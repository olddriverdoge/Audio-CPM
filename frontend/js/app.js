/* ---------------- App：单工作台 + 模块浮窗 ---------------- */
const App = (() => {
  let bv = null;            // 唯一的文件浏览视图（原两页合并）
  let metaFloat = null, tree = null, playPanel = null, audioPanel = null;
  let currentPath = '';
  let currentParent = '';
  let fwBrowse = null, fwTask = null, fwTree = null;
  const MODULE_REGISTRY = {};

  function viewMode() { return Store.get(K.viewMode, 'list') === 'grid' ? 'grid' : 'list'; }
  function gridSize() { return Number(Store.get(K.gridSize, 128)) || 128; }
  // 网格视图 → 显示底部播放条；列表视图 → 行内波形
  function isGridView() { return viewMode() === 'grid'; }

  function paintSel() {
    const n = bv ? bv.count() : 0;
    const el = document.getElementById('sel-info');
    if (el) el.textContent = n === 0 ? '未选择（将处理整个目录）' : '已选 ' + n + ' 个文件';
    const tools = document.getElementById('sel-tools');
    if (tools) tools.classList.toggle('hidden', n === 0);
    if (typeof MoveMgr !== 'undefined') MoveMgr.update();
  }
  function updateSelInfo() { paintSel(); }

  /* 路径面包屑：点某一段跳到该级；长按整行弹输入框编辑路径 */
  function editPath(box) {
    const cur = box.dataset.path || '/';
    const v = prompt('输入要跳转的路径：', cur);
    if (v === null) return;
    const p = String(v).trim();
    if (p && box._onJump) box._onJump(p);
  }
  function bindCrumbEdit(box) {
    if (box._crumbBound) return;
    box._crumbBound = true;
    let lp = null, sx = 0, sy = 0;
    const clear = () => { if (lp) { clearTimeout(lp); lp = null; } };
    box.addEventListener('pointerdown', e => {
      sx = e.clientX; sy = e.clientY;
      clear();
      lp = setTimeout(() => {
        lp = null;
        box._suppressUntil = Date.now() + 900;
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {}
        editPath(box);
      }, 550);
    });
    box.addEventListener('pointermove', e => {
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 8) clear();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => box.addEventListener(t, clear));
    box.addEventListener('click', e => {
      if (Date.now() < (box._suppressUntil || 0)) return;
      const a = e.target.closest('.crumb');
      if (!a) return;
      e.preventDefault();
      const p = a.dataset.crumb;
      if (p && box._onJump && p !== box.dataset.path) box._onJump(p);
    });
  }
  /* 路径引用：local:/sdcard/x、dav:nas/Music/x */
  function refParts(p) {
    const s = String(p || '');
    if (s.indexOf('dav:') === 0) {
      const body = s.slice(4);
      const i = body.indexOf('/');
      const source = i >= 0 ? body.slice(0, i) : body;
      const rest = i >= 0 ? body.slice(i) : '/';
      return {type: 'dav', source: source, rest: rest || '/'};
    }
    if (s.indexOf('local:') === 0) return {type: 'local', source: '', rest: s.slice(6) || '/'};
    return {type: 'local', source: '', rest: s || '/'};
  }
  function refPrefix(parts) { return parts.type === 'dav' ? ('dav:' + parts.source) : 'local:'; }
  function renderCrumbs(id, path, onJump) {
    const box = document.getElementById(id);
    if (!box) return;
    const esc = Utils.escapeHtml;
    const parts = refParts(path);
    const prefix = refPrefix(parts);
    const segs = String(parts.rest || '/').split('/').filter(Boolean);
    let acc = '';
    let html = '<a class="crumb" data-crumb="' + esc(prefix + '/') + '" title="/">/</a>';
    for (const part of segs) {
      acc += '/' + part;
      html += '<span class="crumb-sep">›</span><a class="crumb" data-crumb="' + esc(prefix + acc) +
        '" title="' + esc(prefix + acc) + '">' + esc(part) + '</a>';
    }
    box.innerHTML = html;
    box.dataset.path = path || '/';
    box._onJump = onJump;
    bindCrumbEdit(box);
  }

  function pushRecent(p) {
    try {
      let arr = Store.get(K.recent, []);
      if (!Array.isArray(arr)) arr = [];
      arr = arr.filter(x => x !== p);
      arr.unshift(p);
      Store.set(K.recent, arr.slice(0, 15));
    } catch (e) {}
  }

  const dirSeq = 0;
  let seqNow = 0;
  async function loadDir(path, opts) {
    if (!path) path = currentPath;
    const my = ++seqNow;
    try {
      const d = await Api.browse(path);
      if (my !== seqNow) return false;   // 后发起的跳转优先
      currentPath = d.path;
      currentParent = d.parent || '';
      Store.set(K.lastPath, d.path);
      renderCrumbs('pb1-crumbs', d.path, p => loadDir(p));
      const track = document.getElementById('browse-track');
      if (track) track.textContent = d.path;
      bv.setData(d);
      renderFavs();
      updateSelInfo();
      pushRecent(d.path);
      if (typeof Sources !== 'undefined') Sources.rememberPath(d.path);
      return true;
    } catch (e) {
      if (my !== seqNow) return false;
      Utils.log('err', '浏览失败: ' + e.message);
      Utils.toast('浏览失败: ' + e.message, 'err');
      return false;
    }
  }
  function browse(path) { return loadDir(path); }

  function viewLabel(m) { return m === 'grid' ? '网格' : '列表'; }
  function sizeLabel(sz) { return sz >= 192 ? 'L' : (sz >= 128 ? 'M' : 'S'); }
  function paintViewButtons() {
    const vb = document.getElementById('s1-view-btn');
    if (vb) vb.textContent = viewLabel(viewMode());
    const sb = document.getElementById('s1-size-btn');
    if (sb) {
      sb.textContent = sizeLabel(gridSize());
      sb.classList.toggle('hidden', viewMode() !== 'grid');
    }
  }
  function setViewMode(m) {
    if (m !== 'grid') m = 'list';
    Store.set(K.viewMode, m);
    if (bv) bv.setMode(m);
    paintViewButtons();
    Player.syncBar();
  }
  function cycleViewMode() { setViewMode(viewMode() === 'grid' ? 'list' : 'grid'); }
  function setGridSize(sz) {
    Store.set(K.gridSize, sz);
    paintViewButtons();
    if (bv) bv.render();
  }
  function cycleGridSize() {
    const sizes = [96, 128, 192];
    const i = sizes.indexOf(gridSize());
    setGridSize(sizes[(i + 1) % sizes.length]);
  }

  /* ---- 目标目录多标签 ---- */
  let treeRoots = [];
  let treeActive = 0;
  function treeBaseName(p) {
    const s = String(p || '').replace(/\/+$/, '');
    const i = s.lastIndexOf('/');
    return i > 0 ? s.slice(i + 1) : (s || '/');
  }
  function defaultRootUri() {
    const r = (typeof Sources !== 'undefined') ? Sources.currentRoot() : null;
    return r ? r.path : 'local:/sdcard';
  }
  function curSourceId() {
    return (typeof Sources !== 'undefined' && Sources.current) ? Sources.current : 'local';
  }
  function loadTreeRoots(fallback) {
    const per = Store.get('ac2_tree_roots_' + curSourceId(), null);
    const v = (Array.isArray(per) && per.length) ? per : Store.get(K.treeRoots, null);
    treeRoots = Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : [];
    if (!treeRoots.length) treeRoots = [fallback || defaultRootUri()];
    const n = Number(Store.get('ac2_tree_active_' + curSourceId(), Store.get(K.treeActive, 0))) || 0;
    treeActive = Math.max(0, Math.min(treeRoots.length - 1, n));
  }
  function saveTreeRoots() {
    Store.set(K.treeRoots, treeRoots);
    Store.set(K.treeActive, treeActive);
    Store.set('ac2_tree_roots_' + curSourceId(), treeRoots);
    Store.set('ac2_tree_active_' + curSourceId(), treeActive);
  }
  function renderTreeTabs() {
    const box = document.getElementById('tree-tabs');
    if (!box) return;
    box.innerHTML = treeRoots.map((p, i) =>
      '<button type="button" class="tree-tab' + (i === treeActive ? ' active' : '') +
      '" data-i="' + i + '" title="' + Utils.escapeHtml(p) + '">' +
      Utils.escapeHtml(treeBaseName(p)) + '</button>').join('') +
      '<button type="button" class="tree-tab tree-tab-add" id="tree-tab-add" title="新增目标目录标签">＋</button>';
    const track = document.getElementById('tree-track');
    if (track) track.textContent = treeRoots[treeActive] || '';
  }
  async function activateTreeRoot(i) {
    if (i < 0 || i >= treeRoots.length) return;
    treeActive = i;
    saveTreeRoots();
    renderTreeTabs();
    const p = treeRoots[i];
    const track = document.getElementById('tree-track');
    if (track) track.textContent = p;
    try {
      await tree.setRoot(p);
      Store.set(K.targetPath, p);
    } catch (e) {
      Utils.toast('目标目录读取失败: ' + e.message, 'err');
    }
  }

  /* ---- 文件浏览快捷入口（收藏当前目录） ---- */
  function favKey() { return 'ac2_favs_' + curSourceId(); }
  function favs() {
    const v = Store.get(favKey(), []);
    return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [];
  }
  function saveFavs(list) { Store.set(favKey(), list.slice(0, 12)); }
  function renderFavs() {
    const bar = document.getElementById('fav-bar');
    if (!bar) return;
    const list = favs();
    const cur = currentPath;
    bar.innerHTML = list.map((p, i) =>
      '<span class="fav-chip' + (p === cur ? ' on' : '') + '" data-fav="' + i + '" title="' +
      Utils.escapeHtml(p) + '"><b>' + Utils.escapeHtml(treeBaseName(p) || p) + '</b>' +
      '<i data-fav-del="' + i + '" title="移除">✕</i></span>').join('') +
      '<button type="button" class="fav-add" id="fav-add" title="收藏当前目录">＋收藏</button>';
  }
  function addFavCurrent() {
    const uri = currentPath;
    if (!uri) { Utils.toast('先打开一个目录', 'warn'); return; }
    const list = favs();
    if (list.indexOf(uri) >= 0) { Utils.toast('已在快捷入口里'); return; }
    list.push(uri);
    saveFavs(list);
    renderFavs();
    Utils.toast('已收藏：' + (treeBaseName(uri) || uri));
  }
  function bindFavs() {
    const bar = document.getElementById('fav-bar');
    if (!bar) return;
    bar.addEventListener('click', e => {
      const del = e.target.closest('[data-fav-del]');
      if (del) {
        e.stopPropagation();
        const list = favs();
        list.splice(Number(del.dataset.favDel), 1);
        saveFavs(list); renderFavs(); return;
      }
      if (e.target.closest('#fav-add')) { addFavCurrent(); return; }
      const chip = e.target.closest('.fav-chip');
      if (chip) {
        const p = favs()[Number(chip.dataset.fav)];
        if (p) loadDir(p).catch(err => Utils.toast('打开失败: ' + (err && err.message || err), 'err'));
      }
    });
  }

  /* 一键把当前浏览目录加进目标目录（与现有标签去重，直接切过去） */
  async function addTargetCurrent() {
    const uri = currentPath;
    if (!uri) { Utils.toast('先打开一个目录', 'warn'); return; }
    let i = treeRoots.indexOf(uri);
    if (i < 0) {
      treeRoots.push(uri);
      treeActive = treeRoots.length - 1;
      saveTreeRoots();
      renderTreeTabs();
      i = treeActive;
    }
    await activateTreeRoot(i);
    openModule('tree');
    Utils.toast('目标目录已指向当前路径');
  }

  /* 一次点击：开始播放并落到点击位置 */
  function playRowClick(path, e, rowEl) {
    if (!path) return;
    const box = rowEl ? (rowEl.querySelector('.row-wave') || rowEl) : null;
    const rect = box ? box.getBoundingClientRect() : null;
    const ratio = rect && rect.width > 0 ? Math.max(0, Math.min(0.999, (e.clientX - rect.left) / rect.width)) : 0;
    if (path === Player.current) { Player.seekRatio(ratio); return; }
    PlayMgr.play(path, ratio);
  }

  function refreshColumns() { if (bv) bv.render(); }

  function onPlayed(path) {
    if (bv) bv.onExternalPlayed(path);
    if (metaFloat) metaFloat.load(path);
    updateSelInfo();
    /* 内置播放器起播：自动展开声谱；网格视图再自动调出播放管理 */
    if (Player.current && Player.current === path) {
      const spWin = document.getElementById('spectrum-float');
      const wasClosed = spWin ? spWin.classList.contains('hidden') : false;
      openModule('spectrum');
      if (wasClosed && typeof Spectrum !== 'undefined' && Spectrum.setMode) {
        try { Spectrum.setMode('waterfall'); } catch (_) {}
      }
    }
  }

  /* ---- 播放模式（顺序 / 列表循环 / 单曲循环 / 随机） ---- */
  const AUDIO_EXT = /\.(flac|wav|aif|aiff|mp3|m4a|aac|ogg|opus|ape|wv|dsf|dff)$/i;
  const PLAY_MODES = ['order', 'all', 'one', 'shuffle'];
  function isAudioPath(p) { return AUDIO_EXT.test(String(p || '')); }
  function playbackList() {
    const arr = bv ? bv.visible() : [];
    return arr.filter(f => f && f.path && isAudioPath(f.path));
  }
  function hifiQueue(path) {
    const list = playbackList().filter(f => f.path && f.path.indexOf('dav:') !== 0);
    const i = list.findIndex(f => f.path === path);
    if (i < 0) return null;
    // 队列给得比可见列表更宽：随机/循环时原生队列要能接得住
    const from = Math.max(0, i - 40), to = Math.min(list.length, i + 120);
    const paths = list.slice(from, to).map(f => f.path);
    return {paths, index: i - from};
  }
  function playMode() {
    const m = Store.get(K.playMode, 'order');
    return PLAY_MODES.indexOf(m) >= 0 ? m : 'order';
  }
  function applyPlayMode() {
    if (!(typeof Api !== 'undefined' && Api.playbackMode)) return;
    const m = playMode();
    // ExoPlayer: 0=OFF 1=ALL 2=ONE
    const repeat = (m === 'one') ? 2 : ((m === 'all' || m === 'shuffle') ? 1 : 0);
    Api.playbackMode(repeat, m === 'shuffle').catch(() => {});
  }
  function cyclePlayMode() {
    const i = PLAY_MODES.indexOf(playMode());
    const m = PLAY_MODES[(i + 1) % PLAY_MODES.length];
    Store.set(K.playMode, m);
    applyPlayMode();
    Utils.toast('播放模式：' + ({order: '顺序', all: '列表循环', one: '单曲循环', shuffle: '随机'})[m]);
    return m;
  }
  function autoplayOn() { return playMode() !== 'order'; }
  function paintAutoplay() { /* 顶部按钮已下架，状态看播放管理浮窗 */ }
  function playNext(wrap) {
    if (playMode() === 'shuffle') return playRandom();
    const list = playbackList().filter(f => f && f.path);
    if (!list.length) return false;
    let i = list.findIndex(f => f.path === Player.current);
    if (i < 0) i = -1;
    const next = list[i + 1] || ((wrap || playMode() === 'all') ? list[0] : null);
    if (!next) { Utils.toast('已播放到列表末尾', 'warn'); return false; }
    PlayMgr.play(next.path, 0);
    return true;
  }
  function playPrev() {
    if (playMode() === 'shuffle') return playRandom();
    const list = playbackList().filter(f => f && f.path);
    if (!list.length) return false;
    let i = list.findIndex(f => f.path === Player.current);
    if (i <= 0) i = list.length;
    PlayMgr.play(list[i - 1].path, 0);
    return true;
  }
  function playRandom() {
    const list = playbackList().filter(f => f && f.path);
    if (!list.length) return false;
    if (list.length === 1) { PlayMgr.play(list[0].path, 0); return true; }
    let n = 0, pick = null;
    do { pick = list[Math.floor(Math.random() * list.length)]; n++; }
    while (pick.path === Player.current && n < 8);
    PlayMgr.play(pick.path, 0);
    return true;
  }
  function autoplayNext() {
    const m = playMode();
    if (m === 'one') { Player.replay(); return true; }
    if (m === 'shuffle') return playRandom();
    return playNext(m === 'all');
  }

  /* 输出格式按后端能力裁剪 */
  const FMT_CODEC = v => {
    const c = String(v || '').split('-')[0].toLowerCase();
    return c === 'aiff' ? 'aif' : c;
  };
  const UI_SCALE_MIN = 0.5, UI_SCALE_MAX = 3.0;
  const CANVAS_MIN = -4096, CANVAS_MAX = 4096;
  const CANVAS_PAN_KEY = 'ac3_canvas_pan';
  function canvasPan() {
    const c = window.AUDIOCPM_CANVAS;
    return {x: (c && Number(c.x)) || 0, y: (c && Number(c.y)) || 0};
  }
  function applyCanvasPan(x, y, persist) {
    const px = Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, Number(x) || 0));
    const py = Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, Number(y) || 0));
    document.documentElement.style.setProperty('--canvas-x', px + 'px');
    document.documentElement.style.setProperty('--canvas-y', py + 'px');
    window.AUDIOCPM_CANVAS = {x: px, y: py};
    if (persist) Store.set(CANVAS_PAN_KEY, {x: Math.round(px), y: Math.round(py)});
    return {x: px, y: py};
  }
  function setCanvasPan(x, y, persist) {
    const p = applyCanvasPan(x, y, persist);
    try { WinMgr.syncRects(); } catch (_) {}
    return p;
  }
  function applyUiScale(value) {
    let s = Number(value);
    if (!Number.isFinite(s)) s = 1;
    s = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, s));
    document.documentElement.style.setProperty('--ui-scale', String(s));
    window.AUDIOCPM_UI_SCALE = s;
    return s;
  }
  function setUiScale(value, persist) {
    const s = applyUiScale(value);
    if (persist) Store.set(K.uiScale, s);
    try { WinMgr.syncRects(); } catch (_) {}
    return s;
  }
  function previewUiScale(value) { return applyUiScale(value); }
  function commitUiScale(value) { return setUiScale(value, true); }
  function currentUiScale() { return Number(window.AUDIOCPM_UI_SCALE || 1); }

  /* 手形锁定：遮住 header 以下所有模块，禁止单指点击，只保留双指缩放 */
  function initHandLock() {
    const hand = document.getElementById('btn-hand');
    const lock = document.getElementById('ui-lock');
    const hdr = document.getElementById('app-hdr');
    if (!hand || !lock || !hdr) return;
    let locked = false, pinch = null, pan0 = null;
    function positionLock() {
      lock.style.top = Math.round(hdr.getBoundingClientRect().bottom) + 'px';
    }
    function dist(touches) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.max(1, Math.sqrt(dx * dx + dy * dy));
    }
    function commitCanvas() {
      const p = canvasPan();
      setCanvasPan(p.x, p.y, true);
    }
    function finishPinch(e) {
      if (pinch) {
        const s = currentUiScale();
        pinch = null;
        commitUiScale(s);
        commitCanvas();
      }
      if (pan0 && (!e || !e.touches || e.touches.length === 0)) {
        pan0 = null;
        commitCanvas();
      }
      if (e && e.cancelable) e.preventDefault();
    }
    function setLocked(on) {
      locked = !!on;
      hand.classList.toggle('on', locked);
      hand.setAttribute('aria-pressed', locked ? 'true' : 'false');
      hand.title = locked ? '整体缩放（已锁定，双指缩放 50%–300%）' : '整体缩放';
      const lbl = hand.querySelector('.b-lbl');
      if (lbl) lbl.textContent = '整体缩放';
      if (locked) {
        positionLock();
        lock.classList.remove('hidden');
        lock.setAttribute('aria-hidden', 'false');
        document.body.classList.add('ui-locked');
        Utils.toast('工作台已锁定：单指平移，双指缩放 50%–300%');
      } else {
        finishPinch(null);
        lock.classList.add('hidden');
        lock.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('ui-locked');
        Utils.toast('工作台已解锁');
      }
    }
    hand.addEventListener('click', () => setLocked(!locked));
    window.addEventListener('resize', () => { if (locked) positionLock(); });
    window.addEventListener('orientationchange', () => { if (locked) setTimeout(positionLock, 120); });
    lock.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        e.preventDefault();
        pinch = null;
        const p = canvasPan();
        pan0 = {x: e.touches[0].clientX, y: e.touches[0].clientY, cx: p.x, cy: p.y};
        return;
      }
      if (e.touches.length !== 2) { pinch = null; pan0 = null; return; }
      e.preventDefault();
      pan0 = null;
      const p = canvasPan();
      pinch = {d: dist(e.touches), scale: currentUiScale(), cx: p.x, cy: p.y,
               mx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
               my: (e.touches[0].clientY + e.touches[1].clientY) / 2};
    }, {passive: false});
    lock.addEventListener('touchmove', e => {
      if (pinch && e.touches.length >= 2) {
        e.preventDefault();
        const ratio = dist(e.touches) / pinch.d;
        const s = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, pinch.scale * ratio));
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        // 以双指中心为锚点缩放：中心下面的画布内容保持不动，实现局部放大。
        const ax = (pinch.mx - pinch.cx) / pinch.scale;
        const ay = (pinch.my - pinch.cy) / pinch.scale;
        previewUiScale(s);
        applyCanvasPan(mx - ax * s, my - ay * s, false);
        return;
      }
      if (pan0 && e.touches.length === 1) {
        e.preventDefault();
        applyCanvasPan(pan0.cx + (e.touches[0].clientX - pan0.x),
                       pan0.cy + (e.touches[0].clientY - pan0.y), false);
      }
    }, {passive: false});
    lock.addEventListener('touchend', finishPinch, {passive: false});
    lock.addEventListener('touchcancel', finishPinch, {passive: false});
  }

  async function applyCapabilities() {
    let caps = null;
    try { caps = await Api.caps(); } catch (_) { return; }
    window.AUDIOCPM_CAPS = caps;
    try { document.body.classList.toggle('app-mode', !!caps.android); } catch (_) {}
    if (caps.android) {
      const fs = document.getElementById('btn-fullscreen');
      if (fs) fs.remove();
    }
    const sel = document.getElementById('fmt-select');
    if (!sel) return;
    const allowed = new Set(caps.formats || []);
    for (const op of [...sel.querySelectorAll('option')]) {
      if (!allowed.has(FMT_CODEC(op.value))) op.remove();
    }
    for (const g of [...sel.querySelectorAll('optgroup')]) {
      if (!g.children.length) g.remove();
    }
    const convRadio = document.querySelector('input[name="task"][value="convert"]');
    if (!caps.ffmpeg) {
      sel.disabled = true;
      const op = document.createElement('option');
      op.value = '';
      op.textContent = '当前包不含 ffmpeg，转换不可用';
      sel.appendChild(op);
      if (convRadio) {
        convRadio.disabled = true;
        const alt = document.querySelector('input[name="task"][value="tags"]');
        if (alt) { alt.checked = true; alt.dispatchEvent(new Event('change')); }
      }
      Utils.log('warn', 'ffmpeg 不可用：' + (caps.error || caps.mode || ''));
    } else if (!sel.options.length) {
      sel.disabled = true;
    } else if (!sel.value) {
      sel.selectedIndex = 0;
    }
  }

  /* ---- 模块开关（modbar） ---- */
  function syncMods() {
    document.querySelectorAll('#module-menu [data-mod]').forEach(b => {
      const m = MODULE_REGISTRY[b.dataset.mod];
      if (!m) return;
      const win = document.getElementById(m.win);
      const on = win ? !win.classList.contains('hidden') : false;
      b.classList.toggle('on', on);
    });
    const hint = document.getElementById('scene-home');
    if (hint) {
      hint.style.display = '';
      if (typeof SceneStore !== 'undefined') { try { SceneStore.render(); } catch (_) {} }
    }
  }
  function openModules() {
    return Object.keys(MODULE_REGISTRY).filter(k => {
      const w = document.getElementById(MODULE_REGISTRY[k].win);
      return w && !w.classList.contains('hidden');
    });
  }
  function closeAllModules() {
    openModules().forEach(k => toggleModule(k));
  }
  function openModule(name) {
    const m = MODULE_REGISTRY[name];
    if (!m) return;
    const win = document.getElementById(m.win);
    if (!win) return;
    if (win.classList.contains('hidden')) toggleModule(name);
    try { WinMgr.raise(win); } catch (_) {}
  }
  function toggleModule(name) {
    const m = MODULE_REGISTRY[name];
    if (!m) return;
    const win = document.getElementById(m.win);
    if (!win) return;
    const open = !win.classList.contains('hidden');
    if (open) {
      if (m.fw) m.fw.close();
      else { const btn = document.getElementById(m.min); if (btn) btn.click(); }
    } else {
      if (m.fw) m.fw.open();
      else { const fab = document.getElementById(m.fab); if (fab) fab.click(); }
    }
    setTimeout(syncMods, 0);
  }
  function initMods() {
    fwBrowse = createFloatWin({
      winId: 'fw-browse', headId: 'fw-browse-head', resizeId: 'fw-browse-resize',
      minId: 'fw-browse-min', storeKey: 'ac3_win_browse',
      defW: Math.min(820, Math.max(320, window.innerWidth - 24)),
      defH: Math.min(560, Math.max(320, window.innerHeight - 190)),
      minW: 280, minH: 200,
      onOpen: () => { if (bv) bv.render(); paintViewButtons(); }
    });
    fwTask = createFloatWin({
      winId: 'fw-task', headId: 'fw-task-head', resizeId: 'fw-task-resize',
      minId: 'fw-task-min', storeKey: 'ac3_win_task',
      defW: Math.min(460, window.innerWidth - 24),
      defH: Math.min(500, window.innerHeight - 190),
      minW: 300, minH: 220,
      onOpen: () => { if (typeof TaskRunner !== 'undefined') TaskRunner.syncUI(); }
    });
    fwTree = createFloatWin({
      winId: 'fw-tree', headId: 'fw-tree-head', resizeId: 'fw-tree-resize',
      minId: 'fw-tree-min', storeKey: 'ac3_win_tree',
      defW: Math.min(420, window.innerWidth - 24),
      defH: Math.min(480, window.innerHeight - 190),
      minW: 260, minH: 200
    });

    MODULE_REGISTRY.browse = {win: 'fw-browse', fw: fwBrowse};
    MODULE_REGISTRY.task = {win: 'fw-task', fw: fwTask};
    MODULE_REGISTRY.tree = {win: 'fw-tree', fw: fwTree};
    if (typeof createPlayPanel === 'function') playPanel = createPlayPanel();
    MODULE_REGISTRY.play = {win: 'play-float', fw: playPanel};
    if (typeof createAudioPanel === 'function') audioPanel = createAudioPanel();
    MODULE_REGISTRY.audio = {win: 'audio-float', fw: audioPanel};
    MODULE_REGISTRY.meta = {win: 'meta-float', fab: 'meta-fab', min: 'mf-min'};
    MODULE_REGISTRY.spectrum = {win: 'spectrum-float', fab: 'sf-fab', min: 'sf-min'};
    MODULE_REGISTRY.log = {win: 'log-float', fab: 'log-fab', min: 'lf-min'};

    /* 右下角模块坞：＋ 展开纵向按钮，10 秒无操作收回 */
    const MODULE_LABEL = {
      browse: '文件浏览', task: '批处理', tree: '目标目录', play: '播放管理',
      audio: '音频输出', meta: '元数据', spectrum: '频谱/声谱', log: '日志'
    };
    const fab = document.getElementById('module-fab');
    const menu = document.getElementById('module-menu');
    if (menu) {
      menu.innerHTML = Object.keys(MODULE_REGISTRY).map(k =>
        '<button type="button" class="module-item" data-mod="' + k + '">' +
        (MODULE_LABEL[k] || k) + '</button>').join('');
    }
    let menuTimer = 0;
    function closeModuleMenu() {
      if (menu) menu.classList.add('hidden');
      if (fab) fab.classList.remove('on');
      clearTimeout(menuTimer); menuTimer = 0;
    }
    function bumpModuleMenu() {
      if (!menu || menu.classList.contains('hidden')) return;
      clearTimeout(menuTimer);
      menuTimer = setTimeout(closeModuleMenu, 10000);   // 10 秒不点模块按钮就收回
    }
    function openModuleMenu() {
      if (!menu) return;
      menu.classList.remove('hidden');
      if (fab) fab.classList.add('on');
      bumpModuleMenu();
    }
    if (fab) fab.addEventListener('click', () => {
      if (menu && !menu.classList.contains('hidden')) closeModuleMenu();
      else openModuleMenu();
    });
    if (menu) {
      menu.addEventListener('pointerdown', bumpModuleMenu);
      menu.addEventListener('click', e => {
        const b = e.target.closest('[data-mod]');
        if (!b) return;
        toggleModule(b.dataset.mod);
        closeModuleMenu();
      });
    }
    // 任何浮窗自己收起时（点它的 — 按钮）同步开关状态
    const obs = new MutationObserver(() => syncMods());
    Object.values(MODULE_REGISTRY).forEach(m => {
      const w = document.getElementById(m.win);
      if (w) obs.observe(w, {attributes: true, attributeFilter: ['class']});
    });
    syncMods();
    // 启动停在场景预设页：由卡片决定要摆哪几个模块
    setTimeout(syncMods, 0);
  }

  async function init() {
    if (typeof I18n !== 'undefined') await I18n.init();
    if (typeof Sources !== 'undefined') await Sources.refresh();
    await applyCapabilities();
    if (typeof Sources !== 'undefined') {
      Sources.init();
      Sources.onSelect(async root => {
        applyCaps(root);
        const want = Sources.pathFor(root);
        let ok = await browse(want);
        if (!ok && want !== root.path) ok = await browse(root.path);
        if (!ok) {
          Utils.toast('切换到「' + (root.name || root.id) + '」失败，已保留当前目录', 'err');
          return;
        }
        // 目标目录切到该源（后台加载，不阻塞浏览/播放/元数据）
        const savedRoots = Store.get('ac2_tree_roots_' + root.id, null);
        treeRoots = (Array.isArray(savedRoots) && savedRoots.length)
          ? savedRoots.filter(x => typeof x === 'string' && x.trim())
          : [root.path];
        const n = Number(Store.get('ac2_tree_active_' + root.id, 0)) || 0;
        treeActive = Math.max(0, Math.min(treeRoots.length - 1, n));
        saveTreeRoots();
        renderTreeTabs();
        activateTreeRoot(treeActive).catch(() => {});
        Utils.toast('已切换数据源: ' + (root.name || root.id));
      });
      applyCaps(Sources.currentRoot());
    }
    if (typeof Logs !== 'undefined') Logs.init();
    Layout.init();
    Settings.init();
    Columns.bindSheet();
    const columns1 = Columns.create(K.columns);
    bv = createBrowseView({
      container: document.getElementById('view1'),
      mode: viewMode(), gridSize: gridSize, folderOrder: 'first',
      onOpenDir: p => browse(p),
      onReload: () => browse(currentPath),
      columns: columns1,
      clickPlays: true, selectDirs: true,
      onRowClick: (path, e, rowEl) => playRowClick(path, e, rowEl),
      onCounts: () => {},
      onSelectionChange: updateSelInfo,
      onRender: () => { try { Player.paintRows(); } catch (_) {} }
    });
    tree = createTreeView({
      container: document.getElementById('tree'),
      onSelect: () => MoveMgr.update(),
      onTreeChanged: () => MoveMgr.update()
    });
    metaFloat = createMetaFloat();
    /* 元数据 / 频谱 / 日志：同样交给 WinMgr，标题拖动、双指缩放、点击置顶一致 */
    WinMgr.register({id: 'meta-float', win: 'meta-float', head: 'mf-head', resize: 'mf-resize', minW: 240, minH: 160});
    WinMgr.register({id: 'spectrum-float', win: 'spectrum-float', head: 'sf-head', resize: 'sf-resize', minW: 240, minH: 140});
    WinMgr.register({id: 'log-float', win: 'log-float', head: 'lf-head', resize: 'lf-resize', minW: 240, minH: 160});

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') Settings.close();
    });

    /* 头部按钮 */
    const s1v = document.getElementById('s1-view-btn');
    if (s1v) s1v.addEventListener('click', cycleViewMode);
    const s1sz = document.getElementById('s1-size-btn');
    if (s1sz) s1sz.addEventListener('click', cycleGridSize);
    const s1tg = document.getElementById('s1-target-btn');
    if (s1tg) s1tg.addEventListener('click', () => { addTargetCurrent().catch(e => Utils.toast('设置目标目录失败: ' + (e && e.message || e), 'err')); });

    /* 全屏（仅网页版；app 内已被剔除） */
    const fsBtn = document.getElementById('btn-fullscreen');
    if (fsBtn) {
      const can = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled ||
                     document.documentElement.requestFullscreen ||
                     document.documentElement.webkitRequestFullscreen);
      if (!can) {
        fsBtn.classList.add('hidden');
      } else {
        fsBtn.addEventListener('click', () => {
          const inFs = document.fullscreenElement || document.webkitFullscreenElement;
          if (inFs) {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit) exit.call(document).catch(() => {});
          } else {
            const el = document.documentElement;
            const req = el.requestFullscreen || el.webkitRequestFullscreen;
            if (req) Promise.resolve(req.call(el)).catch(() => Utils.toast('全屏被浏览器拒绝', 'warn'));
          }
        });
      }
    }

    paintViewButtons();

    /* 移动条 */
    const conflictSel = document.getElementById('mv-conflict');
    const savedConflict = Store.get(K.conflict, 'skip');
    conflictSel.value = ['skip', 'rename', 'overwrite'].indexOf(savedConflict) >= 0 ? savedConflict : 'skip';
    conflictSel.addEventListener('change', e => Store.set(K.conflict, e.target.value));
    document.getElementById('mv-btn').onclick = () => MoveMgr.doMove('move');
    document.getElementById('mv-copy').onclick = () => MoveMgr.doMove('copy');
    document.getElementById('mv-undo').onclick = () => MoveMgr.doUndo();

    TaskRunner.syncUI();
    await TaskRunner.loadTaskPresets();
    TaskRunner.init();

    MoveMgr.bind({
      getSources: () => (bv ? bv.selected() : []),
      getTarget: () => (tree ? tree.selected : ''),
      afterMove: async () => {
        await browse(currentPath);
        if (bv) bv.clearSelection();
        updateSelInfo();
      }
    });
    if (typeof Spectrum !== 'undefined') Spectrum.init();

    const savedPan = Store.get(CANVAS_PAN_KEY, null);
    applyCanvasPan(savedPan && savedPan.x, savedPan && savedPan.y, false);
    setUiScale(Store.get(K.uiScale, 1), false);
    initMods();
    initHandLock();
    if (typeof SceneStore !== 'undefined') SceneStore.init();
    applyPlayMode();

    /* 先加载浏览目录，目标目录树放后台（WebDAV 下不再拖住播放/元数据） */
    const last = Store.get(K.lastPath, '') || (await defaultRoot());
    await browse(last);
    if (typeof Sources !== 'undefined') Sources.syncPick(last);
    const curRoot = (typeof Sources !== 'undefined') ? Sources.currentRoot() : null;
    const localRoot = curRoot ? curRoot.path : defaultRootUri();
    let target = Store.get(K.targetPath, '') || localRoot;
    if (curRoot && typeof Sources !== 'undefined') {
      const tsrc = Sources.sourceOf(target);
      if (!tsrc || tsrc.id !== curRoot.id) target = localRoot;
    }
    loadTreeRoots(target);
    renderTreeTabs();
    activateTreeRoot(treeActive).catch(() => {});
    updateSelInfo();
    Player.paintRows();
    Player.syncBar();

    /* 熄屏回来只做轻刷新 */
    let _resumeAt = 0;
    function softResume() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - _resumeAt < 800) return;
      _resumeAt = now;
      try { refreshColumns(); } catch (_) {}
      try { Player.syncBar(); } catch (_) {}
      try { Player.paintRows(); } catch (_) {}
      if (typeof Spectrum !== 'undefined') { try { Spectrum.onVisible(); } catch (_) {} }
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (typeof Spectrum !== 'undefined') { try { Spectrum.onHidden(); } catch (_) {} }
        return;
      }
      softResume();
    });
    window.addEventListener('focus', softResume);
  }

  async function defaultRoot() {
    try {
      const local = (Sources.list || []).find(r => r.kind === 'local');
      const d = await Api.browse(local ? local.path : '');
      return d.path;
    } catch (_) { return 'local:/'; }
  }

  function applyCaps(root) {
    const dav = !!(root && root.kind === 'dav');
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
      startBtn.disabled = dav;
      startBtn.title = dav ? '转码/重命名/封面只支持本地文件，请先把数据源切回本机' : '';
    }
    const ext = document.getElementById('pb-ext');
    if (ext) ext.style.display = dav ? 'none' : '';
    const tip = document.getElementById('task-status');
    if (tip && dav) tip.textContent = '当前是 WebDAV 数据源：文件处理仅支持本地';
    else if (tip && !dav && tip.textContent.indexOf('WebDAV') >= 0) tip.textContent = '';
  }

  return {
    init, browse, onPlayed, updateMoveBar: () => MoveMgr.update(), isGridView, refreshColumns,
    playNext, playPrev, autoplayNext, autoplayOn, applyPlayMode, playMode, cyclePlayMode,
    openModule, openModules, closeAllModules, openMod: openModule, setUiScale, previewUiScale, commitUiScale, currentUiScale, setCanvasPan, applyCanvasPan, canvasPan, addTargetCurrent, addFavCurrent,
    playbackQueueList: () => playbackList().slice(), hifiQueue, toggleModule,
    get path() { return currentPath; },
    selection: () => (bv ? bv.selected() : []),
    currentParent: () => currentParent
  };
})();

App.init().catch(e => {
  console.error(e);
  try { Utils.log('err', '初始化失败: ' + (e && (e.stack || e.message) || e), 'workbench'); } catch (_) {}
  // 启动错误只进日志浮窗（不弹 toast）：失败时也能直接初始化日志并打开
  try { Logs.init(); Logs.setNs('workbench'); Logs.toggle(true); }
  catch (_) { try { App.openModule('log'); } catch (__) {} }
});
