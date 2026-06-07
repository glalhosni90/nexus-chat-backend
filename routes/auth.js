const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');

const SECRET = process.env.JWT_SECRET || 'nexus_secret_change_in_production';

// Register
router.post('/register', async (req, res, next) => {
  try {
    const { username, displayName, password } = req.body;
    if (!username || !displayName || !password)
      return res.status(400).json({ error: 'All fields required' });

    if (username.length < 3 || username.length > 20)
      return res.status(400).json({ error: 'Username must be 3-20 characters' });

    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return res.status(400).json({ error: 'Username can only contain letters, numbers, underscore' });

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, avatar_color, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, username.toLowerCase(), displayName, passwordHash, avatarColor, now);

    const token = jwt.sign({ id, username: username.toLowerCase() }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, username: username.toLowerCase(), displayName, avatarColor } });
  } catch (err) {
    next(err);
  }
});

// Login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user.id, username: user.username, displayName: user.display_name, avatarColor: user.avatar_color }
    });
  } catch (err) {
    next(err);
  }
});

// Search user by username
router.get('/search/:username', require('../middleware/auth'), (req, res) => {
  const user = db.prepare(
    'SELECT id, username, display_name, avatar_color FROM users WHERE username = ?'
  ).get(req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Get current user
router.get('/me', require('../middleware/auth'), (req, res, next) => {
  try {
    const user = db.prepare(
      'SELECT id, username, display_name, avatar_color, created_at FROM users WHERE id = ?'
    ).get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
