const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
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

  // Mock global.io and global.onlineUsers for socket tests
  global.io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  global.onlineUsers = new Map();

  const express = require('express');
  app = express();
  app.use(express.json());
  const uploadRoutes = require('../routes/upload');
  app.use('/api/upload', uploadRoutes);
});

afterEach(() => {
  if (db) db.close();
  delete global.io;
  delete global.onlineUsers;
});

describe('POST /api/upload', () => {
  let tokenA;
  const testFilePath = path.join(__dirname, 'test-file.txt');
  const testImagePath = path.join(__dirname, 'test-image.png');

  beforeAll(() => {
    // Create test files
    fs.writeFileSync(testFilePath, 'Hello, this is a test file content.');
    // Create a minimal PNG (1x1 pixel)
    const pngBuffer = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000a49444154789c626000000002000198e7399f0000000049454e44ae426082',
      'hex'
    );
    fs.writeFileSync(testImagePath, pngBuffer);
  });

  afterAll(() => {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    if (fs.existsSync(testImagePath)) fs.unlinkSync(testImagePath);
    // Clean up uploads directory
    const uploadDir = path.join(__dirname, '../uploads');
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      files.forEach(f => fs.unlinkSync(path.join(uploadDir, f)));
    }
  });

  beforeEach(() => {
    tokenA = createUser('user-a', 'alice', 'Alice');
    createUser('user-b', 'bob', 'Bob');
  });

  it('should upload a text file and create a message', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('toUserId', 'user-b')
      .attach('file', testFilePath);

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\//);
    expect(res.body.type).toBe('file');
    expect(res.body.id).toBeDefined();

    // Verify message was stored in DB
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(res.body.id);
    expect(msg).toBeDefined();
    expect(msg.from_user_id).toBe('user-a');
    expect(msg.to_user_id).toBe('user-b');
    expect(msg.type).toBe('file');
  });

  it('should upload an image file and set type to image', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('toUserId', 'user-b')
      .attach('file', testImagePath);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('image');
  });

  it('should return 400 if no file is uploaded', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('toUserId', 'user-b');

    expect(res.status).toBe(400);
  });

  it('should return 400 if toUserId is not provided', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', testFilePath);

    expect(res.status).toBe(400);
  });

  it('should emit socket event to online recipient', async () => {
    global.onlineUsers.set('user-b', 'socket-b');

    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('toUserId', 'user-b')
      .attach('file', testFilePath);

    expect(res.status).toBe(200);
    expect(global.io.to).toHaveBeenCalledWith('socket-b');
    expect(global.io.emit).toHaveBeenCalledWith('message:receive', expect.objectContaining({
      fromUserId: 'user-a',
      toUserId: 'user-b',
      type: 'file',
    }));
  });

  it('should not emit socket event if recipient is offline', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('toUserId', 'user-b')
      .attach('file', testFilePath);

    expect(res.status).toBe(200);
    expect(global.io.to).not.toHaveBeenCalled();
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/upload')
      .field('toUserId', 'user-b')
      .attach('file', testFilePath);

    expect(res.status).toBe(401);
  });

  it('should reject disallowed file types', async () => {
    const exePath = path.join(__dirname, 'test-file.exe');
    fs.writeFileSync(exePath, 'fake exe content');

    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('toUserId', 'user-b')
      .attach('file', exePath);

    // multer's fileFilter rejects it by passing false, resulting in no req.file
    expect(res.status).toBe(400);

    fs.unlinkSync(exePath);
  });
});
