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
  const friendRoutes = require('../routes/friends');
  app.use('/api/friends', friendRoutes);
});

afterEach(() => {
  if (db) db.close();
});

describe('POST /api/friends/request', () => {
  let tokenA, tokenB;

  beforeEach(() => {
    tokenA = createUser('user-a', 'alice', 'Alice');
    tokenB = createUser('user-b', 'bob', 'Bob');
  });

  it('should send a friend request successfully', async () => {
    const res = await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ toUsername: 'bob' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBeDefined();
    expect(res.body.toUserId).toBe('user-b');
  });

  it('should return 404 if target user does not exist', async () => {
    const res = await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ toUsername: 'nonexistent' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('should return 400 when trying to add yourself', async () => {
    const res = await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ toUsername: 'alice' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cannot add yourself');
  });

  it('should return 409 if already friends', async () => {
    // Create a friendship directly
    db.prepare(`
      INSERT INTO friendships (id, user1_id, user2_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), 'user-a', 'user-b', new Date().toISOString());

    const res = await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ toUsername: 'bob' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Already friends');
  });

  it('should return 409 if a request already exists', async () => {
    await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ toUsername: 'bob' });

    const res = await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ toUsername: 'bob' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Request already exists');
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/friends/request')
      .send({ toUsername: 'bob' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/friends/accept/:requestId', () => {
  let tokenA, tokenB, requestId;

  beforeEach(async () => {
    tokenA = createUser('user-a', 'alice', 'Alice');
    tokenB = createUser('user-b', 'bob', 'Bob');

    const res = await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ toUsername: 'bob' });
    requestId = res.body.requestId;
  });

  it('should accept a friend request', async () => {
    const res = await request(app)
      .post(`/api/friends/accept/${requestId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify friendship was created
    const friendship = db.prepare(
      'SELECT * FROM friendships WHERE user1_id = ? AND user2_id = ?'
    ).get('user-a', 'user-b');
    expect(friendship).toBeDefined();
  });

  it('should return 404 if request does not exist', async () => {
    const res = await request(app)
      .post('/api/friends/accept/nonexistent-id')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Request not found');
  });

  it('should not allow the sender to accept their own request', async () => {
    const res = await request(app)
      .post(`/api/friends/accept/${requestId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Request not found');
  });
});

describe('POST /api/friends/decline/:requestId', () => {
  let tokenA, tokenB, requestId;

  beforeEach(async () => {
    tokenA = createUser('user-a', 'alice', 'Alice');
    tokenB = createUser('user-b', 'bob', 'Bob');

    const res = await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ toUsername: 'bob' });
    requestId = res.body.requestId;
  });

  it('should decline a friend request (as recipient)', async () => {
    const res = await request(app)
      .post(`/api/friends/decline/${requestId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify status changed
    const fr = db.prepare('SELECT status FROM friend_requests WHERE id = ?').get(requestId);
    expect(fr.status).toBe('declined');
  });

  it('should allow sender to cancel their own request', async () => {
    const res = await request(app)
      .post(`/api/friends/decline/${requestId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/friends', () => {
  let tokenA;

  beforeEach(() => {
    tokenA = createUser('user-a', 'alice', 'Alice');
    createUser('user-b', 'bob', 'Bob');
    createUser('user-c', 'charlie', 'Charlie');

    // Create friendships
    db.prepare(`
      INSERT INTO friendships (id, user1_id, user2_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), 'user-a', 'user-b', new Date().toISOString());
    db.prepare(`
      INSERT INTO friendships (id, user1_id, user2_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), 'user-c', 'user-a', new Date().toISOString());
  });

  it('should return all friends of the user', async () => {
    const res = await request(app)
      .get('/api/friends')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const usernames = res.body.map(f => f.username);
    expect(usernames).toContain('bob');
    expect(usernames).toContain('charlie');
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/friends');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/friends/requests/incoming', () => {
  let tokenB;

  beforeEach(() => {
    const tokenA = createUser('user-a', 'alice', 'Alice');
    tokenB = createUser('user-b', 'bob', 'Bob');

    db.prepare(`
      INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(uuidv4(), 'user-a', 'user-b', new Date().toISOString());
  });

  it('should return incoming pending requests', async () => {
    const res = await request(app)
      .get('/api/friends/requests/incoming')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe('alice');
  });
});

describe('GET /api/friends/requests/outgoing', () => {
  let tokenA;

  beforeEach(() => {
    tokenA = createUser('user-a', 'alice', 'Alice');
    createUser('user-b', 'bob', 'Bob');

    db.prepare(`
      INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(uuidv4(), 'user-a', 'user-b', new Date().toISOString());
  });

  it('should return outgoing pending requests', async () => {
    const res = await request(app)
      .get('/api/friends/requests/outgoing')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe('bob');
  });
});
