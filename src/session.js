'use strict';
// Motor da sessão ao vivo. Todo o estado fica em memória (rápido para 250+ participantes);
// ao encerrar, o resultado é gravado no store para consulta e exportação.
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const { scoreAnswer, rank } = require('./scoring');

const MAX_PARTICIPANTS = Number(process.env.MAX_PARTICIPANTS || 250);
const ANSWER_GRACE_MS = 600;      // tolerância de rede após o fim do tempo
const HOST_THROTTLE_MS = 150;     // agrega atualizações para o telão
const NAME_MAX = 24;

const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function makeCode(existing) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem O/0/I/1
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += alphabet[crypto.randomInt(alphabet.length)];
    if (!existing.has(c)) return c;
  }
}

const cleanName = n => String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

class LiveSession {
  constructor(io, quiz, code, store) {
    this.io = io;
    this.store = store;
    this.code = code;
    this.quizId = quiz.id;
    this.quiz = JSON.parse(JSON.stringify(quiz)); // retrato do quiz no momento do início
    this.createdAt = Date.now();
    this.participants = new Map(); // pid -> participante
    this.tokens = new Map();       // token -> pid
    this.banned = new Set();       // tokens removidos
    this._hostTimer = null;
    this.reset();
  }

  get hostRoom() { return `h:${this.code}`; }
  get playRoom() { return `p:${this.code}`; }
  get settings() { return this.quiz.settings; }
  get question() { return this.questions[this.index] || null; }

  reset() {
    this.sessionId = nanoid(12);
    this.phase = 'lobby'; // lobby | question | reveal | leaderboard | ended
    this.index = -1;
    this.locked = false;
    this.paused = false;
    this.deadline = 0;
    this.remainingMs = 0;
    this.startedAt = null;
    this.endedAt = null;
    clearTimeout(this._qTimer);
    let qs = this.quiz.questions.map(q => ({ ...q, options: q.options.map(o => ({ ...o })) }));
    if (this.settings.shuffleQuestions) qs = shuffle(qs);
    if (this.settings.shuffleOptions) qs = qs.map(q => ({ ...q, options: shuffle(q.options) }));
    this.questions = qs;
    for (const p of this.participants.values()) {
      p.score = 0; p.correctCount = 0; p.correctTimeMs = 0; p.answers = {}; p.lastResult = null;
    }
  }

  // ---------------- participantes
  connectedCount() {
    let n = 0;
    for (const p of this.participants.values()) if (p.sockets.size) n++;
    return n;
  }

  join(socket, { name, token }) {
    if (token && this.banned.has(token)) return { error: 'Você foi removido desta sessão.' };
    if (token && this.tokens.has(token)) {
      const p = this.participants.get(this.tokens.get(token));
      this._attach(p, socket);
      return { ok: true, token, name: p.name };
    }
    if (this.phase === 'ended') return { error: 'Este quiz já foi encerrado.' };
    if (this.locked) return { error: 'A entrada de novos participantes foi bloqueada.' };
    if (this.participants.size >= MAX_PARTICIPANTS) return { error: 'A sala está cheia.' };
    const n = cleanName(name);
    if (n.length < 2) return { error: 'Informe um nome com pelo menos 2 caracteres.' };
    const lower = n.toLocaleLowerCase('pt-BR');
    for (const p of this.participants.values()) {
      if (p.name.toLocaleLowerCase('pt-BR') === lower) return { error: 'Esse nome já está em uso. Escolha outro.' };
    }
    const p = {
      id: nanoid(10), token: nanoid(24), name: n, joinedAt: Date.now(),
      score: 0, correctCount: 0, correctTimeMs: 0, answers: {}, lastResult: null, sockets: new Set(),
    };
    this.participants.set(p.id, p);
    this.tokens.set(p.token, p.id);
    this._attach(p, socket);
    this.pushHost();
    return { ok: true, token: p.token, name: p.name };
  }

  _attach(p, socket) {
    socket.data.pid = p.id;
    socket.data.code = this.code;
    socket.join(this.playRoom);
    p.sockets.add(socket.id);
    socket.emit('state', this.viewFor(p));
    this.pushHost();
  }

