require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./models/database');

const authRoutes = require('./routes/auth');
const friendRoutes = require('./routes/friends');
const messageRoutes = require('./routes/messages');
const uploadRoutes = require('./routes/upload');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/messages', messageRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.1' }));
app.use('/api/messages/upload', uploadRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Socket.io - Online users map
const onlineUsers = new Map();
global.io = io;
global.onlineUsers = onlineUsers; // userId -> socketId

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // User comes online
  socket.on('user:online', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
    // Broadcast to all friends that this user is online
    io.emit('user:status', { userId, status: 'online' });
    console.log(`User ${userId} is online`);
  });

  // Send message
  socket.on('message:send', (data) => {
    const { toUserId, message, tempId } = data;
    const fromUserId = socket.userId;

    if (!fromUserId) return;

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
