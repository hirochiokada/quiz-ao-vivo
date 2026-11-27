// Tela do apresentador: projeção + controles.
const code = location.pathname.split('/').pop().toUpperCase();
const stage = $('#stage');
let S = null;              // último estado recebido
let endsAt = 0, tick = null, lastStageKey = '';
let showGab = false;
const seenChips = new Set();

if (!Auth.token) location.href = '/admin?next=' + encodeURIComponent(location.pathname);

const socket = io({ transports: ['websocket', 'polling'] });
socket.on('connect', () => {
  socket.emit('host:watch', { code, token: Auth.token }, r => {
    if (r && r.error) {
      stage.innerHTML = `<div class="empty" style="color:#fff;margin:auto"><h2>${esc(r.error)}</h2><a class="btn" href="/admin">Voltar ao painel</a></div>`;
      if (/login/i.test(r.error)) { Auth.token = null; setTimeout(() => location.href = '/admin?next=' + encodeURIComponent(location.pathname), 1200); }
    }
  });
});
socket.on('disconnect', () => { $('#stat').textContent = 'Reconectando…'; });
socket.on('host:state', s => {
  const prevPhase = S && S.phase, prevIdx = S && S.question && S.question.index, prevPaused = S && S.paused;
  S = s;
  if (s.phase === 'ended' && prevPhase && prevPhase !== 'ended') saveResult();
  if (s.question && s.phase === 'question' && (prevPhase !== 'question' || prevIdx !== s.question.index || prevPaused !== s.paused || !endsAt)) {
    endsAt = performance.now() + s.question.remainingMs;
  }
  if (s.phase !== 'question') endsAt = 0;
  draw();
});

const act = (action, payload) => new Promise(res => socket.emit('host:action', { action, payload }, r => {
  if (r && r.error) toast(r.error, true);
  res(r);
}));

// ---------- desenho do palco
function draw() {
  document.title = `${S.quiz.title} · ${code}`;
  $('#pausedBanner').classList.toggle('hidden', !(S.phase === 'question' && S.paused));
  renderControls();
  renderDrawer();
  let html = '';
  const top = `<div class="s-top"><span class="pill">Sala <b style="letter-spacing:.1em">${esc(code)}</b></span>${S.question && S.phase !== 'ended' ? `<span class="pill">Pergunta ${S.question.index + 1}/${S.question.total}</span>` : ''}
    <span class="grow"></span><span class="pill">👥 ${S.connected}</span></div>`;

  if (S.phase === 'lobby') {
    html = `<div class="lobby">
      <div><div class="qrbox"><img src="/api/sessions/${code}/qr.svg" alt="QR Code para entrar"></div>
        <div class="joininfo"><div class="url" id="joinUrl"></div><div class="small" style="opacity:.75;margin-top:.6rem">ou acesse <b>${esc(location.host)}/join</b> e digite</div><div class="bigcode">${esc(code)}</div></div></div>
      <div>
        <h1 class="title">${esc(S.quiz.title)}</h1>
        ${S.quiz.openingMessage ? `<div class="msg" style="margin-top:1.2rem">${esc(S.quiz.openingMessage)}</div>` : S.quiz.description ? `<div class="msg" style="margin-top:1.2rem">${esc(S.quiz.description)}</div>` : ''}
        <div class="count">👥 ${S.total} participante${S.total === 1 ? '' : 's'} ${S.locked ? '<span class="badge warn">entradas bloqueadas</span>' : ''}</div>
        <div class="names">${S.participants.map(p => `<span class="chip ${p.connected ? '' : 'off'} ${seenChips.has(p.id) ? '' : 'new'}">${esc(p.name)}<button data-kick="${p.id}" title="Remover">✕</button></span>`).join('') || '<span style="opacity:.7">Aguardando participantes… Aponte a câmera do celular para o QR Code.</span>'}</div>
      </div></div>`;
  } else if (S.phase === 'question' || S.phase === 'reveal') {
    const q = S.question, rv = S.reveal;
    const max = rv ? Math.max(1, ...Object.values(rv.counts)) : 1;
    html = `${top}<div class="qwrap">
      <div class="qhead"><div class="qtext">${esc(q.text)}</div>
        ${S.phase === 'question' ? `<div class="htimer"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,.2)" stroke-width="9" fill="none"/><circle id="arc" cx="50" cy="50" r="44" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="276.46"/></svg><span class="t" id="tt"></span></div>` : ''}
      </div>
      ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="">` : ''}
      <div class="answered">${S.phase === 'question'
        ? `${S.answered} de ${S.connected} responderam${q.multiple ? ' · várias respostas corretas' : ''}`
        : `${rv.answered} respostas${rv.correctIds ? ` · ${rv.correct} acerto${rv.correct === 1 ? '' : 's'}` : ''}`}</div>
      <div class="hopts">${q.options.map((o, j) => {
        let cls = `hopt o${j + 1}`;
        const right = rv && rv.correctIds && rv.correctIds.includes(o.id);
        if (rv && rv.correctIds) cls += right ? ' right' : ' dim';
        const n = rv ? rv.counts[o.id] : 0;
        return `<div class="${cls}">${rv ? `<div class="bar" style="width:${(n / max) * 100}%"></div>` : ''}<span class="l" style="position:relative">${LETTERS[j]}</span><span class="txt">${esc(o.text)}</span>${rv ? `<span class="n">${n}</span>` : ''}${right ? '<span class="ck">✓</span>' : ''}</div>`;
      }).join('')}</div></div>`;
  } else if (S.phase === 'leaderboard') {
    html = `${top}<div class="board"><h2>Classificação</h2><div class="lb-scroll">${S.leaderboard.map((r, i) => `<div class="lbrow" style="animation-delay:${i * 60}ms"><span class="pos">${r.rank}º</span><span class="nm">${esc(r.name)}</span><span>${r.score}</span></div>`).join('')}</div></div>`;
  } else if (S.phase === 'ended') {
    const showRank = S.settings.rankingMode !== 'never';
    const lb = S.leaderboard || [];
    const pod = [lb[1], lb[0], lb[2]];
    const hs = [26, 36, 18], colors = ['#a9b4c2', '#f5b301', '#d08a4f'];
    html = `${top}<div class="board" style="text-align:center">
      <h2>🏁 Fim do quiz!</h2>
      ${showRank && lb.length ? `<div class="podium">${pod.map((r, i) => r ? `<div class="pod"><div class="nm">${esc(r.name)}</div><div class="sc">${r.score} pts</div><div class="blk" style="height:${hs[i]}vh;background:${colors[i]}">${r.rank}º</div></div>` : '<div class="pod"></div>').join('')}</div>` : ''}
      ${S.quiz.closingMessage ? `<div class="msg" style="margin:1rem auto;max-width:800px">${esc(S.quiz.closingMessage)}</div>` : ''}
      ${showRank && lb.length > 3 ? `<div class="lb-scroll" style="text-align:left;max-height:30vh">${lb.slice(3).map(r => `<div class="lbrow" style="background:rgba(255,255,255,.12)"><span class="pos">${r.rank}º</span><span class="nm">${esc(r.name)}</span><span>${r.score}</span></div>`).join('')}</div>` : ''}
      <p style="opacity:.8">${S.total} participante${S.total === 1 ? '' : 's'}</p></div>`;
  }
  if (html !== lastStageKey) { stage.innerHTML = html; lastStageKey = html; }
  S.participants.forEach(p => seenChips.add(p.id));
  const ju = $('#joinUrl');
  if (ju && !ju.textContent) fetch(`/api/sessions/${code}/info`).then(r => r.json()).then(i => { ju.textContent = i.joinUrl; }).catch(() => {});

  clearInterval(tick);
  if (S.phase === 'question') { updateTimer(); if (!S.paused) tick = setInterval(updateTimer, 200); }
}

