const express = require('express');
const router = express.Router();
const db = require('../models/database');
const auth = require('../middleware/auth');
const { generateId, now, findUserByUsername, findBidirectionalMatch } = require('../utils/db-helpers');

// Send friend request
router.post('/request', auth, (req, res) => {
  const { toUsername } = req.body;
  const fromUserId = req.user.id;

  const toUser = findUserByUsername(toUsername, 'id');
  if (!toUser) return res.status(404).json({ error: 'User not found' });
  if (toUser.id === fromUserId) return res.status(400).json({ error: 'Cannot add yourself' });

  // Check if already friends
  const alreadyFriends = findBidirectionalMatch(
    'friendships', 'user1_id', 'user2_id', fromUserId, toUser.id
  );
  if (alreadyFriends) return res.status(409).json({ error: 'Already friends' });

  // Check existing request
  const existing = findBidirectionalMatch(
    'friend_requests', 'from_user_id', 'to_user_id', fromUserId, toUser.id
  );
  if (existing) return res.status(409).json({ error: 'Request already exists' });

  const id = generateId();
  db.prepare(`
    INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(id, fromUserId, toUser.id, now());

  res.json({ success: true, requestId: id, toUserId: toUser.id });
});

// Accept friend request
router.post('/accept/:requestId', auth, (req, res) => {
  const request = db.prepare(
    'SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = ?'
  ).get(req.params.requestId, req.user.id, 'pending');

  if (!request) return res.status(404).json({ error: 'Request not found' });

  db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run('accepted', request.id);

  const friendshipId = generateId();
  db.prepare(`
    INSERT INTO friendships (id, user1_id, user2_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(friendshipId, request.from_user_id, request.to_user_id, now());

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
