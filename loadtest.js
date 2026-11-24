#!/usr/bin/env node
'use strict';
// Teste de carga: N participantes simulados entram, respondem todas as perguntas
// e o resultado é conferido. Uso:
//   node scripts/loadtest.js [url] [participantes] [senhaAdmin]
//   node scripts/loadtest.js http://localhost:3000 250 admin
const { io } = require('socket.io-client');

const BASE = process.argv[2] || 'http://localhost:3000';
const N = Number(process.argv[3] || 250);
const PASS = process.argv[4] || process.env.ADMIN_PASSWORD || 'admin';
const QUESTIONS = 5;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, opts = {}, token) => {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.headers.get('content-type').includes('json') ? r.json() : r.text();
};
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };

(async () => {
  const { token } = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: PASS }) });
  const quiz = {
      title: `Teste de carga ${N}`,
      settings: { speedScoring: true, rankingMode: 'during', rankingSize: 10 },
      questions: Array.from({ length: QUESTIONS }, (_, i) => ({
        text: `Pergunta ${i + 1}`, timeLimit: 8, points: 1000, multiple: i === 2,
        options: [{ text: 'A', correct: true }, { text: 'B', correct: i === 2 }, { text: 'C' }, { text: 'D' }],
      })),
  };
  const { code } = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ quiz }) }, token);
  console.log(`Sessão ${code} criada. Conectando ${N} participantes…`);

  const host = io(BASE, { transports: ['websocket'] });
  let hostState = null;
  host.on('host:state', s => { hostState = s; });
  await new Promise(r => host.emit('host:watch', { code, token }, r));
  const act = (action, payload) => new Promise(r => host.emit('host:action', { action, payload }, r));

  const joinLat = [], ansLat = [], errors = [];
  const expected = new Map(); // nome -> pontos esperados (mín.) apenas para conferir corretas
  const clients = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: N }, async (_, i) => {
    await sleep(Math.random() * 3000); // chegadas espalhadas em 3 s
    const c = io(BASE, { transports: ['websocket'], forceNew: true });
    const name = `Pessoa ${String(i + 1).padStart(3, '0')}`;
    c.state = null; c.name = name; c.correct = 0;
    c.on('state', s => {
      c.state = s;
      if (s.phase === 'question' && s.question && !s.myAnswer && c.answeredIdx !== s.question.index) {
        c.answeredIdx = s.question.index;
        const q = s.question;
        const right = Math.random() < 0.6;
        const ids = right
          ? (q.multiple ? q.options.filter(o => o.text === 'A' || o.text === 'B') : q.options.filter(o => o.text === 'A')).map(o => o.id)
          : [q.options.find(o => o.text === 'C').id];
        setTimeout(() => {
          const t = Date.now();
          c.emit('answer', { optionIds: ids }, r => {
            ansLat.push(Date.now() - t);
            if (r.error) errors.push(`${name} q${q.index + 1}: ${r.error}`);
            else if (right) c.correct++;
          });
        }, 200 + Math.random() * 5000);
      }
    });
    await new Promise(r => c.on('connect', r));
    const t = Date.now();
    const res = await new Promise(r => c.emit('join', { code, name }, r));
    joinLat.push(Date.now() - t);
    if (res.error) errors.push(`${name} join: ${res.error}`);
    clients.push(c);
  }));
  await sleep(500);
  console.log(`Entradas: ${clients.length} em ${Date.now() - t0} ms | latência join p50=${pct(joinLat, .5)} p95=${pct(joinLat, .95)} máx=${Math.max(...joinLat)} ms`);
  console.log(`Telão vê: ${hostState.connected} conectados / ${hostState.total} inscritos`);

  const waitFor = async (pred, ms = 15000) => {
    const t = Date.now();
    while (!pred(hostState) && Date.now() - t < ms) await sleep(50);
    if (!pred(hostState)) throw new Error('timeout aguardando estado; fase=' + hostState.phase);
  };
  await act('next'); // começa
  for (let q = 0; q < QUESTIONS; q++) {
    await waitFor(s => s.phase === 'question' && s.question.index === q);
    const start = Date.now();
    // fecha sozinha quando todos respondem (ou quando o tempo esgota)
    await waitFor(s => s.phase === 'reveal');
    console.log(`P${q + 1}: ${hostState.reveal.answered} respostas, ${hostState.reveal.correct} corretas, fechou em ${Date.now() - start} ms`);
    await act('next'); // reveal -> leaderboard
    await waitFor(s => s.phase === 'leaderboard');
    await act('next'); // leaderboard -> próxima / fim
  }
  await waitFor(s => s.phase === 'ended');
  await sleep(500);

  const finalStates = clients.map(c => c.state);
  const ended = finalStates.filter(s => s && s.phase === 'ended').length;
  const withRank = finalStates.filter(s => s && s.me && s.me.rank).length;
  const csv = await api(`/api/export/${code}.csv`, {}, token);
  const lines = csv.trim().split(/\r?\n/).length - 1;
  const totalCorrect = clients.reduce((s, c) => s + c.correct, 0);
  const serverCorrect = hostState.fullRanking ? null : null;

  console.log(`Latência de resposta p50=${pct(ansLat, .5)} p95=${pct(ansLat, .95)} p99=${pct(ansLat, .99)} máx=${Math.max(...ansLat)} ms (${ansLat.length} respostas)`);
  console.log(`Fim: ${ended}/${N} clientes viram "encerrado", ${withRank}/${N} receberam a própria posição`);
  console.log(`Top 3: ${hostState.leaderboard.slice(0, 3).map(r => `${r.rank}º ${r.name} ${r.score}`).join(' | ')}`);
  console.log(`CSV exportado com ${lines} linhas de participantes; acertos enviados pelos clientes: ${totalCorrect}`);
  console.log(errors.length ? `ERROS (${errors.length}):\n  ` + errors.slice(0, 10).join('\n  ') : 'Nenhum erro.');
  void serverCorrect;

  clients.forEach(c => c.close()); host.close();
  process.exit(errors.length || ended !== N || lines !== N ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
