const express = require('express');
const router = express.Router();
const db = require('../models/database');
const auth = require('../middleware/auth');

// Get conversation with a friend
router.get('/:friendId', auth, (req, res, next) => {
  try {
    const { friendId } = req.params;
    const myId = req.user.id;
    const limit = parseInt(req.query.limit) || 50;
    const before = req.query.before;

    let query = `
      SELECT m.id, m.from_user_id, m.to_user_id, m.content, m.type, m.is_read, m.created_at
      FROM messages m
      WHERE (m.from_user_id = ? AND m.to_user_id = ?)
         OR (m.from_user_id = ? AND m.to_user_id = ?)
    `;
    const params = [myId, friendId, friendId, myId];

    if (before) {
      query += ' AND m.created_at < ?';
      params.push(before);
    }

    query += ' ORDER BY m.created_at DESC LIMIT ?';
    params.push(limit);

    const messages = db.prepare(query).all(...params).reverse();

    // Mark as read
    db.prepare(`
      UPDATE messages SET is_read = 1
      WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0
    `).run(friendId, myId);

    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// Get unread counts for all friends
router.get('/unread/counts', auth, (req, res, next) => {
  try {
    const counts = db.prepare(`
      SELECT from_user_id, COUNT(*) as count
      FROM messages
      WHERE to_user_id = ? AND is_read = 0
      GROUP BY from_user_id
    `).all(req.user.id);
    res.json(counts);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
