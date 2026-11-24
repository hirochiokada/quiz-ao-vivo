// Editor de quiz: autosave, imagens, alternativas 2–6, arrastar e soltar.
const quizId = location.pathname.split('/').pop();
let quiz = null;
let saveTimer = null, saving = false, dirty = false;

function setStatus(t) { $('#saveStatus').textContent = t; }

function markDirty() {
  dirty = true;
  setStatus('Alterações não salvas…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 1200);
}

async function save() {
  clearTimeout(saveTimer);
  const ok = QuizStore.save(quiz);
  if (!ok) { setStatus('Erro ao salvar'); throw new Error('Sem espaço no navegador'); }
  dirty = false;
  setStatus('Salvo neste navegador ✓');
  showErrors(validateQuiz(quiz));
  return quiz;
}

function showErrors(errors) {
  const box = $('#errorsBox');
  $('#startBtn').disabled = !!errors.length;
  if (!errors.length) { box.innerHTML = '<span class="badge ok">Pronto para iniciar</span>'; return; }
  box.innerHTML = `<details><summary class="badge warn" style="cursor:pointer">${errors.length} pendência${errors.length > 1 ? 's' : ''} antes de iniciar</summary>
    <div class="errors" style="margin-top:.5rem;position:absolute;bottom:4.2rem;max-width:520px"><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div></details>`;
}

window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });

// ---------- imagem (capa e perguntas)
function imageField(url, onChange, label = 'Adicionar imagem') {
  const wrap = document.createElement('div');
  wrap.className = 'img-drop';
  const draw = () => {
    wrap.innerHTML = url
      ? `<img src="${esc(url)}" alt=""><div class="row" style="justify-content:center"><label class="btn small" style="margin:0">Trocar<input type="file" accept="image/*" hidden></label><button type="button" class="small ghost danger" data-rm>Remover</button></div>`
      : `<label class="btn small" style="margin:0">🖼 ${label}<input type="file" accept="image/*" hidden></label><div class="small" style="margin-top:.3rem">JPG, PNG, GIF ou WebP até 5 MB — ou arraste aqui</div>`;
  };
  const set = async file => {
    wrap.style.opacity = .5;
    const u = await uploadImage(file);
    wrap.style.opacity = 1;
    if (u) { url = u; onChange(u); draw(); }
  };
  wrap.addEventListener('change', e => { if (e.target.files && e.target.files[0]) set(e.target.files[0]); });
  wrap.addEventListener('click', e => { if (e.target.closest('[data-rm]')) { url = null; onChange(null); draw(); } });
  wrap.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); wrap.style.borderColor = 'var(--brand)'; } });
  wrap.addEventListener('dragleave', () => { wrap.style.borderColor = ''; });
  wrap.addEventListener('drop', e => { e.preventDefault(); wrap.style.borderColor = ''; if (e.dataTransfer.files[0]) set(e.dataTransfer.files[0]); });
  draw();
  return wrap;
}

// ---------- perguntas
function newQuestion() {
  const prev = quiz.questions[quiz.questions.length - 1];
  return {
    id: uid(), text: '', image: null, multiple: false,
    timeLimit: prev ? prev.timeLimit : 20, points: prev ? prev.points : 1000,
    options: [{ id: uid(), text: '', correct: true }, { id: uid(), text: '', correct: false }, { id: uid(), text: '', correct: false }, { id: uid(), text: '', correct: false }],
  };
}

function renderQuestions() {
  const list = $('#questions');
  list.innerHTML = '';
  $('#qCount').textContent = `(${quiz.questions.length})`;
  quiz.questions.forEach((q, i) => list.appendChild(questionCard(q, i)));
  if (!quiz.questions.length) list.innerHTML = '<div class="card empty" style="margin-bottom:1rem">Nenhuma pergunta ainda.</div>';
}

