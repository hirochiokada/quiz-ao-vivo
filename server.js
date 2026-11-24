'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const Store = require('./src/store');
const { normalizeQuiz, validateForLive, duplicateQuiz } = require('./src/quiz');
const { SessionManager } = require('./src/session');
const { toCsv, toXlsx, fileName } = require('./src/export');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
if (!process.env.ADMIN_PASSWORD) console.warn('[aviso] ADMIN_PASSWORD não definido — usando a senha padrão "admin".');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const store = new Store(DATA_DIR);

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e5,
  pingInterval: 20000,
  pingTimeout: 25000,
  cors: { origin: false },
});
const sessions = new SessionManager(io, store);

// ---------------- autenticação do administrador
const adminTokens = new Map(); // token -> expira em
const TOKEN_TTL = 12 * 3600e3;
const checkToken = t => {
  const exp = t && adminTokens.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { adminTokens.delete(t); return false; }
  return true;
};
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
function requireAdmin(req, res, next) {
  const h = req.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : req.query.t;
  if (!checkToken(t)) return res.status(401).json({ error: 'Faça login novamente.' });
  next();
}

app.use(express.json({ limit: '1mb' }));

app.post('/api/login', (req, res) => {
  if (!safeEqual(req.body && req.body.password || '', ADMIN_PASSWORD)) {
    return setTimeout(() => res.status(401).json({ error: 'Senha incorreta.' }), 400);
  }
  const t = nanoid(32);
  adminTokens.set(t, Date.now() + TOKEN_TTL);
  res.json({ token: t });
});
app.get('/api/me', requireAdmin, (req, res) => res.json({ ok: true }));

// ---------------- quizzes
const summary = q => ({
  id: q.id, title: q.title, description: q.description, coverImage: q.coverImage,
  questions: q.questions.length, updatedAt: q.updatedAt, errors: validateForLive(q),
});
app.get('/api/quizzes', requireAdmin, (req, res) => res.json(store.listQuizzes().map(summary)));
app.post('/api/quizzes', requireAdmin, (req, res) => res.json(store.upsertQuiz(normalizeQuiz(req.body || {}, null))));
app.get('/api/quizzes/:id', requireAdmin, (req, res) => {
  const q = store.getQuiz(req.params.id);
  q ? res.json({ ...q, errors: validateForLive(q) }) : res.status(404).json({ error: 'Quiz não encontrado.' });
});
app.put('/api/quizzes/:id', requireAdmin, (req, res) => {
  const existing = store.getQuiz(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Quiz não encontrado.' });
  const q = store.upsertQuiz(normalizeQuiz(req.body || {}, existing));
  res.json({ ...q, errors: validateForLive(q) });
});
app.delete('/api/quizzes/:id', requireAdmin, (req, res) => res.json({ ok: store.deleteQuiz(req.params.id) }));
app.post('/api/quizzes/:id/duplicate', requireAdmin, (req, res) => {
  const q = store.getQuiz(req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiz não encontrado.' });
  res.json(store.upsertQuiz(duplicateQuiz(q)));
});
app.post('/api/quizzes/:id/sessions', requireAdmin, (req, res) => {
  const q = store.getQuiz(req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiz não encontrado.' });
  const errors = validateForLive(q);
  if (errors.length) return res.status(400).json({ error: 'Corrija o quiz antes de iniciar.', errors });
  const s = sessions.create(q);
  res.json({ code: s.code });
});

// ---------------- sessões e resultados
app.get('/api/sessions', requireAdmin, (req, res) => res.json(sessions.list().map(s => ({
  code: s.code, quizId: s.quizId, title: s.quiz.title, phase: s.phase, participants: s.participants.size,
  createdAt: new Date(s.createdAt).toISOString(),
}))));
app.get('/api/results', requireAdmin, (req, res) => res.json(store.listResults().map(r => ({
  sessionId: r.sessionId, code: r.code, quizTitle: r.quizTitle, startedAt: r.startedAt, endedAt: r.endedAt,
  participants: r.participants.length, winner: r.participants[0] ? r.participants[0].name : null,
}))));
app.delete('/api/results/:id', requireAdmin, (req, res) => { store.deleteResult(req.params.id); res.json({ ok: true }); });

app.get('/api/export/:key.:fmt', requireAdmin, async (req, res) => {
  if (!['csv', 'xlsx'].includes(req.params.fmt)) return res.status(404).end();
  const live = sessions.get(req.params.key);
  const result = live ? live.toResult() : store.getResult(req.params.key);
  if (!result) return res.status(404).json({ error: 'Resultado não encontrado.' });
  if (req.params.fmt === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.attachment(fileName(result, 'csv'));
    return res.send(toCsv(result));
  }
  const buf = await toXlsx(result);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment(fileName(result, 'xlsx'));
  res.send(Buffer.from(buf));
});

// público: usado pela tela de entrada e pelo QR Code
const joinUrl = (req, code) => `${PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/j/${code}`;
app.get('/api/sessions/:code/info', (req, res) => {
  const s = sessions.get(req.params.code);
  if (!s) return res.status(404).json({ error: 'Sala não encontrada. Confira o código.' });
  res.json({ code: s.code, title: s.quiz.title, coverImage: s.quiz.coverImage, phase: s.phase, locked: s.locked, joinUrl: joinUrl(req, s.code) });
});
app.get('/api/sessions/:code/qr.svg', async (req, res) => {
  const s = sessions.get(req.params.code);
  if (!s) return res.status(404).end();
  const svg = await QRCode.toString(joinUrl(req, s.code), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'private, max-age=3600').send(svg);
});

// ---------------- upload de imagens
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }[file.mimetype];
      cb(null, nanoid(16) + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)),
});
app.post('/api/upload', requireAdmin, (req, res) => {
  upload.single('image')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Imagem maior que 5 MB.' : 'Falha no upload.' });
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem JPG, PNG, GIF ou WebP.' });
    res.json({ url: '/uploads/' + req.file.filename });
  });
});

