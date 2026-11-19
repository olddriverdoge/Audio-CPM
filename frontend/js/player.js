/* ---------------- Player（网页内播放，后端 Range 流） ---------------- */
const Player = (() => {
  const audio = document.getElementById('audio-el');
  const bar = document.getElementById('player-bar');
  const btnToggle = document.getElementById('pb-toggle');
  const seek = document.getElementById('pb-seek');
  const curEl = document.getElementById('pb-cur');
  const durEl = document.getElementById('pb-dur');
  const titleEl = document.getElementById('pb-title');
  const metaEl = document.getElementById('pb-meta');
  const vol = document.getElementById('pb-vol');
  const coverEl = document.getElementById('pb-cover');
  const coverImg = document.createElement('img');
  const waveBase = document.getElementById('pb-wave-base');
  const waveHi = document.getElementById('pb-wave-hi');
  let cur = '';
  let curWave = '';
  let curInfo = null;
  const metaSubs = [];
  coverImg.alt = '';
  coverImg.addEventListener('load', () => coverEl.classList.add('on'));
  coverImg.addEventListener('error', () => {
    coverEl.classList.remove('on');
    coverImg.removeAttribute('src');
  });
  coverEl.appendChild(coverImg);
  let seeking = false;
  let hifi = false, hifiPlaying = false, hifiPos = 0, hifiDur = 0, hifiTimer = 0;
  /* 点击文件行时带了比例但时长未知：等原生返回 durationMs 后补一次 seek */
  let pendingRatio = 0;
  let reportedError = '';
  function reportPlaybackError(err) {
    if (!err || err === reportedError) return;
    reportedError = err;
    // 所有 ExoPlayer/MediaSession 错误统一进日志模块，不只依赖 HiFi 轮询。
    Utils.log('err', '播放错误: ' + err, 'workbench');
    // 本轮会话已确认 HiFi 有问题；继续让网页播放兜底，避免反复起原生播放器。
    window.__ac2HifiBroken = true;
  }

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }
  const ICONS = {'play': '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,3 20,12 6,21"/></svg>', 'pause': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>', 'stop': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14"/></svg>', 'prev': '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="19,4 9,12 19,20"/><rect x="4" y="4" width="3" height="16"/></svg>', 'next': '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5,4 15,12 5,20"/><rect x="17" y="4" width="3" height="16"/></svg>'};
  function setToggle(playing) { btnToggle.innerHTML = playing ? ICONS.pause : ICONS.play; }
  function hifiAvailable() {
    if (window.__ac2HifiBroken) return false;   // 本会话已确认 HiFi 起不来，别再反复失败
    try {
      const r = (typeof Sources !== 'undefined') ? Sources.currentRoot() : null;
      return !!(r && r.caps && r.caps.indexOf('hifi_play') >= 0);
    } catch (_) { return false; }
  }
  function stopHifiPoll() { if (hifiTimer) { clearInterval(hifiTimer); hifiTimer = 0; } }
  /** 原生播放器切歌后，把界面同步到新曲目（不重新发起播放）。 */
  function adoptNative(p) {
    if (!p || p === cur) return;
    cur = p;
    try { if (typeof Spectrum !== 'undefined') Spectrum.onTrackChange(); } catch (_) {}
    try { audio.pause(); audio.removeAttribute('src'); } catch (_) {}
    titleEl.textContent = Utils.basename(p);
    titleEl.title = p;
    if (metaEl) metaEl.textContent = '';
    curInfo = {title: Utils.basename(p), artist: '', composer: '', album: ''};
    notifyMeta();
    applyMeta(p);
    setCover(p);
    setWave(p);
    paintRows();
    try { if (typeof App !== 'undefined' && App.onPlayed) App.onPlayed(p); } catch (_) {}
  }

  function startHifiPoll() {
    stopHifiPoll();
    hifiTimer = setInterval(async () => {
      if (!hifi) return;
      try {
        const s = await Api.playbackState();
        if (!s || !s.ok) return;
        hifiPos = Number(s.positionMs) || 0;
        hifiDur = Number(s.durationMs) || 0;
        if (pendingRatio > 0 && hifiDur > 0) {
          const ms = Math.round(pendingRatio * hifiDur);
          pendingRatio = 0;
          try { await Api.playbackSeek(ms); } catch (_) {}
        }
        if (s.error) {
          reportPlaybackError(s.error);
          stopHifiPoll();
          hifi = false;
          Utils.toast('HiFi 播放失败，已切回网页播放', 'warn');
          audio.src = '/api/stream?path=' + encodeURIComponent(cur || '');
          audio.play().catch(() => {});
          setToggle(false);
          return;
        }
        hifiPlaying = !!s.playing;
        // seek 后恢复由真实播放状态驱动（替代频谱模块里的定时盲试）
        if (hifiPlaying && typeof Spectrum !== 'undefined' && Spectrum.isWaitingResume
            && Spectrum.isWaitingResume()) {
          try { Spectrum.resumeStream(); } catch (_) {}
        }
        // 原生队列自动下一首后，前端要跟着换标题/封面/波形
        if (s.path) {
          const ref = 'local:' + s.path;
          if (ref !== cur) adoptNative(ref);
        }
        const d = hifiDur / 1000, p = hifiPos / 1000;
        if (d > 0) { seek.max = String(d); durEl.textContent = fmt(d); }
        if (!seeking) { seek.value = String(p); curEl.textContent = fmt(p); }
        setPct(d > 0 ? p / d * 100 : 0);
        setToggle(hifiPlaying);
        paintButtons(cur);
      } catch (_) {}
    }, 250);
  }
  function syncMediaState(playing) {
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; }
    catch (_) {}
  }
  // 行内/磁贴播放按钮：当前曲目在播时显示 ⏸，其余 ▶（避免"点了没反应"的错觉）
  function paintButtons(path) {
    const on = !!path && !!cur && (hifi ? hifiPlaying : !audio.paused);
    document.querySelectorAll('[data-act="play"]').forEach(b => {
      const row = b.closest('[data-path]');
      const active = !!(row && path && row.dataset.path === path) && on;
      const state = active ? 'on' : 'off';
      if (b.dataset.state === state) return;
      b.dataset.state = state;
      b.innerHTML = active ? ICONS.pause : ICONS.play;
      b.title = active ? '暂停' : '播放';
    });
  }
  // 播放条封面：有内嵌封面则显示，没有则保留占位图（♪）
  function setCover(path) {
    coverEl.classList.remove('on');
    coverEl.title = path ? '所在文件封面' : '暂无封面';
    if (!path || String(path).indexOf('dav:') === 0) { coverImg.removeAttribute('src'); return; }
    coverImg.src = Api.thumbUrl(path, 96);
  }
  // 读取标签后填充播放条的标题 / 专辑 / 艺术家，并同步媒体通知
  function applyMeta(path) {
    Api.probe(path).then(d => {
      if (cur !== path || !d) return;
      const t = d.tags || {};
      const title = String(t.title || '').trim() || Utils.basename(path);
      const artist = String(t.artist || t.album_artist || '').trim();
      const composer = String(t.composer || '').trim();
      const album = String(t.album || '').trim();
      curInfo = {title, artist: artist || composer, composer, album,
        audio: (d && d.audio) ? d.audio : null};
      if (titleEl) { titleEl.textContent = title; titleEl.title = path; }
      if (metaEl) {
        const sub = [artist || composer, album].filter(Boolean).join(' · ');
        metaEl.textContent = sub || '—';
        metaEl.title = [artist, composer, album].filter(Boolean).join(' / ');
      }
      updateMediaSession(path, {title, artist, album, composer}, d.has_cover);
      // HiFi 原生通知栏优先用这里的标签：FLAC 的 composer 在部分 ROM 上
      // MediaMetadataRetriever 读不到，前端 probe 能稳定拿到。
      if (hifiAvailable() && String(path).indexOf('dav:') !== 0) {
        try { Api.playbackMeta(path, {title, artist, composer, album}).catch(() => {}); } catch (_) {}
      }
      notifyMeta();
    }).catch(() => {});
  }
  function notifyMeta() {
    const info = curInfo ? Object.assign({}, curInfo) : null;
    for (const cb of metaSubs) { try { cb(cur, info); } catch (_) {} }
  }
  function onMeta(cb) { if (typeof cb === 'function') metaSubs.push(cb); }
  function clearWebMediaSession() {
    // HiFi 播放走原生 MediaSession，WebView 的 navigator.mediaSession
    // 不能再挂一份 metadata，否则系统媒体卡片可能选到 WebView 这一路，
    // 表现就是通知栏状态和 app 内部不一致、按钮也控制不到 ExoPlayer。
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      }
    } catch (_) {}
  }
  function updateMediaSession(path, tags, hasCover) {
    if (hifi) { clearWebMediaSession(); return; }
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    try {
      const art = [];
      if (hasCover) {
        try { art.push({src: new URL(Api.coverUrl(path), location.href).href, type: 'image/jpeg'}); } catch (_) {}
      }
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: tags.title || Utils.basename(path),
        artist: [tags.artist, tags.composer].filter(Boolean).join(' / '),
        album: tags.album || '',
        artwork: art
      });
    } catch (_) {}
  }
  // 当前进度百分比（0~100）
  function pct() {
    if (hifi && hifiDur > 0) return Math.max(0, Math.min(100, hifiPos / hifiDur * 100));
    const d = audio.duration;
    if (!isFinite(d) || d <= 0) return 0;
    return Math.max(0, Math.min(100, (audio.currentTime || 0) / d * 100));
  }
  function clipCss(p) { return 'inset(0 ' + (100 - p).toFixed(2) + '% 0 0)'; }
  // 同步“已播放段”裁剪：播放条 + 列表行内波形
  function setPct(p) {
    p = Math.max(0, Math.min(100, Number(p) || 0));
    if (waveHi) waveHi.style.clipPath = clipCss(p);
    const waveBox = document.getElementById('pb-wave');
    if (waveBox) waveBox.style.setProperty('--pb-pct', p.toFixed(2) + '%');
    document.querySelectorAll('.row-wave .rw-hi').forEach(el => { el.style.clipPath = clipCss(p); });
  }
  function isGrid() {
    try { return !!(typeof App !== 'undefined' && App.isGridView && App.isGridView()); }
    catch (_) { return false; }
  }
  // 播放条只在网格视图弹出；列表视图用行内波形当进度背景
  function syncBar() {
    const on = isGrid() && !!cur;
    bar.classList.toggle('hidden', !on);
    document.body.classList.toggle('has-player', on);
  }
  async function setWave(path) {
    curWave = '';
    waveBase.removeAttribute('src');
    waveHi.removeAttribute('src');
    setPct(0);
    const waveBox = document.getElementById('pb-wave');
    const isDav = String(path || '').indexOf('dav:') === 0;
    if (waveBox) waveBox.classList.toggle('time-only', isDav);
    if (!path) return;
    // WebDAV 不请求波形（也不画占位），进度条用时间/range
    if (isDav) { paintRows(); return; }
    const url = await Wave.get(path);
    if (!url || cur !== path) return;
    curWave = url;
    waveBase.src = url;
    waveHi.src = url;
    setPct(pct());
    paintRows();
  }
  // 列表视图：给正在播放的行铺虚化波形背景（每次重渲染后要重画）
  function paintRows() {
    document.querySelectorAll('.row-wave').forEach(n => n.remove());
    document.querySelectorAll('.item.file.playing').forEach(n => n.classList.remove('playing'));
    paintButtons(cur);
    if (!cur || !curWave) return;
    document.querySelectorAll('.item.file[data-path]').forEach(row => {
      if (row.dataset.path !== cur) return;
      const box = document.createElement('div');
      box.className = 'row-wave';
      box.innerHTML = '<img class="rw-base" alt=""><img class="rw-hi" alt="">';
      box.querySelectorAll('img').forEach(img => { img.src = curWave; });
      row.insertBefore(box, row.firstChild);
      row.classList.add('playing');
    });
    setPct(pct());
  }
  function show() {
    syncBar();
  }
  function close() {
    if (hifi) {
      try { Api.playbackStop(); } catch (_) {}
      hifi = false; hifiPlaying = false; stopHifiPoll();
    }
    try { audio.pause(); } catch (_) {}
    audio.removeAttribute('src');
    try { audio.load(); } catch (_) {}
    cur = '';
    curWave = '';
    waveBase.removeAttribute('src');
    waveHi.removeAttribute('src');
    setPct(0);
    paintRows();
    bar.classList.add('hidden');
    document.body.classList.remove('has-player');
    titleEl.textContent = '未在播放';
    if (metaEl) { metaEl.textContent = ''; metaEl.title = ''; }
    curInfo = null;
    notifyMeta();
    clearWebMediaSession();
    setToggle(false);
    setCover('');
    paintButtons('');
  }
  async function open(path, startRatio) {
    if (!path) throw new Error('空路径');
    const ratio = Math.max(0, Math.min(0.999, Number(startRatio) || 0));
    cur = path;
    try { if (typeof Spectrum !== 'undefined') Spectrum.onTrackChange(); } catch (_) {}
    // 切歌前先停掉 WebView 那一路，避免 HiFi 与网页播放同时出声（爆音/叠音）
    try { audio.pause(); } catch (_) {}
    titleEl.textContent = Utils.basename(path);
    titleEl.title = path;
    if (metaEl) metaEl.textContent = '';
    curInfo = {title: Utils.basename(path), artist: '', composer: '', album: ''};
    notifyMeta();
    applyMeta(path);
    setCover(path);
    if (hifiAvailable() && String(path).indexOf('dav:') !== 0) {
      try {
        // “点文件行 = 从点击位置起播”：时长来自波形接口缓存的 durationMs，
        // 已知则直接换算 startMs 交给原生；未知则先记比例，等 state 回 duration 再 seek。
        const durMs = (typeof Wave !== 'undefined' && Wave.durationMs) ? Wave.durationMs(path) : 0;
        const startMs = (durMs > 0 && ratio > 0) ? Math.round(ratio * durMs) : 0;
        pendingRatio = (startMs > 0 || ratio <= 0) ? 0 : ratio;
        const q = (typeof App !== 'undefined' && App.hifiQueue) ? App.hifiQueue(path) : null;
        const r = (q && q.paths && q.paths.length > 1)
          ? await Api.playbackQueue(q.paths, q.index, startMs)
          : await Api.playbackOpen(path, startMs, 0, 0, 0);
        if (r && r.ok) {
          hifi = true; hifiPlaying = true; hifiPos = 0; hifiDur = 0;
          clearWebMediaSession();
          try { if (typeof App !== 'undefined' && App.applyPlayMode) App.applyPlayMode(); } catch (_) {}
          setWave(path); paintRows(); show(); startHifiPoll(); setToggle(true);
          return;
        }
        // 失败不静默：写日志 + 一次性提示，便于真机排查（否则只会"悄悄退回网页播放"）
        const why = (r && (r.error || r.message)) || 'unknown';
        Utils.log('warn', 'HiFi 打开失败，已回退网页播放: ' + why);
        if (!window.__ac2HifiWarned) {
          window.__ac2HifiWarned = true;
          Utils.toast('HiFi 未启用，已回退网页播放：' + why, 'warn');
        }
      } catch (e) {
        Utils.log('warn', 'HiFi 打开异常，已回退网页播放: ' + (e && e.message || e));
      }
    }
    hifi = false;
    pendingRatio = 0;          // 回退网页播放：比例由 audio.currentTime 处理
    if (String(path).indexOf('dav:') === 0) {
      // 远端文件走本机流代理：顺手停掉原生播放器，避免上一首的 ExoPlayer 报错/叠音
      try { if (typeof Api !== 'undefined' && Api.playbackStop) Api.playbackStop().catch(() => {}); } catch (_) {}
    }
    setWave(path);
    paintRows();
    audio.src = '/api/stream?path=' + encodeURIComponent(path);
    show();
    seek.value = '0';
    curEl.textContent = '0:00';
    durEl.textContent = '0:00';
    seek.max = '0';
    // 一次点击就落到点击位置：元数据就绪后按比例跳转
    if (ratio > 0) {
      const applySeek = () => {
        const d = audio.duration;
        if (isFinite(d) && d > 0) {
          audio.currentTime = ratio * d;
          setPct(ratio * 100);
          seek.value = String(audio.currentTime);
          curEl.textContent = fmt(audio.currentTime);
        }
      };
      audio.addEventListener('loadedmetadata', applySeek, { once: true });
      applySeek();
    }
    try {
      await audio.play();
      setToggle(true);
    } catch (e) {
      setToggle(false);
      throw new Error('浏览器无法播放该格式，或需要先点击页面再播放');
    }
    if ('mediaSession' in navigator && window.MediaMetadata) {
      try {
        navigator.mediaSession.setActionHandler('play', () => { audio.play().catch(() => {}); });
        navigator.mediaSession.setActionHandler('pause', () => audio.pause());
        navigator.mediaSession.setActionHandler('seekto', d => {
          if (d && typeof d.seekTime === 'number') audio.currentTime = d.seekTime;
        });
        // 通知栏 / 锁屏的上一首·下一首（后台播放时可用）
        try {
          navigator.mediaSession.setActionHandler('nexttrack', () => {
            if (typeof App !== 'undefined' && App.playNext) App.playNext();
          });
          navigator.mediaSession.setActionHandler('previoustrack', () => {
            audio.currentTime = 0;
            if (audio.paused) audio.play().catch(() => {});
          });
        } catch (_) {}
      } catch (_) {}
    }
    syncMediaState(true);
  }
  /* 播放管理面板用：位置/时长/播放状态/音量/重播 */
  function positionSec() { return hifi ? hifiPos / 1000 : (audio.currentTime || 0); }
  function durationSec() { return hifi ? (hifiDur > 0 ? hifiDur / 1000 : 0) : (isFinite(audio.duration) ? audio.duration : 0); }
  function isPlaying() { return hifi ? hifiPlaying : !audio.paused; }
  function setVolume(v) {
    const x = Math.max(0, Math.min(1, Number(v) || 0));
    try { audio.volume = x; } catch (_) {}
    if (vol) vol.value = String(x);
    try { if (typeof Api !== 'undefined' && Api.playbackVolume) Api.playbackVolume(x).catch(() => {}); } catch (_) {}
  }
  function seekSec(t) {
    const d = durationSec();
    if (!(d > 0)) return;
    seekRatio(Math.max(0, Math.min(1, Number(t) / d)));
  }
  function replay() {
    if (hifi) {
      try { Api.playbackSeek(0).catch(() => {}); } catch (_) {}
      try { Api.playbackResume().catch(() => {}); } catch (_) {}
      hifiPlaying = true;
      return;
    }
    try { audio.currentTime = 0; audio.play().catch(() => {}); } catch (_) {}
  }

  // 按横向比例跳转（整理页点击行/磁贴一步到位）
  function seekRatio(r) {
    const d = hifi ? hifiDur / 1000 : audio.duration;
    if (!isFinite(d) || d <= 0) return;
    const t = Math.max(0, Math.min(1, Number(r) || 0)) * d;
    if (hifi) {
      const ms = Math.round(t * 1000);
      Api.playbackSeek(ms).catch(() => {});
      hifiPos = ms; seek.value = String(t); curEl.textContent = fmt(t);
      setPct(d > 0 ? t / d * 100 : 0);
      return;
    }
    audio.currentTime = t;
    seek.value = String(t);
    curEl.textContent = fmt(t);
    setPct(d > 0 ? t / d * 100 : 0);
    if (audio.paused) audio.play().catch(() => {});
  }
  function toggle() {
    if (!cur) return;
    if (hifi) {
      if (hifiPlaying) { Api.playbackPause().catch(() => {}); hifiPlaying = false; }
      else { Api.playbackResume().catch(() => {}); hifiPlaying = true; }
      setToggle(hifiPlaying); paintButtons(cur);
      return;
    }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  function external() {
    if (cur) PlayMgr.playExternal(cur);
  }

  audio.addEventListener('loadedmetadata', () => {
    const d = audio.duration;
    if (isFinite(d) && d > 0) { seek.max = String(d); durEl.textContent = fmt(d); }
  });
  audio.addEventListener('durationchange', () => {
    const d = audio.duration;
    if (isFinite(d) && d > 0) { seek.max = String(d); durEl.textContent = fmt(d); }
  });
  audio.addEventListener('timeupdate', () => {
    if (seeking) return;
    seek.value = String(audio.currentTime || 0);
    curEl.textContent = fmt(audio.currentTime);
    setPct(pct());
  });
  audio.addEventListener('play', () => { setToggle(true); paintButtons(cur); syncMediaState(true); });
  audio.addEventListener('pause', () => { setToggle(false); paintButtons(cur); syncMediaState(false); });
  audio.addEventListener('ended', () => {
    setToggle(false); paintButtons(cur);
    // 顺序自动播放：播完自动接列表下一首（开关在顶栏「⏭ 顺序」）
    if (typeof App !== 'undefined' && App.autoplayNext) App.autoplayNext();
  });
  audio.addEventListener('error', () => {
    if (!cur) return;
    Utils.toast('网页播放失败：浏览器可能不支持该格式，可点 ↗ 用系统播放器', 'err');
    setToggle(false);
  });

  /* 切后台 / 切页签：浏览器若把播放暂停，回到前台自动续播（网页播放模式） */
  let wasPlaying = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      wasPlaying = !audio.paused && !!cur;
      stopHifiPoll();          // 熄屏期间别每 250ms 打一次 HTTP，回来时统一补一次
      return;
    }
    const wasHifi = !!hifi;
    if (wasHifi) {
      // 先同步拉一次状态，再恢复轮询：亮度回归时不会再堆一堆请求
      Api.playbackState().then(s => {
        if (s && s.ok) {
          hifiPos = Number(s.positionMs) || 0;
          hifiDur = Number(s.durationMs) || 0;
          if (s.path) { const ref = 'local:' + s.path; if (ref !== cur) adoptNative(ref); }
          const d = hifiDur / 1000, p = hifiPos / 1000;
          if (d > 0) { seek.max = String(d); durEl.textContent = fmt(d); }
          if (!seeking) { seek.value = String(p); curEl.textContent = fmt(p); }
          setPct(d > 0 ? p / d * 100 : 0);
          setToggle(!!s.playing);
        }
      }).catch(() => {});
      startHifiPoll();
    }
    if (wasPlaying && cur && audio.paused && Settings.playMode() === 'web') {
      audio.play().catch(() => {});
    }
    wasPlaying = false;
  });

  seek.addEventListener('input', () => {
    seeking = true;
    curEl.textContent = fmt(Number(seek.value));
    const d = audio.duration;
    if (isFinite(d) && d > 0) setPct(Number(seek.value) / d * 100);
  });
  const commitSeek = () => {
    if (!seeking) return;
    const t = Number(seek.value);
    if (isFinite(t)) {
      if (hifi) {
        // 只清前端历史（不停链）：切歌那套 suspend/resume 用在 seek 上会因重试超时把频谱卡死
        try { if (typeof Spectrum !== 'undefined') Spectrum.onSeek(); } catch (_) {}
        // 播放状态轮询也停半秒再起，让 hifiPlaying 这个缓存值在 seek 完成后重新同步
        try { stopHifiPoll(); setTimeout(() => { if (hifi) startHifiPoll(); }, 500); } catch (_) {}
        Api.playbackSeek(Math.round(t * 1000)).catch(() => {});
        hifiPos = t * 1000;
      }
      else audio.currentTime = t;
    }
    seeking = false;
  };
  seek.addEventListener('change', commitSeek);
  seek.addEventListener('pointerup', commitSeek);

  vol.addEventListener('input', () => { audio.volume = Number(vol.value); });
  btnToggle.addEventListener('click', toggle);
  document.getElementById('pb-ext').addEventListener('click', external);
  document.getElementById('pb-close').addEventListener('click', close);

  // 行内点击（含播放行按横向比例跳转）统一由 BrowseView.onRowClick → App.playRowClick 处理

  // 即使当前不是 HiFi（例如已回退网页、或用户在别的模块），也持续检查原生错误。
  // 这样 ExoPlayer 的 Source error 不会只落在 player_error.txt 里。
  setInterval(async () => {
    try {
      const s = await Api.playbackState();
      if (!s || !s.ok || !s.error) return;
      reportPlaybackError(s.error);
    } catch (_) {}
  }, 2000);

  return {open, toggle, close, external, syncBar, paintRows, pct, seekRatio, onMeta,
          position: positionSec, duration: durationSec, isPlaying, setVolume, seekSec, replay,
          hifiActive: () => hifi, hifiPlaying: () => hifiPlaying,
          get current() { return cur; },
          get meta() { return curInfo ? Object.assign({}, curInfo) : null; },
          audio};
})();
