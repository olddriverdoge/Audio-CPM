/* ---------------- Utils ---------------- */
const Utils = (() => {
  const collator = new Intl.Collator('zh-Hans', {numeric:true, sensitivity:'base'});
  const pad = n => String(n).padStart(2, '0');

  function fmtSize(n) {
    if (!n && n !== 0) return '';
    const u = ['B','KB','MB','GB','TB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(i ? 1 : 0) + u[i];
  }
  function fmtTime(t) {
    if (!t) return '';
    const d = new Date(t * 1000);
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
    ));
  }
  function basename(p) {
    if (!p) return '';
    const t = String(p).replace(/\/+$/, '');
    const i = t.lastIndexOf('/');
    return i >= 0 ? t.slice(i + 1) : t;
  }
  function dirname(p) {
    if (!p) return '/';
    const t = String(p).replace(/\/+$/, '');
    const i = t.lastIndexOf('/');
    return i > 0 ? t.slice(0, i) : '/';
  }
  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function debounce(fn, ms) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms || 150);
    };
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function toast(msg, kind) {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }, 2400);
  }
  function log(level, text) {
    const el = document.getElementById('log');
    if (!el) return;
    const time = new Date().toLocaleTimeString('zh-CN', {hour12:false});
    const line = document.createElement('div');
    line.className = level || 'info';
    line.textContent = '[' + time + '] ' + text;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 500) el.removeChild(el.firstChild);
  }
  function openModal(src) {
    if (!src) return;
    const m = document.createElement('div');
    m.className = 'modal';
    const img = document.createElement('img');
    img.src = src;
    m.appendChild(img);
    m.addEventListener('click', () => m.remove());
    document.body.appendChild(m);
  }
  return {collator, fmtSize, fmtTime, escapeHtml, basename, dirname, hash,
          debounce, clamp, toast, log, openModal};
})();
