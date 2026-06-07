const Database = require('better-sqlite3');
const path = require('path');

/**
 * Creates a fresh in-memory SQLite database for testing.
 * Returns the db instance after running the schema.
 */
function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
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

  return db;
}

/**
 * Creates an Express app wired to the given db for integration testing.
 */
function createTestApp(db) {
  // Patch the database module before requiring routes
  jest.resetModules();
  jest.doMock('../models/database', () => db);

  const express = require('express');
  const app = express();
  app.use(express.json());

  const authRoutes = require('../routes/auth');
  const friendRoutes = require('../routes/friends');
  const messageRoutes = require('../routes/messages');

  app.use('/api/auth', authRoutes);
  app.use('/api/friends', friendRoutes);
  app.use('/api/messages', messageRoutes);

  return app;
}

module.exports = { createTestDb, createTestApp };