// ---------------- páginas e arquivos estáticos
const pub = path.join(__dirname, 'public');
const page = f => (req, res) => res.sendFile(path.join(pub, f));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));
app.use(express.static(pub, { index: false, maxAge: '1h' }));
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', page('admin.html'));
app.get('/admin/quiz/:id', page('editor.html'));
app.get('/admin/preview/:id', page('preview.html'));
app.get('/host/:code', page('host.html'));
app.get('/join', page('play.html'));
app.get('/j/:code', page('play.html'));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/healthz', (req, res) => res.json({ ok: true, sessions: sessions.list().length }));

// ---------------- tempo real
io.on('connection', socket => {
  socket.on('host:watch', ({ code, token } = {}, ack) => {
    if (!checkToken(token)) return ack && ack({ error: 'Faça login novamente.' });
    const s = sessions.get(code);
    if (!s) return ack && ack({ error: 'Sessão não encontrada (o servidor pode ter sido reiniciado).' });
    socket.data.host = true;
    socket.data.hostCode = s.code;
    socket.join(s.hostRoom);
    socket.emit('host:state', s.hostView());
    ack && ack({ ok: true });
  });

  socket.on('host:action', ({ action, payload } = {}, ack) => {
    if (!socket.data.host) return ack && ack({ error: 'Não autorizado.' });
    const s = sessions.get(socket.data.hostCode);
    if (!s) return ack && ack({ error: 'Sessão não encontrada.' });
    try { s.action(action, payload); ack && ack({ ok: true }); } catch (e) {
      console.error(e); ack && ack({ error: 'Falha ao executar a ação.' });
    }
  });

  socket.on('join', ({ code, name, token } = {}, ack) => {
    if (typeof ack !== 'function') return;
    const s = sessions.get(code);
    if (!s) return ack({ error: 'Sala não encontrada. Confira o código.', notFound: true });
    if (socket.data.pid && socket.data.code === s.code) return ack({ error: 'Já conectado.' });
    ack(s.join(socket, { name, token }));
  });

  socket.on('answer', ({ optionIds } = {}, ack) => {
    if (typeof ack !== 'function') return;
    const s = socket.data.code && sessions.get(socket.data.code);
    if (!s || !socket.data.pid) return ack({ error: 'Você não está em uma sala.' });
    ack(s.answer(socket, optionIds));
  });

  socket.on('disconnect', () => {
    const s = socket.data.code && sessions.get(socket.data.code);
    if (s) s.detach(socket);
  });
});

server.listen(PORT, () => console.log(`Quiz ao Vivo rodando em http://localhost:${PORT}  (admin: /admin)`));
process.on('SIGTERM', () => { store.flush(); process.exit(0); });
process.on('SIGINT', () => { store.flush(); process.exit(0); });

module.exports = { app, server };
