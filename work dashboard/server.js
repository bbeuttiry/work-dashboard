require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { Server } = require('socket.io');
const http = require('http');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// ─── In-Memory Storage ───────────────────────────────────────────────────────
const users = new Map();         // userId → user object
const workLogs = new Map();      // userId → [log, ...]
const postitStore = new Map();   // userId → [postit, ...]
const chatMessages = [];         // global chat history (max 200)
let onlineCount = 0;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dashboard-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());

// ─── Google OAuth ─────────────────────────────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || 'PLACEHOLDER_CLIENT_ID',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'PLACEHOLDER_SECRET',
  callbackURL: process.env.CALLBACK_URL || `http://localhost:${PORT}/auth/google/callback`
}, (accessToken, refreshToken, profile, done) => {
  const existing = users.get(profile.id);
  const user = {
    id: profile.id,
    email: profile.emails[0].value,
    name: profile.displayName,
    avatar: profile.photos[0].value,
    role: existing?.role || 'member',
    emailAuto: existing?.emailAuto || false,
    joinedAt: existing?.joinedAt || new Date()
  };
  users.set(profile.id, user);
  return done(null, user);
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = users.get(id);
  done(null, user || false);
});

// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=auth' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

app.get('/auth/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ authenticated: true, user: req.user });
  } else {
    res.json({ authenticated: false });
  }
});

// ─── Admin Verification ───────────────────────────────────────────────────────
app.post('/api/verify-admin', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';
  if (password === adminPass) {
    const user = users.get(req.user.id);
    if (user) user.role = 'admin';
    res.json({ success: true });
  } else {
    res.status(403).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
});

// ─── Work Log API ──────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  res.json(workLogs.get(req.user.id) || []);
});

app.post('/api/logs', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const { tasks, hours, category, notes, date } = req.body;
  const logs = workLogs.get(req.user.id) || [];
  const entry = {
    id: Date.now(),
    date: date || new Date().toISOString().split('T')[0],
    tasks: tasks || '',
    hours: parseFloat(hours) || 0,
    category: category || '일반',
    notes: notes || '',
    createdAt: new Date()
  };
  logs.push(entry);
  workLogs.set(req.user.id, logs);
  res.json(entry);
});

app.delete('/api/logs/:id', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const logs = workLogs.get(req.user.id) || [];
  workLogs.set(req.user.id, logs.filter(l => l.id !== parseInt(req.params.id)));
  res.json({ success: true });
});

// All users' logs (admin)
app.get('/api/logs/all', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const allLogs = {};
  for (const [uid, logs] of workLogs) {
    const user = users.get(uid);
    if (user) allLogs[uid] = { user, logs };
  }
  res.json(allLogs);
});

// ─── Post-it API ──────────────────────────────────────────────────────────────
app.get('/api/postits', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  res.json(postitStore.get(req.user.id) || []);
});

app.post('/api/postits', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const { content, color } = req.body;
  const items = postitStore.get(req.user.id) || [];
  const item = { id: Date.now(), content, color: color || '#fef08a', createdAt: new Date() };
  items.push(item);
  postitStore.set(req.user.id, items);
  res.json(item);
});

app.put('/api/postits/:id', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const items = postitStore.get(req.user.id) || [];
  const item = items.find(i => i.id === parseInt(req.params.id));
  if (item) {
    if (req.body.content !== undefined) item.content = req.body.content;
    if (req.body.color !== undefined) item.color = req.body.color;
    res.json(item);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.delete('/api/postits/:id', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const items = postitStore.get(req.user.id) || [];
  postitStore.set(req.user.id, items.filter(i => i.id !== parseInt(req.params.id)));
  res.json({ success: true });
});

// ─── Users API ────────────────────────────────────────────────────────────────
app.get('/api/users', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const list = Array.from(users.values()).map(u => ({
    id: u.id, name: u.name, email: u.email, avatar: u.avatar, role: u.role
  }));
  res.json(list);
});

