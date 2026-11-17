/* ---------------- Logs：全局日志浮窗（按页面隔离） ---------------------------- */
const Logs = (() => {
  const NAMES = {workbench: '工作台'};
  const SINGLE = 'workbench';   // 页面合并成工作台后日志统一一条流
  const MAX = 400;
  const buf = {workbench: []};
  let ns = 'process';
  let floatEl = null, bodyEl = null, tabsEl = null, fabEl = null;
  let open = false, inited = false;

  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function lineHtml(e) {
    return '<div class="log-line ' + (e.level || 'info') + '">[' + e.t + '] ' +
      Utils.escapeHtml(e.text) + '</div>';
  }

  function paintBody() {
    if (!bodyEl) return;
    const arr = buf[ns] || [];
    bodyEl.innerHTML = arr.length ? arr.map(lineHtml).join('') :
      '<div class="detail-empty">暂无日志</div>';
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function paintTabs() {
    if (!tabsEl) return;
    tabsEl.querySelectorAll('button[data-ns]').forEach(b => {
      b.classList.toggle('on', b.dataset.ns === ns);
    });
  }

  function setNs(next) {
    if (!NAMES[next]) return;
    ns = next;
    const tag = document.getElementById('lf-ns');
    if (tag) tag.textContent = NAMES[ns];
    paintTabs();
    paintBody();
  }

  /* 当前页面对应的命名空间：处理页 / 整理页互不串流 */
  function pageNs() { return SINGLE; }

  function plainText() {
    return (buf[ns] || []).map(e => '[' + e.t + '] ' + e.text).join('\n');
  }

  async function copyAll() {
    const text = plainText();
    if (!text) { Utils.toast('日志为空'); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else throw new Error('no clipboard');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
    Utils.toast('日志已复制');
  }

  function add(level, text, forcedNs) {
    const key = SINGLE;
    const arr = buf[key];
    arr.push({t: stamp(), level: level || 'info', text: String(text == null ? '' : text)});
    while (arr.length > MAX) arr.shift();
    if (open && key === ns && bodyEl) {
      // 追加单行，避免整块 innerHTML 重建（日志刷屏时不卡）
      if (bodyEl.querySelector('.detail-empty')) bodyEl.innerHTML = '';
      bodyEl.insertAdjacentHTML('beforeend', lineHtml(arr[arr.length - 1]));
      bodyEl.scrollTop = bodyEl.scrollHeight;
      while (bodyEl.children.length > MAX) bodyEl.removeChild(bodyEl.firstChild);
    }
  }

  function clear(forcedNs) {
    const key = NAMES[forcedNs] ? forcedNs : ns;
    buf[key] = [];
    if (key === ns) paintBody();
  }

  function toggle(force) {
    open = (typeof force === 'boolean') ? force : !open;
    if (floatEl) floatEl.classList.toggle('hidden', !open);
    if (fabEl) fabEl.style.display = open ? 'none' : '';
    if (fabEl) fabEl.classList.toggle('on', open);
    if (open) { paintTabs(); paintBody(); }
  }

  function init() {
    if (inited) return;
    floatEl = document.getElementById('log-float');
    bodyEl = document.getElementById('lf-body');
    tabsEl = document.getElementById('lf-tabs');
    fabEl = document.getElementById('log-fab');
    if (!floatEl || !fabEl) return;
    inited = true;
    ns = pageNs();
    if (fabEl) fabEl.addEventListener('click', () => toggle());
    if (tabsEl) tabsEl.addEventListener('click', e => {
      const b = e.target.closest('button[data-ns]');
      if (b) setNs(b.dataset.ns);
    });
    const minBtn = document.getElementById('lf-min');
    if (minBtn) minBtn.addEventListener('click', () => toggle(false));
    const cp = document.getElementById('lf-copy');
    if (cp) cp.addEventListener('click', copyAll);
    const clr = document.getElementById('lf-clear');
    if (clr) clr.addEventListener('click', () => clear());
    if (typeof Dock !== 'undefined') {
      Dock.bindFab(fabEl, K.fabLog, 'right');
    }
    toggle(false);
  }

  return {init, add, clear, copyAll, setNs, toggle, pageNs,
          get current() { return ns; }, get open() { return open; }};
})();
