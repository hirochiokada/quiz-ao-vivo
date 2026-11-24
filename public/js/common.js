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

async function uploadImage(file) {
  if (!file) return null;
  if (file.size > 5 * 1024 * 1024) { toast('Imagem maior que 5 MB.', true); return null; }
  const fd = new FormData();
  fd.append('image', file);
  try {
    const r = await api('/api/upload', { method: 'POST', body: fd });
    return r.url;
  } catch (e) { toast(e.message, true); return null; }
}

const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
