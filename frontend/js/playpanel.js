/* ---------------- 播放管理（播放列表 / 封面 / 频谱声谱 / 目录导航） ---------------- */
function createPlayPanel() {
  const tr = s => (typeof I18n !== 'undefined') ? I18n.t(s) : s;
  const fw = createFloatWin({
    winId: 'play-float', headId: 'pf-head', resizeId: 'pf-resize', minId: 'pf-min',
    minW: 280, minH: 320
  });
  const win = document.getElementById('play-float');
  const titleEl = document.getElementById('pf-title');
  const subEl = document.getElementById('pf-sub');
  const trackEl = document.getElementById('pf-track');   // 顶部不再展示文件名（可为空）
  const coverBox = document.getElementById('pf-cover');
  const coverImg = document.getElementById('pf-cover-img');
  const bgEl = document.getElementById('pf-bg');
  const qToggle = document.getElementById('pf-q-toggle');
  const qTools = document.getElementById('pf-queue-tools');
  const favBar = document.getElementById('pf-fav-bar');
  const seek = document.getElementById('pf-seek');
  const curEl = document.getElementById('pf-cur');
  const durEl = document.getElementById('pf-dur');
  const playBtn = document.getElementById('pf-play');
  const modeBtn = document.getElementById('pf-mode');
  const waveBox = document.getElementById('pf-wave');
  const waveBase = document.getElementById('pf-wave-base');
  const waveHi = document.getElementById('pf-wave-hi');
  const qEl = document.getElementById('pf-queue');
  const qCount = document.getElementById('pf-qcount');
  const qView = document.getElementById('pf-qview');
  const sfSec = document.getElementById('pf-sf-sec');
  const sfToggle = document.getElementById('pf-sf-toggle');
  const sfBody = document.getElementById('pf-sf-body');
  const sfHost = document.getElementById('pf-sf-host');
  const sfMeta = document.getElementById('pf-sf-meta');
  const idleGuard = document.getElementById('pf-idle-guard');
  if (!win) return fw;

  const MODE_LABEL = {order: '顺序', all: '列表循环', one: '单曲循环', shuffle: '随机'};
  let timer = 0, seeking = false;
  let coverPath = '', coverSrc = '', coverFailed = '', coverFolderTried = false;
  let queueCollapsed = Store.get('ac3_play_queue_collapsed', false) === true;
  let sfCollapsed = Store.get('ac3_play_sf_collapsed', false) === true;
  let favHold = null, favHoldEl = null, favHoldStart = null, suppressFavClickUntil = 0;
  let idleTimer = 0, idleDimmed = false, lastPlaying = false, wakeSuppressUntil = 0;
  let queueView = 'browse';
  let albumSeq = 0, albumCachePath = '', albumCacheData = null;

  function cssUrl(url) {
    return 'url("' + String(url || '').replace(/"/g, '%22').replace(/\)/g, '%29') + '")';
  }

  /* 封面背景：只画一整张，不复制 extra <img>；失败时回到纯色渐变。 */
  function setCoverBackground(url) {
    if (!bgEl) return;
    if (url) {
      bgEl.style.backgroundImage = cssUrl(url);
      win.classList.add('has-cover');
    } else {
      bgEl.style.backgroundImage = '';
      win.classList.remove('has-cover');
    }
  }

  function paintQueueState() {
    if (!qToggle) return;
    win.classList.toggle('queue-collapsed', queueCollapsed);
    qToggle.setAttribute('aria-expanded', queueCollapsed ? 'false' : 'true');
    qToggle.title = tr(queueCollapsed ? '展开播放列表' : '收起播放列表');
    const label = qToggle.querySelector('.pf-qtitle');
    if (label) label.textContent = tr('播放列表');
    if (qTools) qTools.classList.toggle('hidden', queueCollapsed);
  }

  function paintSfState() {
    if (!sfSec) return;
    sfSec.classList.toggle('collapsed', sfCollapsed);
    sfToggle.setAttribute('aria-expanded', sfCollapsed ? 'false' : 'true');
    sfToggle.title = tr(sfCollapsed ? '展开声谱/频谱' : '收起声谱/频谱');
    const caret = sfToggle.querySelector('.pf-sf-caret');
    if (caret) caret.style.transform = sfCollapsed ? 'rotate(180deg)' : '';
    // 频谱只在播放列表收起后有空间显示；这里同步把真实频谱模块挂进来/放回去。
    try {
      // 浮窗里没有工作台画布，播放列表和声谱要同时可见；普通模式仍然
      // 只在列表收起时给声谱腾空间。
      const active = (queueCollapsed || window.__AC2_FLOAT_MODE) && !sfCollapsed
        && !win.classList.contains('hidden');
      win.classList.toggle('pf-sf-live', active);
      if (active && typeof Spectrum !== 'undefined' && Spectrum.setEmbedded) {
        Spectrum.setEmbedded(true, sfHost);
      } else if (typeof Spectrum !== 'undefined' && Spectrum.setEmbedded) {
        Spectrum.setEmbedded(false);
      }
    } catch (_) {}
  }

  /* 外部入口（起播自动展开）用：收起列表、展开声谱区，并指定模式 */
  function showSpectrum(mode) {
    if (sfCollapsed) { sfCollapsed = false; Store.set('ac3_play_sf_collapsed', false); }
    if (!queueCollapsed) { queueCollapsed = true; Store.set('ac3_play_queue_collapsed', true); }
    paintQueueState();
    paintSfState();
    if (mode && typeof Spectrum !== 'undefined' && Spectrum.setMode) {
      try { Spectrum.setMode(mode); } catch (_) {}
    }
    setModeButtonState();
  }

  /* 播放开始后 10 秒无操作：整个播放管理降到 10% 并锁住；
     点一下/滑一下只负责唤醒，不触发下面的按钮。频谱声谱展开时
     内部的 canvas 不受影响（仍是默认 50% 透明度）。 */
  const IDLE_MS = 10000;
  function clearIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
  }
  function armIdleTimer() {
    clearIdleTimer();
    if (!Player.isPlaying() || win.classList.contains('hidden')) return;
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      if (!Player.isPlaying() || win.classList.contains('hidden')) return;
      idleDimmed = true;
      win.classList.add('pf-idle-dim');
      /* 淡出后整块界面透明，只留谱面数据：连坐标轴和网格一起收掉 */
      try { if (typeof Spectrum !== 'undefined' && Spectrum.setBare) Spectrum.setBare(true); } catch (_) {}
    }, IDLE_MS);
  }
  function wakeFromIdle() {
    if (!idleDimmed) return;
    idleDimmed = false;
    win.classList.remove('pf-idle-dim');
    try { if (typeof Spectrum !== 'undefined' && Spectrum.setBare) Spectrum.setBare(false); } catch (_) {}
    wakeSuppressUntil = Date.now() + 400;
    armIdleTimer();
  }

  function setModeButtonState() {
    const mode = (typeof Spectrum !== 'undefined' && Spectrum.mode) ? Spectrum.mode : 'spectrum';
    document.querySelectorAll('#pf-sf-sec .pf-sf-mode').forEach(b => {
      b.classList.toggle('active', b.dataset.sfMode === mode);
    });
    if (sfMeta) sfMeta.textContent = tr('长按调整');
  }

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function renderMeta() {
    const m = Player.meta || {title: tr('未在播放'), artist: '', album: ''};
    const rawTitle = m.title || Utils.basename(Player.current) || '未在播放';
    titleEl.textContent = (rawTitle === '未在播放') ? tr('未在播放') : rawTitle;
    const sub = [m.artist, m.composer, m.album].filter(Boolean).join(' · ');
    subEl.textContent = sub || (Player.current ? '' : tr('从文件浏览里点一首开始'));
    if (trackEl) trackEl.textContent = Player.current ? Utils.basename(Player.current) : tr('未在播放');
    const p = Player.current || '';
    if (p && p.indexOf('dav:') !== 0) {
      if (p !== coverPath && p !== coverFailed) {
        coverPath = p;
        coverFailed = '';
        coverFolderTried = false;
        coverSrc = Api.coverUrl(p);
        coverBox.classList.remove('on');
        coverImg.src = coverSrc;
        setCoverBackground(coverSrc);
      }
    } else {
      coverPath = '';
      coverSrc = '';
      coverFailed = '';
      coverImg.removeAttribute('src');
      coverBox.classList.remove('on');
      setCoverBackground('');
    }
  }

  /* 停止状态：直接显示当前目录的文件夹与音频。
     文件夹/音频都在这里完成一级操作，不再弹独立的目录选择器。 */
  function renderBrowseQueue() {
    const dirs = (typeof App !== 'undefined' && App.directories) ? App.directories() : [];
    const audios = (typeof App !== 'undefined' && App.playbackQueueList) ? App.playbackQueueList() : [];
    qCount.textContent = dirs.length + ' ' + tr('个文件夹') + ' · ' + audios.length + ' ' + tr('首音频');
    let html = '';
    html += dirs.map(d => {
      const p = d.path || '';
      return '<div class="pf-q pf-qdir" data-dir="' + Utils.escapeHtml(p) + '" title="' + Utils.escapeHtml(p) + '">' +
        '<span class="pf-q-ico">📁</span>' +
        '<span class="pf-q-name">' + Utils.escapeHtml(d.name || Utils.basename(p)) + '</span></div>';
    }).join('');
    html += audios.map((f, i) => {
      const p = f.path || '';
      return '<div class="pf-q' + (p === Player.current ? ' on' : '') + '" data-i="' + i + '" data-path="' + Utils.escapeHtml(p) + '" title="' + Utils.escapeHtml(p) + '">' +
        '<span class="pf-q-ico">' + (p === Player.current ? '▶' : '♪') + '</span>' +
        '<span class="pf-q-name">' + Utils.escapeHtml(Utils.basename(p)) + '</span></div>';
    }).join('');
    if (!html) html = '<div class="detail-empty">' + Utils.escapeHtml(tr('当前目录没有文件夹或音频')) + '</div>';
    qEl.innerHTML = html;
    qEl.dataset.view = 'browse';
    qEl.dataset.cur = '';
  }

  /* 播放/暂停状态：维持当前音频队列，不混入文件夹。 */
  function renderAudioQueue() {
    const list = (typeof App !== 'undefined' && App.playbackQueueList) ? App.playbackQueueList() : [];
    qCount.textContent = list.length + ' ' + tr('首音频');
    if (!list.length) {
      qEl.innerHTML = '<div class="detail-empty">' + Utils.escapeHtml(tr('播放列表暂无音频')) + '</div>';
      qEl.dataset.view = 'queue';
      return;
    }
    // 原生队列的当前曲目是 local:/...，比较时去掉前缀
    const cur = String(Player.current || '').replace(/^local:/, '');
    // 浮窗里点列表 = 跳原生队列下标，不重建队列
    const nativeQueue = !!(window.__AC2_FLOAT_MODE && Player.queueList && Player.queueList().length);
    qEl.innerHTML = list.map((f, i) => {
      const p = f.path || '';
      return '<div class="pf-q' + (p === cur ? ' on' : '') + '" data-i="' + i + '"'
        + (nativeQueue ? ' data-qi="' + i + '"' : '')
        + ' data-path="' + Utils.escapeHtml(p) + '" title="' + Utils.escapeHtml(p) + '">' +
        '<span class="pf-q-ico">' + (p === cur ? '▶' : '♪') + '</span>' +
        '<span class="pf-q-name">' + Utils.escapeHtml(Utils.basename(p)) + '</span></div>';
    }).join('');
    qEl.dataset.view = 'queue';
  }

  /* 专辑页：读取当前曲目所属专辑；曲库未索引时后端回退到同目录音频。
     播放列表不再作为页签，专辑页承担“当前播放上下文”的展示。 */
  function renderAlbumQueue() {
    const path = Player.current || '';
    const seq = ++albumSeq;
    if (!path) {
      qEl.dataset.view = 'album';
      qCount.textContent = '未在播放';
      qEl.innerHTML = '<div class="detail-empty">' + Utils.escapeHtml(tr('播放一首歌后，这里显示它所属的专辑')) + '</div>';
      albumCachePath = '';
      albumCacheData = null;
      return;
    }
    if (albumCachePath === path && albumCacheData) {
      paintAlbumData(albumCacheData, path);
      return;
    }
    qEl.dataset.view = 'album';
    qCount.textContent = '读取专辑…';
    qEl.innerHTML = '<div class="detail-empty">读取专辑…</div>';
    Api.libraryAlbum(path).then(d => {
      if (seq !== albumSeq || Player.current !== path) return;
      if (!d || !d.ok) {
        qCount.textContent = '未在曲库';
        qEl.innerHTML = '<div class="detail-empty">' + Utils.escapeHtml(tr('当前曲目不在曲库中')) +
          '<br><span style="font-size:10px">' + Utils.escapeHtml((d && d.error) || '') + '</span></div>';
        return;
      }
      albumCachePath = path;
      albumCacheData = d;
      paintAlbumData(d, path);
    }).catch(e => {
      if (seq !== albumSeq) return;
      qCount.textContent = '读取失败';
      qEl.innerHTML = '<div class="detail-empty" style="color:var(--err)">' +
        Utils.escapeHtml('专辑读取失败：' + (e.message || e)) + '</div>';
    });
  }

  function paintAlbumData(d, path) {
    const tracks = d.tracks || [];
    const cur = String((typeof Player !== 'undefined' && Player.current) || '').replace(/^local:/, '');
    const album = d.album || tr('未命名专辑');
    const by = d.artist || '';
    const side = [by, d.year || '', tracks.length + ' ' + tr('首')].filter(Boolean).join(' · ');
    qCount.textContent = tracks.length + ' ' + tr('首') + (d.indexed === false ? ' · ' + tr('目录回退') : '');
    let html = '<div class="pf-album-head"><b>' + Utils.escapeHtml(album) + '</b><span>' +
      Utils.escapeHtml(side) + '</span></div>';
    html += tracks.map((t, i) => {
      const p = t.path || '';
      const on = String(p).replace(/^local:/, '') === cur;
      const no = String(t.track || '').split('/')[0].trim();
      return '<div class="pf-q' + (on ? ' on' : '') + '" data-i="' + i + '" data-path="' +
        Utils.escapeHtml(p) + '" title="' + Utils.escapeHtml(p) + '">' +
        '<span class="pf-q-ico">' + (on ? '▶' : (no || '♪')) + '</span>' +
        '<span class="pf-q-name">' + Utils.escapeHtml(t.title || t.name) + '</span>' +
        (t.duration ? '<span class="pf-q-time">' + fmt(t.duration) + '</span>' : '') +
        '</div>';
    }).join('');
    if (!tracks.length) html = '<div class="detail-empty">' + Utils.escapeHtml(tr('这张专辑没有音频')) + '</div>';
    qEl.innerHTML = html;
    qEl.dataset.view = 'album';
  }

  function paintQueueView() {
    if (!qView) return;
    qView.querySelectorAll('[data-qview]').forEach(b => {
      const on = b.dataset.qview === queueView;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setQueueView(view) {
    queueView = view === 'album' ? 'album' : 'browse';
    if (queueView === 'album') { albumCachePath = ''; albumCacheData = null; }
    paintQueueView();
    renderQueue();
  }

  function renderQueue() {
    if (queueView === 'browse') renderBrowseQueue();
    else renderAlbumQueue();
  }

  /* 同步文件浏览的目录收藏：+ 收藏当前目录，点收藏切目录，长按收藏删除。 */
  function renderFavorites() {
    if (!favBar) return;
    const list = (typeof App !== 'undefined' && App.favoriteList) ? App.favoriteList() : [];
    const cur = (typeof App !== 'undefined' && App.path) ? App.path : '';
    favBar.innerHTML =
      '<button type="button" class="pf-fav-add" id="pf-fav-add" title="' + Utils.escapeHtml(tr('收藏当前目录')) + '">+</button>' +
      '<div class="pf-fav-scroll">' +
      list.map((p, i) => '<button type="button" class="pf-fav-chip' + (p === cur ? ' active' : '') +
        '" data-fav="' + i + '" title="' + Utils.escapeHtml(p) + '">' +
        '<b>' + Utils.escapeHtml(Utils.basename(p) || p) + '</b></button>').join('') +
      '</div>';
  }

  async function goParent() {
    if (queueView === 'album') { setQueueView('browse'); return; }
    const p = (typeof App !== 'undefined' && App.currentParent) ? App.currentParent() : '';
    if (!p) { Utils.toast(tr('已在最上层'), 'warn'); return; }
    queueView = 'browse';
    paintQueueView();
    try { await App.browse(p); } catch (e) { Utils.toast('打开上级目录失败: ' + (e && e.message || e), 'err'); }
    renderQueue();
  }

  async function openDir(path) {
    if (!path) return;
    queueView = 'browse';
    paintQueueView();
    try {
      await App.browse(path);
      renderQueue();
    } catch (e) {
      Utils.toast('打开目录失败: ' + (e && e.message || e), 'err');
    }
  }

  let wavePath = '';

  async function setWave(path) {
    wavePath = path || '';
    waveBase.style.backgroundImage = '';
    waveHi.style.backgroundImage = '';
    if (!path) { waveBox.classList.add('time-only'); return; }
    if (path.indexOf('dav:') === 0) { waveBox.classList.add('time-only'); return; }
    waveBox.classList.remove('time-only');
    let url = '';
    try { url = await Wave.get(path); } catch (_) { url = ''; }
    if (!url || wavePath !== path) return;
    const css = 'url("' + url + '")';
    waveBase.style.backgroundImage = css;
    waveHi.style.backgroundImage = css;
  }

  function renderState() {
    const d = Player.duration(), p = Player.position();
    const curPath = Player.current || '';
    if (curPath !== wavePath) setWave(curPath);
    if (d > 0) { durEl.textContent = fmt(d); seek.max = String(d); }
    if (!seeking) { seek.value = String(Math.min(p, d || p)); curEl.textContent = fmt(p); }
    const pct = d > 0 ? Math.max(0, Math.min(100, p / d * 100)) : 0;
    waveBox.style.setProperty('--pf-pct', pct + '%');
    waveHi.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
    const on = Player.isPlaying();
    playBtn.innerHTML = on
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,3 20,12 6,21"/></svg>';
    modeBtn.textContent = tr(MODE_LABEL[(App.playMode && App.playMode()) || 'order'] || '顺序');
    // 当前目录变了 / 当前曲目变了 → 队列高亮跟着走
    const cur = Player.current;
    if (qEl.dataset.cur !== (cur || '')) {
      qEl.dataset.cur = cur || '';
      renderQueue();
    }
  }

  function tick() {
    if (win.classList.contains('hidden')) return;
    // 播放/暂停显示音频队列；停止显示当前目录的文件夹 + 音频。
    // 目录、当前曲目或队列变化都要重画。
    const active = !!Player.current;
    if (!active && queueView !== 'browse') { queueView = 'browse'; paintQueueView(); }
    const path = (typeof App !== 'undefined' && App.path) ? App.path : '';
    const list = (typeof App !== 'undefined' && App.playbackQueueList) ? App.playbackQueueList() : [];
    const dirs = (typeof App !== 'undefined' && App.directories) ? App.directories() : [];
    const sig = queueView === 'album'
      ? 'a|' + (Player.current || '')
      : 'b|' + path + '|' + dirs.map(d => d.path || '').join('|') + '|' + list.map(f => f.path || '').join('|');
    if (qEl.dataset.sig !== sig) { qEl.dataset.sig = sig; renderQueue(); }
    renderState();
    const playing = Player.isPlaying();
    if (playing && !lastPlaying) armIdleTimer();
    if (!playing) { clearIdleTimer(); if (idleDimmed) wakeFromIdle(); }
    lastPlaying = playing;
  }

  coverImg.addEventListener('load', () => {
    coverBox.classList.add('on');
    if (coverSrc) win.classList.add('has-cover');
  });
  coverImg.addEventListener('error', () => {
    /* 单曲没有内嵌封面时，退一步用所在文件夹的封面（目录里的 cover.jpg
       或同目录第一首带封面的音频）。这样播放管理背景不会直接掉成黑色。 */
    if (coverPath && !coverFolderTried) {
      const dir = Utils.dirname(coverPath);
      if (dir && dir !== '/' && dir !== coverPath) {
        coverFolderTried = true;
        coverSrc = Api.folderCoverUrl(dir);
        coverImg.src = coverSrc;
        setCoverBackground(coverSrc);
        return;
      }
    }
    coverFailed = coverPath;
    coverImg.removeAttribute('src');
    coverBox.classList.remove('on');
    coverPath = '';
    coverSrc = '';
    setCoverBackground('');
  });
  /* 左上角封面已隐藏，元数据入口改到标题文字上。 */
  const openMeta = () => {
    const p = Player.current;
    if (!p) return;
    if (p.indexOf('dav:') === 0) { Utils.toast('WebDAV 文件暂不支持元数据详情', 'warn'); return; }
    if (typeof App !== 'undefined' && App.openMeta) App.openMeta(p);
  };
  if (titleEl) {
    titleEl.title = '点击查看元数据';
    titleEl.setAttribute('role', 'button');
    titleEl.setAttribute('tabindex', '0');
    titleEl.addEventListener('click', openMeta);
    titleEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMeta(); }
    });
  }
  if (coverBox) {
    coverBox.addEventListener('click', openMeta);
  }

  playBtn.addEventListener('click', () => {
    // 播放管理第一次打开时不一定已经选中过文件。以前这里直接 Player.toggle()，
    // cur 为空会立即 return，看起来就是“点播放没反应”。
    if (!Player.current) {
      const list = (typeof App !== 'undefined' && App.playbackQueueList) ? App.playbackQueueList() : [];
      if (!list.length) { Utils.toast(tr('播放列表暂无音频'), 'warn'); return; }
      PlayMgr.play(list[0].path, 0, {quiet: true});
      return;
    }
    Player.toggle();
  });
  document.getElementById('pf-prev').addEventListener('click', () => { if (App.playPrev) App.playPrev({quiet: true}); });
  document.getElementById('pf-next').addEventListener('click', () => { if (App.playNext) App.playNext(false, {quiet: true}); });
  document.getElementById('pf-stop').addEventListener('click', () => {
    try { Player.close(); } catch (_) {}
    queueView = 'browse';
    paintQueueView();
    renderQueue();
  });
  modeBtn.addEventListener('click', () => {
    if (App.cyclePlayMode) App.cyclePlayMode();
    renderState();
  });

  seek.addEventListener('input', () => {
    seeking = true;
    const d = Player.duration();
    curEl.textContent = fmt(Number(seek.value));
    seek.max = String(d || 0);
  });
  const commitSeek = () => {
    if (!seeking) return;
    seeking = false;
    const d = Player.duration();
    if (d > 0) Player.seekSec(Number(seek.value));
  };
  seek.addEventListener('change', commitSeek);
  seek.addEventListener('pointerup', commitSeek);

  if (qView) {
    qView.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('[data-qview]');
      if (!b) return;
      setQueueView(b.dataset.qview);
    });
  }
  if (qToggle) {
    qToggle.addEventListener('click', () => {
      queueCollapsed = !queueCollapsed;
      Store.set('ac3_play_queue_collapsed', queueCollapsed);
      paintQueueState();
      paintSfState();
    });
  }
  if (sfToggle) {
    sfToggle.addEventListener('click', () => {
      sfCollapsed = !sfCollapsed;
      Store.set('ac3_play_sf_collapsed', sfCollapsed);
      paintSfState();
      setModeButtonState();
    });
  }
  document.querySelectorAll('#pf-sf-sec .pf-sf-mode').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      try { if (typeof Spectrum !== 'undefined' && Spectrum.setMode) Spectrum.setMode(b.dataset.sfMode); } catch (_) {}
      setModeButtonState();
    });
  });

  /* 频谱/声谱展开时，在画布上左右滑切换两种模式；长按配置仍归 Spectrum 自己处理。 */
  let sfSwipe = null;
  sfBody.addEventListener('pointerdown', e => {
    if (Date.now() < wakeSuppressUntil) return;
    if (e.target.closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    sfSwipe = {id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, captured: false};
    // 这里也不能立刻捕获：否则 Spectrum 的长按 pointerup 被重定向，松开后还会弹配置。
  }, {passive: true});
  sfBody.addEventListener('pointermove', e => {
    if (!sfSwipe || sfSwipe.id !== e.pointerId) return;
    const dx = e.clientX - sfSwipe.x, dy = e.clientY - sfSwipe.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) sfSwipe.moved = true;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.35) {
      e.preventDefault();
      if (!sfSwipe.captured) {
        sfSwipe.captured = true;
        try { sfBody.setPointerCapture(e.pointerId); } catch (_) {}
      }
    }
  }, {passive: false});
  sfBody.addEventListener('pointerup', e => {
    if (!sfSwipe || sfSwipe.id !== e.pointerId) { sfSwipe = null; return; }
    const dx = e.clientX - sfSwipe.x, dy = e.clientY - sfSwipe.y;
    sfSwipe = null;
    if (Math.abs(dx) <= 48 || Math.abs(dx) <= Math.abs(dy) * 1.35) return;
    const cur = (typeof Spectrum !== 'undefined' && Spectrum.mode) ? Spectrum.mode : 'spectrum';
    const next = cur === 'spectrum' ? 'waterfall' : 'spectrum';
    try { if (typeof Spectrum !== 'undefined' && Spectrum.setMode) Spectrum.setMode(next); } catch (_) {}
    setModeButtonState();
  });
  sfBody.addEventListener('pointercancel', () => { sfSwipe = null; });

  /* 播放列表左右滑动：两个方向都返回上一级；纵向仍然正常滚动。
     pointerdown 不能立刻 setPointerCapture，否则 click 会重定向到 #pf-queue，
     行内按钮就永远点不中了；只在确认横向滑动后再捕获。 */
  let swipe = null, pressRow = null, suppressQueueClickUntil = 0;
  qEl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pressRow = e.target.closest('.pf-q');
    swipe = {id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, captured: false};
  }, {passive: true});
  qEl.addEventListener('pointermove', e => {
    if (!swipe || swipe.id !== e.pointerId) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) swipe.moved = true;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.35) {
      e.preventDefault();
      if (!swipe.captured) {
        swipe.captured = true;
        try { qEl.setPointerCapture(e.pointerId); } catch (_) {}
      }
    }
  }, {passive: false});
  qEl.addEventListener('pointerup', e => {
    if (!swipe || swipe.id !== e.pointerId) { swipe = null; return; }
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    const done = swipe.moved || Math.abs(dx) > 56;
    swipe = null;
    if (!done || Math.abs(dx) <= 56 || Math.abs(dx) <= Math.abs(dy) * 1.35) return;
    pressRow = null;
    suppressQueueClickUntil = Date.now() + 450;
    goParent();
  });
  qEl.addEventListener('pointercancel', () => { swipe = null; pressRow = null; });
  qEl.addEventListener('click', e => {
    if (Date.now() < suppressQueueClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
    const row = e.target.closest('.pf-q') || pressRow;
    pressRow = null;
    if (!row) return;
    if (row.dataset.dir) { openDir(row.dataset.dir); return; }
    if (row.dataset.qi) { Player.playQueueIndex(Number(row.dataset.qi)); return; }
    if (row.dataset.path) PlayMgr.play(row.dataset.path, 0, {quiet: true});
  }, true);

  if (favBar) {
    favBar.addEventListener('click', e => {
      if (Date.now() < suppressFavClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.target.closest('#pf-fav-add')) {
        if (typeof App !== 'undefined' && App.addFavCurrent) App.addFavCurrent();
        return;
      }
      const chip = e.target.closest('.pf-fav-chip');
      if (chip) {
        const p = (App.favoriteList ? App.favoriteList() : [])[Number(chip.dataset.fav)];
        if (p) openDir(p);
      }
    }, true);
    favBar.addEventListener('pointerdown', e => {
      const chip = e.target.closest('.pf-fav-chip[data-fav]');
      if (!chip) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      favHoldStart = {x: e.clientX, y: e.clientY};
      favHoldEl = chip;
      clearTimeout(favHold);
      favHold = setTimeout(() => {
        favHold = null;
        if (!favHoldStart || !favHoldEl) return;
        suppressFavClickUntil = Date.now() + 500;
        const i = Number(favHoldEl.dataset.fav);
        if (typeof App !== 'undefined' && App.removeFavorite) App.removeFavorite(i);
        try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) {}
      }, 500);
    });
    favBar.addEventListener('pointermove', e => {
      if (!favHoldStart) return;
      if (Math.abs(e.clientX - favHoldStart.x) > 10 || Math.abs(e.clientY - favHoldStart.y) > 10) {
        clearTimeout(favHold); favHold = null; favHoldStart = null; favHoldEl = null;
      }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => favBar.addEventListener(t, () => {
      clearTimeout(favHold); favHold = null; favHoldStart = null; favHoldEl = null;
    }));
    favBar.addEventListener('contextmenu', e => {
      if (e.target.closest('.pf-fav-chip')) e.preventDefault();
    });
  }

  Player.onMeta(() => { renderMeta(); renderState(); });

  /* 只有播放管理内部的第一次操作会重置 10 秒倒计时；如果是淡化锁定状态，
     任意一次点击/滑动都只负责唤醒，并吞掉本次 click，避免误触按钮。 */
  /* 只有播放管理内部的交互才唤醒/重置倒计时；其它模块的操作完全放行，
     不会打断淡出，也不会被吞事件。 */
  document.addEventListener('pointerdown', e => {
    if (!win.contains(e.target)) return;
    if (idleDimmed) {
      e.preventDefault();
      e.stopPropagation();
      wakeFromIdle();
      return;
    }
    armIdleTimer();
  }, true);
  document.addEventListener('keydown', e => {
    if (!win.contains(e.target)) return;
    if (idleDimmed) {
      e.preventDefault();
      e.stopPropagation();
      wakeFromIdle();
      return;
    }
    armIdleTimer();
  }, true);
  document.addEventListener('click', e => {
    if (Date.now() < wakeSuppressUntil && win.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  fw.onToggle(open => {
    /* 播放管理打开时，元数据浮窗不再重复展示封面（样式 body.play-open 负责） */
    try { document.body.classList.toggle('play-open', !!open); } catch (_) {}
    if (open) {
      renderMeta(); paintQueueView(); renderQueue(); renderFavorites(); renderState(); paintSfState();
      clearInterval(timer);
      timer = setInterval(tick, 500);
      armIdleTimer();
    } else {
      clearInterval(timer);
      timer = 0;
      clearIdleTimer();
      wakeFromIdle();
      try { if (typeof Spectrum !== 'undefined' && Spectrum.setEmbedded) Spectrum.setEmbedded(false); } catch (_) {}
    }
  });

  /* 浮窗版布局：播放列表常驻（可点选切歌）+ 内嵌声谱，
     不再走 showSpectrum()（那会把列表收起、只剩声谱）。 */
  function showFloatLayout() {
    queueCollapsed = false;
    sfCollapsed = false;
    if (Player.queueList && Player.queueList().length) queueView = 'album';
    // 不写 Store：浮窗和主页面共用同一个 localStorage，写这里会把主页面
    // 的“列表收起/声谱展开”偏好改掉，回到 App 就会自动弹出声谱。
    paintQueueState();
    paintSfState();
    if (typeof Spectrum !== 'undefined' && Spectrum.setMode) {
      try { Spectrum.setMode('waterfall'); } catch (_) {}
    }
    setModeButtonState();
  }
  if (window.__AC2_FLOAT_MODE) setTimeout(showFloatLayout, 300);

  document.addEventListener('ac2:queue-changed', () => {
    if (window.__AC2_FLOAT_MODE && Player.queueList && Player.queueList().length) {
      queueView = 'album';
      paintQueueView();
    }
    renderQueue();
  });
  document.addEventListener('ac2:fav-changed', renderFavorites);
  document.addEventListener('ac2:browse-changed', () => { renderQueue(); renderFavorites(); });

  paintQueueState();
  paintQueueView();
  paintSfState();
  setModeButtonState();
  renderMeta();
  renderQueue();
  renderFavorites();
  renderState();
  return Object.assign(fw, {
    showSpectrum,
    showFloatLayout,
    startLive: () => {
      renderMeta(); paintQueueView(); renderQueue(); renderFavorites(); renderState(); paintSfState();
      clearInterval(timer);
      timer = setInterval(tick, 500);
    },
    refresh: () => { renderMeta(); paintQueueView(); renderQueue(); renderFavorites(); renderState(); paintQueueState(); paintSfState(); setModeButtonState(); }
  });
}
