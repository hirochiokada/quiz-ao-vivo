// Renderização da tela do participante a partir do "view" enviado pelo servidor.
// Compartilhado entre a página real (/j/CODIGO) e a pré-visualização do administrador.
function createPlayUI(root, { onAnswer }) {
  let view = null;
  let selected = [];
  let selQ = -1;
  let sending = false;
  let endsAt = 0;
  let tick = null;
  let lastKey = '';

  const top = v => `<div class="pv-top">
      <span class="pv-pill">${esc(v.quiz.title)}</span>
      <span class="pv-pill">${esc(v.me.name)}${v.me.score != null ? ` · ${v.me.score} pts` : ''}</span>
    </div>`;

  function timerSvg() {
    return `<div class="timer" id="pvTimer"><svg width="46" height="46"><circle cx="23" cy="23" r="20" stroke="rgba(255,255,255,.25)" stroke-width="5" fill="none"/>
      <circle id="pvArc" cx="23" cy="23" r="20" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="125.66" stroke-dashoffset="0"/></svg><span class="t" id="pvT"></span></div>`;
  }

  function updateTimer() {
    const el = document.getElementById('pvT');
    if (!el || !view || !view.question) return;
    const total = view.question.timeLimit * 1000;
    const left = view.paused ? view.question.remainingMs : Math.max(0, endsAt - performance.now());
    el.textContent = Math.ceil(left / 1000);
    document.getElementById('pvArc').setAttribute('stroke-dashoffset', String(125.66 * (1 - left / total)));
    document.getElementById('pvTimer').classList.toggle('low', left < 5000);
  }

  function optionButtons(q, { interactive, correctIds, mine }) {
    return `<div class="pv-opts" role="group" aria-disabled="${!interactive}">${q.options.map((o, j) => {
      const isSel = (interactive ? selected : mine || []).includes(o.id);
      const right = correctIds && correctIds.includes(o.id);
      let cls = `pv-opt o${j + 1}`;
      if (isSel) cls += ' sel';
      if (correctIds) cls += right ? ' right' : ' dim';
      else if (!interactive && mine && mine.length && !isSel) cls += ' dim';
      return `<button class="${cls}" data-opt="${esc(o.id)}" ${interactive ? '' : 'tabindex="-1"'} aria-pressed="${isSel}">
        <span class="l"><span>${LETTERS[j]}</span></span><span>${esc(o.text)}</span>
        ${correctIds && right ? '<span class="mark">✓</span>' : ''}</button>`;
    }).join('')}</div>`;
  }

  function lbList(list, myName) {
    return `<ol class="lb">${list.map(r => `<li class="${r.name === myName ? 'me' : ''}"><span class="pos">${r.rank}º</span><span class="nm">${esc(r.name)}</span><span class="sc">${r.score}</span></li>`).join('')}</ol>`;
  }

  function myRankLine(v) {
    if (v.me.rank) return `<div class="pv-big">${v.me.rank}º lugar</div><div class="pv-sub">de ${v.me.of} participantes · ${v.me.score} pontos</div>`;
    if (v.me.score != null) return `<div class="pv-big">${v.me.score} pontos</div>`;
    return '';
  }

  // chamado quando chega um novo estado do servidor
  function render(v) {
    view = v;
    const q = v.question;
    if (q && v.phase === 'question') {
      if (selQ !== q.index) { selQ = q.index; selected = []; sending = false; }
      endsAt = performance.now() + q.remainingMs;
    }
    draw();
  }

  function draw() {
    const v = view;
    const q = v.question;
    clearInterval(tick);
    let html = '';
    switch (v.phase) {
      case 'lobby':
        html = `${top(v)}<div class="pv-main pv-center">
          ${v.quiz.coverImage ? `<img class="pv-cover" src="${esc(v.quiz.coverImage)}" alt="">` : ''}
          <div class="spinner"></div>
          <div class="pv-big">Você está dentro!</div>
          <div class="pv-sub pulse">Aguarde o apresentador iniciar o quiz…</div>
          ${v.quiz.openingMessage ? `<div class="pv-msg">${esc(v.quiz.openingMessage)}</div>` : ''}
          ${v.quiz.description && !v.quiz.openingMessage ? `<div class="pv-msg">${esc(v.quiz.description)}</div>` : ''}
        </div>`;
        break;

      case 'question': {
        const done = v.myAnswer && v.myAnswer.length;
        html = `${top(v)}
          <div class="row between" style="margin-top:.8rem"><b>Pergunta ${q.index + 1} de ${q.total}</b>${timerSvg()}</div>
          ${q.image ? `<img class="pv-qimg" src="${esc(q.image)}" alt="">` : ''}
          <div class="pv-q">${esc(q.text)}</div>
          ${done ? `<div class="pv-main pv-center"><div class="pv-result neutral"><div class="emoji">✅</div>
                <div class="pv-big">Resposta registrada!</div><div class="pv-sub pulse">Aguarde o fim do tempo…</div></div>
                <div style="margin-top:1rem">${optionButtons(q, { interactive: false, mine: v.myAnswer })}</div></div>`
            : `<div class="small" style="opacity:.9;margin-bottom:.5rem">${q.multiple ? 'Selecione <b>todas</b> as corretas e confirme' : 'Toque em uma alternativa e confirme'}</div>
               ${optionButtons(q, { interactive: true })}
               <div class="pv-confirm"><button class="primary" id="pvConfirm" ${selected.length && !sending ? '' : 'disabled'}>${sending ? 'Enviando…' : 'Confirmar resposta'}</button>
               <p class="pv-err" id="pvErr"></p></div>`}
          ${v.paused ? '<div class="overlay">⏸<br>Quiz pausado<br><span style="font-weight:500;font-size:1rem">Aguarde o apresentador</span></div>' : ''}`;
        break;
      }

      case 'reveal': {
        const r = v.result || {};
        let cls = 'neutral', emoji = '⏱', title = 'Tempo esgotado', sub = 'Você não respondeu a tempo.';
        if (r.answered) {
          if (r.correct === true) { cls = 'ok'; emoji = '🎉'; title = 'Resposta correta!'; sub = ''; }
          else if (r.correct === false) { cls = 'bad'; emoji = '😕'; title = 'Resposta incorreta'; sub = ''; }
          else { emoji = '✅'; title = 'Resposta registrada'; sub = 'Aguarde a próxima pergunta.'; }
        }
        html = `${top(v)}<div class="pv-main">
          <div class="pv-result ${cls}"><div class="emoji">${emoji}</div><div class="pv-big">${title}</div>
            ${sub ? `<div class="pv-sub">${sub}</div>` : ''}
            ${r.points != null && r.answered && r.correct !== false ? `<div class="pv-points">+${r.points} pontos</div>` : ''}
          </div>
          ${q ? `<div style="margin-top:1rem"><div class="pv-q" style="font-size:1rem">${esc(q.text)}</div>
            ${optionButtons(q, { interactive: false, correctIds: v.reveal && v.reveal.correctIds, mine: v.myAnswer })}</div>` : ''}
          <p class="pv-sub pulse pv-center" style="margin-top:1rem">Aguarde o apresentador…</p>
        </div>`;
        break;
      }

      case 'leaderboard':
        html = `${top(v)}<div class="pv-main pv-center">
          <div class="pv-sub">Classificação parcial</div>
          ${myRankLine(v)}
          ${v.leaderboard ? `<div style="margin-top:1rem;text-align:left">${lbList(v.leaderboard, v.me.name)}</div>` : ''}
          <p class="pv-sub pulse" style="margin-top:1rem">Próxima pergunta em instantes…</p>
        </div>`;
        break;

      case 'ended':
        html = `${top(v)}<div class="pv-main pv-center">
          <div class="emoji" style="font-size:3rem">🏁</div>
          <div class="pv-big">Fim do quiz!</div>
          ${myRankLine(v)}
          ${v.quiz.closingMessage ? `<div class="pv-msg">${esc(v.quiz.closingMessage)}</div>` : ''}
          ${v.leaderboard ? `<div style="margin-top:1rem;text-align:left"><div class="pv-sub" style="margin-bottom:.5rem;text-align:center">Classificação final</div>${lbList(v.leaderboard, v.me.name)}</div>` : ''}
        </div>`;
        break;
    }
    // evita "piscar" a tela com estados idênticos (ex.: reconexão)
    const key = html;
    if (key !== lastKey) { root.innerHTML = html; lastKey = key; }
    if (v.phase === 'question' && !(v.myAnswer && v.myAnswer.length)) bindQuestion(q);
    if (v.phase === 'question') { updateTimer(); if (!v.paused) tick = setInterval(updateTimer, 200); }
  }

  function bindQuestion(q) {
    root.querySelectorAll('[data-opt]').forEach(b => {
      b.onclick = () => {
        if (sending || view.paused) return;
        const id = b.dataset.opt;
        if (q.multiple) selected = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
        else selected = [id];
        if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
        lastKey = '';
        draw();
      };
    });
    const c = document.getElementById('pvConfirm');
    if (c) c.onclick = async () => {
      if (!selected.length || sending) return;
      sending = true; lastKey = ''; draw();
      const res = await onAnswer(selected.slice());
      sending = false;
      if (res && res.ok) { view = { ...view, myAnswer: selected.slice() }; lastKey = ''; draw(); }
      else { lastKey = ''; draw(); const e = document.getElementById('pvErr'); if (e) e.textContent = (res && res.error) || 'Não foi possível enviar. Tente de novo.'; }
    };
  }

  return { render, get view() { return view; }, destroy() { clearInterval(tick); } };
}
