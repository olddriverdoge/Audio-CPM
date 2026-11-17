/* ---------------- 播放管理（当前目录播放控制 / 主流播放器布局） ---------------- */
function createPlayPanel() {
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

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function renderMeta() {
    const m = Player.meta || {title: '未在播放', artist: '', album: ''};
    titleEl.textContent = m.title || Utils.basename(Player.current) || '未在播放';
    const sub = [m.artist, m.album].filter(Boolean).join(' · ');
    subEl.textContent = sub || (Player.current ? '' : '从文件浏览里点一首开始');
    trackEl.textContent = Player.current ? Utils.basename(Player.current) : '未在播放';
    const p = Player.current || '';
    if (p && p.indexOf('dav:') !== 0) {
      coverImg.src = Api.coverUrl(p);
      coverBox.classList.add('on');
    } else {
      coverImg.removeAttribute('src');
      coverBox.classList.remove('on');
    }
  }

  function renderQueue() {
    const list = (typeof App !== 'undefined' && App.playbackQueueList) ? App.playbackQueueList() : [];
    qCount.textContent = list.length + ' 首';
    if (!list.length) {
      qEl.innerHTML = '<div class="detail-empty">当前目录没有音频文件</div>';
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
    waveHi.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
    playBtn.textContent = Player.isPlaying() ? '⏸' : '▶';
    modeBtn.textContent = MODE_LABEL[(App.playMode && App.playMode()) || 'order'] || '顺序';
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

  coverImg.addEventListener('load', () => coverBox.classList.add('on'));
  coverImg.addEventListener('error', () => { coverImg.removeAttribute('src'); coverBox.classList.remove('on'); });

  playBtn.addEventListener('click', () => Player.toggle());
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

  return Object.assign(fw, {refresh: () => { renderMeta(); renderQueue(); renderState(); } });
}
