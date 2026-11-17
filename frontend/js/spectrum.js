/* ---------------- Spectrum（全局悬浮：频谱 / 声谱，可拖动 / 吸附 / 缩放） ---------------- */
const Spectrum = (() => {
  const box = document.getElementById('spectrum-float');
  const fab = document.getElementById('sf-fab');
  const head = document.getElementById('sf-head');
  const trackEl = document.getElementById('sf-track');
  const canvas = document.getElementById('sf-canvas');
  const stateEl = document.getElementById('sf-state');
  const minBtn = document.getElementById('sf-min');
  let delayEl = null;
  let delayVal = null;
  const subEl = document.getElementById('sf-sub');
  let xScale = 'log';                  // log | lin（频谱 X 轴与柱数据同时切换）
  let hideTimer = 0;
  let pausedAt = 0, idleTimer = 0, stopped = false;
  const DPR = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  let cssW = 0, cssH = 0;
  let peakVals = [], peakAt = [];       // 峰值保持
  const resize = document.getElementById('sf-resize');
  const g = canvas ? canvas.getContext('2d') : null;
  let open = false, core = null, raf = 0;
  /* 延迟显示：蓝牙耳机有 100~300ms 传输延迟，画面会超前声音。
     这里缓存最近若干帧，按 delayMs 回放历史帧来对齐。 */
  let hist = [], delayMs = 0;
  let mode = 'spectrum';                 // spectrum | spectrogram（内部值仍用 waterfall，兼容旧配置）
  const pos = {side: 'right', top: null};

  // 声谱缓冲（时间轴横向、频率纵向；新数据从右侧进入，向左滚动）
  const wf = document.createElement('canvas');
  let wfCtx = null, wfW = 0, wfH = 0, wfLast = 0;
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

  // 配色：audition（默认）/ inferno（高对比）/ gray（强光下可读）
  function buildPalette(kind) {
    let stops;
    if (kind === 'inferno') {
      stops = [[0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164]];
    } else if (kind === 'gray') {
      stops = [[0,0,0],[64,64,64],[128,128,128],[192,192,192],[255,255,255]];
    } else if (kind === 'flame') {
      stops = [[0,0,0],[30,0,0],[90,0,4],[160,12,0],[220,60,0],[255,140,0],[255,220,80],[255,255,255]];
    } else {
      stops = [
        [0, 0, 0], [0, 0, 70], [40, 0, 120], [110, 0, 140], [170, 0, 110],
        [220, 40, 40], [255, 140, 20], [255, 230, 90], [255, 255, 255],
      ];
    }
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
  function applySpectrum(r) {
    if (!r || !r.ok || !r.bands) return;
    const d = new Uint8Array(96);
    for (let i = 0; i < 96; i++) d[i] = Math.max(0, Math.min(255, Math.round((r.bands[i] || 0) * 255)));
    core.data = d;
    if (r.levels && r.levels.length) {
      const lv = new Uint8Array(96);
      for (let i = 0; i < 96; i++) lv[i] = Math.max(0, Math.min(255, Math.round((r.levels[i] || 0) * 255)));
      core.levels = lv;
    }
    if (r.bars && r.bars.length) {
      const bs = new Uint8Array(r.bars.length);
      for (let i = 0; i < r.bars.length; i++) bs[i] = Math.max(0, Math.min(255, Math.round((r.bars[i] || 0) * 255)));
      core.bars = bs;
    }
    if (r.linbars && r.linbars.length) {
      const lb = new Uint8Array(r.linbars.length);
      for (let i = 0; i < r.linbars.length; i++) lb[i] = Math.max(0, Math.min(255, Math.round((r.linbars[i] || 0) * 255)));
      core.linbars = lb;
    }
    if (r.spec && r.spec.length) {
      const sp = new Uint8Array(r.spec.length);
      for (let i = 0; i < r.spec.length; i++) sp[i] = Math.max(0, Math.min(255, Math.round((r.spec[i] || 0) * 255)));
      core.spec = sp;
    }
    if (r.sampleRate) core.sampleRate = r.sampleRate;
    hist.push({t: performance.now(), data: d, bars: core.bars, linbars: core.linbars,
               spec: core.spec, levels: core.levels});
    if (hist.length > 260) hist.shift();
  }

  /* 取 delayMs 之前的那一帧；历史不够就用最早一帧 */
  function pickDelayed() {
    if (!delayMs || !hist.length) return null;
    const target = performance.now() - delayMs;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].t <= target) return hist[i];
    }
    return hist[0];
  }
  function startPcmPoll() {
    if (pcmTimer) return;
    try { Api.playbackSpectrum(true); } catch (_) {}
    // 高刷路径：直接同步调用 Java（WebView JS 桥），跟 requestAnimationFrame 走，
    // 帧率由屏幕刷新率决定（60/90/120Hz），绕开 HTTP 轮询的延迟。
    const nat = (typeof window.Ac2Native === 'object' && window.Ac2Native
                 && typeof window.Ac2Native.spectrum === 'function');
    if (nat) {
      const tick = () => {
        if (!pcmTimer) return;
        if (core && core.native) {
          try { const s = window.Ac2Native.spectrum(); if (s) applySpectrum(JSON.parse(s)); } catch (_) {}
        }
        requestAnimationFrame(tick);
      };
      pcmTimer = 1;
      requestAnimationFrame(tick);
      return;
    }
    pcmTimer = setInterval(async () => {
      if (!core || !core.native) return;
      try { applySpectrum(await Api.playbackSpectrum()); } catch (_) {}
    }, 33);
  }

  function ensureCore() {
    const hifi = !!(typeof Player !== 'undefined' && Player.hifiActive && Player.hifiActive());
    if (hifi) {
      if (!core || !core.native) {
        core = {native: true, data: new Uint8Array(96), levels: new Uint8Array(96), bars: new Uint8Array(48), linbars: new Uint8Array(48), spec: new Uint8Array(0), sampleRate: 48000, ctx: null, analyser: null};
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
    cssW = w; cssH = h;
    // 位图按 devicePixelRatio 放大：放大面板时不再糊
    const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    try { pushParams(); } catch (_) {}   // 面板变宽/变窄时柱数自动降档
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
    // dB 刻度与柱高同尺：0dB 在顶、-80dB 在底（柱高 v=(db+80)/80）。
    [0, -20, -40, -60, -80].forEach(db => {
      const y = y0 + gh * (-db / 80);
      g.beginPath();
      g.moveTo(x0, Math.round(y) + .5);
      g.lineTo(x0 + gw, Math.round(y) + .5);
      g.stroke();
      g.fillText(String(db), x0 - 3, y);
    });
    // 刻度随分档方式切换：线性柱=Hz 等距（40Hz~20kHz），对数柱=对数位置
    const lin = (xScale === 'lin');
    const marks = (lin
      ? [40, 2000, 5000, 10000, 15000, 20000]
      : [40, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]).filter(v => v <= topHz + 1);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    marks.forEach(hz => {
      const x = Math.min(x0 + gw - 2, x0 + gw * (lin
        ? ((hz - 40) / (20000 - 40))
        : (Math.log(hz / 40) / Math.log(20000 / 40))));
      g.beginPath();
      g.moveTo(Math.round(x) + .5, y0);
      g.lineTo(Math.round(x) + .5, y0 + gh);
      g.stroke();
      g.fillText(hz >= 1000 ? (hz / 1000) + 'k' : String(hz),
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
    const bw = Math.max(1, Math.round(w * DPR));
    const bh = Math.max(1, Math.round(h * DPR));
    if (wfW === bw && wfH === bh) return;
    const old = document.createElement('canvas');
    old.width = Math.max(1, wfW); old.height = Math.max(1, wfH);
    const oldCtx = wfW > 0 && wfH > 0 ? old.getContext('2d') : null;
    if (oldCtx) { try { oldCtx.drawImage(wf, 0, 0); } catch (_) {} }
    wf.width = bw; wf.height = bh;
    try { wfCtx = wf.getContext('2d'); } catch (_) { wfCtx = null; }
    wfW = bw; wfH = bh;
    if (!wfCtx) return;
    wfCtx.fillStyle = '#000';
    wfCtx.fillRect(0, 0, bw, bh);
    if (oldCtx) {
      try { wfCtx.drawImage(old, Math.max(0, bw - old.width), Math.max(0, bh - old.height)); } catch (_) {}
    }
  }

  // 频率 → 纵向位置（对数感拉伸：低频占更大比例，接近 foobar 的观感）
  const GAMMA = 1.6;
  function yOfHz(hz, topHz, gh, y0) {
    const f = Math.max(0, Math.min(1, hz / topHz));
    return y0 + gh * (1 - Math.pow(f, 1 / GAMMA));
  }

  /* 纵向映射：cur=现有效果，lin=线性，log=对数（声谱画布与刻度共用） */
  function hzToNorm(hz, top) {
    const f = Math.max(0, Math.min(1, hz / top));
    if (cfg.y === 'lin') return f;
    if (cfg.y === 'log') {
      const lo = 40;
      if (hz <= lo) return 0;
      return Math.max(0, Math.min(1, Math.log(hz / lo) / Math.log(top / lo)));
    }
    return Math.pow(f, 1 / GAMMA);
  }
  function normToHz(norm, top) {
    const n = Math.max(0, Math.min(1, norm));
    if (cfg.y === 'lin') return n * top;
    if (cfg.y === 'log') {
      const lo = 40;
      return lo * Math.pow(top / lo, n);
    }
    return top * Math.pow(n, GAMMA);
  }

  function drawWaterfall(area) {
    const W = Math.max(1, Math.round(area.gw));
    const H = Math.max(1, Math.round(area.gh));
    resizeWf(W, H);                     // 位图按 DPR 放大，放大面板也不糊
    if (!wfCtx) return;
    const BW = wfW, BH = wfH;
    // 左移一列（自身拷贝）；列速固定 ~60fps，避免高刷屏上滚动变快
    const now = performance.now();
    const advance = (wfLast === 0) || (now - wfLast >= 16.7);
    if (advance) wfLast = now;
    wfCtx.globalCompositeOperation = 'copy';
    try {
      if (typeof wfCtx.drawImage === 'function' && advance) wfCtx.drawImage(wf, -DPR, 0);
    } catch (_) { wfCtx.fillRect(0, 0, BW, BH); }
    wfCtx.globalCompositeOperation = 'source-over';

    const nyq = nyquist();
    const topHz = Math.min(cfg.top || 24000, nyq);
    // 声谱优先用原生高分辨率线性谱（128/256/512），没有就退回 96 档线性 bands
    const srcBins = (core.spec && core.spec.length) ? core.spec : core.data;
    const nB = srcBins.length || 96;
    const pal = palette || (palette = buildPalette(cfg.pal));
    const br = BRIGHT[cfg.bright] || BRIGHT.std;
    let img = null, px = null;
    try { img = wfCtx.createImageData(DPR, BH); px = img.data; } catch (_) {}
    for (let y = 0; y < BH; y++) {
      const rowNorm = (BH - 1 - y) / Math.max(1, BH - 1);   // 0=底(低频) 1=顶
      const hz = normToHz(rowNorm, topHz);
      const bin = Math.min(nB - 1, Math.max(0, Math.floor(hz / nyq * nB)));
      const v = srcBins[bin] || 0;
      const ci = Math.max(0, Math.min(255, Math.round((v - br[0]) * 255 / (br[1] - br[0]))));
      if (px) {
        for (let k = 0; k < DPR; k++) {
          const o = (y * DPR + k) * 4;
          px[o] = pal[ci * 3];
          px[o + 1] = pal[ci * 3 + 1];
          px[o + 2] = pal[ci * 3 + 2];
          px[o + 3] = 255;
        }
      } else {
        wfCtx.fillStyle = 'rgb(' + pal[ci * 3] + ',' + pal[ci * 3 + 1] + ',' + pal[ci * 3 + 2] + ')';
        wfCtx.fillRect(BW - DPR, y, DPR, 1);
      }
    }
    if (px) { try { wfCtx.putImageData(img, BW - DPR, 0); } catch (_) {} }

    if (typeof g.drawImage === 'function') g.drawImage(wf, area.x0, area.y0, W, H);

    // 时间网格：右端=现在，每格约 1 秒
    if (cfg.grid) {
      const secPx = Math.max(18, Math.round(1000 / 16.7));
      g.strokeStyle = 'rgba(148,163,184,.16)';
      let n = 0;
      for (let x = area.gw - secPx; x > 3; x -= secPx) {
        n++;
        g.beginPath();
        g.moveTo(area.x0 + x + .5, area.y0);
        g.lineTo(area.x0 + x + .5, area.y0 + area.gh);
        g.stroke();
        if (n === 1) {
          g.fillStyle = 'rgba(148,163,184,.45)';
          g.textAlign = 'left'; g.textBaseline = 'bottom';
          g.fillText('1s', area.x0 + x + 2, area.y0 + area.gh - 2);
        }
      }
    }

    // Y 轴：频率（左侧，低频在下）
    let marks;
    if (cfg.y === 'log') {
      marks = [40, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(v => v <= topHz + 1);
    } else {
      const step = topHz <= 3000 ? 500 : (topHz <= 8000 ? 1000 : (topHz <= 14000 ? 2000 : 4000));
      marks = [];
      for (let hz = 0; hz <= topHz + 1; hz += step) marks.push(hz);
    }
    g.font = '9px ui-monospace, Menlo, monospace';
    g.fillStyle = 'rgba(148,163,184,.8)';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    marks.forEach(hz => {
      const y = area.y0 + area.gh * (1 - hzToNorm(hz, topHz));
      g.fillText(hz === 0 ? '0' : (hz >= 1000 ? (hz / 1000) + 'k' : String(hz)), area.x0 - 3, y);
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
    const w = cssW, h = cssH;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, w, h);
    // 两种模式坐标系隔离：频谱 X=频率 / Y=dB；声谱 X=时间 / Y=频率
    const area = computeArea(w, h, 30, 14);
    if (mode !== 'waterfall') drawAxes(w, h, 30, 14);
    const paused = !core || (core.native ? !(Player.hifiPlaying && Player.hifiPlaying()) : Player.audio.paused);
    if (paused) {
      if (!pausedAt) pausedAt = performance.now();
      if (cfg.stop > 0 && !stopped && performance.now() - pausedAt > cfg.stop * 1000) {
        enterIdle();
        return;
      }
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
    pausedAt = 0;
    if (!core.native) {
      if (core.ctx.state === 'suspended') core.ctx.resume().catch(() => {});
      core.analyser.getByteFrequencyData(core.data);
    } else if (delayMs > 0) {
      const f = pickDelayed();
      if (f) {
        core.data = f.data; core.bars = f.bars;
        if (f.linbars) core.linbars = f.linbars;
        if (f.spec) core.spec = f.spec;
        if (f.levels) core.levels = f.levels;
      }
    }
    if (mode === 'waterfall') {
      drawWaterfall(area);
      setState('声谱');
    } else {
      const src = (xScale === 'lin' ? (core.linbars || core.bars) : core.bars) || core.data;
      const bars = src.length || 48;
      const bw = area.gw / bars;
      const now = performance.now();
      const holdMs = (cfg.peak || 0) * 1000;
      if (peakVals.length !== bars) {
        peakVals = new Array(bars).fill(0);
        peakAt = new Array(bars).fill(0);
      }
      for (let i = 0; i < bars; i++) {
        const v = (src[i] || 0) / 255;
        if (holdMs > 0) {
          if (v >= peakVals[i]) { peakVals[i] = v; peakAt[i] = now; }
          else if (now - peakAt[i] > holdMs) peakVals[i] = Math.max(v, peakVals[i] - 0.02);
        } else {
          peakVals[i] = v;
        }
        const bh = Math.max(1, v * area.gh);
        const x = area.x0 + i * bw;
        const grad = g.createLinearGradient(0, area.y0 + area.gh, 0, area.y0 + area.gh - bh);
        grad.addColorStop(0, '#38bdf8');
        grad.addColorStop(1, '#fb923c');
        g.fillStyle = grad;
        g.fillRect(Math.round(x + 1), Math.round(area.y0 + area.gh - bh),
          Math.max(1, Math.round(bw - 2)), Math.round(bh));
        if (holdMs > 0 && peakVals[i] > 0.03) {
          const py = area.y0 + area.gh - peakVals[i] * area.gh;
          g.fillStyle = 'rgba(251,146,60,.95)';
          g.fillRect(Math.round(x + 1), Math.round(py), Math.max(1, Math.round(bw - 2)), 1);
        }
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
  /* 暂停一段时间后彻底停算（频谱/声谱都停），播放恢复时秒回 */
  function enterIdle() {
    stopped = true;
    stop();
    stopPcmPoll();
    try { Api.playbackSpectrum(false); } catch (_) {}
    setState('暂停·已停算');
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      if (!open) { clearInterval(idleTimer); idleTimer = 0; return; }
      const playing = (core && core.native)
        ? !!(Player.hifiPlaying && Player.hifiPlaying())
        : !!(Player.audio && !Player.audio.paused);
      if (playing) {
        clearInterval(idleTimer); idleTimer = 0;
        stopped = false; pausedAt = 0;
        startPcmPoll();
        start();
      }
    }, 1000);
  }

  /* ---------- 调节区：长按展开、5s 自动收起、竖向靠左、按场景只显示对应项 ---------- */
  const REL_K = {fast: 0.20, mid: 0.12, slow: 0.07};
  const BRIGHT = {dark: [55, 255], std: [0, 255], bright: [0, 178]};
  const cfg = {
    x: (Store.get(K.spectrumX, 'log') === 'lin') ? 'lin' : 'log',
    db: Number(Store.get(K.spectrumDb, -80)) || -80,
    rel: Store.get(K.spectrumRel, 'mid'),
    peak: Number(Store.get(K.spectrumPeak, 1)),
    bars: Number(Store.get(K.spectrumBars, 48)),
    stop: Number(Store.get(K.spectrumStop, 5)),
    bright: Store.get(K.wfBright, 'std'),
    top: [24000, 12000, 6000, 2000].includes(Number(Store.get(K.wfTop, 24000)))
      ? Number(Store.get(K.wfTop, 24000)) : 24000,
    grid: Number(Store.get(K.wfGrid, 1)),
    pal: Store.get(K.wfPal, 'audition'),
    bands2: [128, 256, 512].includes(Number(Store.get(K.wfBands, 256)))
      ? Number(Store.get(K.wfBands, 256)) : 256,
    y: Store.get(K.wfY, 'cur')
  };
  xScale = cfg.x;

  const STOP_CHIP = {k: 'stop', key: K.spectrumStop, opts: [5, 10, 30, 0],
    label: v => v ? ('停算 ' + v + 's') : '停算 关'};
  const SPEC_CHIPS = [
    {k: 'x', key: K.spectrumX, opts: ['log', 'lin'],
     label: v => v === 'lin' ? 'X 线性' : 'X 对数'},
    {k: 'db', key: K.spectrumDb, opts: [-60, -80, -100],
     label: v => 'dB 0~' + v},
    {k: 'rel', key: K.spectrumRel, opts: ['fast', 'mid', 'slow'],
     label: v => ({fast: '回弹 快', mid: '回弹 中', slow: '回弹 慢'})[v]},
    {k: 'peak', key: K.spectrumPeak, opts: [1, 2, 0],
     label: v => v ? ('峰值保持 ' + v + 's') : '峰值保持 关'},
    {k: 'bars', key: K.spectrumBars, opts: [48, 64, 96],
     label: v => '柱数 ' + v}
  ];
  const WF_CHIPS = [
    {k: 'bright', key: K.wfBright, opts: ['dark', 'std', 'bright'],
     label: v => ({dark: '亮度 暗', std: '亮度 标准', bright: '亮度 亮'})[v]},
    {k: 'top', key: K.wfTop, opts: [24000, 12000, 6000, 2000],
     label: v => '频段 ' + (v >= 1000 ? (v / 1000) + 'k' : v)},
    {k: 'bands2', key: K.wfBands, opts: [128, 256, 512],
     label: v => '分辨率 ' + v},
    {k: 'y', key: K.wfY, opts: ['cur', 'lin', 'log'],
     label: v => ({cur: 'Y 轴 现效', lin: 'Y 轴 线性', log: 'Y 轴 对数'})[v]},
    {k: 'grid', key: K.wfGrid, opts: [1, 0],
     label: v => v ? '时间网格 开' : '时间网格 关'},
    {k: 'pal', key: K.wfPal, opts: ['audition', 'inferno', 'flame', 'gray'],
     label: v => ({audition: '配色 Audition', inferno: '配色 Inferno', flame: '配色 火焰', gray: '配色 灰度'})[v]}
  ];

  /* 窄面板自动降档：96 → 64 → 48，按钮上标注实际值 */
  function effBars() {
    const w = canvas ? (canvas.clientWidth || 0) : 0;
    if (cfg.bars <= 48) return 48;
    if (w < 260) return 48;
    if (w < 400) return Math.min(cfg.bars, 64);
    return cfg.bars;
  }
  function paintBarsChip() {
    const b = subEl && subEl.querySelector('[data-k="bars"]');
    if (!b) return;
    const eff = effBars();
    b.textContent = '柱数 ' + eff + (eff !== cfg.bars ? '（自动）' : '');
  }
  function pushParams() {
    paintBarsChip();
    try {
      if (window.Ac2Native && typeof window.Ac2Native.setParams === 'function') {
        window.Ac2Native.setParams(JSON.stringify({
          floorDb: cfg.db, release: REL_K[cfg.rel] || 0.12, bars: effBars(),
          spec: (mode === 'waterfall' ? (cfg.bands2 || 256) : 0)}));
      }
    } catch (_) {}
  }

  function makeChip(item) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sf-chip'; b.dataset.k = item.k;
    b.textContent = item.label(cfg[item.k]);
    b.addEventListener('click', e => {
      e.stopPropagation();
      const i = Math.max(0, item.opts.findIndex(v => v === cfg[item.k]));
      const nv = item.opts[(i + 1) % item.opts.length];
      cfg[item.k] = nv;
      Store.set(item.key, nv);
      if (item.k === 'x') xScale = nv;
      if (item.k === 'pal') { palette = null; }
      b.textContent = item.label(nv);
      if (item.k === 'db' || item.k === 'rel' || item.k === 'bars'
          || item.k === 'bands2' || item.k === 'y') pushParams();
      armHide();
    });
    return b;
  }

  function paintScene() {
    if (!subEl) return;
    subEl.querySelectorAll('[data-scene]').forEach(el => {
      el.style.display = (el.dataset.scene === 'both' || el.dataset.scene === mode) ? '' : 'none';
    });
    paintBarsChip();
  }

  function buildSub() {
    if (!subEl) return;
    subEl.innerHTML = '';
    // 延迟滑杆（蓝牙对齐，频谱/声谱都生效）
    const row = document.createElement('div');
    row.className = 'sf-line';
    const lab = document.createElement('label');
    lab.textContent = '延迟（蓝牙对齐）'; lab.htmlFor = 'sf-delay';
    const inp = document.createElement('input');
    inp.type = 'range'; inp.id = 'sf-delay'; inp.min = '0'; inp.max = '500'; inp.step = '20';
    const val = document.createElement('span'); val.id = 'sf-delay-val';
    row.append(lab, inp, val);
    // 通用项（两种场景都生效）
    const gBoth = document.createElement('div');
    gBoth.className = 'sf-grp'; gBoth.dataset.scene = 'both';
    gBoth.append(makeChip(STOP_CHIP));
    // 场景分组
    const gs = document.createElement('div');
    gs.className = 'sf-grp'; gs.dataset.scene = 'spectrum';
    SPEC_CHIPS.forEach(it => gs.append(makeChip(it)));
    const gw = document.createElement('div');
    gw.className = 'sf-grp'; gw.dataset.scene = 'waterfall';
    WF_CHIPS.forEach(it => gw.append(makeChip(it)));
    subEl.append(row, gBoth, gs, gw);
    delayEl = inp; delayVal = val;
    setDelay(Store.get(K.spectrumDelay, 0) || 0, false);
    inp.addEventListener('input', () => { setDelay(Number(inp.value), false); armHide(); });
    inp.addEventListener('change', () => { setDelay(Number(inp.value), true); armHide(); });
    paintScene();
    pushParams();
  }

  function armHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { hideTimer = 0; hideSub(); }, 5000);
  }
  function showSub() {
    if (!subEl) return;
    if (!subEl.childElementCount) buildSub();
    paintScene();
    subEl.classList.add('show');
    armHide();
  }
  function hideSub() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    if (subEl) subEl.classList.remove('show');
  }

  function setDelay(ms, save) {
    delayMs = Math.max(0, Math.min(500, Math.round(ms) || 0));
    if (delayEl) delayEl.value = String(delayMs);
    if (delayVal) delayVal.textContent = delayMs + 'ms';
    if (save) Store.set(K.spectrumDelay, delayMs);
  }

  if (subEl) {
    subEl.addEventListener('pointerdown', e => e.stopPropagation());
    subEl.addEventListener('input', armHide);
    subEl.addEventListener('change', armHide);
  }
  buildSub();
  hideSub();

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
    paintScene();
    pushParams();
    if (mode === 'waterfall') { wfW = 0; wfH = 0; if (wfCtx) wfCtx = null; }
    setState('');
    if (open) { if (!raf) start(); }
  }

  function apply() {
    if (!box) return;
    box.classList.toggle('hidden', !open);
    if (fab) fab.style.display = open ? 'none' : '';
    if (open) {
      applySize(); applyPos(); layoutCanvas(); paintTrack(); paintTabs(); paintScene();
      stopped = false; pausedAt = 0;
      if (core && core.native) startPcmPoll();
      start();
    } else {
      stop(); setState('');
      stopPcmPoll();
      if (idleTimer) { clearInterval(idleTimer); idleTimer = 0; }
      stopped = false; pausedAt = 0;
      hideSub();
      try { Api.playbackSpectrum(false); } catch (_) {}
    }
  }

  /* 延迟条默认收起：长按模块（画布区域）才展开，方便蓝牙耳机对齐 */
  let lpTimer = 0;
  function bindLongPress() {
    if (!box || !subEl) return;
    box.addEventListener('pointerdown', e => {
      if (e.target.closest('.sf-head, .sf-resize, .sf-sub, button')) return;
      if (lpTimer) clearTimeout(lpTimer);
      lpTimer = setTimeout(() => {
        lpTimer = 0;
        if (subEl.classList.contains('show')) hideSub(); else showSub();
      }, 550);
      const cancel = () => {
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; }
        box.removeEventListener('pointerup', cancel);
        box.removeEventListener('pointercancel', cancel);
        box.removeEventListener('pointermove', cancel);
      };
      box.addEventListener('pointerup', cancel);
      box.addEventListener('pointercancel', cancel);
      box.addEventListener('pointermove', cancel);
    }, {passive: true});
  }
  bindLongPress();

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