app.put('/api/users/:id/role', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const u = users.get(req.params.id);
  if (u) { u.role = req.body.role; res.json(u); }
  else res.status(404).json({ error: 'Not found' });
});

app.put('/api/users/preferences', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const u = users.get(req.user.id);
  if (u) {
    if (req.body.emailAuto !== undefined) u.emailAuto = req.body.emailAuto;
    res.json(u);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ─── Email API ────────────────────────────────────────────────────────────────
async function sendDailyEmail(user) {
  const today = new Date().toISOString().split('T')[0];
  const logs = (workLogs.get(user.id) || []).filter(l => l.date === today);
  const totalHours = logs.reduce((s, l) => s + l.hours, 0).toFixed(1);
  const taskRows = logs.length > 0
    ? logs.map(l => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${l.tasks}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${l.category}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${l.hours}시간</td></tr>`).join('')
    : '<tr><td colspan="3" style="padding:12px;text-align:center;color:#999">등록된 업무 없음</td></tr>';

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });

  await transporter.sendMail({
    from: `"업무 대시보드" <${process.env.GMAIL_USER}>`,
    to: user.email,
    subject: `[업무 결산] ${today} 일일 보고서 - ${user.name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#6366f1;border-bottom:2px solid #6366f1;padding-bottom:12px">📊 일일 업무 결산 보고서</h2>
        <p><strong>날짜:</strong> ${today} &nbsp;|&nbsp; <strong>담당자:</strong> ${user.name}</p>
        <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0">
          <span style="font-size:32px;font-weight:700;color:#1e293b">${totalHours}</span>
          <span style="color:#64748b">시간 &nbsp;|&nbsp; ${logs.length}건 완료</span>
        </div>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.1)">
          <thead><tr style="background:#6366f1;color:white">
            <th style="padding:10px 12px;text-align:left">업무 내용</th>
            <th style="padding:10px 12px;text-align:center">분류</th>
            <th style="padding:10px 12px;text-align:right">시간</th>
          </tr></thead>
          <tbody>${taskRows}</tbody>
        </table>
        <p style="color:#94a3b8;font-size:12px;margin-top:24px;text-align:center">업무 대시보드에서 자동 발송된 메일입니다.</p>
      </div>`
  });
}

app.post('/api/send-daily-report', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await sendDailyEmail(req.user);
    res.json({ success: true, message: `${req.user.email}로 발송되었습니다.` });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: '이메일 발송 실패. GMAIL 설정을 확인하세요.' });
  }
});

// ─── Cron: Auto daily email at 18:00 KST (09:00 UTC) ────────────────────────
cron.schedule('0 9 * * *', async () => {
  for (const [, user] of users) {
    if (user.emailAuto) {
      try { await sendDailyEmail(user); }
      catch (e) { console.error(`Auto email failed for ${user.email}:`, e.message); }
    }
  }
}, { timezone: 'UTC' });

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  onlineCount++;
  io.emit('online-count', onlineCount);
  socket.emit('chat-history', chatMessages.slice(-80));

  socket.on('join', (userData) => {
    socket.userData = userData;
    socket.broadcast.emit('system-message', `${userData.name}님이 입장하셨습니다.`);
  });

  socket.on('chat-message', (data) => {
    const msg = {
      id: Date.now(),
      userId: data.userId,
      userName: data.userName,
      avatar: data.avatar,
      content: data.content,
      time: new Date()
    };
    chatMessages.push(msg);
    if (chatMessages.length > 200) chatMessages.shift();
    io.emit('chat-message', msg);
  });

  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    io.emit('online-count', onlineCount);
    if (socket.userData) {
      socket.broadcast.emit('system-message', `${socket.userData.name}님이 퇴장하셨습니다.`);
    }
  });
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 업무 대시보드 실행 중: http://localhost:${PORT}`);
});
