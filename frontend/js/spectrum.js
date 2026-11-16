/* ---------------- Spectrum（全局悬浮：频谱 / 声谱，可拖动 / 吸附 / 缩放） ---------------- */
const Spectrum = (() => {
  const box = document.getElementById('spectrum-float');
  const fab = document.getElementById('sf-fab');
  const head = document.getElementById('sf-head');
  const trackEl = document.getElementById('sf-track');
  const canvas = document.getElementById('sf-canvas');
  const stateEl = document.getElementById('sf-state');
  const minBtn = document.getElementById('sf-min');
  const resize = document.getElementById('sf-resize');
  const g = canvas ? canvas.getContext('2d') : null;
  let open = false, core = null, raf = 0;
  let mode = 'spectrum';                 // spectrum | spectrogram（内部值仍用 waterfall，兼容旧配置）
  const pos = {side: 'right', top: null};

  // 声谱缓冲（时间轴横向、频率纵向；新数据从右侧进入，向左滚动）
  const wf = document.createElement('canvas');
  let wfCtx = null, wfW = 0, wfH = 0;
  let palette = null;

  function setState(t) { if (stateEl) stateEl.textContent = t || ''; }

  function paintTrack() {
    if (!trackEl) return;
    const p = Player.current;
    const info = Player.meta;
    if (!p) { trackEl.textContent = '未在播放'; trackEl.title = ''; return; }
    const title = (info && info.title) || Utils.basename(p);
    const sub = info && (info.artist || info.album)
      ? [info.artist, info.album].filter(Boolean).join(' · ') : '';
    trackEl.textContent = title + (sub ? ' — ' + sub : '');
    trackEl.title = p;
  }

  // 参考 Adobe Audition 频谱配色：黑 → 深蓝 → 紫 → 品红 → 红 → 橙 → 黄 → 白
  function buildPalette() {
    const stops = [
      [0, 0, 0], [0, 0, 70], [40, 0, 120], [110, 0, 140], [170, 0, 110],
      [220, 40, 40], [255, 140, 20], [255, 230, 90], [255, 255, 255],
    ];
    const pal = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255 * (stops.length - 1);
      const j = Math.floor(t), f = t - j;
      const a = stops[j], b = stops[Math.min(stops.length - 1, j + 1)];
      pal[i * 3] = Math.round(a[0] + (b[0] - a[0]) * f);
      pal[i * 3 + 1] = Math.round(a[1] + (b[1] - a[1]) * f);
      pal[i * 3 + 2] = Math.round(a[2] + (b[2] - a[2]) * f);
    }
    return pal;
  }

  let pcmTimer = 0;
  function startPcmPoll() {
    if (pcmTimer) return;
    try { Api.playbackSpectrum(true); } catch (_) {}
    pcmTimer = setInterval(async () => {
      if (!core || !core.native) return;
      try {
        const r = await Api.playbackSpectrum();
        if (!r || !r.ok || !r.bands) return;
        const d = new Uint8Array(96);
        for (let i = 0; i < 96; i++) d[i] = Math.max(0, Math.min(255, Math.round((r.bands[i] || 0) * 255)));
        core.data = d;
        if (r.levels && r.levels.length) {
          const lv = new Uint8Array(96);
          for (let i = 0; i < 96; i++) lv[i] = Math.max(0, Math.min(255, Math.round((r.levels[i] || 0) * 255)));
          core.levels = lv;
        }
        if (r.sampleRate) core.sampleRate = r.sampleRate;
      } catch (_) {}
    }, 33);
  }

  function ensureCore() {
    const hifi = !!(typeof Player !== 'undefined' && Player.hifiActive && Player.hifiActive());
    if (hifi) {
      if (!core || !core.native) {
        core = {native: true, data: new Uint8Array(96), levels: new Uint8Array(96), sampleRate: 48000, ctx: null, analyser: null};
        startPcmPoll();
      }
      return core;
    }
    /*
     * 非 HiFi（WebDAV 走 WebView 播放）不再接管 WebAudio。
     * 之前 createMediaElementSource + connect(destination) 会把主播放链路拉进
     * WebAudio（Android WebView 重采样 / 切后台渲染限流），是"开频谱就爆音"的根因。
     * 现在频谱只在本地 HiFi（ExoPlayer PCM 旁路）下提供。
     */
    if (core && !core.native) {
      try { core.analyser.disconnect(); } catch (_) {}
      stopPcmPoll();
    }
    core = null;
    return null;
  }

  function stopPcmPoll() { if (pcmTimer) { clearInterval(pcmTimer); pcmTimer = 0; } }

  function layoutCanvas() {
    if (!canvas) return;
    const w = Math.max(120, Math.round(canvas.clientWidth || 300));
    const h = Math.max(60, Math.round(canvas.clientHeight || 120));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  function nyquist() { return ((core && (core.sampleRate || (core.ctx && core.ctx.sampleRate))) || 48000) / 2; }

  function computeArea(w, h, padL, padB) {
    return {x0: padL, y0: 2, gw: w - padL - 4, gh: h - padB - 2,
            topHz: Math.min(24000, nyquist())};
  }

  function drawAxes(w, h, padL, padB) {
    const area = computeArea(w, h, padL, padB);
    const x0 = area.x0, y0 = area.y0, gw = area.gw, gh = area.gh, topHz = area.topHz;
    g.strokeStyle = 'rgba(148,163,184,.22)';
    g.fillStyle = 'rgba(148,163,184,.8)';
    g.lineWidth = 1;
    g.font = '9px ui-monospace, Menlo, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    [0, -20, -40, -60, -80].forEach(db => {
      const y = y0 + gh * (-db / 100);
      g.beginPath();
      g.moveTo(x0, Math.round(y) + .5);
      g.lineTo(x0 + gw, Math.round(y) + .5);
      g.stroke();
      g.fillText(String(db), x0 - 3, y);
    });
    const marks = [0, 4000, 8000, 12000, 16000, 20000, 24000].filter(v => v <= topHz + 1);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    marks.forEach(hz => {
      const x = x0 + gw * (hz / topHz);
      g.beginPath();
      g.moveTo(Math.round(x) + .5, y0);
      g.lineTo(Math.round(x) + .5, y0 + gh);
      g.stroke();
      g.fillText(hz === 0 ? '0' : (hz / 1000) + 'k',
        Math.min(x0 + gw - 8, Math.max(x0 + 6, x)), y0 + gh + 2);
    });
    g.strokeStyle = 'rgba(148,163,184,.6)';
    g.beginPath();
    g.moveTo(x0 + .5, y0);
    g.lineTo(x0 + .5, y0 + gh + .5);
    g.lineTo(x0 + gw, y0 + gh + .5);
    g.stroke();
    g.fillStyle = 'rgba(148,163,184,.55)';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText('dB', 2, 1);
    g.textAlign = 'right';
    g.fillText('Hz', w - 3, y0 + gh + 2);
    return area;
  }

  function resizeWf(w, h) {
    if (wfW === w && wfH === h) return;
    const old = document.createElement('canvas');
    old.width = Math.max(1, wfW); old.height = Math.max(1, wfH);
    const oldCtx = wfW > 0 && wfH > 0 ? old.getContext('2d') : null;
    if (oldCtx) { try { oldCtx.drawImage(wf, 0, 0); } catch (_) {} }
    wf.width = w; wf.height = h;
    try { wfCtx = wf.getContext('2d'); } catch (_) { wfCtx = null; }
    wfW = w; wfH = h;
    if (!wfCtx) return;
    wfCtx.fillStyle = '#000';
    wfCtx.fillRect(0, 0, w, h);
    if (oldCtx) {
      try { wfCtx.drawImage(old, Math.max(0, w - old.width), Math.max(0, h - old.height)); } catch (_) {}
    }
  }

  // 频率 → 纵向位置（对数感拉伸：低频占更大比例，接近 foobar 的观感）
  const GAMMA = 1.6;
  function yOfHz(hz, topHz, gh, y0) {
    const f = Math.max(0, Math.min(1, hz / topHz));
    return y0 + gh * (1 - Math.pow(f, 1 / GAMMA));
  }

  function drawWaterfall(area) {
    const W = Math.max(1, Math.round(area.gw));
    const H = Math.max(1, Math.round(area.gh));
    resizeWf(W, H);
    if (!wfCtx) return;
    // 左移一列（自身拷贝）；不支持 drawImage 的环境退化为清屏
    wfCtx.globalCompositeOperation = 'copy';
    try {
      if (typeof wfCtx.drawImage === 'function') wfCtx.drawImage(wf, -1, 0);
      else wfCtx.fillStyle = '#000';
    } catch (_) { wfCtx.fillStyle = '#000'; }
    if (typeof wfCtx.drawImage !== 'function') wfCtx.fillRect(0, 0, W, H);
    wfCtx.globalCompositeOperation = 'source-over';

    const data = core.data;
    const nyq = nyquist();
    const spanBins = Math.max(2, Math.round(data.length * area.topHz / nyq));
    const pal = palette || (palette = buildPalette());
    const useImage = typeof wfCtx.createImageData === 'function' &&
                     typeof wfCtx.putImageData === 'function';
    const img = useImage ? wfCtx.createImageData(1, H) : null;
    const px = img ? img.data : null;
    for (let y = 0; y < H; y++) {
      const norm = (H - 1 - y) / Math.max(1, H - 1);          // 0=底部(低频) 1=顶部
      const bin = Math.min(spanBins - 1, Math.floor(Math.pow(norm, GAMMA) * spanBins));
      const v = data[bin] || 0;
      const ci = Math.min(255, v);
      if (px) {
        const o = y * 4;
        px[o] = pal[ci * 3];
        px[o + 1] = pal[ci * 3 + 1];
        px[o + 2] = pal[ci * 3 + 2];
        px[o + 3] = 255;
      } else {
        wfCtx.fillStyle = 'rgb(' + pal[ci * 3] + ',' + pal[ci * 3 + 1] + ',' + pal[ci * 3 + 2] + ')';
        wfCtx.fillRect(W - 1, y, 1, 1);
      }
    }
    if (px) { try { wfCtx.putImageData(img, W - 1, 0); } catch (_) {} }

    if (typeof g.drawImage === 'function') g.drawImage(wf, area.x0, area.y0);
    g.font = '9px ui-monospace, Menlo, monospace';
    // Y 轴：频率（左侧，低频在下）
    const marks = [0, 4000, 8000, 12000, 16000, 20000, 24000].filter(v => v <= area.topHz + 1);
    g.fillStyle = 'rgba(148,163,184,.8)';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    marks.forEach(hz => {
      const y = yOfHz(hz, area.topHz, area.gh, area.y0);
      g.fillText(hz === 0 ? '0' : (hz / 1000) + 'k', area.x0 - 3, y);
    });
    g.strokeStyle = 'rgba(148,163,184,.45)';
    g.beginPath();
    g.moveTo(area.x0 + .5, area.y0);
    g.lineTo(area.x0 + .5, area.y0 + area.gh + .5);
    g.stroke();
    g.fillStyle = 'rgba(148,163,184,.55)';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText('Hz', 2, 1);
    // X 轴：时间（右端为现在，向左为过去）
    g.strokeStyle = 'rgba(148,163,184,.45)';
    g.beginPath();
    g.moveTo(area.x0, area.y0 + area.gh + .5);
    g.lineTo(area.x0 + area.gw, area.y0 + area.gh + .5);
    g.stroke();
    g.fillStyle = 'rgba(148,163,184,.55)';
    g.textAlign = 'right';
    g.textBaseline = 'top';
    g.fillText('时间 →', area.x0 + area.gw, area.y0 + area.gh + 2);
  }

  function draw() {
    raf = 0;
    if (!open || !g) return;
    layoutCanvas();
    const w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    // 两种模式坐标系隔离：频谱 X=频率 / Y=dB；声谱 X=时间 / Y=频率
    const area = computeArea(w, h, 30, 14);
    if (mode !== 'waterfall') drawAxes(w, h, 30, 14);
    const paused = !core || (core.native ? !(Player.hifiPlaying && Player.hifiPlaying()) : Player.audio.paused);
    if (paused) {
      if (mode === 'waterfall') {
        drawWaterfall(area);
        g.fillStyle = 'rgba(0,0,0,.45)';
        g.fillRect(area.x0, area.y0, area.gw, area.gh);
      } else {
        g.fillStyle = 'rgba(56,189,248,.20)';
        g.fillRect(area.x0, area.y0 + area.gh - 2, area.gw, 2);
      }
      setState(!core ? '未启用' : '暂停');
      raf = requestAnimationFrame(draw);
      return;
    }
    if (!core.native) {
      if (core.ctx.state === 'suspended') core.ctx.resume().catch(() => {});
      core.analyser.getByteFrequencyData(core.data);
    }
    if (mode === 'waterfall') {
      drawWaterfall(area);
      setState('声谱');
    } else {
      const nyq = nyquist();
      const bars = 48;
      const spanBins = Math.max(2, Math.round(core.data.length * area.topHz / nyq));
      const step = Math.max(1, Math.floor(Math.max(bars, spanBins) / bars));
      const bw = area.gw / bars;
      const src = (core.levels && core.levels.length) ? core.levels : core.data;
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += src[i * step + j] || 0;
        const v = (sum / step) / 255;
        const bh = Math.max(1, v * area.gh);
        const x = area.x0 + i * bw;
        const grad = g.createLinearGradient(0, area.y0 + area.gh, 0, area.y0 + area.gh - bh);
        grad.addColorStop(0, '#38bdf8');
        grad.addColorStop(1, '#fb923c');
        g.fillStyle = grad;
        g.fillRect(Math.round(x + 1), Math.round(area.y0 + area.gh - bh),
          Math.max(1, Math.round(bw - 2)), Math.round(bh));
      }
      setState('实时');
    }
    raf = requestAnimationFrame(draw);
  }

  function start() {
    ensureCore();
    if (!core) { setState('不可用'); return; }
    if (!raf) raf = requestAnimationFrame(draw);
  }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  function applySize() {
    const s = Store.get(K.spectrumSize, null);
    if (s && Number(s.w) > 0 && Number(s.h) > 0) {
      box.style.width = Math.round(s.w) + 'px';
      box.style.height = Math.round(s.h) + 'px';
    }
  }

  function applyPos() {
    if (pos.side === 'left') { box.style.left = '10px'; box.style.right = 'auto'; }
    else { box.style.right = '10px'; box.style.left = 'auto'; }
    if (pos.top != null) { box.style.top = Math.round(pos.top) + 'px'; box.style.bottom = 'auto'; }
    else { box.style.top = 'auto'; box.style.bottom = '96px'; }
    if (fab) {
      fab.style.left = pos.side === 'left' ? '10px' : 'auto';
      fab.style.right = pos.side === 'right' ? '10px' : 'auto';
    }
  }

  function paintTabs() {
    document.querySelectorAll('.sf-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
  }

  function setMode(m) {
    mode = (m === 'waterfall') ? 'waterfall' : 'spectrum';
    Store.set(K.spectrumMode, mode);
    paintTabs();
    if (mode === 'waterfall') { wfW = 0; wfH = 0; if (wfCtx) wfCtx = null; }
    setState('');
    if (open) { if (!raf) start(); }
  }

  function apply() {
    if (!box) return;
    box.classList.toggle('hidden', !open);
    if (fab) fab.style.display = open ? 'none' : '';
    if (open) { applySize(); applyPos(); layoutCanvas(); paintTrack(); paintTabs(); start(); }
    else { stop(); setState(''); }
  }

  function toggle() {
    open = !open;
    apply();
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}
  }

  // 拖动标题栏移动；松手吸附到左 / 右边缘（记住停靠边与高度）
  let drag = null;
  function onHeadDown(e) {
    if (!box || e.target.closest('button')) return;
    const r = box.getBoundingClientRect();
    drag = {x: e.clientX, y: e.clientY, l: r.left, t: r.top};
    box.style.left = Math.round(r.left) + 'px';
    box.style.top = Math.round(r.top) + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    try { head.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }
  function onHeadMove(e) {
    if (!drag || !box) return;
    const l = Math.max(4, Math.min(window.innerWidth - box.offsetWidth - 4, drag.l + e.clientX - drag.x));
    const t = Math.max(4, Math.min(window.innerHeight - box.offsetHeight - 4, drag.t + e.clientY - drag.y));
    box.style.left = Math.round(l) + 'px';
    box.style.top = Math.round(t) + 'px';
  }
  function onHeadUp() {
    if (!drag) return;
    drag = null;
    const r = box.getBoundingClientRect();
    pos.side = (r.left + r.width / 2) < window.innerWidth / 2 ? 'left' : 'right';
    pos.top = Math.max(4, Math.min(window.innerHeight - r.height - 4, r.top));
    Store.set(K.spectrumPos, {side: pos.side, top: pos.top});
    applyPos();
  }

  // 右下角拖动缩放（记住尺寸）
  let rz = null;
  if (resize) {
    resize.addEventListener('pointerdown', e => {
      const r = box.getBoundingClientRect();
      rz = {x: e.clientX, y: e.clientY,
            w: box.offsetWidth || r.width || 320,
            h: box.offsetHeight || r.height || 170};
      try { resize.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    resize.addEventListener('pointermove', e => {
      if (!rz) return;
      const w = Math.max(180, Math.min(window.innerWidth * .92, rz.w + (e.clientX - rz.x)));
      const h = Math.max(110, Math.min(window.innerHeight * .7, rz.h + (e.clientY - rz.y)));
      box.style.width = Math.round(w) + 'px';
      box.style.height = Math.round(h) + 'px';
      layoutCanvas();
    });
    ['pointerup', 'pointercancel'].forEach(t => resize.addEventListener(t, () => {
      if (!rz) return;
      rz = null;
      const w = Math.round(parseFloat(box.style.width) || box.offsetWidth || 0);
      const h = Math.round(parseFloat(box.style.height) || box.offsetHeight || 0);
      if (w > 0 && h > 0) Store.set(K.spectrumSize, {w, h});
    }));
  }

  function init() {
    if (!box || !canvas) return;
    const saved = Store.get(K.spectrumPos, null);
    if (saved && (saved.side === 'left' || saved.side === 'right')) {
      pos.side = saved.side;
      pos.top = Number.isFinite(Number(saved.top)) ? Number(saved.top) : null;
    }
    const savedMode = Store.get(K.spectrumMode, 'spectrum');
    mode = (savedMode === 'waterfall') ? 'waterfall' : 'spectrum';
    if (fab) fab.addEventListener('click', toggle);
    if (minBtn) minBtn.addEventListener('click', toggle);
    document.querySelectorAll('.sf-tab').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); setMode(b.dataset.mode); });
    });
    if (head) {
      head.addEventListener('pointerdown', onHeadDown);
      head.addEventListener('pointermove', onHeadMove);
      ['pointerup', 'pointercancel'].forEach(t => head.addEventListener(t, onHeadUp));
    }
    applySize();
    applyPos();
    paintTabs();
    apply();
    paintTrack();
    if (Player.onMeta) Player.onMeta(() => paintTrack());
    const audio = Player.audio;
    audio.addEventListener('play', () => { if (open) start(); });
    audio.addEventListener('pause', () => { if (open) setState('暂停'); });
    audio.addEventListener('ended', () => { if (open) setState('结束'); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !open || !core || !core.ctx) return;
      if (core.ctx.state === 'suspended') core.ctx.resume().catch(() => {});
    });
  }

  return {init, toggle, setMode, get open() { return open; }, get mode() { return mode; }};
})();
