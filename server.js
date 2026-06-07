require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./models/database');
const { insertMessage } = require('./utils/db-helpers');
const { emitToUser } = require('./utils/socket');

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

/**
 * Forward a socket event from the current socket's user to a recipient.
 * Attaches { fromUserId } automatically.
 */
function forwardToUser(socket, toUserId, event, extra = {}) {
  return emitToUser(toUserId, event, { fromUserId: socket.userId, ...extra });
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // User comes online
  socket.on('user:online', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
    io.emit('user:status', { userId, status: 'online' });
    console.log(`User ${userId} is online`);
  });

  // Send message
  socket.on('message:send', (data) => {
    const { toUserId, message, tempId } = data;
    const fromUserId = socket.userId;

    if (!fromUserId) return;

    const msg = insertMessage(fromUserId, toUserId, message);
    const msgObj = { id: msg.id, fromUserId, toUserId, content: message, createdAt: msg.createdAt };

    emitToUser(toUserId, 'message:receive', msgObj);
    socket.emit('message:sent', { ...msgObj, tempId });
  });

  // Typing indicator
  socket.on('typing:start', ({ toUserId }) => {
    forwardToUser(socket, toUserId, 'typing:start');
  });

  socket.on('typing:stop', ({ toUserId }) => {
    forwardToUser(socket, toUserId, 'typing:stop');
  });

  // WebRTC Signaling for voice calls
  socket.on('call:offer', ({ toUserId, offer }) => {
    if (!forwardToUser(socket, toUserId, 'call:offer', { offer })) {
      socket.emit('call:unavailable', { toUserId });
    }
  });

  socket.on('call:answer', ({ toUserId, answer }) => {
    forwardToUser(socket, toUserId, 'call:answer', { answer });
  });

  socket.on('call:ice-candidate', ({ toUserId, candidate }) => {
    forwardToUser(socket, toUserId, 'call:ice-candidate', { candidate });
  });

  socket.on('call:end', ({ toUserId }) => {
    forwardToUser(socket, toUserId, 'call:end');
  });

  socket.on('call:reject', ({ toUserId }) => {
    forwardToUser(socket, toUserId, 'call:reject');
  });

  // Friend request notifications
  socket.on('friend:request:send', ({ toUserId }) => {
    forwardToUser(socket, toUserId, 'friend:request:incoming');
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
