/* ---------------- 播放管理（当前目录播放控制 / 主流播放器布局） ---------------- */
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
  const seek = document.getElementById('pf-seek');
  const curEl = document.getElementById('pf-cur');
  const durEl = document.getElementById('pf-dur');
  const playBtn = document.getElementById('pf-play');
  const modeBtn = document.getElementById('pf-mode');
  const vol = document.getElementById('pf-vol');
  const volVal = document.getElementById('pf-vol-val');
  const volIco = document.getElementById('pf-vol-ico');
  const waveBox = document.getElementById('pf-wave');
  const waveBase = document.getElementById('pf-wave-base');
  const waveHi = document.getElementById('pf-wave-hi');
  const qEl = document.getElementById('pf-queue');
  const qCount = document.getElementById('pf-qcount');
  if (!win) return fw;

  const MODE_LABEL = {order: '顺序', all: '列表循环', one: '单曲循环', shuffle: '随机'};
  let timer = 0, seeking = false;
  let coverPath = '', coverSrc = '', coverFailed = '';
  let queueCollapsed = Store.get('ac3_play_queue_collapsed', false) === true;

  function cssUrl(url) {
    return 'url("' + String(url || '').replace(/"/g, '%22').replace(/\)/g, '%29') + '")';
  }

  /* 封面虚化背景：只画一整张，不复制 extra <img>；失败时回到纯色渐变。 */
  function setCoverBackground(url) {
    if (!bgEl) return;
    if (url) {
      // 只画封面本身；压暗交给 CSS ::after，避免在 JS 里再叠一层重渐变。
      bgEl.style.backgroundImage = cssUrl(url);
      win.classList.add('has-cover');
    } else {
      bgEl.style.backgroundImage = '';
      win.classList.remove('has-cover');
    }
  }

  function applyQueueState() {
    if (!qToggle) return;
    win.classList.toggle('queue-collapsed', queueCollapsed);
    qToggle.setAttribute('aria-expanded', queueCollapsed ? 'false' : 'true');
    qToggle.title = tr(queueCollapsed ? '展开播放列表' : '收起播放列表');
    const label = qToggle.querySelector('.pf-qtitle');
    if (label) label.textContent = tr('当前目录');
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
      qEl.innerHTML = '<div class="detail-empty">' + Utils.escapeHtml(tr('当前目录没有音频文件')) + '</div>';
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
    const v = Number(vol.value);
    volVal.textContent = Math.round(v * 100) + '%';
    volIco.textContent = v === 0 ? '🔇' : (v < 0.5 ? '🔉' : '🔊');
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
      if (!list.length) { Utils.toast('当前目录没有音频文件', 'warn'); return; }
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

  vol.addEventListener('input', () => {
    Player.setVolume(Number(vol.value));
    renderState();
  });

  if (qToggle) {
    qToggle.addEventListener('click', () => {
      queueCollapsed = !queueCollapsed;
      Store.set('ac3_play_queue_collapsed', queueCollapsed);
      applyQueueState();
    });
  }

  qEl.addEventListener('click', e => {
    const row = e.target.closest('.pf-q');
    if (!row) return;
    const list = (typeof App !== 'undefined' && App.playbackQueueList) ? App.playbackQueueList() : [];
    const it = list[Number(row.dataset.i)];
    if (it && it.path) PlayMgr.play(it.path);
  });

  Player.onMeta(() => { renderMeta(); renderState(); });

  fw.onToggle(open => {
    if (open) {
      renderMeta(); renderQueue(); renderState();
      clearInterval(timer);
      timer = setInterval(tick, 500);
    } else {
      clearInterval(timer);
      timer = 0;
    }
  });

  applyQueueState();
  renderMeta();
  renderQueue();
  renderState();
  return Object.assign(fw, {refresh: () => { renderMeta(); renderQueue(); renderState(); applyQueueState(); } });
}