function questionCard(q, i) {
  const el = document.createElement('div');
  el.className = 'card q-card';
  el.dataset.id = q.id;
  el.innerHTML = `
    <div class="q-head">
      <span class="handle" title="Arraste para reordenar" aria-label="Arrastar">⠿</span>
      <span class="q-num">${i + 1}</span>
      <span class="grow muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.text) || 'Nova pergunta'}</span>
      <button class="icon ghost small" data-a="up" title="Mover para cima" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="icon ghost small" data-a="down" title="Mover para baixo" ${i === quiz.questions.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="icon ghost small" data-a="dup" title="Duplicar pergunta">⧉</button>
      <button class="icon ghost small danger" data-a="del" title="Excluir pergunta">✕</button>
    </div>
    <div class="q-body">
      <div class="grid2" style="grid-template-columns:2fr 1fr">
        <div><label>Pergunta</label><textarea data-f="text" maxlength="500" placeholder="Digite a pergunta">${esc(q.text)}</textarea></div>
        <div class="img-slot"><label>Imagem (opcional)</label></div>
      </div>
      <div class="row" style="margin:1rem 0;gap:1.25rem">
        <div><label>Tempo (segundos)</label>
          <div class="row" style="gap:.4rem"><input type="range" min="5" max="120" step="5" data-f="timeLimit" value="${q.timeLimit}" style="width:140px">
          <input type="number" min="5" max="120" data-f="timeLimit" value="${q.timeLimit}" style="width:80px"></div></div>
        <div><label>Pontuação máxima</label><input type="number" min="0" max="100000" step="100" data-f="points" value="${q.points}" style="width:120px"></div>
        <label class="check" style="margin-top:1.4rem"><input type="checkbox" data-f="multiple" ${q.multiple ? 'checked' : ''}><span>Várias respostas corretas</span></label>
      </div>
      <label>Alternativas <span class="muted small" style="font-weight:400">(${q.multiple ? 'marque todas as corretas' : 'marque a correta'})</span></label>
      <div class="opts"></div>
      <button class="small" data-a="addOpt" ${q.options.length >= 6 ? 'disabled' : ''}>+ Alternativa</button>
      <span class="muted small">${q.options.length}/6</span>
    </div>`;
  $('.img-slot', el).appendChild(imageField(q.image, u => { q.image = u; markDirty(); }));
  const opts = $('.opts', el);
  q.options.forEach((o, j) => {
    const row = document.createElement('div');
    row.className = 'opt-row';
    row.innerHTML = `<span class="opt-chip o${j + 1}">${LETTERS[j]}</span>
      <input type="text" maxlength="200" value="${esc(o.text)}" placeholder="Alternativa ${LETTERS[j]}" data-o="${j}">
      <label class="opt-correct"><input type="${q.multiple ? 'checkbox' : 'radio'}" name="c-${q.id}" data-c="${j}" ${o.correct ? 'checked' : ''}>Correta</label>
      <button class="icon ghost small danger" data-rmopt="${j}" title="Remover alternativa" ${q.options.length <= 2 ? 'disabled' : ''}>✕</button>`;
    opts.appendChild(row);
  });

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.f === 'text') { q.text = t.value; $('.q-head .grow', el).textContent = t.value || 'Nova pergunta'; }
    if (t.dataset.f === 'timeLimit') {
      const v = Math.max(5, Math.min(120, parseInt(t.value, 10) || 5));
      q.timeLimit = v;
      $$('[data-f="timeLimit"]', el).forEach(x => { if (x !== t) x.value = v; });
    }
    if (t.dataset.f === 'points') q.points = Math.max(0, parseInt(t.value, 10) || 0);
    if (t.dataset.o != null) q.options[+t.dataset.o].text = t.value;
    markDirty();
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.f === 'timeLimit') t.value = q.timeLimit;
    if (t.dataset.f === 'multiple') {
      q.multiple = t.checked;
      if (!q.multiple) { let seen = false; q.options.forEach(o => { if (o.correct && seen) o.correct = false; if (o.correct) seen = true; }); }
      rerender(q);
      markDirty();
    }
    if (t.dataset.c != null) {
      const j = +t.dataset.c;
      if (q.multiple) q.options[j].correct = t.checked;
      else q.options.forEach((o, k) => { o.correct = k === j; });
      markDirty();
    }
  });
  el.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const idx = quiz.questions.indexOf(q);
    if (b.dataset.rmopt != null) { q.options.splice(+b.dataset.rmopt, 1); rerender(q); markDirty(); return; }
    switch (b.dataset.a) {
      case 'addOpt': if (q.options.length < 6) { q.options.push({ id: uid(), text: '', correct: false }); rerender(q); markDirty(); setTimeout(() => { const ins = $$(`[data-id="${q.id}"] [data-o]`); ins[ins.length - 1].focus(); }); } break;
      case 'up': move(idx, idx - 1); break;
      case 'down': move(idx, idx + 1); break;
      case 'dup': {
        const c = JSON.parse(JSON.stringify(q));
        c.id = uid(); c.options.forEach(o => { o.id = uid(); });
        quiz.questions.splice(idx + 1, 0, c); renderQuestions(); markDirty(); break;
      }
      case 'del':
        if (q.text || q.options.some(o => o.text)) { if (!await confirmDialog('Excluir esta pergunta?', 'Excluir', true)) return; }
        quiz.questions.splice(idx, 1); renderQuestions(); markDirty(); break;
    }
  });
  enableDrag(el, $('.handle', el));
  return el;
}

