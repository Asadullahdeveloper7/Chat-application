const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = 'messenger-secret-2024';

// ── In-memory store ──────────────────────────────────────────────────────────
const users = {};          // { userId: userObject }
const friendships = {};    // { userId: { friends: Set, sent: Set, received: Set } }
const conversations = {};  // { convId: [messages] }
const onlineUsers = new Set();

// ── Helpers ──────────────────────────────────────────────────────────────────
const genToken   = (id) => jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
const hashPwd    = (p)  => bcrypt.hashSync(p, 10);
const checkPwd   = (p, h) => bcrypt.compareSync(p, h);
const convId     = (a, b) => [a, b].sort().join('::');
const auth       = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Unauthorized' }); }
};
const initFriends = (id) => {
  if (!friendships[id]) {
    friendships[id] = { friends: new Set(), sent: new Set(), received: new Set() };
  }
};
const safeUser = (u) => ({
  id: u.id, username: u.username, email: u.email,
  bio: u.bio || '', avatar: u.avatar || null, createdAt: u.createdAt
});

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/signup', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (Object.values(users).find(u => u.email === email))
    return res.status(400).json({ error: 'Email already registered' });
  if (Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(400).json({ error: 'Username already taken' });

  const id = Date.now().toString();
  users[id] = { id, username, email, password: hashPwd(password), bio: '', avatar: null, createdAt: new Date() };
  initFriends(id);
  const token = genToken(id);
  res.json({ token, user: safeUser(users[id]) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });
  const user = Object.values(users).find(u => u.email === email);
  if (!user || !checkPwd(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });
  initFriends(user.id);
  const token = genToken(user.id);
  res.json({ token, user: safeUser(user) });
});

// ── Users ────────────────────────────────────────────────────────────────────
// Search / list all users (excluding self)
app.get('/api/users', auth, (req, res) => {
  const { q } = req.query;
  let list = Object.values(users).filter(u => u.id !== req.user.userId);
  if (q) list = list.filter(u => u.username.toLowerCase().includes(q.toLowerCase()));
  res.json(list.map(safeUser));
});

