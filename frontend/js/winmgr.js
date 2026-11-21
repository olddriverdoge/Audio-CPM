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
  /* 单模块内容缩放增益：两指位移先收敛，避免文字跳动过猛。 */
  const MODULE_ZOOM_GAIN = 0.7;
  function palmLocked() {
    try { return !!window.AUDIOCPM_PALM_LOCKED; } catch (_) { return false; }
  }
  // 大画布：模块不再被夹在当前视口里，允许拖到视口外，再由手掌模式平移回来。
  const CANVAS = {left: -2048, top: -768, right: 4096, bottom: 3072};

  function px(v, d) { return Number.isFinite(Number(v)) ? Number(v) : d; }
  function uiScale() {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
    return Number.isFinite(v) && v >= 0.5 && v <= 3.005 ? v : 1;
  }
  function canvasPan() {
    const c = window.AUDIOCPM_CANVAS;
    return {x: (c && Number(c.x)) || 0, y: (c && Number(c.y)) || 0};
  }
  /* 单个模块自己的内容比例；和全局 --ui-scale 相乘。 */
  function winScale(win) {
    try {
      const raw = win.style.getPropertyValue('--win-scale');
      const v = raw ? parseFloat(raw) : parseFloat(getComputedStyle(win).getPropertyValue('--win-scale'));
      return Number.isFinite(v) ? Math.max(0.5, Math.min(3, v)) : 1;
    } catch (_) { return 1; }
  }
  function totalScale(win) { return uiScale() * winScale(win); }

  /* 大画布逻辑边界；视口只用于初始落位，不再限制模块坐标。 */
  function bounds() {
    return CANVAS;
  }

  /* 首次打开模块时的可视落位参考（之后位置由大画布坐标记忆） */
  function viewportBounds() {
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
    const z = uiScale();
    const maxW = Math.max(80, b.right - b.left);
    const maxH = Math.max(80, b.bottom - b.top);
    // 最小尺寸也按工作台缩放，50% 时窗口才能真正缩小
    const fw = Math.min(minW * z, maxW), fh = Math.min(minH * z, maxH);
    r.w = Math.max(fw, Math.min(r.w || maxW, maxW));
    r.h = Math.max(fh, Math.min(r.h || maxH, maxH));
    r.x = Math.max(b.left, Math.min(r.x, b.right - r.w));
    r.y = Math.max(b.top, Math.min(r.y, b.bottom - r.h));
    return r;
  }

  function measure(win) {
    const r = win.getBoundingClientRect();
    const p = canvasPan();
    return {x: Math.round(r.left - p.x), y: Math.round(r.top - p.y),
            w: Math.round(r.width), h: Math.round(r.height)};
  }

  function setRect(win, r) {
    // 全局缩放 × 该窗口自己的内容缩放；视觉尺寸 = 样式尺寸 × 两者乘积
    const z = totalScale(win);
    win.style.left = Math.round(r.x) + 'px';
    win.style.top = Math.round(r.y) + 'px';
    win.style.width = Math.round(r.w / z) + 'px';
    win.style.height = Math.round(r.h / z) + 'px';
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
    if (!win) return {apply() {}, raise() {}, sync() {}, get rect() { return null; }};
    const minW = opts.minW || 240, minH = opts.minH || 160;
    const contentSized = !!opts.contentSized;      // 宽度按内容（如移动条），不写死 w/h
    const geoKey = 'ac3_geo_' + (opts.id || win.id);
    let rect = null;

    function readGeo() {
      const g = Store.get(geoKey, null);
      if (!g || !Number.isFinite(Number(g.w)) || !Number.isFinite(Number(g.h))) return null;
      // 几何尺寸按全局 100% 逻辑尺寸存；该窗口自己的内容比例单独恢复。
      const z = uiScale();
      const k = Number.isFinite(Number(g.scale)) ? Math.max(0.5, Math.min(3, Number(g.scale))) : 1;
      win.style.setProperty('--win-scale', String(k));
      return {x: Number(g.x), y: Number(g.y), w: Number(g.w) * z, h: Number(g.h) * z};
    }
    function persist() {
      if (!rect) return;
      const z = uiScale();
      Store.set(geoKey, {x: Math.round(rect.x), y: Math.round(rect.y),
                         w: Math.round(rect.w / z), h: Math.round(rect.h / z),
                         scale: Math.round(winScale(win) * 100) / 100});
    }
    function apply(remeasure) {
      const saved = readGeo();
      if (saved) {
        rect = clampRect({...saved}, minW, minH);
      } else {
        const m = measure(win);
        const vb = viewportBounds();
        const r = remeasure || m;
        // 首次打开时至少落在 header 下方；已有画布坐标在 saved 分支里保持自由。
        r.x = Math.max(vb.left, r.x || vb.left);
        r.y = Math.max(vb.top, r.y || vb.top);
        rect = clampRect(r, minW, minH);
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
    /* 缩放后只同步内部 rect（视觉坐标），不重写宽高 */
    function sync() {
      if (win.classList.contains('hidden')) return;
      rect = measure(win);
    }

    /* 转屏：按当前真实尺寸重新压缩进可视区（不依赖上一方向存下来的几何） */
    /* 自适应布局直接落一个视觉矩形（不经过拖拽手势），并持久化。
       loose=true 时允许小于模块常规最小尺寸：横屏高度有限时，若仍按
       minH 夹取，右列两个窗会互相压住，反而不如让内容自己滚动。 */
    function place(r, loose) {
      if (!r) return;
      const base = {x: r.x, y: r.y, w: Math.max(40, r.w), h: Math.max(40, r.h)};
      rect = loose ? base : clampRect(base, minW, minH);
      setRect(win, rect);
      persist();
    }

    function fit() {
      if (win.classList.contains('hidden')) return;
      const b = bounds();
      const maxW = Math.max(80, b.right - b.left);
      const maxH = Math.max(80, b.bottom - b.top);
      // 视口退化（后台、键盘动画中间态）时不做任何尺寸改写，避免把
      // 用户尺寸压到下限后持久化。
      if (maxW < 200 || maxH < 200) return;
      if (contentSized) {
        const z = uiScale();
        const w = Math.min((win.offsetWidth || maxW) * z, maxW);
        const h = Math.min((win.offsetHeight || maxH) * z, maxH);
        win.style.maxWidth = Math.round(maxW / z) + 'px';
        win.style.maxHeight = Math.round(maxH / z) + 'px';
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
      if (palmLocked()) return;
      if (!rect) apply();
      const [a, b] = [...ptrs.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      pinch0 = {dist, cx, cy, rect: {...rect}, scale: winScale(win)};
      mode = 'pinch';
    }

    function onWinDown(e) {
      if (palmLocked()) return;
      if (e.pointerType === 'mouse') return;
      // 新的一次单指手势开始时，清掉上一次可能没收到 pointerup 的残留触点。
      // 否则残留触点 + 当前单指会被算成“双指”，把拖动误判成缩放。
      if (e.isPrimary && ptrs.size > 0) {
        ptrs.clear();
        if (mode === 'drag' || mode === 'pinch') mode = null;
        drag0 = null; pinch0 = null;
      }
      ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (ptrs.size === 2) {
        try { win.setPointerCapture(e.pointerId); } catch (_) {}
        beginPinch();
      }
    }
    function onWinMove(e) {
      if (palmLocked()) return;
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (mode === 'pinch' && ptrs.size >= 2 && pinch0) {
        const [a, b] = [...ptrs.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const ratio = Math.max(0.35, Math.min(2.2, dist / pinch0.dist));
        // 和手形锁走同一条路径：文字/控件/窗口一起缩放，且从手势起点计算。
        zoomAt(pinch0.rect, ratio, cx, cy, pinch0.scale);
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (mode === 'drag' && drag0) {
        const b0 = bounds();
        const z = uiScale();
        const w = contentSized ? (win.offsetWidth * z) : rect.w;
        const h = contentSized ? (win.offsetHeight * z) : rect.h;
        const x = Math.max(b0.left, Math.min(b0.right - w, drag0.rx + (e.clientX - drag0.x)));
        const y = Math.max(b0.top, Math.min(b0.bottom - h, drag0.ry + (e.clientY - drag0.y)));
        rect = {...rect, x, y};
        if (contentSized) { win.style.left = x + 'px'; win.style.top = y + 'px'; }
        else setRect(win, rect);
        if (e.cancelable) e.preventDefault();
      }
    }
    function onWinUp(e) {
      // 只处理本窗口正在跟踪的触点；文档级兜底 pointerup 也会调用它
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size === 0) {
        if (mode === 'drag' || mode === 'pinch') persist();
        if (opts.onRectChange) { try { opts.onRectChange(rect); } catch (_) {} }
        mode = null; drag0 = null; pinch0 = null; rz0 = null;
      } else if (ptrs.size === 1 && mode === 'pinch') {
        // 双指变单指：结束这次捏合，避免跳变
        persist();
        mode = null; pinch0 = null;
      }
    }
    // 手指可能在浮窗外抬起（如正文滚动后滑出窗口），窗口自身收不到 pointerup，
    // 这里在 document 上兜底清理，避免残留触点把下一次单指拖动误判成缩放。
    const docUp = e => onWinUp(e);
    document.addEventListener('pointerup', docUp, true);
    document.addEventListener('pointercancel', docUp, true);
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
        if (palmLocked()) return;
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
        if (palmLocked()) return;
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

    /* 打开 / 收起：只在可见性真正变化时夹一次并置顶。
       不能对任何 class 变化都 apply()：播放管理的 pf-idle-dim、has-cover，
       频谱的 is-embedded 等都会改 class，apply() 会重新读 Store 里的旧几何，
       表现就是点一下/自动淡化后窗口尺寸跳回预设默认。 */
    let wasHidden = win.classList.contains('hidden');
    const obs = new MutationObserver(() => {
      const hidden = win.classList.contains('hidden');
      if (hidden === wasHidden) return;
      wasHidden = hidden;
      if (!hidden) {
        apply(); raise(win);
      } else {
        // 收起时手指可能还在屏上；清掉手势状态，避免下次单指拖动被旧触点干扰。
        ptrs.clear(); mode = null; drag0 = null; pinch0 = null; rz0 = null;
      }
    });
    obs.observe(win, {attributes: true, attributeFilter: ['class']});

    if (!win.classList.contains('hidden')) apply();   // 收起时量不到尺寸，等展开由 observer 夹取
    /* 只缩放当前窗口：双指在某个模块上捏合时由手形锁代理到这里，
       不修改全局 --ui-scale，其他模块保持原样。 */
    function zoomAt(base, factor, sx, sy, baseScale) {
      if (!rect || !base) return;
      // 不是只改窗口尺寸：同时改 --win-scale，让模块里的文字、按钮、列表
      // 和窗口边框一起缩放；其他模块保持原样。
      // factor 是相对手势开始时的总比例，必须从 baseScale 计算；
      // 若从当前 cur 累乘，每次 touchmove 都会复利放大，手感会越捏越快。
      const cur = winScale(win);
      const start = Number.isFinite(Number(baseScale)) ? Number(baseScale) : cur;
      const damped = 1 + (factor - 1) * MODULE_ZOOM_GAIN;
      const next = Math.max(0.5, Math.min(3, start * damped));
      // base 是手势开始时的视觉 rect；宽高/位置必须按“相对起点”的总比例算，
      // 不能用相邻两次的增量 f，否则第二个 touchmove 起尺寸会从错误基准累加。
      const total = start > 0 ? next / start : 1;
      const p = canvasPan();
      const nw = Math.max(minW, base.w * total);
      const nh = Math.max(minH, base.h * total);
      const nx = base.x + (sx - p.x - base.x) * (1 - total);
      const ny = base.y + (sy - p.y - base.y) * (1 - total);
      win.style.setProperty('--win-scale', String(Math.round(next * 1000) / 1000));
      rect = clampRect({x: nx, y: ny, w: nw, h: nh}, minW, minH);
      if (contentSized) {
        win.style.left = Math.round(rect.x) + 'px';
        win.style.top = Math.round(rect.y) + 'px';
      } else {
        setRect(win, rect);
      }
      if (opts.onRectChange) { try { opts.onRectChange(rect); } catch (_) {} }
      // 捏合过程中手指可能被系统手势/切后台打断，pointerup 收不到；
      // 落一次防抖持久化，保证窗口尺寸和内容缩放不会丢回上一次（看起来像默认值）。
      schedulePersist();
    }
    let pTimer = 0;
    function schedulePersist() {
      if (pTimer) clearTimeout(pTimer);
      pTimer = setTimeout(() => { pTimer = 0; persist(); }, 450);
    }
    const ctl = {
      win,
      apply,
      cancelGestures: () => {
        ptrs.clear();
        mode = null; drag0 = null; pinch0 = null; rz0 = null;
      },
      refresh,
      sync,
      fit,
      place,
      zoomAt,
      persist: () => persist(),
      raise: () => raise(win),
      get rect() { return rect; },
      get scale() { return winScale(win); }
    };
    regs.push(ctl);
    return ctl;
  }

  /* 播放条出现/消失、转屏：重算并夹住所有已展开窗口 */
  function reclampAll(force) {
    regs.forEach(r => { try { (force && r.fit) ? r.fit() : r.refresh(); } catch (_) {} });
  }
  /* 转屏：立即 + 120ms + 350ms 三次，避开 WebView 视口尺寸滞后的窗口期。
     但 Android 后台切回/地址栏收起时 WebView 会先报一个明显偏小的视口，
     这时如果按它 fit() 就会把用户调好的窗口压小并写回存储，回来后就
     像是“尺寸被改回默认”。所以只接受稳定、非瞬时的视口尺寸。 */
  let stableVP = {w: window.innerWidth, h: window.innerHeight, at: 0};
  function vpTrusted() {
    const w = window.innerWidth, h = window.innerHeight;
    // 后台/切前台时 Android WebView 会短暂报 0 或极小视口；这种尺寸绝不能
    // 拿去 fit()，否则窗口会被压到最小并写回存储，回来就是“变回默认”。
    if (w < 200 || h < 200) return false;
    if (!stableVP.w || !stableVP.h) { stableVP = {w: w, h: h, at: Date.now()}; return true; }
    // 同一方向下的骤然缩小（< 72% 宽或 < 60% 高）判为瞬时抖动，不重算。
    const sameOrient = (w > h) === (stableVP.w > stableVP.h);
    if (sameOrient && (w < stableVP.w * 0.72 || h < stableVP.h * 0.6)) return false;
    if (Math.abs(w - stableVP.w) > 2 || Math.abs(h - stableVP.h) > 2) {
      stableVP = {w: w, h: h, at: Date.now()};
    }
    return true;
  }
  function onRotate() {
    const run = () => { if (vpTrusted()) reclampAll(true); };
    run(); setTimeout(run, 120); setTimeout(run, 350);
  }
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

  function reapplyAll() { regs.forEach(r => { try { r.refresh(); } catch (_) {} }); }
  function persistAll() { regs.forEach(r => { try { r.persist(); } catch (_) {} }); }
  function syncRects() { regs.forEach(r => { try { r.sync(); } catch (_) {} }); }
  function cancelGestures() { regs.forEach(r => { try { r.cancelGestures(); } catch (_) {} }); }
  function find(win) { return regs.find(r => r.win === win) || null; }
  function place(win, r, loose) {
    const c = typeof win === 'string' ? regs.find(x => x.win.id === win) : find(win);
    if (c && c.place) c.place(r, loose);
  }
  function zoomWindow(win, base, factor, sx, sy, baseScale) {
    const c = find(win);
    if (c) c.zoomAt(base, factor, sx, sy, baseScale);
  }
  return {register, raise, reclampAll, reapplyAll, persistAll, syncRects, cancelGestures, bounds, find, place, zoomWindow};
})();
