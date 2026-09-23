import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { all, one, run, transaction } from './db.js';
import { DatabaseSessionStore } from './session-store.js';

const root = dirname(fileURLToPath(import.meta.url));
export const app = express();
app.set('views', join(root, 'views'));
app.set('view engine', 'ejs');
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(join(root, 'public')));
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('Set SESSION_SECRET to at least 32 random characters.');
app.use(session({
  secret: process.env.SESSION_SECRET,
  store: new DatabaseSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 86400000 }
}));
passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = await one('SELECT * FROM users WHERE email = ?', String(email).trim().toLowerCase());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) return done(null, false);
    return done(null, user);
  } catch (error) { return done(error); }
}));
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => one('SELECT id,name,email,role FROM users WHERE id = ?', id).then(user => done(null, user || false)).catch(done));
app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
  req.session.csrf ||= randomBytes(32).toString('hex');
  res.locals.user = req.user || null;
  res.locals.csrf = req.session.csrf;
  res.locals.notice = req.session.notice || null;
  delete req.session.notice;
  next();
});
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const supplied = Buffer.from(String(req.body._csrf || ''));
  const expected = Buffer.from(req.session.csrf || '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(403).send('Invalid form token. Reload the page and try again.');
  next();
});

function render(res, page, data = {}, status = 200) { res.status(status).render('layout', { page, ...data }); }
function notice(req, message) { req.session.notice = message; }
function requireUser(req, res, next) { if (!req.isAuthenticated()) return res.redirect('/login'); next(); }
function requireAdmin(req, res, next) { if (!req.isAuthenticated()) return res.redirect('/login'); if (req.user.role !== 'admin') return res.sendStatus(403); next(); }
function clean(value) { return String(value || '').trim(); }
function validEmail(value) { return /^\S+@\S+\.\S+$/.test(value); }
function sessionDetails(id, database = { one }) {
  return database.one(`SELECT s.*, sp.name AS sport_name, u.name AS creator_name,
    (SELECT COUNT(*) FROM participants p WHERE p.session_id=s.id) AS joined_count
    FROM sessions s JOIN sports sp ON sp.id=s.sport_id JOIN users u ON u.id=s.creator_id WHERE s.id=?`, id);
}
function localDateToIso(value, offset) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null;
  const minutes = Number(offset);
  if (!Number.isInteger(minutes) || minutes < -840 || minutes > 840) return null;
  const date = new Date(`${value}:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 16) !== value) return null;
  const iso = new Date(date.getTime() + minutes * 60000).toISOString();
  return iso;
}

app.get('/', (req, res) => res.redirect('/sessions'));
app.get('/signup', (req, res) => render(res, 'signup', { error: null, values: {} }));
app.post('/signup', async (req, res, next) => {
  const name = clean(req.body.name), email = clean(req.body.email).toLowerCase(), password = String(req.body.password || '');
  if (!name || name.length > 100 || !validEmail(email) || email.length > 254 || password.length < 12)
    return render(res, 'signup', { error: 'Enter a name, valid email, and password of at least 12 characters.', values: { name, email } }, 400);
  try {
    const result = await run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?) RETURNING id', name, email, bcrypt.hashSync(password, 12), 'player');
    req.session.regenerate(err => {
      if (err) return next(err);
      req.login({ id: result.lastInsertRowid }, error => {
        if (error) return next(error);
        req.session.csrf = randomBytes(32).toString('hex');
        res.redirect('/sessions');
      });
    });
  } catch (error) {
    if (error.code === '23505') return render(res, 'signup', { error: 'That email is already registered.', values: { name, email } }, 400);
    next(error);
  }
});
app.get('/login', (req, res) => render(res, 'login', { error: null }));
app.post('/login', (req, res, next) => passport.authenticate('local', (error, user) => {
  if (error) return next(error);
  if (!user) return render(res, 'login', { error: 'Incorrect email or password.' }, 401);
  req.session.regenerate(err => {
    if (err) return next(err);
    req.login(user, err2 => {
      if (err2) return next(err2);
      req.session.csrf = randomBytes(32).toString('hex');
      res.redirect('/sessions');
    });
  });
})(req, res, next));
app.post('/logout', requireUser, (req, res, next) => req.logout(error => {
  if (error) return next(error);
  req.session.destroy(err => err ? next(err) : res.redirect('/login'));
}));

app.get('/sports', requireAdmin, async (req, res) => render(res, 'sports', { sports: await all('SELECT sports.*, users.name AS creator_name FROM sports JOIN users ON users.id=sports.creator_id WHERE sports.creator_id=? ORDER BY sports.name', req.user.id), error: null }));
app.post('/sports', requireAdmin, async (req, res, next) => {
  const name = clean(req.body.name);
  if (!name || name.length > 100) return render(res, 'sports', { sports: await all('SELECT * FROM sports WHERE creator_id=? ORDER BY name', req.user.id), error: 'Sport name must be 1–100 characters.' }, 400);
  try { await run('INSERT INTO sports(name,creator_id) VALUES(?,?)', name, req.user.id); notice(req, 'Sport created.'); res.redirect('/sports'); }
  catch (error) { if (error.code === '23505') return render(res, 'sports', { sports: await all('SELECT * FROM sports WHERE creator_id=? ORDER BY name', req.user.id), error: 'That sport already exists.' }, 400); next(error); }
});
app.get('/sports/:id/edit', requireAdmin, async (req, res) => {
  const sport = await one('SELECT * FROM sports WHERE id=? AND creator_id=?', req.params.id, req.user.id);
  if (!sport) return res.sendStatus(404);
  render(res, 'edit-sport', { sport, error: null });
});
app.post('/sports/:id/edit', requireAdmin, async (req, res, next) => {
  const sport = await one('SELECT * FROM sports WHERE id=? AND creator_id=?', req.params.id, req.user.id);
  if (!sport) return res.sendStatus(404);
  const name = clean(req.body.name);
  if (!name || name.length > 100) return render(res, 'edit-sport', { sport, error: 'Sport name must be 1–100 characters.' }, 400);
  try { await run('UPDATE sports SET name=? WHERE id=?', name, sport.id); notice(req, 'Sport updated.'); res.redirect('/sports'); }
  catch (error) { if (error.code === '23505') return render(res, 'edit-sport', { sport, error: 'That sport already exists.' }, 400); next(error); }
});

app.get('/sessions', requireUser, async (req, res) => {
  const base = `SELECT s.*, sp.name AS sport_name, u.name AS creator_name,
    (SELECT COUNT(*) FROM participants p WHERE p.session_id=s.id) AS joined_count
    FROM sessions s JOIN sports sp ON sp.id=s.sport_id JOIN users u ON u.id=s.creator_id`;
  const created = await all(`${base} WHERE s.creator_id=? ORDER BY s.starts_at DESC`, req.user.id);
  const joined = await all(`${base} WHERE EXISTS(SELECT 1 FROM participants p WHERE p.session_id=s.id AND p.user_id=?) AND s.creator_id<>? ORDER BY s.starts_at DESC`, req.user.id, req.user.id);
  const available = await all(`${base} WHERE s.creator_id<>? AND s.cancelled_at IS NULL AND s.starts_at>? AND (SELECT COUNT(*) FROM participants p WHERE p.session_id=s.id)<s.extra_capacity AND NOT EXISTS(SELECT 1 FROM participants p WHERE p.session_id=s.id AND p.user_id=?) ORDER BY s.starts_at`, req.user.id, new Date().toISOString(), req.user.id);
  render(res, 'sessions', { created, joined, available });
});
app.get('/sessions/new', requireUser, async (req, res) => render(res, 'new-session', { sports: await all('SELECT * FROM sports ORDER BY name'), error: null, values: {} }));
app.post('/sessions', requireUser, async (req, res, next) => {
  const sportId = Number(req.body.sport_id), venue = clean(req.body.venue), capacity = Number(req.body.extra_capacity);
  const startsAt = localDateToIso(clean(req.body.starts_at), req.body.timezone_offset);
  const parseNames = value => String(value || '').split('\n').map(clean).filter(Boolean);
  const team1 = parseNames(req.body.team1), team2 = parseNames(req.body.team2);
  const error = !await one('SELECT id FROM sports WHERE id=?', sportId) ? 'Choose an available sport.' :
    !startsAt || startsAt <= new Date().toISOString() ? 'Choose a future date and time.' :
    !venue || venue.length > 200 ? 'Venue must be 1–200 characters.' :
    !Number.isInteger(capacity) || capacity < 0 || capacity > 100 ? 'Additional places must be between 0 and 100.' :
    team1.length + team2.length > 100 || [...team1, ...team2].some(n => n.length > 100) ? 'Enter at most 100 player names, each at most 100 characters.' : null;
  if (error) return render(res, 'new-session', { sports: await all('SELECT * FROM sports ORDER BY name'), error, values: req.body }, 400);
  try {
    const id = await transaction(async db => {
      const result = await db.run('INSERT INTO sessions(sport_id,creator_id,starts_at,venue,extra_capacity) VALUES(?,?,?,?,?) RETURNING id', sportId, req.user.id, startsAt, venue, capacity);
      for (const [team, names] of [[1, team1], [2, team2]]) for (const name of names) await db.run('INSERT INTO initial_players(session_id,team,name) VALUES(?,?,?)', result.lastInsertRowid, team, name);
      return result.lastInsertRowid;
    });
    res.redirect(`/sessions/${id}`);
  } catch (err) { next(err); }
});
app.get('/sessions/:id', requireUser, async (req, res) => {
  const item = await sessionDetails(req.params.id);
  if (!item) return res.sendStatus(404);
  const initial = await all('SELECT * FROM initial_players WHERE session_id=? ORDER BY team,id', item.id);
  const participants = await all('SELECT p.*, u.name FROM participants p JOIN users u ON u.id=p.user_id WHERE p.session_id=? ORDER BY p.team,p.joined_at', item.id);
  render(res, 'session-detail', { item, initial, participants, error: null });
});
app.post('/sessions/:id/join', requireUser, async (req, res, next) => {
  const team = Number(req.body.team);
  if (![1, 2].includes(team)) return res.status(400).send('Choose a team.');
  try {
    const result = await transaction(async db => {
      await db.one('SELECT id FROM sessions WHERE id=? FOR UPDATE', req.params.id);
      const item = await sessionDetails(req.params.id, db);
      if (!item) return 'Session not found.';
      if (item.creator_id === req.user.id) return 'You created this session.';
      if (item.cancelled_at || item.starts_at <= new Date().toISOString()) return 'This session is no longer available.';
      if (item.joined_count >= item.extra_capacity) return 'This session is full.';
      if (await db.one('SELECT id FROM participants WHERE session_id=? AND user_id=?', item.id, req.user.id)) return 'You already joined this session.';
      await db.run('INSERT INTO participants(session_id,user_id,team) VALUES(?,?,?)', item.id, req.user.id, team);
      return null;
    });
    if (result) return res.status(400).send(result);
    notice(req, 'You joined the session.'); res.redirect(`/sessions/${req.params.id}`);
  } catch (error) { next(error); }
});
app.post('/sessions/:id/cancel', requireUser, async (req, res, next) => {
  const item = await sessionDetails(req.params.id);
  if (!item) return res.sendStatus(404);
  if (item.creator_id !== req.user.id) return res.sendStatus(403);
  const reason = clean(req.body.reason);
  if (item.cancelled_at) return res.status(400).send('Session already cancelled.');
  if (!reason || reason.length > 500) return res.status(400).send('Give a reason of 1–500 characters.');
  try { await run('UPDATE sessions SET cancelled_at=?, cancellation_reason=? WHERE id=? AND cancelled_at IS NULL', new Date().toISOString(), reason, item.id); notice(req, 'Session cancelled.'); res.redirect(`/sessions/${item.id}`); }
  catch (error) { next(error); }
});
app.get('/admin/reports', requireAdmin, async (req, res) => {
  const from = clean(req.query.from), to = clean(req.query.to);
  let error = null, report = null;
  if (from || to) {
    const validDay = value => /^\d{4}-\d\d-\d\d$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!validDay(from) || !validDay(to) || from > to) error = 'Choose a valid start and end date.';
    else {
      const start = `${from}T00:00:00.000Z`, end = new Date(`${to}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const rows = await all(`SELECT sp.name, COUNT(s.id) AS played FROM sports sp LEFT JOIN sessions s ON s.sport_id=sp.id AND s.cancelled_at IS NULL AND s.starts_at>=? AND s.starts_at<? AND s.starts_at<=? GROUP BY sp.id ORDER BY played DESC,sp.name`, start, end.toISOString(), new Date().toISOString());
      const total = rows.reduce((sum, row) => sum + Number(row.played), 0);
      report = { total, rows: rows.map(row => ({ ...row, played: Number(row.played), percent: total ? (Number(row.played) / total * 100).toFixed(1) : '0.0' })) };
    }
  }
  render(res, 'reports', { from, to, error, report });
});

app.use((req, res) => res.status(404).render('layout', { page: 'not-found' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).render('layout', { page: 'server-error' });
});
