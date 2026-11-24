'use strict';
// Servidor do Quiz ao Vivo.
// Não grava nada em disco: os quizzes ficam no navegador do apresentador e são enviados
// ao iniciar uma sessão. Assim funciona em hospedagens gratuitas (ex.: Render), cujo disco é apagado.
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const { normalizeQuiz, validateForLive } = require('./quiz');
const { SessionManager } = require('./session');
const { toCsv, toXlsx, fileName } = require('./export');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
if (!process.env.ADMIN_PASSWORD) console.warn('[aviso] ADMIN_PASSWORD não definido — usando a senha padrão "admin".');

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
const sessions = new SessionManager(io);

// ---------------- autenticação do apresentador
const adminTokens = new Map(); // token -> expira em
const TOKEN_TTL = 24 * 3600e3;
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

const smallJson = express.json({ limit: '100kb' });
const bigJson = express.json({ limit: '25mb' }); // quizzes com imagens embutidas

app.post('/api/login', smallJson, (req, res) => {
  if (!safeEqual(req.body && req.body.password || '', ADMIN_PASSWORD)) {
    return setTimeout(() => res.status(401).json({ error: 'Senha incorreta.' }), 400);
  }
  const t = nanoid(32);
  adminTokens.set(t, Date.now() + TOKEN_TTL);
  res.json({ token: t });
});
app.get('/api/me', requireAdmin, (req, res) => res.json({ ok: true }));

// ---------------- sessões
app.post('/api/sessions', requireAdmin, bigJson, (req, res) => {
  const quiz = normalizeQuiz((req.body && req.body.quiz) || {}, null);
  const errors = validateForLive(quiz);
  if (errors.length) return res.status(400).json({ error: 'Corrija o quiz antes de iniciar.', errors });
  const s = sessions.create(quiz);
  res.json({ code: s.code });
});
app.get('/api/sessions', requireAdmin, (req, res) => res.json(sessions.list().map(s => ({
  code: s.code, title: s.quiz.title, phase: s.phase, participants: s.participants.size,
  createdAt: new Date(s.createdAt).toISOString(),
}))));
app.get('/api/sessions/:code/result', requireAdmin, (req, res) => {
  const s = sessions.get(req.params.code);
  if (!s) return res.status(404).json({ error: 'Sessão não encontrada.' });
  res.json(s.toResult());
});

// exportação: de uma sessão ativa (GET) ou de um resultado guardado no navegador (POST)
async function sendExport(res, result, fmt) {
  if (fmt === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.attachment(fileName(result, 'csv'));
    return res.send(toCsv(result));
  }
  const buf = await toXlsx(result);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment(fileName(result, 'xlsx'));
  res.send(Buffer.from(buf));
}
const validResult = r => r && Array.isArray(r.questions) && Array.isArray(r.participants);
app.get('/api/export/:code.:fmt', requireAdmin, async (req, res) => {
  if (!['csv', 'xlsx'].includes(req.params.fmt)) return res.status(404).end();
  const s = sessions.get(req.params.code);
  if (!s) return res.status(404).json({ error: 'Sessão não encontrada.' });
  sendExport(res, s.toResult(), req.params.fmt);
});
app.post('/api/export.:fmt', requireAdmin, bigJson, async (req, res) => {
  if (!['csv', 'xlsx'].includes(req.params.fmt)) return res.status(404).end();
  if (!validResult(req.body)) return res.status(400).json({ error: 'Resultado inválido.' });
  try { await sendExport(res, req.body, req.params.fmt); } catch (e) { res.status(400).json({ error: 'Resultado inválido.' }); }
});

// público: usado pela tela de entrada, pelo QR Code e pelas imagens
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
app.get('/img/:code/:id', (req, res) => {
  const s = sessions.get(req.params.code);
  const img = s && s.images.get(req.params.id);
  if (!img) return res.status(404).end();
  res.set('Content-Type', img.type).set('Cache-Control', 'public, max-age=86400, immutable').send(img.buf);
});

// ---------------- páginas e arquivos estáticos
// todos os arquivos ficam na mesma pasta; só os listados aqui são públicos
const pub = __dirname;
const page = f => (req, res) => res.sendFile(path.join(pub, f));
const STATIC = {
  '/css/app.css': 'app.css', '/css/play.css': 'play.css',
  '/js/common.js': 'common.js', '/js/play-ui.js': 'play-ui.js', '/js/editor.js': 'editor.js', '/js/host.js': 'host.js',
  '/exemplo.json': 'exemplo.json',
};
for (const [url, file] of Object.entries(STATIC)) {
  app.get(url, (req, res) => res.set('Cache-Control', 'public, max-age=600').sendFile(path.join(pub, file)));
}
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

server.listen(PORT, () => console.log(`Quiz ao Vivo rodando em http://localhost:${PORT}  (apresentador: /admin)`));
module.exports = { app, server };
