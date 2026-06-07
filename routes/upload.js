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
    const allowedExts = /jpeg|jpg|png|gif|webp|pdf|doc|docx|zip|txt|mp3|mp4/;
    const allowedMimes = /image\/(jpeg|png|gif|webp)|application\/(pdf|msword|vnd\.openxmlformats|zip|octet-stream)|text\/plain|audio\/mpeg|video\/mp4/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mimeValid = allowedMimes.test(file.mimetype);
    const extValid = allowedExts.test(ext);
    cb(null, extValid && mimeValid);
  }
});

router.post('/', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });

  const { toUserId } = req.body;
  if (!toUserId) return res.status(400).json({ error: 'toUserId مطلوب' });

  const imageExts = /\.(jpg|jpeg|png|gif|webp)$/i;
  const type = imageExts.test(req.file.originalname) ? 'image' : 'file';
  const url = '/uploads/' + req.file.filename;
  const msgId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO messages (id, from_user_id, to_user_id, content, type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msgId, req.user.id, toUserId, url, type, now);

  // Emit to recipient via socket (handled in server.js via global io)
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
