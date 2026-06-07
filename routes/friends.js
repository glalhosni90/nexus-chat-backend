const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const auth = require('../middleware/auth');

// Send friend request
router.post('/request', auth, (req, res) => {
  const { toUsername } = req.body;
  if (!toUsername || typeof toUsername !== 'string')
    return res.status(400).json({ error: 'toUsername is required' });

  const fromUserId = req.user.id;

  const toUser = db.prepare('SELECT id FROM users WHERE username = ?').get(toUsername.toLowerCase());
  if (!toUser) return res.status(404).json({ error: 'User not found' });
  if (toUser.id === fromUserId) return res.status(400).json({ error: 'Cannot add yourself' });

  // Check if already friends
  const alreadyFriends = db.prepare(`
    SELECT id FROM friendships
    WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
  `).get(fromUserId, toUser.id, toUser.id, fromUserId);
  if (alreadyFriends) return res.status(409).json({ error: 'Already friends' });

  // Check existing request
  const existing = db.prepare(`
    SELECT id, status FROM friend_requests
    WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
  `).get(fromUserId, toUser.id, toUser.id, fromUserId);

  if (existing) return res.status(409).json({ error: 'Request already exists' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(id, fromUserId, toUser.id, new Date().toISOString());

  res.json({ success: true, requestId: id, toUserId: toUser.id });
});

// Accept friend request
router.post('/accept/:requestId', auth, (req, res) => {
  const request = db.prepare(
    'SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = ?'
  ).get(req.params.requestId, req.user.id, 'pending');

  if (!request) return res.status(404).json({ error: 'Request not found' });

  db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run('accepted', request.id);

  const friendshipId = uuidv4();
  db.prepare(`
    INSERT INTO friendships (id, user1_id, user2_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(friendshipId, request.from_user_id, request.to_user_id, new Date().toISOString());

  res.json({ success: true });
});

// Decline/cancel request
router.post('/decline/:requestId', auth, (req, res) => {
  db.prepare(
    'UPDATE friend_requests SET status = ? WHERE id = ? AND (to_user_id = ? OR from_user_id = ?)'
  ).run('declined', req.params.requestId, req.user.id, req.user.id);
  res.json({ success: true });
});

// Get my friends list
router.get('/', auth, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color
    FROM friendships f
    JOIN users u ON (
      CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END = u.id
    )
    WHERE f.user1_id = ? OR f.user2_id = ?
  `).all(req.user.id, req.user.id, req.user.id);
  res.json(friends);
});

// Get pending requests (incoming)
router.get('/requests/incoming', auth, (req, res) => {
  const requests = db.prepare(`
    SELECT fr.id, fr.created_at, u.id as from_user_id, u.username, u.display_name, u.avatar_color
    FROM friend_requests fr
    JOIN users u ON fr.from_user_id = u.id
    WHERE fr.to_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `).all(req.user.id);
  res.json(requests);
});

// Get outgoing pending requests
router.get('/requests/outgoing', auth, (req, res) => {
  const requests = db.prepare(`
    SELECT fr.id, fr.created_at, u.id as to_user_id, u.username, u.display_name
    FROM friend_requests fr
    JOIN users u ON fr.to_user_id = u.id
    WHERE fr.from_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `).all(req.user.id);
  res.json(requests);
});

module.exports = router;
