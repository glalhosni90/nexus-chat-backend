const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const auth = require('../middleware/auth');

// Create uploads directory
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|zip|txt|mp3|mp4/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    cb(null, allowed.test(ext));
  }
});

router.post('/', auth, upload.single('file'), (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { toUserId } = req.body;
  if (!toUserId) return res.status(400).json({ error: 'toUserId is required' });

  const imageExts = /\.(jpg|jpeg|png|gif|webp)$/i;
  const type = imageExts.test(req.file.originalname) ? 'image' : 'file';
  const url = '/uploads/' + req.file.filename;
  const msgId = uuidv4();
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO messages (id, from_user_id, to_user_id, content, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(msgId, req.user.id, toUserId, url, type, now);
  } catch (err) {
    // Clean up the uploaded file if DB insert fails
    const filePath = path.join(uploadDir, req.file.filename);
    fs.unlink(filePath, () => {});
    return next(err);
  }

  // Emit to recipient via socket
  if (global.io) {
    const { onlineUsers } = global;
    const recipientSocket = onlineUsers?.get(toUserId);
    if (recipientSocket) {
      global.io.to(recipientSocket).emit('message:receive', {
        id: msgId, fromUserId: req.user.id, toUserId, content: url, type, createdAt: now
      });
    }
  }

  res.json({ url, type, id: msgId });
});

module.exports = router;
