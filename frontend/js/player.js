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

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }
  function setToggle(playing) { btnToggle.textContent = playing ? '⏸' : '▶'; }
  function syncMediaState(playing) {
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; }
    catch (_) {}
  }
  // 行内/磁贴播放按钮：当前曲目在播时显示 ⏸，其余 ▶（避免"点了没反应"的错觉）
  function paintButtons(path) {
    const on = !!path && !!cur && !audio.paused;
    document.querySelectorAll('[data-act="play"]').forEach(b => {
      const row = b.closest('[data-path]');
      const active = !!(row && path && row.dataset.path === path) && on;
      const state = active ? 'on' : 'off';
      if (b.dataset.state === state) return;
      b.dataset.state = state;
      b.textContent = active ? '⏸' : '▶';
      b.title = active ? '暂停' : '播放';
    });
  }
  // 播放条封面：有内嵌封面则显示，没有则保留占位图（♪）
  function setCover(path) {
    coverEl.classList.remove('on');
    coverEl.title = path ? '所在文件封面' : '暂无封面';
    if (!path) { coverImg.removeAttribute('src'); return; }
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
      curInfo = {title, artist: artist || composer, composer, album};
      if (titleEl) { titleEl.textContent = title; titleEl.title = path; }
      if (metaEl) {
        const sub = [artist || composer, album].filter(Boolean).join(' · ');
        metaEl.textContent = sub || '—';
        metaEl.title = [artist, composer, album].filter(Boolean).join(' / ');
      }
      updateMediaSession(path, {title, artist, album, composer}, d.has_cover);
      notifyMeta();
    }).catch(() => {});
  }
  function notifyMeta() {
    const info = curInfo ? Object.assign({}, curInfo) : null;
    for (const cb of metaSubs) { try { cb(cur, info); } catch (_) {} }
  }
  function onMeta(cb) { if (typeof cb === 'function') metaSubs.push(cb); }
  function updateMediaSession(path, tags, hasCover) {
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
    const d = audio.duration;
    if (!isFinite(d) || d <= 0) return 0;
    return Math.max(0, Math.min(100, (audio.currentTime || 0) / d * 100));
  }
  function clipCss(p) { return 'inset(0 ' + (100 - p).toFixed(2) + '% 0 0)'; }
  // 同步“已播放段”裁剪：播放条 + 列表行内波形
  function setPct(p) {
    p = Math.max(0, Math.min(100, Number(p) || 0));
    if (waveHi) waveHi.style.clipPath = clipCss(p);
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
    if (!path) return;
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
    setToggle(false);
    setCover('');
    paintButtons('');
  }
  async function open(path, startRatio) {
    if (!path) throw new Error('空路径');
    const ratio = Math.max(0, Math.min(0.999, Number(startRatio) || 0));
    cur = path;
    titleEl.textContent = Utils.basename(path);
    titleEl.title = path;
    if (metaEl) metaEl.textContent = '';
    curInfo = {title: Utils.basename(path), artist: '', composer: '', album: ''};
    notifyMeta();
    applyMeta(path);
    setCover(path);
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
  // 按横向比例跳转（整理页点击行/磁贴一步到位）
  function seekRatio(r) {
    const d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    const t = Math.max(0, Math.min(1, Number(r) || 0)) * d;
    audio.currentTime = t;
    seek.value = String(t);
    curEl.textContent = fmt(t);
    setPct(d > 0 ? t / d * 100 : 0);
    if (audio.paused) audio.play().catch(() => {});
  }
  function toggle() {
    if (!cur) return;
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
    if (document.hidden) { wasPlaying = !audio.paused && !!cur; return; }
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
    if (isFinite(t)) audio.currentTime = t;
    seeking = false;
  };
  seek.addEventListener('change', commitSeek);
  seek.addEventListener('pointerup', commitSeek);

  vol.addEventListener('input', () => { audio.volume = Number(vol.value); });
  btnToggle.addEventListener('click', toggle);
  document.getElementById('pb-ext').addEventListener('click', external);
  document.getElementById('pb-close').addEventListener('click', close);

  // 行内点击（含播放行按横向比例跳转）统一由 BrowseView.onRowClick → App.playRowClick 处理

  return {open, toggle, close, external, syncBar, paintRows, pct, seekRatio, onMeta,
          get current() { return cur; },
          get meta() { return curInfo ? Object.assign({}, curInfo) : null; },
          audio};
})();