function updateTimer() {
  const t = $('#tt');
  if (!t || !S.question) return;
  const total = S.question.timeLimit * 1000;
  const left = S.paused ? S.question.remainingMs : Math.max(0, endsAt - performance.now());
  t.textContent = Math.ceil(left / 1000);
  $('#arc').setAttribute('stroke-dashoffset', String(276.46 * (1 - left / total)));
}

// ---------- controles
function renderControls() {
  const last = S.question && S.question.index >= S.question.total - 1;
  const during = !!(S.question && S.question.rankingNext);
  const b = [];
  $('#stat').textContent = S.phase === 'question' ? `${S.answered}/${S.connected} responderam` : `${S.connected} conectados · ${S.total} inscritos`;
  if (S.phase === 'lobby') {
    b.push(`<button class="small" data-a="lock">${S.locked ? '🔓 Liberar entradas' : '🔒 Bloquear entradas'}</button>`);
    b.push(`<button class="primary" data-a="next" ${S.total ? '' : 'disabled title="Aguardando participantes"'}>▶ Iniciar quiz</button>`);
  } else if (S.phase === 'question') {
    b.push(`<button class="small" data-a="lock">${S.locked ? '🔓 Liberar entradas' : '🔒 Bloquear entradas'}</button>`);
    b.push(S.paused ? '<button class="warnb" data-a="resume">▶ Retomar</button>' : '<button data-a="pause">⏸ Pausar</button>');
    b.push('<button class="primary" data-a="closeQuestion">Encerrar pergunta</button>');
  } else if (S.phase === 'reveal') {
    b.push(`<button class="primary" data-a="next">${during ? 'Classificação →' : last ? 'Resultado final →' : 'Próxima pergunta →'}</button>`);
  } else if (S.phase === 'leaderboard') {
    b.push(`<button class="primary" data-a="next">${last ? 'Resultado final →' : 'Próxima pergunta →'}</button>`);
  } else if (S.phase === 'ended') {
    const t = encodeURIComponent(Auth.token);
    b.push(`<a class="btn small" href="/api/export/${code}.xlsx?t=${t}">⬇ Excel</a>`, `<a class="btn small" href="/api/export/${code}.csv?t=${t}">⬇ CSV</a>`);
    b.push('<button class="small" data-a="restart">↻ Reiniciar sessão</button>');
  }
  if (S.phase !== 'ended' && S.phase !== 'lobby') b.unshift('<button class="small" data-a="end" style="opacity:.8">■ Encerrar quiz</button>');
  if (S.phase === 'lobby' && S.total) b.unshift('<button class="small" data-a="restart" style="opacity:.8" title="Remove as pontuações; mantém os inscritos">↻ Reiniciar</button>');
  $('#ctlButtons').innerHTML = b.join('');

  const q = S.question;
  $('#gab').innerHTML = q && q.correctIds && S.phase === 'question'
    ? `<button class="small ghost" data-gab style="color:#fff">${showGab ? '🙈' : '👁'} Gabarito</button>${showGab ? ` <span class="gab">${q.options.map((o, j) => q.correctIds.includes(o.id) ? LETTERS[j] : null).filter(Boolean).join(', ')}</span>` : ''}`
    : '';
}

