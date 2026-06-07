const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const SECRET = 'nexus_secret_change_in_production';

let app, db;

function createUser(id, username, displayName) {
  const passwordHash = bcrypt.hashSync('pass123', 10);
  db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, avatar_color, created_at)
    VALUES (?, ?, ?, ?, '#6366f1', ?)
  `).run(id, username, displayName, passwordHash, new Date().toISOString());
  return jwt.sign({ id, username }, SECRET, { expiresIn: '1h' });
}

function insertMessage(id, fromId, toId, content, isRead, createdAt) {
  db.prepare(`
    INSERT INTO messages (id, from_user_id, to_user_id, content, type, is_read, created_at)
    VALUES (?, ?, ?, ?, 'text', ?, ?)
  `).run(id, fromId, toId, content, isRead ? 1 : 0, createdAt);
}

beforeEach(() => {
  jest.resetModules();

  const Database = require('better-sqlite3');
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_color TEXT DEFAULT '#6366f1',
      status TEXT DEFAULT 'offline',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id),
      UNIQUE(from_user_id, to_user_id)
    );
    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user1_id TEXT NOT NULL,
      user2_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user1_id) REFERENCES users(id),
      FOREIGN KEY (user2_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id)
    );
  `);

  jest.doMock('../models/database', () => db);

  const express = require('express');
  app = express();
  app.use(express.json());
  const messageRoutes = require('../routes/messages');
  app.use('/api/messages', messageRoutes);
});

afterEach(() => {
  if (db) db.close();
});

describe('GET /api/messages/:friendId', () => {
  let tokenA;

  beforeEach(() => {
    tokenA = createUser('user-a', 'alice', 'Alice');
    createUser('user-b', 'bob', 'Bob');

    // Insert messages
    insertMessage('msg-1', 'user-a', 'user-b', 'Hello Bob', false, '2024-01-01T10:00:00Z');
    insertMessage('msg-2', 'user-b', 'user-a', 'Hi Alice', false, '2024-01-01T10:01:00Z');
    insertMessage('msg-3', 'user-a', 'user-b', 'How are you?', false, '2024-01-01T10:02:00Z');
  });

  it('should return conversation messages between two users', async () => {
    const res = await request(app)
      .get('/api/messages/user-b')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    // Should be in chronological order (reversed from DESC)
    expect(res.body[0].content).toBe('Hello Bob');
    expect(res.body[1].content).toBe('Hi Alice');
    expect(res.body[2].content).toBe('How are you?');
  });

  it('should respect the limit parameter', async () => {
    const res = await request(app)
      .get('/api/messages/user-b?limit=2')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Should get the 2 most recent messages (DESC then reversed)
    expect(res.body[0].content).toBe('Hi Alice');
    expect(res.body[1].content).toBe('How are you?');
  });

  it('should support pagination with before parameter', async () => {
    const res = await request(app)
      .get('/api/messages/user-b')
      .query({ before: '2024-01-01T10:02:00Z' })
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].content).toBe('Hello Bob');
    expect(res.body[1].content).toBe('Hi Alice');
  });

  it('should mark messages from friend as read', async () => {
    // Before: messages from bob are unread
    const unreadBefore = db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0'
    ).get('user-b', 'user-a');
    expect(unreadBefore.count).toBe(1);

    await request(app)
      .get('/api/messages/user-b')
      .set('Authorization', `Bearer ${tokenA}`);

    // After: messages from bob should be marked as read
    const unreadAfter = db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0'
    ).get('user-b', 'user-a');
    expect(unreadAfter.count).toBe(0);
  });

  it('should return empty array if no messages exist', async () => {
    createUser('user-c', 'charlie', 'Charlie');

    const res = await request(app)
      .get('/api/messages/user-c')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/messages/user-b');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/messages/unread/counts', () => {
  let tokenA;

  beforeEach(() => {
    tokenA = createUser('user-a', 'alice', 'Alice');
    createUser('user-b', 'bob', 'Bob');
    createUser('user-c', 'charlie', 'Charlie');

    // Unread messages from bob to alice
    insertMessage('msg-1', 'user-b', 'user-a', 'Hey!', false, '2024-01-01T10:00:00Z');
    insertMessage('msg-2', 'user-b', 'user-a', 'You there?', false, '2024-01-01T10:01:00Z');
    // Unread message from charlie to alice
    insertMessage('msg-3', 'user-c', 'user-a', 'Hi', false, '2024-01-01T10:02:00Z');
    // Already read message (should not be counted)
    insertMessage('msg-4', 'user-b', 'user-a', 'old msg', true, '2024-01-01T09:00:00Z');
  });

  it('should return unread counts grouped by sender', async () => {
    const res = await request(app)
      .get('/api/messages/unread/counts')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const bobCount = res.body.find(c => c.from_user_id === 'user-b');
    const charlieCount = res.body.find(c => c.from_user_id === 'user-c');

    expect(bobCount.count).toBe(2);
    expect(charlieCount.count).toBe(1);
  });

  it('should return empty array if no unread messages', async () => {
    // Mark all as read
    db.prepare('UPDATE messages SET is_read = 1').run();

    const res = await request(app)
      .get('/api/messages/unread/counts')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/messages/unread/counts');
    expect(res.status).toBe(401);
  });
});
