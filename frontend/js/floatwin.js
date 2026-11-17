/* ---------------- FloatWin：工作台通用浮窗 ----------------
 * 与元数据/频谱同一种视觉，但由模块开关（modbar）统一启停。
 * 支持：拖动标题栏移动、右下角拖动改尺寸、位置与尺寸记忆、开/关回调。
 */
function createFloatWin(cfg) {
  const win = document.getElementById(cfg.winId);
  const head = document.getElementById(cfg.headId);
  const resize = cfg.resizeId ? document.getElementById(cfg.resizeId) : null;
  const key = cfg.storeKey;
  const minW = cfg.minW || 220;
  const minH = cfg.minH || 140;
  let open = false;
  let onChange = null;

  function defRect() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(cfg.defW || 360, vw - 16);
    const h = Math.min(cfg.defH || 420, vh - 120);
    return {x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(56, Math.round((vh - h) / 3)), w, h};
  }
  function clampRect(r) {
    const vw = window.innerWidth, vh = window.innerHeight;
    r.w = Math.max(minW, Math.min(r.w, vw - 12));
    r.h = Math.max(minH, Math.min(r.h, vh - 60));
    r.x = Math.max(2, Math.min(r.x, vw - r.w - 2));
    r.y = Math.max(2, Math.min(r.y, vh - r.h - 2));
    return r;
  }
  function saved() {
    const v = Store.get(key, null);
    if (!v || !Number.isFinite(Number(v.w)) || !Number.isFinite(Number(v.h))) return null;
    return clampRect({x: Number(v.x), y: Number(v.y), w: Number(v.w), h: Number(v.h)});
  }
  function apply() {
    if (!win) return;
    const r = saved() || defRect();
    win.style.left = r.x + 'px';
    win.style.top = r.y + 'px';
    win.style.width = r.w + 'px';
    win.style.height = r.h + 'px';
    win.style.right = 'auto';
    win.style.bottom = 'auto';
  }
  function persist() {
    if (!win) return;
    const b = win.getBoundingClientRect();
    Store.set(key, {x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height)});
  }

  function setOpen(v, silent) {
    open = !!v;
    if (win) win.classList.toggle('hidden', !open);
    if (open) apply();
    if (!silent) {
      if (open && cfg.onOpen) { try { cfg.onOpen(); } catch (_) {} }
      if (!open && cfg.onClose) { try { cfg.onClose(); } catch (_) {} }
      if (onChange) { try { onChange(open); } catch (_) {} }
    }
  }

  /* 拖动标题栏 */
  if (head) {
    let st = null;
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      st = {x: e.clientX, y: e.clientY, l: win.offsetLeft, t: win.offsetTop};
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      if (e.cancelable) e.preventDefault();
    });
    head.addEventListener('pointermove', e => {
      if (!st) return;
      win.style.left = Math.max(2, Math.min(window.innerWidth - win.offsetWidth - 2, st.l + (e.clientX - st.x))) + 'px';
      win.style.top = Math.max(2, Math.min(window.innerHeight - win.offsetHeight - 2, st.t + (e.clientY - st.y))) + 'px';
      win.style.right = 'auto'; win.style.bottom = 'auto';
      if (e.cancelable) e.preventDefault();
    });
    ['pointerup', 'pointercancel'].forEach(t => head.addEventListener(t, () => {
      if (!st) return;
      st = null;
      persist();
    }));
  }

  /* 右下角改尺寸 */
  if (resize && win) {
    let rs = null;
    resize.addEventListener('pointerdown', e => {
      rs = {x: e.clientX, y: e.clientY, w: win.offsetWidth, h: win.offsetHeight};
      try { resize.setPointerCapture(e.pointerId); } catch (_) {}
      if (e.cancelable) e.preventDefault();
    });
    resize.addEventListener('pointermove', e => {
      if (!rs) return;
      win.style.width = Math.max(minW, rs.w + (e.clientX - rs.x)) + 'px';
      win.style.height = Math.max(minH, rs.h + (e.clientY - rs.y)) + 'px';
      if (e.cancelable) e.preventDefault();
    });
    ['pointerup', 'pointercancel'].forEach(t => resize.addEventListener(t, () => {
      if (!rs) return;
      rs = null;
      persist();
    }));
  }

  window.addEventListener('resize', () => {
    if (!open) return;
    const r = clampRect({x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight});
    win.style.left = r.x + 'px'; win.style.top = r.y + 'px';
    win.style.width = r.w + 'px'; win.style.height = r.h + 'px';
  });

  const minBtn = cfg.minId ? document.getElementById(cfg.minId) : null;
  if (minBtn) minBtn.addEventListener('click', () => setOpen(false));

  apply();
  setOpen(false, true);

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    isOpen: () => open,
    onToggle: fn => { onChange = fn; },
    apply
  };
}
