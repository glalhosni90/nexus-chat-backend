require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const db = require('./models/database');
const { getJwtSecret } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const friendRoutes = require('./routes/friends');
const messageRoutes = require('./routes/messages');
const uploadRoutes = require('./routes/upload');
const path = require('path');

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : [];

const corsOptions = {
  origin: allowedOrigins.length > 0
    ? (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    : false,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
};

const io = new Server(server, { cors: corsOptions });

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later' },
});

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/messages', messageRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/messages/upload', uploadRoutes);
app.use('/uploads', require('./middleware/auth'), express.static(path.join(__dirname, 'uploads')));

// Socket.io - Online users map
const onlineUsers = new Map();
global.io = io;
global.onlineUsers = onlineUsers; // userId -> socketId

// Socket.io JWT authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    socket.userId = decoded.id;
    socket.username = decoded.username;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  // User automatically online on authenticated connection
  onlineUsers.set(socket.userId, socket.id);
  io.emit('user:status', { userId: socket.userId, status: 'online' });

  // Send message
  socket.on('message:send', (data) => {
    if (!data || typeof data !== 'object') return;
    const { toUserId, message, tempId } = data;
    const fromUserId = socket.userId;

    if (!fromUserId || !toUserId || !message) return;
    if (typeof message !== 'string' || message.length > 5000) return;

    // Save to DB
    const stmt = db.prepare(`
      INSERT INTO messages (id, from_user_id, to_user_id, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const msgId = require('uuid').v4();
    const now = new Date().toISOString();
    stmt.run(msgId, fromUserId, toUserId, message, now);

    const msgObj = { id: msgId, fromUserId, toUserId, content: message, createdAt: now };

    // Send to recipient if online
    const recipientSocket = onlineUsers.get(toUserId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('message:receive', msgObj);
    }

    // Confirm to sender
    socket.emit('message:sent', { ...msgObj, tempId });
  });

  // Typing indicator
  socket.on('typing:start', ({ toUserId }) => {
    const recipientSocket = onlineUsers.get(toUserId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('typing:start', { fromUserId: socket.userId });
    }
  });

  socket.on('typing:stop', ({ toUserId }) => {
    const recipientSocket = onlineUsers.get(toUserId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('typing:stop', { fromUserId: socket.userId });
    }
  });

  // WebRTC Signaling for voice calls
  socket.on('call:offer', ({ toUserId, offer }) => {
    const recipientSocket = onlineUsers.get(toUserId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('call:offer', { fromUserId: socket.userId, offer });
    } else {
      socket.emit('call:unavailable', { toUserId });
    }
  });

  socket.on('call:answer', ({ toUserId, answer }) => {
    const recipientSocket = onlineUsers.get(toUserId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('call:answer', { fromUserId: socket.userId, answer });
    }
  });

  socket.on('call:ice-candidate', ({ toUserId, candidate }) => {
    const recipientSocket = onlineUsers.get(toUserId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('call:ice-candidate', { fromUserId: socket.userId, candidate });
    }
  });

  socket.on('call:end', ({ toUserId }) => {
    const recipientSocket = onlineUsers.get(toUserId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('call:end', { fromUserId: socket.userId });
    }
  });

  socket.on('call:reject', ({ toUserId }) => {
    const recipientSocket = onlineUsers.get(toUserId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('call:reject', { fromUserId: socket.userId });
    }
  });

  // Friend request notifications
  socket.on('friend:request:send', ({ toUserId }) => {
    const recipientSocket = onlineUsers.get(toUserId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('friend:request:incoming', { fromUserId: socket.userId });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      io.emit('user:status', { userId: socket.userId, status: 'offline' });
      console.log(`User ${socket.userId} went offline`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`NexusChat server running on port ${PORT}`);
});