// Get own profile
app.get('/api/me', auth, (req, res) => {
  const user = users[req.user.userId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(safeUser(user));
});

// Update profile (bio + avatar upload)
app.post('/api/me/update', auth, (req, res) => {
  const user = users[req.user.userId];
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (req.body.bio !== undefined) user.bio = req.body.bio;
  if (req.body.username) user.username = req.body.username;

  if (req.files && req.files.avatar) {
    const file = req.files.avatar;
    const filename = `${user.id}-avatar.${file.name.split('.').pop()}`;
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    file.mv(path.join(uploadDir, filename), (err) => {
      if (err) return res.status(500).json({ error: 'Upload failed' });
      user.avatar = `/uploads/${filename}`;
      res.json(safeUser(user));
    });
    return;
  }
  res.json(safeUser(user));
});

// ── Friend Requests ───────────────────────────────────────────────────────────
// Send friend request
app.post('/api/friends/request/:targetId', auth, (req, res) => {
  const me = req.user.userId;
  const them = req.params.targetId;
  if (!users[them]) return res.status(404).json({ error: 'User not found' });
  if (me === them) return res.status(400).json({ error: 'Cannot friend yourself' });

  initFriends(me); initFriends(them);
  const myData = friendships[me];
  const theirData = friendships[them];

  if (myData.friends.has(them)) return res.status(400).json({ error: 'Already friends' });
  if (myData.sent.has(them)) return res.status(400).json({ error: 'Request already sent' });
  if (myData.received.has(them)) {
    // They already sent us a request → auto-accept
    myData.received.delete(them);
    theirData.sent.delete(me);
    myData.friends.add(them);
    theirData.friends.add(me);
    io.to(`user-${them}`).emit('friend-request-accepted', { userId: me, user: safeUser(users[me]) });
    return res.json({ message: 'Friend request accepted', status: 'friends' });
  }

  myData.sent.add(them);
  theirData.received.add(me);
  io.to(`user-${them}`).emit('friend-request', { from: me, user: safeUser(users[me]) });
  res.json({ message: 'Friend request sent', status: 'pending' });
});

// Accept friend request
app.post('/api/friends/accept/:requesterId', auth, (req, res) => {
  const me = req.user.userId;
  const them = req.params.requesterId;
  initFriends(me); initFriends(them);
  const myData = friendships[me];
  const theirData = friendships[them];

  if (!myData.received.has(them)) return res.status(400).json({ error: 'No pending request' });

  myData.received.delete(them);
  theirData.sent.delete(me);
  myData.friends.add(them);
  theirData.friends.add(me);

  io.to(`user-${them}`).emit('friend-request-accepted', { userId: me, user: safeUser(users[me]) });
  res.json({ message: 'Friend request accepted' });
});

// Decline / cancel friend request
app.post('/api/friends/decline/:userId', auth, (req, res) => {
  const me = req.user.userId;
  const them = req.params.userId;
  initFriends(me); initFriends(them);

  friendships[me].received.delete(them);
  friendships[me].sent.delete(them);
  friendships[them].sent.delete(me);
  friendships[them].received.delete(me);

  res.json({ message: 'Request declined' });
});

// Unfriend
app.post('/api/friends/remove/:userId', auth, (req, res) => {
  const me = req.user.userId;
  const them = req.params.userId;
  initFriends(me); initFriends(them);

  friendships[me].friends.delete(them);
  friendships[them].friends.delete(me);
  res.json({ message: 'Unfriended' });
});

// Get friend data (friends list + pending requests)
app.get('/api/friends', auth, (req, res) => {
  const me = req.user.userId;
  initFriends(me);
  const data = friendships[me];

  const friends = [...data.friends].map(id => ({
    ...safeUser(users[id]),
    online: onlineUsers.has(id)
  })).filter(u => u.id);

  const received = [...data.received].map(id => safeUser(users[id])).filter(u => u.id);
  const sent     = [...data.sent].map(id => safeUser(users[id])).filter(u => u.id);

  res.json({ friends, received, sent });
});

// ── Chat ─────────────────────────────────────────────────────────────────────
app.get('/api/chat/:friendId', auth, (req, res) => {
  const cid = convId(req.user.userId, req.params.friendId);
  res.json(conversations[cid] || []);
});

app.post('/api/chat/upload', auth, (req, res) => {
  if (!req.files || !req.files.image)
    return res.status(400).json({ error: 'No image' });
  const file = req.files.image;
  const filename = `msg-${Date.now()}.${file.name.split('.').pop()}`;
  const uploadDir = path.join(__dirname, 'public', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  file.mv(path.join(uploadDir, filename), (err) => {
    if (err) return res.status(500).json({ error: 'Upload failed' });
    res.json({ url: `/uploads/${filename}` });
  });
});

// ── Pages ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth-login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth-signup.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'messenger.html')));

// Legacy routes (keep old links working)
app.get('/auth/login', (req, res) => res.redirect('/login'));
app.get('/auth/signup', (req, res) => res.redirect('/signup'));

// ── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.userId = userId;
    socket.join(`user-${userId}`);
    onlineUsers.add(userId);
    io.emit('online-users', Array.from(onlineUsers));
  });

  socket.on('send-message', (data) => {
    const { senderId, receiverId, text, image } = data;
    const cid = convId(senderId, receiverId);
    if (!conversations[cid]) conversations[cid] = [];

    const msg = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      senderId, receiverId, text: text || '', image: image || null,
      timestamp: new Date(), seen: false
    };
    conversations[cid].push(msg);

    io.to(`user-${receiverId}`).emit('receive-message', { conversationId: cid, message: msg });
    io.to(`user-${senderId}`).emit('message-sent', { conversationId: cid, message: msg });
  });

  socket.on('mark-seen', ({ conversationId, viewerId, senderId }) => {
    const msgs = conversations[conversationId];
    if (msgs) {
      msgs.forEach(m => {
        if (m.senderId === senderId && m.receiverId === viewerId && !m.seen) {
          m.seen = true;
          m.seenAt = new Date();
        }
      });
      io.to(`user-${senderId}`).emit('messages-seen', { conversationId });
    }
  });

  socket.on('typing', ({ senderId, receiverId, name }) => {
    io.to(`user-${receiverId}`).emit('user-typing', { senderId, name });
  });

  socket.on('stop-typing', ({ senderId, receiverId }) => {
    io.to(`user-${receiverId}`).emit('user-stop-typing', { senderId });
  });

  socket.on('delete-message', ({ messageId, conversationId, senderId, receiverId }) => {
    const msgs = conversations[conversationId];
    if (msgs) {
      const idx = msgs.findIndex(m => m.id === messageId);
      if (idx !== -1) {
        msgs.splice(idx, 1);
        io.to(`user-${senderId}`).emit('message-deleted', { messageId, conversationId });
        io.to(`user-${receiverId}`).emit('message-deleted', { messageId, conversationId });
      }
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.userId);
    io.emit('online-users', Array.from(onlineUsers));
  });
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Messenger running → http://localhost:${PORT}`));
