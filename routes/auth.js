const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models/database');
const { JWT_SECRET } = require('../utils/config');
const { generateId, now, findUserByUsername } = require('../utils/db-helpers');

// Register
router.post('/register', async (req, res) => {
  const { username, displayName, password } = req.body;
  if (!username || !displayName || !password)
    return res.status(400).json({ error: 'All fields required' });

  if (username.length < 3 || username.length > 20)
    return res.status(400).json({ error: 'Username must be 3-20 characters' });

  if (!/^[a-zA-Z0-9_]+$/.test(username))
    return res.status(400).json({ error: 'Username can only contain letters, numbers, underscore' });

  const existing = findUserByUsername(username, 'id');
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const passwordHash = await bcrypt.hash(password, 10);
  const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];
  const avatarColor = colors[Math.floor(Math.random() * colors.length)];
  const id = generateId();
  const createdAt = now();

  db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, avatar_color, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, username.toLowerCase(), displayName, passwordHash, avatarColor, createdAt);

  const token = jwt.sign({ id, username: username.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id, username: username.toLowerCase(), displayName, avatarColor } });
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const user = findUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    token,
    user: { id: user.id, username: user.username, displayName: user.display_name, avatarColor: user.avatar_color }
  });
});

// Search user by username
router.get('/search/:username', require('../middleware/auth'), (req, res) => {
  const user = findUserByUsername(req.params.username, 'id, username, display_name, avatar_color');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Get current user
router.get('/me', require('../middleware/auth'), (req, res) => {
  const user = db.prepare(
    'SELECT id, username, display_name, avatar_color, created_at FROM users WHERE id = ?'
  ).get(req.user.id);
  res.json(user);
});

module.exports = router;
