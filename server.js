const express    = require('express');
const http       = require('http');
const socketIo   = require('socket.io');
const path       = require('path');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const cors       = require('cors');
const fileUpload = require('express-fileupload');
const fs         = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = 'messenger-secret-2024';

// ─────────────────────────────────────────────────────
//  IN-MEMORY STORE
// ─────────────────────────────────────────────────────
const users         = {};   // { userId: user }
const friendships   = {};   // { userId: { friends:Set, sent:Set, received:Set } }
const conversations = {};   // { convId: [messages] }
const groups        = {};   // { groupId: group }
const groupMsgs     = {};   // { groupId: [messages] }
const onlineUsers   = new Set();
const userStatus    = {};   // { userId: { emoji, text } }

// ─────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────
const genToken    = id  => jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
const hashPwd     = p   => bcrypt.hashSync(p, 10);
const checkPwd    = (p,h)=> bcrypt.compareSync(p, h);
const dmId        = (a,b)=> [a,b].sort().join('::');
const genId       = ()   => Date.now().toString(36) + Math.random().toString(36).slice(2);

const auth = (req, res, next) => {
  try {
    const t = req.headers.authorization?.split(' ')[1];
    req.user = jwt.verify(t, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Unauthorized' }); }
};

const initFriends = id => {
  if (!friendships[id])
    friendships[id] = { friends: new Set(), sent: new Set(), received: new Set() };
};

const safeUser = u => ({
  id: u.id, username: u.username, email: u.email,
  bio: u.bio || '', avatar: u.avatar || null,
  createdAt: u.createdAt,
  status: userStatus[u.id] || null
});

const safeGroup = g => ({
  id: g.id, name: g.name, avatar: g.avatar || null,
  description: g.description || '',
  members: g.members, admins: g.admins,
  createdBy: g.createdBy, createdAt: g.createdAt
});

// ─────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────
app.post('/api/auth/signup', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (Object.values(users).find(u => u.email === email))
    return res.status(400).json({ error: 'Email already registered' });
  if (Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(400).json({ error: 'Username taken' });

  const id = genId();
  users[id] = { id, username, email, password: hashPwd(password), bio: '', avatar: null, createdAt: new Date() };
  initFriends(id);
  res.json({ token: genToken(id), user: safeUser(users[id]) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = Object.values(users).find(u => u.email === email);
  if (!user || !checkPwd(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });
  initFriends(user.id);
  res.json({ token: genToken(user.id), user: safeUser(user) });
});

// ─────────────────────────────────────────────────────
//  USERS
// ─────────────────────────────────────────────────────
app.get('/api/me', auth, (req, res) => {
  const u = users[req.user.userId];
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(safeUser(u));
});

app.post('/api/me/update', auth, (req, res) => {
  const u = users[req.user.userId];
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (req.body.bio      !== undefined) u.bio      = req.body.bio;
  if (req.body.username)               u.username = req.body.username;

  if (req.files?.avatar) {
    const file = req.files.avatar;
    const fname = `${u.id}-avatar.${file.name.split('.').pop()}`;
    const dir   = path.join(__dirname, 'public', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    file.mv(path.join(dir, fname), err => {
      if (err) return res.status(500).json({ error: 'Upload failed' });
      u.avatar = `/uploads/${fname}`;
      res.json(safeUser(u));
    });
    return;
  }
  res.json(safeUser(u));
});

app.get('/api/users', auth, (req, res) => {
  const { q } = req.query;
  let list = Object.values(users).filter(u => u.id !== req.user.userId);
  if (q) list = list.filter(u => u.username.toLowerCase().includes(q.toLowerCase()));
  res.json(list.map(safeUser));
});

// Status (emoji + text)
app.post('/api/me/status', auth, (req, res) => {
  const { emoji, text } = req.body;
  userStatus[req.user.userId] = { emoji: emoji || '', text: text || '' };
  io.emit('user-status-update', { userId: req.user.userId, status: userStatus[req.user.userId] });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────
//  FRIENDS
// ─────────────────────────────────────────────────────
app.post('/api/friends/request/:targetId', auth, (req, res) => {
  const me = req.user.userId, them = req.params.targetId;
  if (!users[them]) return res.status(404).json({ error: 'User not found' });
  if (me === them)  return res.status(400).json({ error: 'Cannot friend yourself' });
  initFriends(me); initFriends(them);
  const my = friendships[me], th = friendships[them];

  if (my.friends.has(them)) return res.status(400).json({ error: 'Already friends' });
  if (my.sent.has(them))    return res.status(400).json({ error: 'Request already sent' });
  if (my.received.has(them)) {
    my.received.delete(them); th.sent.delete(me);
    my.friends.add(them);     th.friends.add(me);
    io.to(`user-${them}`).emit('friend-request-accepted', { userId: me, user: safeUser(users[me]) });
    return res.json({ message: 'Auto-accepted', status: 'friends' });
  }
  my.sent.add(them); th.received.add(me);
  io.to(`user-${them}`).emit('friend-request', { from: me, user: safeUser(users[me]) });
  res.json({ message: 'Request sent', status: 'pending' });
});

app.post('/api/friends/accept/:id', auth, (req, res) => {
  const me = req.user.userId, them = req.params.id;
  initFriends(me); initFriends(them);
  if (!friendships[me].received.has(them)) return res.status(400).json({ error: 'No request' });
  friendships[me].received.delete(them); friendships[them].sent.delete(me);
  friendships[me].friends.add(them);     friendships[them].friends.add(me);
  io.to(`user-${them}`).emit('friend-request-accepted', { userId: me, user: safeUser(users[me]) });
  res.json({ message: 'Accepted' });
});

app.post('/api/friends/decline/:id', auth, (req, res) => {
  const me = req.user.userId, them = req.params.id;
  initFriends(me); initFriends(them);
  friendships[me].received.delete(them); friendships[me].sent.delete(them);
  friendships[them].sent.delete(me);     friendships[them].received.delete(me);
  res.json({ message: 'Declined' });
});

app.post('/api/friends/remove/:id', auth, (req, res) => {
  const me = req.user.userId, them = req.params.id;
  initFriends(me); initFriends(them);
  friendships[me].friends.delete(them); friendships[them].friends.delete(me);
  res.json({ message: 'Unfriended' });
});

app.get('/api/friends', auth, (req, res) => {
  const me = req.user.userId; initFriends(me);
  const d  = friendships[me];
  res.json({
    friends:  [...d.friends].map(id => ({ ...safeUser(users[id]), online: onlineUsers.has(id) })).filter(u => u.id),
    received: [...d.received].map(id => safeUser(users[id])).filter(u => u.id),
    sent:     [...d.sent].map(id => safeUser(users[id])).filter(u => u.id)
  });
});

// ─────────────────────────────────────────────────────
//  DM CHAT
// ─────────────────────────────────────────────────────
app.get('/api/chat/:friendId', auth, (req, res) => {
  res.json(conversations[dmId(req.user.userId, req.params.friendId)] || []);
});

app.post('/api/chat/upload', auth, (req, res) => {
  if (!req.files?.image) return res.status(400).json({ error: 'No image' });
  const file  = req.files.image;
  const fname = `msg-${genId()}.${file.name.split('.').pop()}`;
  const dir   = path.join(__dirname, 'public', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  file.mv(path.join(dir, fname), err => {
    if (err) return res.status(500).json({ error: 'Upload failed' });
    res.json({ url: `/uploads/${fname}` });
  });
});

// ─────────────────────────────────────────────────────
//  GROUPS
// ─────────────────────────────────────────────────────
app.post('/api/groups', auth, (req, res) => {
  const { name, memberIds, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name required' });
  const me      = req.user.userId;
  const members = [me, ...(memberIds || [])].filter((v,i,a) => a.indexOf(v) === i);
  const id      = 'g_' + genId();
  groups[id] = {
    id, name, description: description || '',
    members, admins: [me], createdBy: me,
    avatar: null, createdAt: new Date()
  };
  groupMsgs[id] = [];
  members.forEach(uid => io.to(`user-${uid}`).emit('group-created', safeGroup(groups[id])));
  res.json(safeGroup(groups[id]));
});

app.get('/api/groups', auth, (req, res) => {
  const me  = req.user.userId;
  const list = Object.values(groups).filter(g => g.members.includes(me));
  res.json(list.map(safeGroup));
});

app.get('/api/groups/:gid', auth, (req, res) => {
  const g = groups[req.params.gid];
  if (!g) return res.status(404).json({ error: 'Group not found' });
  if (!g.members.includes(req.user.userId)) return res.status(403).json({ error: 'Not a member' });
  res.json({ ...safeGroup(g), memberDetails: g.members.map(id => safeUser(users[id])).filter(Boolean) });
});

app.post('/api/groups/:gid/add', auth, (req, res) => {
  const g = groups[req.params.gid];
  if (!g) return res.status(404).json({ error: 'Not found' });
  if (!g.admins.includes(req.user.userId)) return res.status(403).json({ error: 'Admins only' });
  const { userId } = req.body;
  if (!users[userId]) return res.status(404).json({ error: 'User not found' });
  if (!g.members.includes(userId)) {
    g.members.push(userId);
    io.to(`user-${userId}`).emit('group-created', safeGroup(g));
    g.members.forEach(uid => io.to(`user-${uid}`).emit('group-updated', safeGroup(g)));
  }
  res.json(safeGroup(g));
});

app.post('/api/groups/:gid/leave', auth, (req, res) => {
  const g = groups[req.params.gid];
  if (!g) return res.status(404).json({ error: 'Not found' });
  const me = req.user.userId;
  g.members = g.members.filter(id => id !== me);
  g.admins  = g.admins.filter(id => id !== me);
  g.members.forEach(uid => io.to(`user-${uid}`).emit('group-updated', safeGroup(g)));
  res.json({ message: 'Left group' });
});

app.get('/api/groups/:gid/messages', auth, (req, res) => {
  const g = groups[req.params.gid];
  if (!g || !g.members.includes(req.user.userId)) return res.status(403).json({ error: 'No access' });
  res.json(groupMsgs[req.params.gid] || []);
});

app.post('/api/groups/:gid/avatar', auth, (req, res) => {
  const g = groups[req.params.gid];
  if (!g) return res.status(404).json({ error: 'Not found' });
  if (!g.admins.includes(req.user.userId)) return res.status(403).json({ error: 'Admins only' });
  if (!req.files?.avatar) return res.status(400).json({ error: 'No file' });
  const file  = req.files.avatar;
  const fname = `${req.params.gid}-avatar.${file.name.split('.').pop()}`;
  const dir   = path.join(__dirname, 'public', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  file.mv(path.join(dir, fname), err => {
    if (err) return res.status(500).json({ error: 'Upload failed' });
    g.avatar = `/uploads/${fname}`;
    g.members.forEach(uid => io.to(`user-${uid}`).emit('group-updated', safeGroup(g)));
    res.json(safeGroup(g));
  });
});

// ─────────────────────────────────────────────────────
//  PAGES
// ─────────────────────────────────────────────────────
app.get('/',         (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login',    (_req, res) => res.sendFile(path.join(__dirname, 'public', 'auth-login.html')));
app.get('/signup',   (_req, res) => res.sendFile(path.join(__dirname, 'public', 'auth-signup.html')));
app.get('/chat',     (_req, res) => res.sendFile(path.join(__dirname, 'public', 'messenger.html')));
app.get('/auth/login',  (_req, res) => res.redirect('/login'));
app.get('/auth/signup', (_req, res) => res.redirect('/signup'));

// ─────────────────────────────────────────────────────
//  SOCKET.IO
// ─────────────────────────────────────────────────────
io.on('connection', socket => {

  // ── Join ──────────────────────────────────────────
  socket.on('join', userId => {
    socket.userId = userId;
    socket.join(`user-${userId}`);
    onlineUsers.add(userId);
    io.emit('online-users', Array.from(onlineUsers));
    // Re-join group rooms
    Object.values(groups).filter(g => g.members.includes(userId))
      .forEach(g => socket.join(`group-${g.id}`));
  });

  // ── DM messages ───────────────────────────────────
  socket.on('send-message', data => {
    const { senderId, receiverId, text, image, replyTo } = data;
    const cid = dmId(senderId, receiverId);
    if (!conversations[cid]) conversations[cid] = [];
    const msg = {
      id: genId(), senderId, receiverId,
      text: text || '', image: image || null,
      replyTo: replyTo || null,
      timestamp: new Date(), seen: false, reactions: {}
    };
    conversations[cid].push(msg);
    io.to(`user-${receiverId}`).emit('receive-message', { conversationId: cid, message: msg });
    io.to(`user-${senderId}`).emit('message-sent',    { conversationId: cid, message: msg });
  });

  socket.on('mark-seen', ({ conversationId, viewerId, senderId }) => {
    const msgs = conversations[conversationId];
    if (msgs) {
      msgs.forEach(m => {
        if (m.senderId === senderId && m.receiverId === viewerId && !m.seen) {
          m.seen = true; m.seenAt = new Date();
        }
      });
      io.to(`user-${senderId}`).emit('messages-seen', { conversationId });
    }
  });

  socket.on('react-message', ({ conversationId, messageId, emoji, userId }) => {
    const msgs = conversations[conversationId];
    if (msgs) {
      const msg = msgs.find(m => m.id === messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = {};
        if (msg.reactions[userId] === emoji) { delete msg.reactions[userId]; }
        else { msg.reactions[userId] = emoji; }
        const [a, b] = conversationId.split('::');
        io.to(`user-${a}`).emit('message-reacted', { conversationId, messageId, reactions: msg.reactions });
        io.to(`user-${b}`).emit('message-reacted', { conversationId, messageId, reactions: msg.reactions });
      }
    }
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

  socket.on('typing', ({ senderId, receiverId, name }) => {
    io.to(`user-${receiverId}`).emit('user-typing', { senderId, name });
  });
  socket.on('stop-typing', ({ senderId, receiverId }) => {
    io.to(`user-${receiverId}`).emit('user-stop-typing', { senderId });
  });

  // ── Group messages ─────────────────────────────────
  socket.on('group-message', data => {
    const { groupId, senderId, text, image, replyTo } = data;
    const g = groups[groupId];
    if (!g || !g.members.includes(senderId)) return;
    if (!groupMsgs[groupId]) groupMsgs[groupId] = [];
    const msg = {
      id: genId(), groupId, senderId,
      text: text || '', image: image || null,
      replyTo: replyTo || null,
      timestamp: new Date(), reactions: {},
      seenBy: [senderId]
    };
    groupMsgs[groupId].push(msg);
    io.to(`group-${groupId}`).emit('group-receive-message', { groupId, message: msg });
  });

  socket.on('group-typing', ({ groupId, senderId, name }) => {
    socket.to(`group-${groupId}`).emit('group-user-typing', { groupId, senderId, name });
  });
  socket.on('group-stop-typing', ({ groupId, senderId }) => {
    socket.to(`group-${groupId}`).emit('group-user-stop-typing', { groupId, senderId });
  });

  socket.on('group-react', ({ groupId, messageId, emoji, userId }) => {
    const msgs = groupMsgs[groupId];
    if (msgs) {
      const msg = msgs.find(m => m.id === messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = {};
        if (msg.reactions[userId] === emoji) delete msg.reactions[userId];
        else msg.reactions[userId] = emoji;
        io.to(`group-${groupId}`).emit('group-message-reacted', { groupId, messageId, reactions: msg.reactions });
      }
    }
  });

  socket.on('group-delete-message', ({ groupId, messageId, senderId }) => {
    const msgs = groupMsgs[groupId];
    if (msgs) {
      const idx = msgs.findIndex(m => m.id === messageId);
      if (idx !== -1) {
        msgs.splice(idx, 1);
        io.to(`group-${groupId}`).emit('group-message-deleted', { groupId, messageId });
      }
    }
  });

  // ── WebRTC Signalling (1-to-1 calls) ──────────────
  socket.on('call-offer', ({ to, from, fromName, callType, offer }) => {
    io.to(`user-${to}`).emit('call-incoming', { from, fromName, callType, offer });
  });
  socket.on('call-answer', ({ to, answer }) => {
    io.to(`user-${to}`).emit('call-answered', { answer });
  });
  socket.on('call-ice', ({ to, candidate }) => {
    io.to(`user-${to}`).emit('call-ice', { candidate });
  });
  socket.on('call-reject', ({ to }) => {
    io.to(`user-${to}`).emit('call-rejected');
  });
  socket.on('call-end', ({ to }) => {
    io.to(`user-${to}`).emit('call-ended');
  });

  // ── Friend requests ────────────────────────────────
  socket.on('disconnect', () => {
    onlineUsers.delete(socket.userId);
    io.emit('online-users', Array.from(onlineUsers));
  });
});

// ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Messenger running → http://localhost:${PORT}`));
