const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { generateId, insertMessage } = require('../utils/db-helpers');
const { emitToUser } = require('../utils/socket');

// Create uploads directory
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, generateId() + ext);
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

router.post('/', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });

  const { toUserId } = req.body;
  if (!toUserId) return res.status(400).json({ error: 'toUserId مطلوب' });

  const imageExts = /\.(jpg|jpeg|png|gif|webp)$/i;
  const type = imageExts.test(req.file.originalname) ? 'image' : 'file';
  const url = '/uploads/' + req.file.filename;

  const msg = insertMessage(req.user.id, toUserId, url, type);

  emitToUser(toUserId, 'message:receive', {
    id: msg.id, fromUserId: req.user.id, toUserId, content: url, type, createdAt: msg.createdAt
  });

  res.json({ url, type, id: msg.id });
});

module.exports = router;
