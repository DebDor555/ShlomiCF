const express = require('express');
const session = require('express-session');
const path    = require('path');
const db      = require('./db/database');

const app = express();
app.use(express.json());

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'cf-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

// ── Public routes (no auth) ───────────────────────────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'נדרשים אימייל וסיסמה' });
  const user = db.getUserByEmail(email.trim().toLowerCase());
  if (!user || user.password !== db.sha256(password)) {
    return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  }
  req.session.userId = user.id;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── All routes below require login ────────────────────────────────────────────
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// ── Accounts ──────────────────────────────────────────────────────────────────
app.get('/api/accounts', (req, res) => {
  res.json(db.getAccounts());
});

app.put('/api/accounts/:id', (req, res) => {
  const { balance } = req.body;
  db.updateAccount(Number(req.params.id), balance);
  res.json({ ok: true });
});

// ── FX Rates ──────────────────────────────────────────────────────────────────
app.get('/api/fx-rates', (req, res) => {
  res.json(db.getFxRates());
});

app.put('/api/fx-rates/:id', (req, res) => {
  const { rate } = req.body;
  db.updateFxRate(Number(req.params.id), rate);
  res.json({ ok: true });
});

// ── Recurring Items ───────────────────────────────────────────────────────────
app.get('/api/recurring', (req, res) => {
  res.json(db.getRecurringItems());
});

app.post('/api/recurring', (req, res) => {
  const info = db.createRecurringItem(req.body);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/recurring/:id', (req, res) => {
  db.updateRecurringItem(Number(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/recurring/:id', (req, res) => {
  db.deleteRecurringItem(Number(req.params.id));
  res.json({ ok: true });
});

// ── Events ────────────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const { from, to, scenario } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  res.json(db.getEvents(from, to, scenario));
});

app.post('/api/events', (req, res) => {
  const info = db.createEvent(req.body);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/events/:id', (req, res) => {
  db.updateEvent(Number(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/events/:id', (req, res) => {
  db.deleteEvent(Number(req.params.id));
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = 3001; // 3000 is used by Arugga
app.listen(PORT, () => {
  console.log(`CashflowPlanner running at http://localhost:${PORT}`);
});