document.addEventListener('click', async e => {
  const a = e.target.closest('[data-a]');
  if (a) {
    const action = a.dataset.a;
    if (action === 'end' && !await confirmDialog('Encerrar o quiz agora? Os participantes verão o resultado final.', 'Encerrar', true)) return;
    if (action === 'restart' && !await confirmDialog('Reiniciar a sessão? Pontuações e respostas serão zeradas; os participantes conectados voltam para a sala de espera. As perguntas são mantidas.', 'Reiniciar', true)) return;
    a.disabled = true;
    await act(action, action === 'lock' ? { locked: !S.locked } : undefined);
    a.disabled = false;
  }
  if (e.target.closest('[data-gab]')) { showGab = !showGab; renderControls(); }
  const k = e.target.closest('[data-kick]');
  if (k) {
    const p = S.participants.find(x => x.id === k.dataset.kick);
    if (p && await confirmDialog(`Remover "${p.name}" da sessão?`, 'Remover', true)) act('kick', { pid: p.id });
  }
});

// ---------- gaveta de participantes
function renderDrawer() {
  if (!$('#drawer').classList.contains('open')) return;
  const term = $('#dSearch').value.trim().toLowerCase();
  const list = S.participants.filter(p => !term || p.name.toLowerCase().includes(term));
  const ranks = new Map((S.fullRanking || []).map(r => [r.name, r.rank]));
  $('#dCount').textContent = `(${S.connected} conectados / ${S.total})`;
  $('#dList').innerHTML = list.map(p => `<div class="prow"><span class="dotc ${p.connected ? '' : 'off'}" title="${p.connected ? 'Conectado' : 'Desconectado'}"></span>
    <span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
    ${S.phase === 'question' ? (p.answered ? '<span class="badge ok">respondeu</span>' : '<span class="badge">aguardando</span>') : ''}
    ${S.phase !== 'lobby' ? `<span class="small muted" title="Posição · pontos">${ranks.get(p.name) || '–'}º · ${p.score}</span>` : ''}
    <button class="small ghost danger" data-kick="${p.id}">Remover</button></div>`).join('') || '<div class="empty">Ninguém por aqui ainda.</div>';
}
$('#peopleBtn').onclick = () => { $('#drawer').classList.toggle('open'); renderDrawer(); };
$('#dClose').onclick = () => $('#drawer').classList.remove('open');
$('#dSearch').oninput = renderDrawer;

// ---------- tela cheia / ocultar controles / atalhos
const toggleFs = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
const toggleCtl = () => { $('#controls').classList.toggle('hide'); $('#showCtl').classList.toggle('hidden', !$('#controls').classList.contains('hide')); };
$('#fsBtn').onclick = toggleFs;
$('#hideBtn').onclick = toggleCtl;
$('#showCtl').onclick = toggleCtl;
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea') || document.querySelector('.modal-bg')) return;
  if (e.key === 'f' || e.key === 'F') toggleFs();
  if (e.key === 'h' || e.key === 'H') toggleCtl();
  if (!S) return;
  if ((e.key === ' ' || e.key === 'ArrowRight') && ['lobby', 'reveal', 'leaderboard'].includes(S.phase) && (S.phase !== 'lobby' || S.total)) { e.preventDefault(); act('next'); }
  if ((e.key === 'p' || e.key === 'P') && S.phase === 'question') act(S.paused ? 'resume' : 'pause');
});

// guarda o resultado final neste navegador (o servidor gratuito pode apagar tudo ao "dormir")
let savedFor = null;
async function saveResult() {
  if (savedFor === S.sessionId) return;
  savedFor = S.sessionId;
  try {
    const r = await api(`/api/sessions/${code}/result`);
    if (r.startedAt && ResultStore.add(r)) toast('Resultado salvo em Administração › Resultados.');
  } catch {}
}
