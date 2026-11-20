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
  const trackEl = document.getElementById('pf-track');
  const coverBox = document.getElementById('pf-cover');
  const coverImg = document.getElementById('pf-cover-img');
  const bgEl = document.getElementById('pf-bg');
  const qToggle = document.getElementById('pf-q-toggle');
  const qUp = document.getElementById('pf-q-up');
  const qPick = document.getElementById('pf-q-pick');
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
  const dirPicker = document.getElementById('pf-dir-picker');
  const dirList = document.getElementById('pf-dir-list');
  const dirClose = document.getElementById('pf-dir-close');
  const sfSec = document.getElementById('pf-sf-sec');
  const sfToggle = document.getElementById('pf-sf-toggle');
  const sfBody = document.getElementById('pf-sf-body');
  const sfHost = document.getElementById('pf-sf-host');
  const sfMeta = document.getElementById('pf-sf-meta');
  if (!win) return fw;

  const MODE_LABEL = {order: '顺序', all: '列表循环', one: '单曲循环', shuffle: '随机'};
  let timer = 0, seeking = false;
  let coverPath = '', coverSrc = '', coverFailed = '';
  let queueCollapsed = Store.get('ac3_play_queue_collapsed', false) === true;
  let sfCollapsed = Store.get('ac3_play_sf_collapsed', false) === true;
  let favHold = null, favHoldEl = null, favHoldStart = null, suppressFavClickUntil = 0;

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
      const active = queueCollapsed && !sfCollapsed && !win.classList.contains('hidden');
      if (active && typeof Spectrum !== 'undefined' && Spectrum.setEmbedded) {
        Spectrum.setEmbedded(true, sfHost);
      } else if (typeof Spectrum !== 'undefined' && Spectrum.setEmbedded) {
        Spectrum.setEmbedded(false);
      }
    } catch (_) {}
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
    trackEl.textContent = Player.current ? Utils.basename(Player.current) : tr('未在播放');
    const p = Player.current || '';
    if (p && p.indexOf('dav:') !== 0) {
      if (p !== coverPath && p !== coverFailed) {
        coverPath = p;
        coverFailed = '';
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

  function renderQueue() {
    const list = (typeof App !== 'undefined' && App.playbackQueueList) ? App.playbackQueueList() : [];
    qCount.textContent = list.length + ' 首';
    if (!list.length) {
      qEl.innerHTML = '<div class="detail-empty">' + Utils.escapeHtml(tr('播放列表暂无音频')) + '</div>';
      return;
    }
    const cur = Player.current;
    qEl.innerHTML = list.map((f, i) => {
      const p = f.path || '';
      const label = Utils.basename(p);
      return '<div class="pf-q' + (p === cur ? ' on' : '') + '" data-i="' + i + '" title="' + Utils.escapeHtml(p) + '">' +
        '<span class="pf-q-ico">' + (p === cur ? '▶' : '♪') + '</span>' +
        '<span class="pf-q-name">' + Utils.escapeHtml(label) + '</span></div>';
    }).join('');
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

  function renderDirList() {
    if (!dirList) return;
    const dirs = (typeof App !== 'undefined' && App.directories) ? App.directories() : [];
    const parent = (typeof App !== 'undefined' && App.currentParent) ? App.currentParent() : '';
    let html = '';
    if (parent) {
      html += '<button type="button" class="pf-dir-row" data-dir="' + Utils.escapeHtml(parent) + '">' +
        '<span class="pf-dir-ico">⬆</span><span>.. ' + Utils.escapeHtml(tr('上级目录')) + '</span></button>';
    }
    html += dirs.map(d => '<button type="button" class="pf-dir-row" data-dir="' + Utils.escapeHtml(d.path || '') + '">' +
      '<span class="pf-dir-ico">📁</span><span>' + Utils.escapeHtml(d.name || Utils.basename(d.path)) + '</span></button>').join('');
    if (!html) html = '<div class="detail-empty">' + Utils.escapeHtml(tr('当前目录没有子目录')) + '</div>';
    dirList.innerHTML = html;
  }

  function openDirPicker(show) {
    if (!dirPicker) return;
    if (show) {
      renderDirList();
      dirPicker.classList.remove('hidden');
    } else {
      dirPicker.classList.add('hidden');
    }
  }

  async function goParent() {
    const p = (typeof App !== 'undefined' && App.currentParent) ? App.currentParent() : '';
    if (!p) { Utils.toast(tr('已在最上层'), 'warn'); return; }
    try { await App.browse(p); } catch (e) { Utils.toast('打开上级目录失败: ' + (e && e.message || e), 'err'); }
    renderQueue();
  }

  async function openDir(path) {
    if (!path) return;
    try {
      await App.browse(path);
      openDirPicker(false);
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
    // 换目录/换歌曲时队列结构变了 → 重画
    const list = (typeof App !== 'undefined' && App.playbackQueueList) ? App.playbackQueueList() : [];
    const sig = list.length + ':' + ((list[0] && list[0].path) || '') + ':' + ((list[list.length - 1] && list[list.length - 1].path) || '');
    if (qEl.dataset.sig !== sig) { qEl.dataset.sig = sig; renderQueue(); }
    renderState();
  }

  coverImg.addEventListener('load', () => {
    coverBox.classList.add('on');
    if (coverSrc) win.classList.add('has-cover');
  });
  coverImg.addEventListener('error', () => {
    coverFailed = coverPath;
    coverImg.removeAttribute('src');
    coverBox.classList.remove('on');
    coverPath = '';
    coverSrc = '';
    setCoverBackground('');
  });
  /* 播放管理封面也能进元数据：之前只有右下角 meta-fab 一个入口。 */
  if (coverBox) {
    coverBox.title = '点击查看元数据';
    coverBox.setAttribute('role', 'button');
    coverBox.setAttribute('tabindex', '0');
    const openMeta = () => {
      const p = Player.current;
      if (!p) return;
      if (p.indexOf('dav:') === 0) { Utils.toast('WebDAV 文件暂不支持元数据详情', 'warn'); return; }
      if (typeof App !== 'undefined' && App.openMeta) App.openMeta(p);
    };
    coverBox.addEventListener('click', openMeta);
    coverBox.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMeta(); }
    });
  }

  playBtn.addEventListener('click', () => {
    // 播放管理第一次打开时不一定已经选中过文件。以前这里直接 Player.toggle()，
    // cur 为空会立即 return，看起来就是“点播放没反应”。
    if (!Player.current) {
      const list = (typeof App !== 'undefined' && App.playbackQueueList) ? App.playbackQueueList() : [];
      if (!list.length) { Utils.toast(tr('播放列表暂无音频'), 'warn'); return; }
      PlayMgr.play(list[0].path);
      return;
    }
    Player.toggle();
  });
  document.getElementById('pf-prev').addEventListener('click', () => { if (App.playPrev) App.playPrev(); });
  document.getElementById('pf-next').addEventListener('click', () => { if (App.playNext) App.playNext(); });
  document.getElementById('pf-stop').addEventListener('click', () => {
    try { Player.close(); } catch (_) {}
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

  if (qToggle) {
    qToggle.addEventListener('click', () => {
      queueCollapsed = !queueCollapsed;
      Store.set('ac3_play_queue_collapsed', queueCollapsed);
      paintQueueState();
      paintSfState();
    });
  }
  if (qUp) qUp.addEventListener('click', goParent);
  if (qPick) qPick.addEventListener('click', () => openDirPicker(dirPicker && dirPicker.classList.contains('hidden')));
  if (dirClose) dirClose.addEventListener('click', () => openDirPicker(false));
  if (dirList) {
    dirList.addEventListener('click', e => {
      const row = e.target.closest('.pf-dir-row[data-dir]');
      if (row) openDir(row.dataset.dir);
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

  /* 播放列表左右滑动：右滑回上级，左滑打开目录选择；纵向仍然正常滚动。 */
  let swipe = null, suppressQueueClickUntil = 0;
  qEl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipe = {id: e.pointerId, x: e.clientX, y: e.clientY, moved: false};
    try { qEl.setPointerCapture(e.pointerId); } catch (_) {}
  }, {passive: true});
  qEl.addEventListener('pointermove', e => {
    if (!swipe || swipe.id !== e.pointerId) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) swipe.moved = true;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.35) e.preventDefault();
  }, {passive: false});
  qEl.addEventListener('pointerup', e => {
    if (!swipe || swipe.id !== e.pointerId) { swipe = null; return; }
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    const done = swipe.moved || Math.abs(dx) > 56;
    swipe = null;
    if (!done || Math.abs(dx) <= 56 || Math.abs(dx) <= Math.abs(dy) * 1.35) return;
    suppressQueueClickUntil = Date.now() + 450;
    if (dx > 0) goParent(); else openDirPicker(true);
  });
  qEl.addEventListener('pointercancel', () => { swipe = null; });
  qEl.addEventListener('click', e => {
    if (Date.now() < suppressQueueClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
    const row = e.target.closest('.pf-q');
    if (!row) return;
    const list = (typeof App !== 'undefined' && App.playbackQueueList) ? App.playbackQueueList() : [];
    const it = list[Number(row.dataset.i)];
    if (it && it.path) PlayMgr.play(it.path);
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

  fw.onToggle(open => {
    if (open) {
      renderMeta(); renderQueue(); renderFavorites(); renderState(); paintSfState();
      clearInterval(timer);
      timer = setInterval(tick, 500);
    } else {
      clearInterval(timer);
      timer = 0;
      try { if (typeof Spectrum !== 'undefined' && Spectrum.setEmbedded) Spectrum.setEmbedded(false); } catch (_) {}
    }
  });

  document.addEventListener('ac2:fav-changed', renderFavorites);
  document.addEventListener('ac2:browse-changed', () => { renderQueue(); renderFavorites(); });

  paintQueueState();
  paintSfState();
  setModeButtonState();
  renderMeta();
  renderQueue();
  renderFavorites();
  renderState();
  return Object.assign(fw, {
    refresh: () => { renderMeta(); renderQueue(); renderFavorites(); renderState(); paintQueueState(); paintSfState(); setModeButtonState(); }
  });
}
