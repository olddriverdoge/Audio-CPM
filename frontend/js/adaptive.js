/* ---------------- Adaptive：不同手机/横竖屏的浮窗自适应布局 ----------------
 * 目标不是替用户决定布局，而是只在「源布局和当前视口不匹配」时做最小干预：
 * 1) 按源视口等比缩放场景几何，保持原有的相对位置和留白；
 * 2) 横屏时把主模块放左列、其余模块右列堆叠，避免纵向缩放后小得看不清；
 * 3) 旧场景没有源视口信息时，用几何包围盒推断，缺失则不动。
 */
const Adaptive = (() => {
  const GAP = 6;
  const WIN = {
    browse: 'fw-browse', task: 'fw-task', tree: 'fw-tree', play: 'play-float',
    audio: 'audio-float', meta: 'meta-float', spectrum: 'spectrum-float', log: 'log-float'
  };

  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* 和 WinMgr 使用同一套顶部/底部可用区域，但不依赖 WinMgr 先初始化。 */
  function currentViewport() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const bar = document.getElementById('modbar') || document.getElementById('scene-bar');
    const hdr = document.getElementById('app-hdr');
    const topEl = bar || hdr;
    const top = (topEl ? Math.round(topEl.getBoundingClientRect().bottom) : 0) + GAP;
    const pb = document.getElementById('player-bar');
    let bottom = vh - GAP;
    if (pb && !pb.classList.contains('hidden')) {
      const t = Math.round(pb.getBoundingClientRect().top);
      if (t > top + 40) bottom = Math.min(bottom, t - GAP);
    }
    return {
      left: GAP, top, right: vw - GAP, bottom,
      w: vw, h: vh,
      availW: Math.max(120, vw - GAP * 2),
      availH: Math.max(120, bottom - top)
    };
  }

  function isLandscape(v) {
    const x = v || currentViewport();
    return x.availW > x.availH * 1.18;
  }

  /* 窄屏把全局 UI 稍微收回一点；不小于 1.0，避免文字过小。 */
  function uiScaleFor(width, sourceScale) {
    const src = clamp(num(sourceScale, 1.1), 0.7, 1.6);
    if (width <= 420) return clamp(Math.min(src, 1.0), 0.95, 1.1);
    if (width <= 560) return clamp(Math.min(src, 1.06), 0.95, 1.15);
    return src;
  }

  function modulesOf(s) {
    if (!s) return [];
    return Array.isArray(s.modules) ? s.modules : (Array.isArray(s.mods) ? s.mods : []);
  }

  /* 没有源视口时，用所有窗口的包围盒做保守推断。 */
  function inferViewport(geo) {
    let minX = Infinity, minY = Infinity, maxX = 1, maxY = 1;
    Object.keys(geo || {}).forEach(id => {
      const g = geo[id] || {};
      const x = num(g.x, 0), y = num(g.y, 0);
      const w = Math.max(1, num(g.w, 1)), h = Math.max(1, num(g.h, 1));
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });
    if (!Number.isFinite(minX)) minX = 0;
    if (!Number.isFinite(minY)) minY = 0;
    return {w: Math.max(320, maxX), h: Math.max(480, maxY), minX, minY};
  }

  function rectOf(g, z) {
    const zz = z || 1;
    return {
      x: num(g.x, 0), y: num(g.y, 0),
      w: Math.max(1, num(g.w, 1) * zz),
      h: Math.max(1, num(g.h, 1) * zz)
    };
  }

  function overlapCount(geo, z) {
    const rs = Object.keys(geo || {}).map(id => rectOf(geo[id], z));
    let n = 0;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        const iw = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const ih = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (iw > 12 && ih > 12) n++;
      }
    }
    return n;
  }

  /* 横屏：主模块（优先文件浏览）左列，其余模块右列等高堆叠。 */
  function arrangeLandscape(scene, viewport, z) {
    const mods = modulesOf(scene);
    const v = viewport || currentViewport();
    const gap = GAP;
    const primary = mods.indexOf('browse') >= 0 ? 'browse' : mods[0];
    const rest = mods.filter(m => m !== primary);
    const leftW = rest.length ? Math.round((v.availW - gap) * 0.56) : v.availW;
    const rightW = rest.length ? (v.availW - gap - leftW) : leftW;
    const rects = {};
    rects[primary] = {x: v.left, y: v.top, w: leftW, h: v.availH};
    if (rest.length) {
      const each = Math.max(70, (v.availH - gap * (rest.length - 1)) / rest.length);
      rest.forEach((m, i) => {
        rects[m] = {x: v.left + leftW + gap, y: v.top + i * (each + gap), w: rightW, h: each};
      });
    }
    const geo = {};
    mods.forEach(m => {
      const r = rects[m];
      if (!r) return;
      geo[WIN[m] || m] = {
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.max(80, Math.round(r.w / z)),
        h: Math.max(80, Math.round(r.h / z)),
        scale: 1
      };
    });
    return Object.assign({}, scene, {geo: geo, uiScale: z, canvas: {x: 0, y: 0}});
  }

  /* 竖屏：缩放后仍重叠时，按等高全宽堆叠，保持模块可读。 */
  function arrangePortrait(scene, viewport, z) {
    const mods = modulesOf(scene);
    const v = viewport || currentViewport();
    const gap = GAP;
    const h = Math.max(90, (v.availH - gap * (mods.length - 1)) / Math.max(1, mods.length));
    const geo = {};
    mods.forEach((m, i) => {
      geo[WIN[m] || m] = {
        x: v.left + 1, y: Math.round(v.top + i * (h + gap)),
        w: Math.max(80, Math.round((v.availW - 2) / z)),
        h: Math.max(80, Math.round(h / z)),
        scale: 1
      };
    });
    return Object.assign({}, scene, {geo: geo, uiScale: z, canvas: {x: 0, y: 0}});
  }

  /* 把场景几何适配到当前视口。source 缺失且非强制时保持原样（旧场景）。 */
  function fitScene(scene, source, opts) {
    if (!scene || !scene.geo || !Object.keys(scene.geo).length) return scene;
    opts = opts || {};
    const v = currentViewport();
    const src = source || scene.viewport || (opts.force ? inferViewport(scene.geo) : null);
    if (!src) return scene;
    const z = uiScaleFor(v.w, scene.uiScale);
    const srcW = Math.max(1, num(src.w, 0), num(src.maxX, 0));
    const srcH = Math.max(1, num(src.h, 0), num(src.maxY, 0));
    const minX = num(src.minX, 0);
    const minY = num(src.minY, 0);
    const f = Math.min(1, (v.availW / z) / srcW, (v.availH / z) / srcH);
    const geo0 = scene.geo;

    // 横屏优先重排；竖屏仅在需要缩放且原布局重叠时重排。
    if (isLandscape(v) && modulesOf(scene).length >= 2 && (opts.force || f < 0.98)) {
      return arrangeLandscape(scene, v, z);
    }

    if (f >= 0.985 && !(opts.force && overlapCount(geo0, z))) {
      return scene;
    }

    const geo = {};
    Object.keys(geo0).forEach(id => {
      const g = geo0[id] || {};
      const x = num(g.x, 0), y = num(g.y, 0);
      const w = Math.max(1, num(g.w, 1)), h = Math.max(1, num(g.h, 1));
      geo[id] = {
        x: Math.round(v.left + (x - minX) * f),
        y: Math.round(v.top + (y - minY) * f),
        w: Math.max(80, Math.round(w * f)),
        h: Math.max(80, Math.round(h * f)),
        scale: Math.min(1, num(g.scale, 1))
      };
    });
    if (overlapCount(geo, z)) {
      return arrangePortrait(scene, v, z);
    }
    return Object.assign({}, scene, {geo: geo, uiScale: z, canvas: {x: 0, y: 0}});
  }

  return {currentViewport, isLandscape, inferViewport, fitScene, uiScaleFor};
})();