  detach(socket) {
    const p = this.participants.get(socket.data.pid);
    if (p) { p.sockets.delete(socket.id); this.pushHost(); }
  }

  kick(pid) {
    const p = this.participants.get(pid);
    if (!p) return;
    this.banned.add(p.token);
    this.tokens.delete(p.token);
    this.participants.delete(pid);
    for (const sid of p.sockets) {
      const s = this.io.sockets.sockets.get(sid);
      if (s) { s.emit('kicked'); s.leave(this.playRoom); s.data.pid = null; }
    }
    this.pushHost();
  }

  // ---------------- fluxo
  action(action, payload = {}) {
    switch (action) {
      case 'next': return this.next();
      case 'closeQuestion': if (this.phase === 'question') this.closeQuestion(); return;
      case 'pause': return this.pause();
      case 'resume': return this.resume();
      case 'end': return this.end();
      case 'lock': this.locked = !!payload.locked; this.pushHost(); this.pushAll(); return;
      case 'kick': return this.kick(String(payload.pid));
      case 'restart': this.reset(); this.pushAll(); this.pushHost(); return;
      default: return;
    }
  }

  next() {
    if (this.phase === 'lobby') {
      this.startedAt = Date.now();
      return this.openQuestion(0);
    }
    if (this.phase === 'question') return this.closeQuestion();
    const last = this.index >= this.questions.length - 1;
    if (this.phase === 'reveal') {
      if (this.settings.rankingMode === 'during') {
        this.phase = 'leaderboard';
        this.pushAll(); this.pushHost();
        return;
      }
      return last ? this.end() : this.openQuestion(this.index + 1);
    }
    if (this.phase === 'leaderboard') return last ? this.end() : this.openQuestion(this.index + 1);
  }

  openQuestion(i) {
    this.index = i;
    this.phase = 'question';
    this.paused = false;
    const ms = this.question.timeLimit * 1000;
    this.deadline = Date.now() + ms;
    clearTimeout(this._qTimer);
    this._qTimer = setTimeout(() => this.closeQuestion(), ms + ANSWER_GRACE_MS);
    this.pushAll(); this.pushHost();
  }

  pause() {
    if (this.phase !== 'question' || this.paused) return;
    this.paused = true;
    this.remainingMs = Math.max(0, this.deadline - Date.now());
    clearTimeout(this._qTimer);
    this.pushAll(); this.pushHost();
  }

  resume() {
    if (this.phase !== 'question' || !this.paused) return;
    this.paused = false;
    this.deadline = Date.now() + this.remainingMs;
    this._qTimer = setTimeout(() => this.closeQuestion(), this.remainingMs + ANSWER_GRACE_MS);
    this.pushAll(); this.pushHost();
  }

  answer(socket, optionIds) {
    const p = this.participants.get(socket.data.pid);
    if (!p) return { error: 'Participante não encontrado.' };
    if (this.phase !== 'question') return { error: 'O tempo desta pergunta acabou.' };
    if (this.paused) return { error: 'O quiz está pausado.' };
    const q = this.question;
    if (p.answers[q.id]) return { error: 'Você já respondeu esta pergunta.' };
    const now = Date.now();
    if (now > this.deadline + ANSWER_GRACE_MS) return { error: 'O tempo desta pergunta acabou.' };
    const valid = new Set(q.options.map(o => o.id));
    const ids = [...new Set((Array.isArray(optionIds) ? optionIds : []).map(String))].filter(id => valid.has(id));
    if (!ids.length) return { error: 'Selecione uma alternativa.' };
    if (!q.multiple && ids.length > 1) return { error: 'Selecione apenas uma alternativa.' };
    const elapsed = Math.min(q.timeLimit * 1000, Math.max(0, q.timeLimit * 1000 - (this.deadline - now)));
    const r = scoreAnswer(q, ids, elapsed, this.settings.speedScoring);
    p.answers[q.id] = { ids, elapsedMs: elapsed, correct: r.correct, points: r.points };
    // outras abas do mesmo participante também ficam sabendo
    for (const sid of p.sockets) if (sid !== socket.id) this.io.to(sid).emit('state', this.viewFor(p));
    this.pushHost();
    // todos os conectados responderam → encerra a pergunta automaticamente
    if (this.answeredCount() >= this.connectedCount()) setTimeout(() => {
      if (this.phase === 'question' && this.question === q && this.answeredCount() >= this.connectedCount()) this.closeQuestion();
    }, 800);
    return { ok: true };
  }

