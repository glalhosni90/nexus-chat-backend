const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../nexus.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
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

console.log('Database initialized');
module.exports = db;
