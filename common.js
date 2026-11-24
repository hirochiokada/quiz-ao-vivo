// Utilitários compartilhados entre as páginas.
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const Auth = {
  get token() { try { return localStorage.getItem('quiz_admin_token'); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem('quiz_admin_token', v) : localStorage.removeItem('quiz_admin_token'); } catch {} },
};

async function api(path, opts = {}) {
  const headers = { ...(opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : {}) };
  if (Auth.token) headers.authorization = 'Bearer ' + Auth.token;
  const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !path.endsWith('/login')) {
    Auth.token = null;
    location.href = '/admin?next=' + encodeURIComponent(location.pathname + location.search);
    throw new Error('Não autenticado');
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Erro ' + res.status);
    err.data = data;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, bad) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2800);
}

function confirmDialog(message, okLabel = 'Confirmar', danger = false) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><p style="margin-top:0">${esc(message)}</p>
      <div class="row end"><button data-r="0">Cancelar</button><button data-r="1" class="${danger ? 'primary" style="background:var(--bad);border-color:var(--bad)' : 'primary'}">${esc(okLabel)}</button></div></div>`;
    bg.addEventListener('click', e => {
      const r = e.target.dataset && e.target.dataset.r;
      if (e.target === bg || r != null) { bg.remove(); resolve(r === '1'); }
    });
    document.body.appendChild(bg);
    bg.querySelector('[data-r="1"]').focus();
  });
}

// ---------- imagens: reduzidas no navegador e guardadas dentro do quiz (data URL)
function readImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem.')); };
    img.src = url;
  });
}
async function uploadImage(file, maxSide = 1024) {
  if (!file) return null;
  if (!/^image\//.test(file.type)) { toast('Escolha um arquivo de imagem.', true); return null; }
  try {
    const img = await readImage(file);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.78);
  } catch (e) { toast(e.message, true); return null; }
}

// ---------- quizzes e resultados ficam salvos NESTE navegador (localStorage)
const uid = () => Math.random().toString(36).slice(2, 12);
const QuizStore = {
  list() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('quiz_q_')) { try { out.push(JSON.parse(localStorage.getItem(k))); } catch {} }
    }
    return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },
  get(id) { try { return JSON.parse(localStorage.getItem('quiz_q_' + id)); } catch { return null; } },
  save(q) {
    q.updatedAt = new Date().toISOString();
    try { localStorage.setItem('quiz_q_' + q.id, JSON.stringify(q)); return true; }
    catch (e) { toast('Espaço do navegador cheio. Use imagens menores ou exclua quizzes antigos (faça backup antes).', true); return false; }
  },
  remove(id) { localStorage.removeItem('quiz_q_' + id); },
  create(data = {}) {
    const q = {
      id: uid(), title: 'Novo quiz', description: '', coverImage: null, openingMessage: '', closingMessage: '',
      settings: { speedScoring: true, showCorrectAnswer: true, rankingMode: 'during', rankingSize: 5, showPersonalScore: true, shuffleQuestions: false, shuffleOptions: false },
      questions: [], createdAt: new Date().toISOString(), ...data,
    };
    if (data.settings) q.settings = { ...this.create.defaults, ...data.settings };
    return q;
  },
};
QuizStore.create.defaults = { speedScoring: true, showCorrectAnswer: true, rankingMode: 'during', rankingSize: 5, showPersonalScore: true, shuffleQuestions: false, shuffleOptions: false };

const ResultStore = {
  list() { try { return JSON.parse(localStorage.getItem('quiz_results') || '[]'); } catch { return []; } },
  add(r) {
    let all = this.list().filter(x => x.sessionId !== r.sessionId);
    all.unshift(r);
    for (;;) {
      try { localStorage.setItem('quiz_results', JSON.stringify(all)); return true; }
      catch { if (all.length <= 1) return false; all = all.slice(0, -1); } // descarta os mais antigos se faltar espaço
    }
  },
  remove(id) { localStorage.setItem('quiz_results', JSON.stringify(this.list().filter(x => x.sessionId !== id))); },
};

// mesma validação do servidor, para mostrar pendências no editor
function validateQuiz(quiz) {
  const errors = [];
  if (!(quiz.title || '').trim()) errors.push('O quiz precisa de um título.');
  if (!quiz.questions.length) errors.push('Cadastre pelo menos uma pergunta.');
  quiz.questions.forEach((q, i) => {
    const n = `Pergunta ${i + 1}`;
    if (!(q.text || '').trim() && !q.image) errors.push(`${n}: informe o texto ou uma imagem.`);
    if (q.options.length < 2) errors.push(`${n}: são necessárias pelo menos 2 alternativas.`);
    if (q.options.some(o => !(o.text || '').trim())) errors.push(`${n}: há alternativas sem texto.`);
    const c = q.options.filter(o => o.correct).length;
    if (c === 0) errors.push(`${n}: marque a alternativa correta.`);
    if (!q.multiple && c > 1) errors.push(`${n}: marcada como resposta única, mas tem ${c} corretas.`);
  });
  return errors;
}

// baixa um arquivo gerado pelo servidor a partir de um POST
async function downloadPost(path, body, fallbackName) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + Auth.token }, body: JSON.stringify(body) });
  if (!res.ok) { toast('Não foi possível gerar o arquivo.', true); return; }
  const name = (/filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '') || [])[1] || fallbackName;
  downloadBlob(await res.blob(), name);
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function startSession(quiz) {
  const win = window.open('about:blank', '_blank');
  try {
    const r = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ quiz }) });
    if (win) win.location = '/host/' + r.code; else location.href = '/host/' + r.code;
  } catch (e) {
    if (win) win.close();
    toast(e.data && e.data.errors ? e.data.errors[0] : e.message, true);
  }
}

const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