  answeredCount() {
    const q = this.question;
    if (!q) return 0;
    let n = 0;
    for (const p of this.participants.values()) if (p.answers[q.id]) n++;
    return n;
  }

  closeQuestion() {
    if (this.phase !== 'question') return;
    clearTimeout(this._qTimer);
    this.paused = false;
    const q = this.question;
    for (const p of this.participants.values()) {
      const a = p.answers[q.id];
      if (a) {
        p.score += a.points;
        if (a.correct) { p.correctCount++; p.correctTimeMs += a.elapsedMs; }
      }
      p.lastResult = a ? { answered: true, correct: a.correct, points: a.points } : { answered: false, correct: false, points: 0 };
    }
    this.phase = 'reveal';
    this.pushAll(); this.pushHost();
  }

  end() {
    if (this.phase === 'ended') return;
    if (this.phase === 'question') this.closeQuestion();
    clearTimeout(this._qTimer);
    this.phase = 'ended';
    this.endedAt = Date.now();
    if (this.startedAt) this.store.addResult(this.toResult());
    this.pushAll(); this.pushHost();
  }

  // ---------------- visões
  ranking() { return rank([...this.participants.values()]); }

  leaderboard(limitOverride) {
    const size = limitOverride ?? this.settings.rankingSize;
    const list = this.ranking();
    return (size ? list.slice(0, size) : list).map(({ p, rank }) => ({ rank, name: p.name, score: p.score }));
  }

  publicQuestion() {
    const q = this.question;
    if (!q) return null;
    return {
      index: this.index, total: this.questions.length, text: q.text, image: q.image,
      multiple: q.multiple, timeLimit: q.timeLimit, points: q.points,
      options: q.options.map(o => ({ id: o.id, text: o.text })),
      remainingMs: this.paused ? this.remainingMs : Math.max(0, this.deadline - Date.now()),
    };
  }

  revealInfo() {
    const q = this.question;
    const counts = Object.fromEntries(q.options.map(o => [o.id, 0]));
    let answered = 0, correct = 0;
    for (const p of this.participants.values()) {
      const a = p.answers[q.id];
      if (!a) continue;
      answered++; if (a.correct) correct++;
      for (const id of a.ids) counts[id]++;
    }
    return {
      counts, answered, correct,
      correctIds: this.settings.showCorrectAnswer ? q.options.filter(o => o.correct).map(o => o.id) : null,
    };
  }

  canSeeRanking() {
    const m = this.settings.rankingMode;
    return (m === 'during' && (this.phase === 'leaderboard' || this.phase === 'ended')) || (m === 'end' && this.phase === 'ended');
  }

  baseView() {
    return {
      code: this.code,
      phase: this.phase,
      paused: this.paused,
      locked: this.locked,
      serverNow: Date.now(),
      quiz: {
        title: this.quiz.title, description: this.quiz.description, coverImage: this.quiz.coverImage,
        openingMessage: this.quiz.openingMessage,
        closingMessage: this.phase === 'ended' ? this.quiz.closingMessage : '',
        total: this.questions.length,
      },
      question: this.phase === 'lobby' || this.phase === 'ended' ? null : this.publicQuestion(),
      reveal: this.phase === 'reveal' || this.phase === 'leaderboard' ? this.revealInfo() : null,
    };
  }

