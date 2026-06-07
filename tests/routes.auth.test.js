const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const SECRET = 'nexus_secret_change_in_production';

let app, db;

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
  const authRoutes = require('../routes/auth');
  app.use('/api/auth', authRoutes);
});

afterEach(() => {
  if (db) db.close();
});

describe('POST /api/auth/register', () => {
  it('should register a new user and return token + user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'john_doe', displayName: 'John', password: 'securepass123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.username).toBe('john_doe');
    expect(res.body.user.displayName).toBe('John');
    expect(res.body.user.id).toBeDefined();

    // Verify token is valid
    const decoded = jwt.verify(res.body.token, SECRET);
    expect(decoded.username).toBe('john_doe');
  });

  it('should return 400 if fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'john' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('All fields required');
  });

  it('should return 400 if username is too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ab', displayName: 'AB', password: 'pass123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username must be 3-20 characters');
  });

  it('should return 400 if username is too long', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'a'.repeat(21), displayName: 'Long', password: 'pass123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username must be 3-20 characters');
  });

  it('should return 400 if username contains invalid characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'john doe!', displayName: 'John', password: 'pass123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username can only contain letters, numbers, underscore');
  });

  it('should return 409 if username is already taken', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'john_doe', displayName: 'John', password: 'pass123' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'john_doe', displayName: 'John2', password: 'pass456' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Username already taken');
  });

  it('should store username in lowercase', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'JohnDoe', displayName: 'John', password: 'pass123' });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('johndoe');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'testuser', displayName: 'Test', password: 'password123' });
  });

  it('should login successfully with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.username).toBe('testuser');
    expect(res.body.user.displayName).toBe('Test');
  });

  it('should return 400 if fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password required');
  });

  it('should return 401 for non-existent username', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: 'pass123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('should return 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('should handle case-insensitive username login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'TestUser', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('testuser');
  });
});

describe('GET /api/auth/search/:username', () => {
  let token;

  beforeEach(async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'searcher', displayName: 'Searcher', password: 'pass123' });
    token = reg.body.token;

    await request(app)
      .post('/api/auth/register')
      .send({ username: 'target_user', displayName: 'Target', password: 'pass123' });
  });

  it('should find an existing user by username', async () => {
    const res = await request(app)
      .get('/api/auth/search/target_user')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('target_user');
    expect(res.body.display_name).toBe('Target');
  });

  it('should return 404 for non-existent user', async () => {
    const res = await request(app)
      .get('/api/auth/search/nobody')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .get('/api/auth/search/target_user');

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  let token;

  beforeEach(async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'myuser', displayName: 'My User', password: 'pass123' });
    token = reg.body.token;
  });

  it('should return current user info', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('myuser');
    expect(res.body.display_name).toBe('My User');
    expect(res.body.id).toBeDefined();
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .get('/api/auth/me');

    expect(res.status).toBe(401);
  });
});
