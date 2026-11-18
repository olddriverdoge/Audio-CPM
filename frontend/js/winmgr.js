/* ---------------- WinMgr：统一浮窗管理 ----------------
 * 1) 所有浮窗都夹在「工作台可用区域」内：上不过 header/modbar，下不被播放条/手势条盖住；
 * 2) 点击任一浮窗即置顶，展开时也置顶（z-index 栈，允许自由互相覆盖）；
 * 3) 手势：标题栏单指拖动；窗体内双指捏合缩放（同时可双指整体拖）；右下角仍可单指缩放。
 */
const WinMgr = (() => {
  let zBase = 400;
  let zTop = zBase;
  const regs = [];
  const GAP = 6;

  function px(v, d) { return Number.isFinite(Number(v)) ? Number(v) : d; }

  /* 可用区域：header + modbar 之下，播放条（可见时）之上，左右留 6px */
  function bounds() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const bar = document.getElementById('modbar') || document.getElementById('scene-bar');
    const hdr = document.getElementById('app-hdr');
    const topEl = bar || hdr;
    const top = (topEl ? Math.round(topEl.getBoundingClientRect().bottom) : 0) + GAP;
    const pb = document.getElementById('player-bar');
    let bottom = vh - 6;
    if (pb && !pb.classList.contains('hidden')) {
      const t = Math.round(pb.getBoundingClientRect().top);
      if (t > top + 40) bottom = Math.min(bottom, t - GAP);
    }
    return {left: GAP, top, right: vw - GAP, bottom};
  }

  function clampRect(r, minW, minH) {
    const b = bounds();
    const maxW = Math.max(80, b.right - b.left);
    const maxH = Math.max(80, b.bottom - b.top);
    // 横竖屏切换后可用区域可能比窗口最小尺寸还小：这时优先压缩到可视范围
    const fw = Math.min(minW, maxW), fh = Math.min(minH, maxH);
    r.w = Math.max(fw, Math.min(r.w || maxW, maxW));
    r.h = Math.max(fh, Math.min(r.h || maxH, maxH));
    r.x = Math.max(b.left, Math.min(r.x, b.right - r.w));
    r.y = Math.max(b.top, Math.min(r.y, b.bottom - r.h));
    return r;
  }

  function measure(win) {
    const r = win.getBoundingClientRect();
    return {x: Math.round(r.left), y: Math.round(r.top),
            w: Math.round(r.width), h: Math.round(r.height)};
  }

  function setRect(win, r) {
    win.style.left = Math.round(r.x) + 'px';
    win.style.top = Math.round(r.y) + 'px';
    win.style.width = Math.round(r.w) + 'px';
    win.style.height = Math.round(r.h) + 'px';
    win.style.right = 'auto';
    win.style.bottom = 'auto';
  }

  function raise(win) {
    zTop = Math.max(zTop + 1, zBase);
    win.style.zIndex = String(zTop);
  }

  function register(opts) {
    const win = typeof opts.win === 'string' ? document.getElementById(opts.win) : opts.win;
    const head = typeof opts.head === 'string' ? document.getElementById(opts.head) : opts.head;
    const resize = opts.resize ? (typeof opts.resize === 'string' ? document.getElementById(opts.resize) : opts.resize) : null;
    if (!win) return {apply() {}, raise() {}, get rect() { return null; }};
    const minW = opts.minW || 240, minH = opts.minH || 160;
    const contentSized = !!opts.contentSized;      // 宽度按内容（如移动条），不写死 w/h
    const geoKey = 'ac3_geo_' + (opts.id || win.id);
    let rect = null;

    function readGeo() {
      const g = Store.get(geoKey, null);
      if (!g || !Number.isFinite(Number(g.w)) || !Number.isFinite(Number(g.h))) return null;
      return {x: Number(g.x), y: Number(g.y), w: Number(g.w), h: Number(g.h)};
    }
    function persist() {
      if (!rect) return;
      Store.set(geoKey, {x: Math.round(rect.x), y: Math.round(rect.y),
                         w: Math.round(rect.w), h: Math.round(rect.h)});
    }
    function apply(remeasure) {
      const saved = readGeo();
      if (saved) {
        rect = clampRect({...saved}, minW, minH);
      } else {
        const m = measure(win);
        rect = clampRect(remeasure || m, minW, minH);
      }
      if (contentSized) {
        win.style.left = Math.round(rect.x) + 'px';
        win.style.top = Math.round(rect.y) + 'px';
        win.style.width = '';
        win.style.height = '';
        win.style.right = 'auto'; win.style.bottom = 'auto';
      } else {
        setRect(win, rect);
      }
    }
    /* 收起状态下尺寸为 0，不能量；展开后才量 */
    function refresh() {
      if (win.classList.contains('hidden')) return;
      apply();
    }

    /* 转屏：按当前真实尺寸重新压缩进可视区（不依赖上一方向存下来的几何） */
    function fit() {
      if (win.classList.contains('hidden')) return;
      const b = bounds();
      const maxW = Math.max(80, b.right - b.left);
      const maxH = Math.max(80, b.bottom - b.top);
      if (contentSized) {
        const w = Math.min(win.offsetWidth || maxW, maxW);
        const h = Math.min(win.offsetHeight || maxH, maxH);
        win.style.maxWidth = maxW + 'px';
        win.style.maxHeight = maxH + 'px';
        rect = rect || {x: b.left, y: b.top, w: w, h: h};
        rect.w = w; rect.h = h;
        rect.x = Math.max(b.left, Math.min(rect.x, b.right - w));
        rect.y = Math.max(b.top, Math.min(rect.y, b.bottom - h));
        win.style.left = Math.round(rect.x) + 'px';
        win.style.top = Math.round(rect.y) + 'px';
      } else {
        const cur = measure(win);
        rect = clampRect({
          x: (rect || cur).x, y: (rect || cur).y,
          w: Math.min(cur.w || (rect && rect.w) || maxW, maxW),
          h: Math.min(cur.h || (rect && rect.h) || maxH, maxH)
        }, minW, minH);
        setRect(win, rect);
      }
      persist();
    }

    /* 点击即置顶 */
    win.addEventListener('pointerdown', e => { raise(win); }, true);

    /* ---- 单指拖动标题栏 / 双指捏合（标题栏或窗体都可用） ---- */
    const ptrs = new Map();
    let mode = null;         // 'drag' | 'pinch'
    let drag0 = null, pinch0 = null, rz0 = null;

    function activeCount() { return ptrs.size; }

    function beginPinch() {
      if (!rect) apply();
      const [a, b] = [...ptrs.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      pinch0 = {dist, cx, cy, rect: {...rect}};
      mode = 'pinch';
    }

    function onWinDown(e) {
      if (e.pointerType === 'mouse') return;
      ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (ptrs.size === 2) {
        try { win.setPointerCapture(e.pointerId); } catch (_) {}
        beginPinch();
      }
    }
    function onWinMove(e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (mode === 'pinch' && ptrs.size >= 2 && pinch0) {
        const [a, b] = [...ptrs.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const s = Math.max(0.35, Math.min(2.2, dist / pinch0.dist));
        const b0 = bounds();
        const maxW = b0.right - b0.left, maxH = b0.bottom - b0.top;
        const nw = Math.max(minW, Math.min(pinch0.rect.w * s, maxW));
        const nh = Math.max(minH, Math.min(pinch0.rect.h * s, maxH));
        rect = clampRect({
          x: cx - nw / 2 + (cx - pinch0.cx) * 0,
          y: cy - nh / 2,
          w: nw, h: nh
        }, minW, minH);
        rect.x = Math.min(rect.x, b0.right - nw);
        rect.y = Math.min(rect.y, b0.bottom - nh);
        if (contentSized) { win.style.left = rect.x + 'px'; win.style.top = rect.y + 'px'; }
        else setRect(win, rect);
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (mode === 'drag' && drag0) {
        const b0 = bounds();
        const w = contentSized ? win.offsetWidth : rect.w;
        const h = contentSized ? win.offsetHeight : rect.h;
        const x = Math.max(b0.left, Math.min(b0.right - w, drag0.rx + (e.clientX - drag0.x)));
        const y = Math.max(b0.top, Math.min(b0.bottom - h, drag0.ry + (e.clientY - drag0.y)));
        rect = {...rect, x, y};
        if (contentSized) { win.style.left = x + 'px'; win.style.top = y + 'px'; }
        else setRect(win, rect);
        if (e.cancelable) e.preventDefault();
      }
    }
    function onWinUp(e) {
      ptrs.delete(e.pointerId);
      if (ptrs.size === 0) {
        if (mode === 'drag' || mode === 'pinch') persist();
        if (opts.onRectChange) { try { opts.onRectChange(rect); } catch (_) {} }
        mode = null; drag0 = null; pinch0 = null;
      } else if (ptrs.size === 1 && mode === 'pinch') {
        // 双指变单指：结束这次捏合，避免跳变
        persist();
        mode = null; pinch0 = null;
      }
    }
    win.addEventListener('pointerdown', onWinDown, true);
    win.addEventListener('pointermove', onWinMove, true);
    win.addEventListener('pointerup', onWinUp, true);
    win.addEventListener('pointercancel', onWinUp, true);
    // 浏览器级双指缩放会打断手势，禁掉
    win.addEventListener('gesturestart', e => { if (e.cancelable) e.preventDefault(); });
    win.addEventListener('touchmove', e => { if (e.touches && e.touches.length >= 2 && e.cancelable) e.preventDefault(); }, {passive: false});

    /* 标题栏单指拖动（与上面双指互斥） */
    if (head) {
      head.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;
        if (ptrs.size >= 2) return;
        if (!rect) apply();
        raise(win);
        ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
        drag0 = {x: e.clientX, y: e.clientY, rx: rect.x, ry: rect.y};
        mode = 'drag';
        try { head.setPointerCapture(e.pointerId); } catch (_) {}
        if (e.cancelable) e.preventDefault();
      });
      head.addEventListener('pointermove', e => {
        if (mode !== 'drag' || !drag0) return;
        onWinMove(e);
      });
      ['pointerup', 'pointercancel'].forEach(t => head.addEventListener(t, e => {
        if (mode === 'drag') onWinUp(e);
      }));
    }

    /* 右下角单指缩放 */
    if (resize) {
      resize.addEventListener('pointerdown', e => {
        if (!rect) apply();
        rz0 = {x: e.clientX, y: e.clientY, rx: rect.x, ry: rect.y, rw: rect.w, rh: rect.h};
        raise(win);
        try { resize.setPointerCapture(e.pointerId); } catch (_) {}
        if (e.cancelable) e.preventDefault();
      });
      resize.addEventListener('pointermove', e => {
        if (!rz0) return;
        const b0 = bounds();
        rect.w = Math.max(minW, Math.min(rz0.rw + (e.clientX - rz0.x), b0.right - b0.left));
        rect.h = Math.max(minH, Math.min(rz0.rh + (e.clientY - rz0.y), b0.bottom - b0.top));
        setRect(win, rect);
        if (opts.onRectChange) { try { opts.onRectChange(rect); } catch (_) {} }
        if (e.cancelable) e.preventDefault();
      });
      ['pointerup', 'pointercancel'].forEach(t => resize.addEventListener(t, () => {
        if (!rz0) return;
        rz0 = null;
        persist();
        if (opts.onRectChange) { try { opts.onRectChange(rect); } catch (_) {} }
      }));
    }

    /* 打开 / 收起：打开时夹一次并置顶 */
    const obs = new MutationObserver(() => {
      if (!win.classList.contains('hidden')) { apply(); raise(win); }
    });
    obs.observe(win, {attributes: true, attributeFilter: ['class']});

    if (!win.classList.contains('hidden')) apply();   // 收起时量不到尺寸，等展开由 observer 夹取
    const ctl = {
      apply,
      refresh,
      fit,
      raise: () => raise(win),
      get rect() { return rect; }
    };
    regs.push(ctl);
    return ctl;
  }

  /* 播放条出现/消失、转屏：重算并夹住所有已展开窗口 */
  function reclampAll(force) {
    regs.forEach(r => { try { (force && r.fit) ? r.fit() : r.refresh(); } catch (_) {} });
  }
  /* 转屏：立即 + 120ms + 350ms 三次，避开 WebView 视口尺寸滞后的窗口期 */
  function onRotate() { reclampAll(true); setTimeout(() => reclampAll(true), 120); setTimeout(() => reclampAll(true), 350); }
  window.addEventListener('resize', onRotate);
  window.addEventListener('orientationchange', onRotate);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onRotate);
  if (window.screen && screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', onRotate);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const pb = document.getElementById('player-bar');
    if (pb) new MutationObserver(() => reclampAll()).observe(pb, {attributes: true, attributeFilter: ['class']});
  });

  return {register, raise, reclampAll, bounds};
})();