  viewFor(p, base = this.baseView(), ranked = null) {
    const q = this.question;
    const v = { ...base, me: { name: p.name } };
    if (q && p.answers[q.id] && this.phase === 'question') v.myAnswer = p.answers[q.id].ids;
    if (this.phase === 'reveal' || this.phase === 'leaderboard') {
      const a = q && p.answers[q.id];
      v.myAnswer = a ? a.ids : [];
      v.result = {
        answered: !!a,
        correct: this.settings.showCorrectAnswer ? !!(a && a.correct) : null,
        points: this.settings.showPersonalScore ? (a ? a.points : 0) : null,
      };
    }
    if (this.settings.showPersonalScore && this.phase !== 'lobby') v.me.score = p.score;
    if (this.canSeeRanking()) {
      ranked = ranked || this.ranking();
      const mine = ranked.find(r => r.p.id === p.id);
      v.me.rank = mine ? mine.rank : null;
      v.me.score = p.score;
      v.me.of = ranked.length;
      v.leaderboard = this.leaderboard();
    }
    return v;
  }

  pushAll() {
    const base = this.baseView();
    const ranked = this.canSeeRanking() ? this.ranking() : null;
    for (const p of this.participants.values()) {
      if (!p.sockets.size) continue;
      const v = this.viewFor(p, base, ranked);
      for (const sid of p.sockets) this.io.to(sid).emit('state', v);
    }
  }

  hostView() {
    const base = this.baseView();
    const q = this.question;
    if (q && this.phase !== 'lobby' && this.phase !== 'ended') {
      // o apresentador sempre vê o gabarito no painel; o telão respeita a configuração
      base.question.correctIds = q.options.filter(o => o.correct).map(o => o.id);
    }
    return {
      ...base,
      settings: this.settings,
      sessionId: this.sessionId,
      participants: [...this.participants.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(p => ({ id: p.id, name: p.name, connected: p.sockets.size > 0, score: p.score, answered: !!(q && p.answers[q.id]) })),
      connected: this.connectedCount(),
      total: this.participants.size,
      answered: this.answeredCount(),
      leaderboard: this.phase === 'leaderboard' || this.phase === 'ended' ? this.leaderboard() : null,
      fullRanking: this.leaderboard(0),
      maxParticipants: MAX_PARTICIPANTS,
    };
  }

  pushHost() {
    if (this._hostTimer) return;
    this._hostTimer = setTimeout(() => {
      this._hostTimer = null;
      this.io.to(this.hostRoom).emit('host:state', this.hostView());
    }, HOST_THROTTLE_MS);
  }

  // ---------------- resultado para exportação
  toResult() {
    const ranked = this.ranking();
    return {
      sessionId: this.sessionId,
      code: this.code,
      quizId: this.quizId,
      quizTitle: this.quiz.title,
      speedScoring: this.settings.speedScoring,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      endedAt: this.endedAt ? new Date(this.endedAt).toISOString() : null,
      questions: this.questions.map(q => ({
        id: q.id, text: q.text, points: q.points, timeLimit: q.timeLimit, multiple: q.multiple,
        options: q.options.map(o => ({ id: o.id, text: o.text, correct: o.correct })),
      })),
      participants: ranked.map(({ p, rank }) => ({
        rank, name: p.name, score: p.score, correctCount: p.correctCount,
        joinedAt: new Date(p.joinedAt).toISOString(),
        answers: Object.fromEntries(Object.entries(p.answers).map(([qid, a]) => [qid, { ...a }])),
      })),
    };
  }
}

class SessionManager {
  constructor(io, store) {
    this.io = io;
    this.store = store;
    this.sessions = new Map();
    // remove sessões antigas (encerradas há 6h ou criadas há 24h)
    setInterval(() => {
      const now = Date.now();
      for (const [code, s] of this.sessions) {
        if ((s.endedAt && now - s.endedAt > 6 * 3600e3) || now - s.createdAt > 24 * 3600e3) this.sessions.delete(code);
      }
    }, 10 * 60e3).unref();
  }
  create(quiz) {
    const code = makeCode(this.sessions);
    const s = new LiveSession(this.io, quiz, code, this.store);
    this.sessions.set(code, s);
    return s;
  }
  get(code) { return this.sessions.get(String(code || '').toUpperCase()) || null; }
  list() { return [...this.sessions.values()]; }
}

module.exports = { SessionManager, LiveSession, MAX_PARTICIPANTS };