function rerender(q) {
  const old = $(`.q-card[data-id="${q.id}"]`);
  old.replaceWith(questionCard(q, quiz.questions.indexOf(q)));
}

function move(from, to) {
  if (to < 0 || to >= quiz.questions.length || from === to) return;
  const [q] = quiz.questions.splice(from, 1);
  quiz.questions.splice(to, 0, q);
  renderQuestions();
  markDirty();
  const el = $(`.q-card[data-id="${q.id}"]`);
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// arrastar e soltar com Pointer Events (funciona com mouse e toque)
function enableDrag(card, handle) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    // recolhe todos os cartões para o arrasto ficar curto, mantendo o cartão sob o ponteiro
    const before = card.getBoundingClientRect().top;
    $('#questions').classList.add('sorting');
    window.scrollBy(0, card.getBoundingClientRect().top - before);
    card.classList.add('dragging');
    let target = null, after = false;
    const clear = () => $$('.q-card').forEach(c => c.classList.remove('drop-before', 'drop-after'));
    const onMove = ev => {
      clear();
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const c = under && under.closest('.q-card');
      target = null;
      if (c && c !== card) {
        const r = c.getBoundingClientRect();
        after = ev.clientY > r.top + r.height / 2;
        c.classList.add(after ? 'drop-after' : 'drop-before');
        target = c;
      }
      if (ev.clientY < 60) window.scrollBy(0, -12);
      if (ev.clientY > innerHeight - 90) window.scrollBy(0, 12);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      card.classList.remove('dragging');
      $('#questions').classList.remove('sorting');
      clear();
      if (!target) { card.scrollIntoView({ block: 'center' }); return; }
      const from = quiz.questions.findIndex(q => q.id === card.dataset.id);
      let to = quiz.questions.findIndex(q => q.id === target.dataset.id) + (after ? 1 : 0);
      if (from < to) to--;
      move(from, to);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}

// ---------- início
async function init() {
  if (!Auth.token) { location.href = '/admin?next=' + encodeURIComponent(location.pathname); return; }
  quiz = QuizStore.get(quizId);
  if (!quiz) { document.getElementById('app').innerHTML = '<div class="card empty">Quiz não encontrado neste navegador. <a href="/admin">Voltar</a></div>'; return; }
  quiz.errors = validateQuiz(quiz);
  document.title = (quiz.title || 'Quiz') + ' · Editar';
  $$('[data-k]').forEach(inp => {
    inp.value = quiz[inp.dataset.k] || '';
    inp.addEventListener('input', () => { quiz[inp.dataset.k] = inp.value; markDirty(); });
  });
  $$('[data-s]').forEach(inp => {
    const k = inp.dataset.s;
    if (inp.type === 'checkbox') inp.checked = !!quiz.settings[k]; else inp.value = String(quiz.settings[k]);
    inp.addEventListener('change', () => {
      quiz.settings[k] = inp.type === 'checkbox' ? inp.checked : (k === 'rankingSize' ? Number(inp.value) : inp.value);
      syncRankingSize();
      markDirty();
    });
  });
  const syncRankingSize = () => { $('#rankingSize').disabled = quiz.settings.rankingMode === 'never'; };
  syncRankingSize();
  $('#cover').appendChild(imageField(quiz.coverImage, u => { quiz.coverImage = u; markDirty(); }, 'Adicionar capa'));
  $('#previewBtn').href = '/admin/preview/' + quizId;
  $('#previewBtn').addEventListener('click', () => { if (dirty) save(); });
  showErrors(quiz.errors || []);
  delete quiz.errors;
  if (!quiz.questions.length) quiz.questions.push(newQuestion());
  renderQuestions();
}

$('#addQ').onclick = () => {
  quiz.questions.push(newQuestion());
  renderQuestions();
  markDirty();
  const cards = $$('.q-card');
  const last = cards[cards.length - 1];
  last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $('textarea', last).focus(), 300);
};
$('#saveBtn').onclick = () => save().then(() => toast('Quiz salvo.'));
$('#startBtn').onclick = async () => {
  try { await save(); } catch { return; }
  startSession(quiz);
};
init().catch(e => toast(e.message, true));
