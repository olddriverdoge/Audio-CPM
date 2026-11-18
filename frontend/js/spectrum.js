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
  let winCtl = null;

  // 声谱缓冲（时间轴横向、频率纵向；新数据从右侧进入，向左滚动）
  const wf = document.createElement('canvas');
  const wfTmp = document.createElement('canvas');      // 滚动位移用的中转画布（不自绘自）
  let wfCtx = null, wfTmpCtx = null, wfW = 0, wfH = 0, wfLast = 0;
  let palette = null;
  const WFDPR = Math.min(2, DPR);        // 瀑布位图不必按 3x 放大：2x 已足够清晰，省一半以上像素拷贝
  let dataSeq = 0, wfSeq = -1, lastDataAt = 0;           // 原生数据帧序号 / 瀑布已消费到的序号（没新数据就不滚动）
  let lastMeasure = 0;                   // 画布尺寸测量节流（每帧读 clientWidth 会强制同步排版）
  let paramsSig = '';                    // 已下发的参数签名（避免每帧 JSON + 桥调用）
  let wfImg = null, wfImgKey = '';       // 复用 ImageData
  let wfRowBin = null, wfRowKey = '';     // 频率→行号映射缓存（避免每帧 BH 次 pow/log）
  /* 切歌窗口：先把整条数据链停掉（前端取数 + 原生 FFT），等新曲真正开始播放再重新接上。
     以前是切歌时立刻重启取数，恰好撞上 ExoPlayer 换源/重建 sink 的主线程重活，
     90Hz 的 JS 桥调用全挤在那一帧，表现就是"整个 app 卡死 + 频谱错乱"。 */
  let switchTok = 0, switchTimer = 0, suspended = false;

  function setState(t) { if (stateEl) stateEl.textContent = t || ''; }

  function paintTrack() {
    if (!trackEl) return;
    const p = Player.current;
    const info = Player.meta;
    if (!p) { trackEl.textContent = (typeof I18n !== 'undefined') ? I18n.t('未在播放') : '未在播放'; trackEl.title = ''; return; }
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

  function isDavTrack() {
    try { return String(Player.current || '').indexOf('dav:') === 0; } catch (_) { return false; }
  }

  /* WebDAV 走 <audio> 播放，原生 SpectrumProcessor 没有输入；这里用 WebAudio 的
     AnalyserNode 旁路分析解码后的 PCM。它不额外读网络，也不下载整首文件。
     只在 DAV 曲目、打开频谱面板时启用；关闭面板后切回 source→destination，
     避免把普通播放长期挂在 WebAudio 处理链上。 */
  function setWebAnalyser(core, on) {
    if (!core || core.native || !core.source || !core.analyser || !core.ctx) return;
    try {
      core.source.disconnect();
      if (on) {
        try { core.analyser.disconnect(); } catch (_) {}
        core.source.connect(core.analyser);
        core.analyser.connect(core.ctx.destination);
      } else {
        core.source.connect(core.ctx.destination);
      }
    } catch (_) {}
  }

  function createWebCore() {
    if (window.__ac2WebAudioCore) return window.__ac2WebAudioCore;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || typeof Player === 'undefined' || !Player.audio) return null;
    try {
      const ctx = new AC();
      const source = ctx.createMediaElementSource(Player.audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      ctx.resume().catch(() => {});
      const core = {
        native: false, ctx, source, analyser,
        raw: new Uint8Array(analyser.frequencyBinCount),
        data: new Uint8Array(96), levels: new Uint8Array(96),
        bars: new Uint8Array(48), linbars: new Uint8Array(48),
        spec: new Uint8Array(128), sampleRate: ctx.sampleRate
      };
      window.__ac2WebAudioCore = core;
      return core;
    } catch (e) {
      try { Utils.log('warn', 'WebDAV 频谱初始化失败: ' + (e && e.message || e)); } catch (_) {}
      return null;
    }
  }

  function fillWebBands(core) {
    if (!core || core.native || !core.analyser || !core.raw) return;
    core.analyser.getByteFrequencyData(core.raw);
    const nyq = Math.max(1, (core.ctx && core.ctx.sampleRate || core.sampleRate || 48000) / 2);
    const raw = core.raw, n = raw.length;
    const binAt = hz => Math.min(n - 1, Math.max(0, Math.floor(hz / nyq * n)));
    // 96 个对数频段，和原生 bands 的烘焙方式对齐
    for (let i = 0; i < 96; i++) {
      const a = 30 * Math.pow(nyq / 30, i / 96);
      const b = 30 * Math.pow(nyq / 30, (i + 1) / 96);
      const x = binAt(a), y = Math.max(x, binAt(b));
      let m = 0;
      for (let j = x; j <= y; j++) if (raw[j] > m) m = raw[j];
      core.data[i] = m;
      core.levels[i] = m;
    }
    const barN = Math.max(1, effBars());
    if (!core.bars || core.bars.length !== barN) {
      core.bars = new Uint8Array(barN);
      core.linbars = new Uint8Array(barN);
    }
    for (let i = 0; i < barN; i++) {
      // 对数柱：把 96 个对数频段按柱数合并
      const a = Math.floor(i * 96 / barN), b = Math.max(a + 1, Math.floor((i + 1) * 96 / barN));
      let m = 0;
      for (let j = a; j < b; j++) if (core.data[j] > m) m = core.data[j];
      core.bars[i] = m;
      // 线性柱：给 X 轴切到 lin 时用
      const lx = Math.floor(i * n / barN), ly = Math.max(lx + 1, Math.floor((i + 1) * n / barN));
      let lm = 0;
      for (let j = lx; j < ly; j++) if (raw[j] > lm) lm = raw[j];
      core.linbars[i] = lm;
    }
    // 声谱用线性谱（128 档），避免瀑布只显示 96 个粗频段
    if (!core.spec || core.spec.length !== 128) core.spec = new Uint8Array(128);
    for (let i = 0; i < 128; i++) {
      const a = Math.floor(i * n / 128), b = Math.max(a + 1, Math.floor((i + 1) * n / 128));
      let m = 0;
      for (let j = a; j < b; j++) if (raw[j] > m) m = raw[j];
      core.spec[i] = m;
    }
    core.sampleRate = core.ctx ? core.ctx.sampleRate : core.sampleRate;
    dataSeq++;
  }

  function packInto(src, dst) {
    if (!src || !src.length) return dst;
    const n = src.length;
    if (!dst || dst.length !== n) dst = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = Math.round((src[i] || 0) * 255);
      dst[i] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
    return dst;
  }
  let live = {data: null, bars: null, linbars: null, spec: null, levels: null};

  function applySpectrum(r) {
    if (!r || !r.ok || !r.bands) return;
    dataSeq++;
    lastDataAt = performance.now();
    // delay=0 时复用同一批缓冲（避免每秒 ~90×5 次 Uint8Array 分配，GC 抖动会让切歌时更卡）
    const useLive = delayMs === 0;
    if (useLive) {
      live.data = packInto(r.bands, live.data);
      if (r.levels && r.levels.length) live.levels = packInto(r.levels, live.levels);
      if (r.bars && r.bars.length) live.bars = packInto(r.bars, live.bars);
      if (r.linbars && r.linbars.length) live.linbars = packInto(r.linbars, live.linbars);
      if (r.spec && r.spec.length) live.spec = packInto(r.spec, live.spec);
      core.data = live.data; core.levels = live.levels;
      core.bars = live.bars; core.linbars = live.linbars; core.spec = live.spec;
    } else {
      const d = new Uint8Array(96);
      for (let i = 0; i < 96; i++) d[i] = Math.max(0, Math.min(255, Math.round((r.bands[i] || 0) * 255)));
      const lv = new Uint8Array(96);
      for (let i = 0; i < 96; i++) lv[i] = Math.max(0, Math.min(255, Math.round((r.levels[i] || 0) * 255)));
      const bs = r.bars && r.bars.length ? packInto(r.bars) : null;
      const lb = r.linbars && r.linbars.length ? packInto(r.linbars) : null;
      const sp = r.spec && r.spec.length ? packInto(r.spec) : null;
      core.data = d; core.levels = lv;
      if (bs) core.bars = bs;
      if (lb) core.linbars = lb;
      if (sp) core.spec = sp;
      // 历史帧只在"有延迟"时才留（默认 0 时不 push，省掉每秒几十帧的整帧引用与内存增长）
      const now = performance.now();
      hist.push({t: now, data: d, bars: core.bars, linbars: core.linbars,
                 spec: core.spec, levels: core.levels});
      const cap = Math.max(8, Math.min(200, Math.ceil(delayMs / 8) + 5));   // 1s 档按 ~125Hz 取数留够历史
      while (hist.length > cap) hist.shift();
    }
    if (r.sampleRate) core.sampleRate = r.sampleRate;
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
  let lastHeal = 0, badFrames = 0, healLogAt = 0;
  let seekGuardUntil = 0;
  let waitResume = false, waitSince = 0;   // seek 后等待"真正播起来"再恢复取数（事件驱动）              // 拖进度条后的保护期：期间不进 idle，避免长定位把 rAF 停掉卡在"缓冲中"
  /* 取数自救：只要"缓冲中"持续超过 1.5s，就重开原生开关 + 重建取数链。
     seek/切歌/息屏任何一条路径把链子弄停（原生 enabled 被关、rAF 链断、tick 换代），这里都能拉回来。 */
  function healStream(reason) {
    const now = performance.now();
    if (now - lastHeal < 2000) return;
    lastHeal = now;
    try { Api.playbackSpectrum(true); } catch (_) {}
    stopPcmPoll();
    startPcmPoll();                     // 只重建取数链；rAF 由 draw 自己的循环维持
    if (now - healLogAt > 8000) {
      healLogAt = now;
      try { Utils.log('warn', '频谱取数停摆(' + (reason || '') + ')，已自动重连'); } catch (_) {}
    }
  }

  let pcmTickId = 0;
  function startPcmPoll() {
    if (pcmTimer) return;
    if (!core || !core.native) return;   // WebDAV 用 WebAudio 分析，不启动原生桥轮询
    try { Api.playbackSpectrum(true); } catch (_) {}
    // 高刷路径：直接同步调用 Java（WebView JS 桥），跟 requestAnimationFrame 走，
    // 帧率由屏幕刷新率决定（60/90/120Hz），绕开 HTTP 轮询的延迟。
    const nat = (typeof window.AudioCpmNative === 'object' && window.AudioCpmNative
                 && typeof window.AudioCpmNative.spectrum === 'function');
    if (nat) {
      const myId = ++pcmTickId;
      const tick = () => {
        if (!pcmTimer || myId !== pcmTickId) return;
        if (core && core.native) {
          try {
            const s = window.AudioCpmNative.spectrum();
            if (s) {
              const r = JSON.parse(s);
              if (r && r.ok === false) { if (++badFrames > 20) { badFrames = 0; healStream('native-error'); } }
              else { badFrames = 0; applySpectrum(r); }
            }
          } catch (e) {
            if (++badFrames > 20) { badFrames = 0; healStream('bridge'); }   // 桥调用连续失败：重连
          }
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
    if (isDavTrack()) {
      if (core && core.native) stopPcmPoll();
      if (!core || core.native) core = createWebCore();
      if (core) setWebAnalyser(core, true);
      return core;
    }
    const hifi = !!(typeof Player !== 'undefined' && Player.hifiActive && Player.hifiActive());
    if (hifi) {
      if (!core || !core.native) {
        core = {native: true, data: new Uint8Array(96), levels: new Uint8Array(96), bars: new Uint8Array(48), linbars: new Uint8Array(48), spec: new Uint8Array(0), sampleRate: 48000, ctx: null, analyser: null};
        startPcmPoll();
      }
      return core;
    }
    /*
     * 本地 WebView 播放仍不接管 WebAudio；WebDAV 曲目单独走上面的 AnalyserNode，
     * 关闭频谱面板时会切回 source→destination，不影响普通播放链路。
     */
    if (core && !core.native) {
      setWebAnalyser(core, false);
      stopPcmPoll();
    }
    core = null;
    return null;
  }

  function stopPcmPoll() {
    pcmTickId++;
    if (pcmTimer) { clearInterval(pcmTimer); pcmTimer = 0; }
  }

  function layoutCanvas() {
    if (!canvas) return;
    // 每帧读 clientWidth/clientHeight 会强制同步排版；面板尺寸不会每帧变，200ms 量一次足够
    const now = performance.now();
    if (!cssW || !cssH || now - lastMeasure > 200) {
      lastMeasure = now;
      cssW = Math.max(120, Math.round(canvas.clientWidth || 300));
      cssH = Math.max(60, Math.round(canvas.clientHeight || 120));
    }
    const w = cssW, h = cssH;
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
    const bw = Math.max(1, Math.round(w * WFDPR));
    const bh = Math.max(1, Math.round(h * WFDPR));
    if (wfW === bw && wfH === bh) return;
    const old = document.createElement('canvas');
    old.width = Math.max(1, wfW); old.height = Math.max(1, wfH);
    const oldCtx = wfW > 0 && wfH > 0 ? old.getContext('2d') : null;
    if (oldCtx) { try { oldCtx.drawImage(wf, 0, 0); } catch (_) {} }
    wf.width = bw; wf.height = bh;
    wfTmp.width = bw; wfTmp.height = bh;
    try { wfCtx = wf.getContext('2d'); } catch (_) { wfCtx = null; }
    try { wfTmpCtx = wfTmp.getContext('2d'); } catch (_) { wfTmpCtx = null; }
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
    // 只有真的来了新数据才滚动/写列：切歌瞬间原生还没出帧时，不为一个空帧白白拷贝整块位图
    const now = performance.now();
    const newData = wfSeq !== dataSeq;
    const advance = newData && ((wfLast === 0) || (now - wfLast >= 16.0));
    if (advance) { wfLast = now; wfSeq = dataSeq; }
    const colW = Math.max(1, Math.round(WFDPR));   // 新列宽（设备像素）

    const nyq = nyquist();
    const topHz = Math.min(cfg.top || 24000, nyq);
    // 声谱优先用原生高分辨率线性谱（128/256/512），没有就退回 96 档线性 bands
    let srcBins = (core.spec && core.spec.length) ? core.spec : core.data;
    if (!srcBins || !srcBins.length) srcBins = core.data || new Uint8Array(96);
    if (srcBins === core.spec) {
      let mx = 0;
      for (let i = 0; i < srcBins.length; i += 4) { if (srcBins[i] > mx) mx = srcBins[i]; }
      if (mx < 3) srcBins = core.data || srcBins;   // 全零谱 = 还没算，退回可用数据
    }
    const nB = srcBins.length || 96;

    if (advance) {
      const pal = palette || (palette = buildPalette(cfg.pal));
      const br = BRIGHT[cfg.bright] || BRIGHT.std;
      // 频率→行号映射缓存：BH 每帧最多 ~1800 行，逐行 pow/log 在低端机上很贵
      const rowKey = BH + '|' + topHz + '|' + cfg.y + '|' + nB + '|' + nyq;
      if (rowKey !== wfRowKey) {
        wfRowKey = rowKey;
        wfRowBin = new Int32Array(BH);
        for (let y = 0; y < BH; y++) {
          const rowNorm = (BH - 1 - y) / Math.max(1, BH - 1);
          const hz = normToHz(rowNorm, topHz);
          wfRowBin[y] = Math.min(nB - 1, Math.max(0, Math.floor(hz / nyq * nB)));
        }
      }
      const imgKey = colW + 'x' + BH;
      if (imgKey !== wfImgKey) {
        wfImgKey = imgKey;
        try { wfImg = wfCtx.createImageData(colW, BH); } catch (_) { wfImg = null; }
      }
      const px = wfImg ? wfImg.data : null;
      for (let y = 0; y < BH; y++) {
        const v = srcBins[wfRowBin[y]] || 0;
        const ci = Math.max(0, Math.min(255, Math.round((v - br[0]) * 255 / (br[1] - br[0]))));
        if (px) {
          const o = (y * colW) * 4;
          const r = pal[ci * 3], gg = pal[ci * 3 + 1], bb = pal[ci * 3 + 2];
          for (let k = 0; k < colW; k++) {
            const q = o + k * 4;
            px[q] = r; px[q + 1] = gg; px[q + 2] = bb; px[q + 3] = 255;
          }
        }
      }
      // 左移一列（用中转画布，避免"自绘自"在某些 WebView 上被清屏）
      try {
        if (wfTmpCtx) {
          wfTmpCtx.globalCompositeOperation = 'copy';
          wfTmpCtx.drawImage(wf, 0, 0);
          wfTmpCtx.globalCompositeOperation = 'source-over';
          wfCtx.globalCompositeOperation = 'copy';
          wfCtx.drawImage(wfTmp, -colW, 0);
          wfCtx.globalCompositeOperation = 'source-over';
        }
      } catch (_) {
        try { wfCtx.globalCompositeOperation = 'source-over'; } catch (__) {}
      }
      if (px) { try { wfCtx.putImageData(wfImg, BW - colW, 0); } catch (_) {} }
    }

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
    inDraw = true;
    try {
      if (suspended) return;             // 切歌/定位窗口不重绘（等新数据）
      if (!open || !g) return;
      try {
        drawFrame();
      } catch (e) {
        try { console.warn('spectrum draw failed', e); } catch (_) {}
      }
      if (stopped) return;               // enterIdle 停算后不再排帧
    } finally {
      inDraw = false;
    }
    raf = requestAnimationFrame(draw);
  }

  function drawFrame() {
    layoutCanvas();
    const w = cssW, h = cssH;
    g.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    g.clearRect(0, 0, w, h);
    // 两种模式坐标系隔离：频谱 X=频率 / Y=dB；声谱 X=时间 / Y=频率
    const area = computeArea(w, h, 30, 14);
    if (mode !== 'waterfall') drawAxes(w, h, 30, 14);
    const paused = !core || (core.native ? !(Player.hifiPlaying && Player.hifiPlaying()) : Player.audio.paused);
    if (paused) {
      if (!pausedAt) pausedAt = performance.now();
      if (cfg.stop > 0 && !stopped && performance.now() > seekGuardUntil
          && performance.now() - pausedAt > cfg.stop * 1000) {
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
      return;            // 排帧统一由 draw() 末尾负责；这里若再排会形成双链并指数增长
    }
    pausedAt = 0;
    // 切歌/缓冲的空窗：原生还没产出新帧时不要空转重绘（此前会把 rAF 全花在画旧数据/空帧上）
    if (core.native && performance.now() - lastDataAt > 450
        && (typeof Player.hifiPlaying !== 'function' || Player.hifiPlaying())) {
      if (performance.now() - lastDataAt > 3000) healStream('buffering ' + Math.round(performance.now() - lastDataAt) + 'ms');
      g.fillStyle = 'rgba(148,163,184,.5)';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '12px ui-monospace, Menlo, monospace';
      g.fillText('缓冲中…', w / 2, h / 2);
      setState('缓冲');
      return;            // 同上：绝不能在 drawFrame 内再排帧
    }
    if (!core.native) {
      if (core.ctx && core.ctx.state === 'suspended') core.ctx.resume().catch(() => {});
      fillWebBands(core);
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
      setState('');
    }
  }

  /* 切歌：底层换源，旧谱系整体作废。
     ① 立刻清空前端所有历史/峰值/瀑布并停掉 rAF + 取数；
     ② 同时关掉原生 FFT（Api.playbackSpectrum(false)），切歌窗口里不再抢主线程；
     ③ 等新曲真正在播再重新下发参数并重启数据链（收起状态则完全不碰）。 */
  function onTrackChange() {
    hist = [];
    dataSeq = 0; wfSeq = -1; lastDataAt = performance.now();
    peakVals = []; peakAt = [];
    wfRowKey = ''; wfImgKey = '';
    if (core && core.native) {
      const barN = Math.max(1, effBars());
      live = {data: null, bars: null, linbars: null, spec: null, levels: null};
      core.data = new Uint8Array(96); core.levels = new Uint8Array(96);
      core.bars = new Uint8Array(barN); core.linbars = new Uint8Array(barN);
      core.spec = new Uint8Array(0);
    } else if (core && !core.native) {
      if (core.data) core.data.fill(0);
      if (core.levels) core.levels.fill(0);
      if (core.bars) core.bars.fill(0);
      if (core.linbars) core.linbars.fill(0);
      if (core.spec && core.spec.length) core.spec.fill(0);
    }
    try { if (wfCtx) { wfCtx.fillStyle = '#000'; wfCtx.fillRect(0, 0, wfW, wfH); } } catch (_) {}
    paramsSig = '';                      // 新 processor 是默认参数，必须重新下发
    if (!open) return;                   // 收起时不重启任何计算
    suspendForSwitch();
  }

  function paintSwitchHint() {
    if (!g) return;
    try {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#0f1419';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = 'rgba(148,163,184,.75)';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = Math.round(12 * DPR) + 'px ui-monospace, Menlo, monospace';
      g.fillText('切换中…', canvas.width / 2, canvas.height / 2);
    } catch (_) {}
  }

  function suspendForSwitch() {
    ++switchTok;
    suspended = true;
    stopPcmPoll();                        // 前端取数链停掉（pcmTickId 递增）
    stop();                               // rAF 也停掉，切歌时不重绘
    try { Api.playbackSpectrum(false); } catch (_) {}   // 原生 FFT 立刻停算
    setState('切换中…');
    paintSwitchHint();
    scheduleResume(switchTok, 700, 0);
  }

  function scheduleResume(tok, ms, tries) {
    if (switchTimer) clearTimeout(switchTimer);
    switchTimer = setTimeout(() => {
      switchTimer = 0;
      if (tok !== switchTok || !open || !suspended) return;
      const playing = (typeof Player.hifiPlaying === 'function') ? !!Player.hifiPlaying() : true;
      // 以前 10×300ms(≈3s) 就放弃：往后拖进度时 ExoPlayer 定位+续读常超过 3s，
      // 一旦放弃频谱就永久停在"切换中…"，只能收起重开。改成持续等待（≈20s 上限）。
      if (!playing && tries < 50) { scheduleResume(tok, 400, tries + 1); return; }
      if (!playing) { resumeStream(); return; }
      resumeStream();
    }, ms);
  }

  let resolveTimer = 0;
  function resumeStream() {
    if (!open) return;
    waitResume = false;
    if (resolveTimer) { clearTimeout(resolveTimer); resolveTimer = 0; }
    suspended = false; stopped = false; pausedAt = 0;
    paramsSig = '';
    pushParams();
    try { Api.playbackSpectrum(true); } catch (_) {}
    startPcmPoll();
    start();
  }

  let inDraw = false;
  function start() {
    ensureCore();
    if (!core) { setState((typeof I18n !== 'undefined') ? I18n.t('不可用') : '不可用'); return; }
    // 关键：draw 执行期间 raf 恒为 0，若此时再排一帧就会和 draw 末尾那帧并行成两条链，
    // 之后每自愈一次多一条，90Hz 桥调用叠加直接把 UI 线程拖死（真机表现：界面卡死但音频还在放）。
    if (!raf && !inDraw) raf = requestAnimationFrame(draw);
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
        try { Api.playbackSpectrum(true); } catch (_) {}
        startPcmPoll();
        start();
      }
    }, 1000);
  }

  /* 熄屏 / 切后台：rAF 已停，但原生 FFT 与 HTTP 取数还在跑，
     回来时容易一次性补一大批帧 + 重绘瀑布，表现就是"刚点亮时卡一阵"。
     这里干脆在不可见时整条链停掉，可见后再接上。 */
  function onHidden() {
    if (!open) return;
    ++switchTok;
    suspended = true;
    stopPcmPoll();
    stop();
    if (core && !core.native) setWebAnalyser(core, false);
    try { Api.playbackSpectrum(false); } catch (_) {}
    setState('暂停·已停算');
  }

  /* 拖进度条：只清前端历史/瀑布，不停取数链、不 toggle 原生 FFT。
     ExoPlayer 定位期间没有新帧，drawFrame 会自然显示"缓冲中…"，出帧后自动恢复；
     以前走 suspendForSwitch 会因 3s 重试超时把频谱永久卡死。 */
  function onSeek() {
    if (!open) return;
    seekGuardUntil = performance.now() + 15000;
    // 与切歌完全同款：停前端取数 + 停 rAF + 关原生 FFT。
    // 恢复不用定时器盲猜，而是等 Player 轮询发现"真的在播"再回来 —— 定位期间
    // 一次 JS 桥调用都不做，避免 90Hz 同步调用和 ExoPlayer 的定位重活抢 UI 线程（界面卡死的主因）。
    ++switchTok;
    suspended = true;
    waitResume = true;
    waitSince = performance.now();
    stopPcmPoll();
    stop();
    try { Api.playbackSpectrum(false); } catch (_) {}
    hist = []; peakVals = []; peakAt = [];
    wfRowKey = ''; wfImgKey = '';
    dataSeq = 0; wfSeq = -1;
    lastDataAt = performance.now();
    lastHeal = 0; badFrames = 0;
    try { if (wfCtx) { wfCtx.fillStyle = '#000'; wfCtx.fillRect(0, 0, wfW, wfH); } } catch (_) {}
    if (core && core.native) {
      if (core.data) core.data.fill(0);
      if (core.levels) core.levels.fill(0);
      if (core.bars) core.bars.fill(0);
      if (core.linbars) core.linbars.fill(0);
      if (core.spec && core.spec.length) core.spec.fill(0);
    }
    setState('定位中…');
    paintSwitchHint('定位中…');
    armWaitResume();
  }

  /* 兜底：万一播放状态轮询也断了，15s 后无条件恢复，避免永久停在"定位中…" */
  function armWaitResume() {
    if (resolveTimer) clearTimeout(resolveTimer);
    resolveTimer = setTimeout(() => {
      resolveTimer = 0;
      if (!waitResume || !open) return;
      resumeStream();
    }, 15000);
  }

  function onVisible() {
    if (!open || !suspended) return;
    const tok = ++switchTok;
    setTimeout(() => {
      if (tok !== switchTok || !open) return;
      resumeStream();
    }, 350);
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
     label: v => ({cur: 'Y 轴 默认', lin: 'Y 轴 线性', log: 'Y 轴 对数'})[v]},
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
    const eff = effBars();
    const specN = (mode === 'waterfall' ? (cfg.bands2 || 256) : 0);
    const sig = cfg.db + '|' + (REL_K[cfg.rel] || 0.12) + '|' + eff + '|' + specN;
    if (sig === paramsSig) return;      // 参数没变就不下发（draw 每帧都会走到这里）
    paramsSig = sig;
    paintBarsChip();
    try {
      if (window.AudioCpmNative && typeof window.AudioCpmNative.setParams === 'function') {
        window.AudioCpmNative.setParams(JSON.stringify({
          floorDb: cfg.db, release: REL_K[cfg.rel] || 0.12, bars: eff, spec: specN}));
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
    inp.type = 'range'; inp.id = 'sf-delay'; inp.min = '0'; inp.max = '1000'; inp.step = '20';
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
    delayMs = Math.max(0, Math.min(1000, Math.round(ms) || 0));
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
    const st = Store.get(K.winSpectrum, null);
    if (st && Number.isFinite(Number(st.x)) && Number.isFinite(Number(st.y))) {
      box.style.left = Math.max(2, Math.min(window.innerWidth - 60, Number(st.x))) + 'px';
      box.style.top = Math.max(2, Math.min(window.innerHeight - 40, Number(st.y))) + 'px';
      box.style.right = 'auto'; box.style.bottom = 'auto';
      return;
    }
    // 旧版只记了停靠边 + 顶部高度：沿用
    if (pos.side === 'left') { box.style.left = '10px'; box.style.right = 'auto'; }
    else { box.style.right = '10px'; box.style.left = 'auto'; }
    if (pos.top != null) { box.style.top = Math.round(pos.top) + 'px'; box.style.bottom = 'auto'; }
    else { box.style.top = 'auto'; box.style.bottom = '96px'; }
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
      if (winCtl) winCtl.apply(); layoutCanvas(); paintTrack(); paintTabs(); paintScene();
      stopped = false; pausedAt = 0;
      suspended = false; switchTok++;    // 手动展开＝立刻恢复，取消切歌等待
      paramsSig = '';
      if (core && core.native) startPcmPoll();
      start();
    } else {
      stop(); setState('');
      stopPcmPoll();
      if (core && !core.native) setWebAnalyser(core, false);
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

  /* 缩放/拖动/置顶统一交给 WinMgr（见 app.js 注册） */

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
    if (typeof Dock !== 'undefined') {
      Dock.bindFab(fab, K.fabSpectrum, 'right');
    }
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

  return {init, toggle, setMode, onTrackChange, onSeek, resumeStream, onHidden, onVisible,
          isWaitingResume: () => waitResume,
          get open() { return open; }, get mode() { return mode; }};
})();
