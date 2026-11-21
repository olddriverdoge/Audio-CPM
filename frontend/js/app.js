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
      try { document.dispatchEvent(new CustomEvent('ac2:browse-changed', {detail:{path:d.path,parent:d.parent||''}})); } catch (_) {}
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
    box.innerHTML =
      '<button type="button" class="tree-tab tree-tab-add" id="tree-tab-add" title="把目标目录里选中的文件夹加为标签">＋</button>' +
      treeRoots.map((p, i) =>
        '<button type="button" class="tree-tab' + (i === treeActive ? ' active' : '') +
        '" data-i="' + i + '" title="' + Utils.escapeHtml(p) + '">' +
        Utils.escapeHtml(treeBaseName(p)) + '</button>').join('');
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
      renderTreePath(p);
    } catch (e) {
      Utils.toast('目标目录读取失败: ' + e.message, 'err');
    }
  }

  /* 目标目录的上级路径：保留 local:/ 或 dav:source 前缀。 */
  function targetParent(p) {
    const parts = refParts(p);
    const rest = String(parts.rest || '/').replace(/\/+$/, '');
    if (!rest || rest === '/') return '';
    const i = rest.lastIndexOf('/');
    if (i <= 0) return refPrefix(parts) + '/';
    return refPrefix(parts) + rest.slice(0, i);
  }

  function renderTreePath(p) {
    renderCrumbs('tree-crumbs', p, q => openTargetPath(q).catch(e => Utils.toast('切换路径失败: ' + (e.message || e), 'err')));
    const up = document.getElementById('tree-up');
    if (!up) return;
    const parent = targetParent(p);
    up.dataset.path = parent || '';
    up.disabled = !parent;
    up.title = parent ? ('上级目录：' + parent) : '已在最上层';
  }

  /* 面包屑/上级入口：已在标签里就切换；不在标签里只临时浏览，
     绝不自动创建快捷按钮。新增只能通过标签栏左侧的 ＋。 */
  async function openTargetPath(p) {
    if (!p || !tree) return;
    const i = treeRoots.indexOf(p);
    if (i >= 0) return activateTreeRoot(i);
    try {
      await tree.setRoot(p);
      Store.set(K.targetPath, p);
      renderTreePath(p);
      const track = document.getElementById('tree-track');
      if (track) track.textContent = p;
    } catch (e) {
      Utils.toast('切换路径失败: ' + (e.message || e), 'err');
    }
  }

  /* 加号：把目标目录树里当前选中的文件夹追加成标签，不再弹输入框。 */
  async function addSelectedTreeRoot() {
    const p = tree && tree.selected;
    if (!p) { Utils.toast('先在目标目录里选中一个文件夹', 'warn'); return; }
    const i = treeRoots.indexOf(p);
    if (i >= 0) {
      await activateTreeRoot(i);
      Utils.toast('该文件夹已在目标目录标签里');
      return;
    }
    treeRoots.push(p);
    treeActive = treeRoots.length - 1;
    saveTreeRoots();
    renderTreeTabs();
    await activateTreeRoot(treeActive);
    Utils.toast('已加入目标目录：' + (treeBaseName(p) || p));
  }

  /* 目标目录标签：点击切换；长按删除（不显示 ✕，避免误触）。 */
  function deleteTreeRoot(i) {
    if (i < 0 || i >= treeRoots.length) return;
    if (treeRoots.length <= 1) {
      Utils.toast('至少保留一个目标目录', 'warn');
      return;
    }
    const oldActive = treeActive;
    const oldPath = treeRoots[i];
    treeRoots.splice(i, 1);
    if (i < oldActive) treeActive--;
    else if (i === oldActive) treeActive = Math.min(i, treeRoots.length - 1);
    saveTreeRoots();
    renderTreeTabs();
    if (i === oldActive) activateTreeRoot(treeActive).catch(() => {});
    Utils.toast('已移除目标目录：' + (treeBaseName(oldPath) || oldPath));
  }

  function bindTreeTabs() {
    const box = document.getElementById('tree-tabs');
    if (!box) return;
    let holdTimer = null, holdStart = null, holdEl = null, suppressClickUntil = 0;
    const clearHold = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      holdStart = null; holdEl = null;
    };
    box.addEventListener('pointerdown', e => {
      const el = e.target.closest('.tree-tab[data-i]');
      if (!el) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      holdStart = {x: e.clientX, y: e.clientY};
      holdEl = el;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!holdStart || !holdEl) return;
        suppressClickUntil = Date.now() + 500;
        deleteTreeRoot(Number(holdEl.dataset.i));
        try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) {}
      }, 500);
    });
    box.addEventListener('pointermove', e => {
      if (!holdStart) return;
      if (Math.abs(e.clientX - holdStart.x) > 10 || Math.abs(e.clientY - holdStart.y) > 10) clearHold();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => box.addEventListener(t, clearHold));
    box.addEventListener('contextmenu', e => {
      if (e.target.closest('.tree-tab[data-i]')) e.preventDefault();
    });
    box.addEventListener('click', e => {
      if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.target.closest('#tree-tab-add')) { addSelectedTreeRoot(); return; }
      const tab = e.target.closest('.tree-tab[data-i]');
      if (tab) activateTreeRoot(Number(tab.dataset.i));
    }, true);
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
    bar.innerHTML =
      '<button type="button" class="fav-add" id="fav-add" title="收藏当前目录">+</button>' +
      '<div class="fav-scroll">' +
      list.map((p, i) =>
        '<button type="button" class="tree-tab fav-chip' + (p === cur ? ' active' : '') +
        '" data-fav="' + i + '" title="' + Utils.escapeHtml(p) + '">' +
        '<b>' + Utils.escapeHtml(treeBaseName(p) || p) + '</b></button>').join('') +
      '</div>';
    try { document.dispatchEvent(new CustomEvent('ac2:fav-changed')); } catch (_) {}
  }
  function removeFavByIndex(i) {
    const list = favs();
    if (!(i >= 0 && i < list.length)) return false;
    const p = list.splice(i, 1)[0];
    saveFavs(list);
    renderFavs();
    Utils.toast('已移除收藏：' + (treeBaseName(p) || p));
    return true;
  }
  function openFav(p) {
    if (!p) return Promise.resolve(false);
    return loadDir(p).catch(err => { Utils.toast('打开收藏失败: ' + (err && err.message || err), 'err'); return false; });
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
    let holdTimer = null, holdStart = null, holdEl = null, suppressClickUntil = 0;
    const clearHold = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      holdStart = null; holdEl = null;
    };
    bar.addEventListener('pointerdown', e => {
      const chip = e.target.closest('.fav-chip[data-fav]');
      if (!chip) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      holdStart = {x: e.clientX, y: e.clientY};
      holdEl = chip;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!holdStart || !holdEl) return;
        suppressClickUntil = Date.now() + 500;
        const list = favs();
        const i = Number(holdEl.dataset.fav);
        if (i >= 0 && i < list.length) {
          const p = list.splice(i, 1)[0];
          saveFavs(list);
          renderFavs();
          Utils.toast('已移除收藏：' + (treeBaseName(p) || p));
          try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) {}
        }
      }, 500);
    });
    bar.addEventListener('pointermove', e => {
      if (!holdStart) return;
      if (Math.abs(e.clientX - holdStart.x) > 10 || Math.abs(e.clientY - holdStart.y) > 10) clearHold();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => bar.addEventListener(t, clearHold));
    bar.addEventListener('contextmenu', e => {
      if (e.target.closest('.fav-chip')) e.preventDefault();
    });
    bar.addEventListener('click', e => {
      if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.target.closest('#fav-add')) { addFavCurrent(); return; }
      const chip = e.target.closest('.fav-chip');
      if (chip) {
        const p = favs()[Number(chip.dataset.fav)];
        if (p) loadDir(p).catch(err => Utils.toast('打开失败: ' + (err && err.message || err), 'err'));
      }
    }, true);
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

  /* 移动/删除后的路径比较：local: 前缀去掉，目录按前缀判断。 */
  function normPath(p) {
    let s = String(p || '');
    if (s.indexOf('local:') === 0) s = s.slice(6);
    return s.replace(/\/+$/, '');
  }
  function pathInSrc(path, src) {
    const a = normPath(path), b = normPath(src);
    if (!a || !b) return false;
    return a === b || a.indexOf(b + '/') === 0;
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

  function openMeta(path) {
    if (!metaFloat) return;
    if (path) metaFloat.load(path);
    openModule('meta');
  }

  function onPlayed(path, opts) {
    if (bv) bv.onExternalPlayed(path);
    if (metaFloat) metaFloat.load(path);
    // 切歌后重新下发一次音效参数：原生静态状态通常还在，但播放器/Sink 重建
    // 或进程被系统回收时不能依赖“上次已经设过”。
    try { if (window.__ac2ReapplyAudioFx) window.__ac2ReapplyAudioFx(); } catch (_) {}
    updateSelInfo();
    /* 内置播放器起播：从文件浏览/网格起播时才自动展开声谱。
       从播放管理内部选曲走 quiet，不再二次弹窗。 */
    const quiet = !!(opts && opts.quiet);
    if (!quiet && Player.current && Player.current === path) {
      /* 独立频谱/声谱浮窗已移除：起播时展开播放管理的内嵌声谱即可 */
      openModule('play');
      const panel = MODULE_REGISTRY.play && MODULE_REGISTRY.play.fw;
      if (panel && panel.showSpectrum) {
        try { panel.showSpectrum('waterfall'); } catch (_) {}
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
  let advancingFolder = false;
  /* 顺序模式播完当前目录后，继续找父目录里的下一个兄弟目录。
     只把有音频的目录切进浏览视图，随后由该目录的可见列表继续顺序播放。 */
  async function playNextFolder(opts) {
    if (advancingFolder) return false;
    const here = currentPath, parent = currentParent;
    if (!here || !parent) return false;
    advancingFolder = true;
    try {
      const d = await Api.browse(parent);
      const dirs = (d && Array.isArray(d.dirs) ? d.dirs : [])
        .filter(x => x && x.path)
        .slice()
        .sort((a, b) => Utils.collator.compare(a.name || '', b.name || ''));
      const idx = dirs.findIndex(x => normPath(x.path) === normPath(here));
      if (idx < 0) return false;
      for (let i = idx + 1; i < dirs.length; i++) {
        const target = dirs[i].path;
        let sub = null;
        try { sub = await Api.browse(target); } catch (_) { continue; }
        const audios = ((sub && sub.files) || []).filter(f => f && f.path && isAudioPath(f.path));
        if (!audios.length) continue;
        const ok = await loadDir(target);
        if (!ok) continue;
        const nextList = playbackList();
        if (!nextList.length) continue;
        PlayMgr.play(nextList[0].path, 0, opts);
        const msg = (typeof I18n !== 'undefined')
          ? I18n.t('顺序播放：进入下一个目录 {name}').replace('{name}', dirs[i].name || Utils.basename(target))
          : ('顺序播放：进入下一个目录 ' + (dirs[i].name || Utils.basename(target)));
        Utils.toast(msg);
        try { Utils.log('info', '顺序播放进入下一个目录: ' + target, 'workbench'); } catch (_) {}
        return true;
      }
      return false;
    } catch (e) {
      try { Utils.log('warn', '查找下一个目录失败: ' + (e && e.message || e), 'workbench'); } catch (_) {}
      return false;
    } finally {
      advancingFolder = false;
    }
  }
  async function playNext(wrap, opts) {
    if (playMode() === 'shuffle') return playRandom(opts);
    const list = playbackList().filter(f => f && f.path);
    if (!list.length) return false;
    let i = list.findIndex(f => f.path === Player.current);
    if (i < 0) i = -1;
    const next = list[i + 1] || ((wrap || playMode() === 'all') ? list[0] : null);
    if (next) { PlayMgr.play(next.path, 0, opts); return true; }
    if (!wrap && playMode() === 'order') {
      const moved = await playNextFolder(opts);
      if (moved) return true;
    }
    Utils.toast('已播放到列表末尾', 'warn');
    return false;
  }
  function playPrev(opts) {
    if (playMode() === 'shuffle') return playRandom(opts);
    const list = playbackList().filter(f => f && f.path);
    if (!list.length) return false;
    let i = list.findIndex(f => f.path === Player.current);
    if (i <= 0) i = list.length;
    PlayMgr.play(list[i - 1].path, 0, opts);
    return true;
  }
  function playRandom(opts) {
    const list = playbackList().filter(f => f && f.path);
    if (!list.length) return false;
    if (list.length === 1) { PlayMgr.play(list[0].path, 0, opts); return true; }
    let n = 0, pick = null;
    do { pick = list[Math.floor(Math.random() * list.length)]; n++; }
    while (pick.path === Player.current && n < 8);
    PlayMgr.play(pick.path, 0, opts);
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

  /* 手掌按钮：
     - 开启：只锁定/拖动。空白处单指平移画布，禁止缩放任何浮窗；模块内部点击、
       滚动和按钮全部保留。
     - 关闭：空白处双指缩放全部组件。 */
  function initHandLock() {
    const hand = document.getElementById('btn-hand');
    if (!hand) return;
    let locked = false, pan = null, pinch = null;

    function dist(touches) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.max(1, Math.sqrt(dx * dx + dy * dy));
    }
    function blankTarget(t) {
      if (!t || !t.closest) return false;
      // 任何浮窗、顶栏/模块条、播放条、设置层都不归画布手势处理。
      return !t.closest('#app-hdr,.hdr,.modbar,#player-bar,.fw-win,.play-float,' +
        '.audio-float,.meta-float,.spectrum-float,.log-float,#sheet-overlay,' +
        '#menu-overlay,#toast-wrap');
    }
    function commitCanvas() {
      const p = canvasPan();
      setCanvasPan(p.x, p.y, true);
    }
    function finish(e) {
      if (pinch) {
        pinch = null;
        commitUiScale(currentUiScale());
        commitCanvas();
      } else if (pan) {
        pan = null;
        commitCanvas();
      }
      if (e && e.cancelable) e.preventDefault();
    }
    function setLocked(on) {
      locked = !!on;
      window.AUDIOCPM_PALM_LOCKED = locked;
      try { WinMgr.cancelGestures(); } catch (_) {}
      hand.classList.toggle('on', locked);
      hand.setAttribute('aria-pressed', locked ? 'true' : 'false');
      hand.title = locked
        ? '已锁定：空白处拖动平移，缩放已禁用，模块可正常点击'
        : '空白处双指缩放全部组件';
      const lbl = hand.querySelector('.b-lbl');
      if (lbl) lbl.textContent = locked ? '锁定' : '缩放';
      if (locked) {
        document.body.classList.add('ui-locked');
        Utils.toast('已锁定：空白处拖动平移，缩放已禁用；模块可正常点击');
      } else {
        finish(null);
        document.body.classList.remove('ui-locked');
        Utils.toast('已解锁：空白处双指缩放全部组件');
      }
    }

    hand.addEventListener('click', () => setLocked(!locked));

    document.addEventListener('touchstart', e => {
      if (!blankTarget(e.target)) return;   // 模块内触摸完全不拦截
      if (locked) {
        pinch = null;
        if (e.touches.length === 1) {
          e.preventDefault();
          const p = canvasPan();
          pan = {x: e.touches[0].clientX, y: e.touches[0].clientY, cx: p.x, cy: p.y};
        } else {
          // 锁定时即使双指落在空白处也不缩放，只阻止浏览器原生缩放。
          pan = null;
          if (e.cancelable) e.preventDefault();
        }
        return;
      }
      if (e.touches.length === 2) {
        e.preventDefault();
        pan = null;
        const p = canvasPan();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        pinch = {d: dist(e.touches), scale: currentUiScale(), cx: p.x, cy: p.y, mx, my};
      }
    }, {passive: false, capture: true});

    document.addEventListener('touchmove', e => {
      if (pinch && e.touches.length >= 2) {
        e.preventDefault();
        const ratio = dist(e.touches) / pinch.d;
        const s = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, pinch.scale * ratio));
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const ax = (pinch.mx - pinch.cx) / pinch.scale;
        const ay = (pinch.my - pinch.cy) / pinch.scale;
        previewUiScale(s);
        applyCanvasPan(mx - ax * s, my - ay * s, false);
        return;
      }
      if (pan && locked && e.touches.length === 1) {
        e.preventDefault();
        applyCanvasPan(pan.cx + (e.touches[0].clientX - pan.x),
                       pan.cy + (e.touches[0].clientY - pan.y), false);
      }
    }, {passive: false});

    document.addEventListener('touchend', e => {
      if (pinch || pan) finish(e);
    }, {passive: false});
    document.addEventListener('touchcancel', e => {
      if (pinch || pan) finish(e);
    }, {passive: false});
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
    MODULE_REGISTRY.log = {win: 'log-float', fab: 'log-fab', min: 'lf-min'};

    /* 右下角模块坞：＋ 展开纵向按钮，10 秒无操作收回 */
    const MODULE_LABEL = {
      browse: '文件浏览', task: '批处理', tree: '目标目录', play: '播放管理',
      audio: '音频输出', meta: '元数据', log: '日志'
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
    // 仓库默认配置只在缺失时补入，不能覆盖本机已调好的布局/表头/频谱参数。
    if (typeof Defaults !== 'undefined') {
      try { await Defaults.apply(); } catch (_) {}
      try { Defaults.init(); } catch (_) {}
    }
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
    if (typeof UpdateChecker !== 'undefined') UpdateChecker.init();
    if (typeof BackgroundKeeper !== 'undefined') BackgroundKeeper.init();
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
      onDeleted: async (info) => {
        if (!info || !Player.current) return;
        const hit = (info.results || []).some(x =>
          x.status === 'ok' && pathInSrc(Player.current, x.src || x.path));
        if (hit) {
          try { Player.close(); } catch (_) {}
          Utils.toast('当前播放文件已被删除，已停止播放');
          Utils.log('warn', '当前播放文件被删除，已停止播放: ' + Player.current, 'organize');
        }
      },
      onRender: () => { try { Player.paintRows(); } catch (_) {} }
    });
    tree = createTreeView({
      container: document.getElementById('tree'),
      onSelect: () => MoveMgr.update(),
      onTreeChanged: () => MoveMgr.update()
    });
    bindFavs();
    bindTreeTabs();
    const treeUp = document.getElementById('tree-up');
    if (treeUp) treeUp.addEventListener('click', async e => {
      e.preventDefault();
      const p = treeUp.dataset.path;
      if (!p) return;
      try { await openTargetPath(p); Utils.toast('已切换到上级：' + (treeBaseName(p) || p)); }
      catch (err) { Utils.toast('切换上级失败: ' + (err && err.message || err), 'err'); }
    });
    /* 文件浏览选择工具栏：全选 / 清空 / 删除之前没有绑定，按钮点了没反应 */
    const selAll = document.getElementById('btn-selall');
    const selClear = document.getElementById('btn-selclear');
    const selDel = document.getElementById('btn-del');
    if (selAll) selAll.addEventListener('click', () => { if (bv) bv.selectAll(true); });
    if (selClear) selClear.addEventListener('click', () => { if (bv) bv.clearSelection(); });
    if (selDel) selDel.addEventListener('click', () => {
      if (bv) Promise.resolve(bv.deleteSelected()).catch(e => Utils.toast('删除失败: ' + (e && e.message || e), 'err'));
    });
    /* 目标目录树头部的“展开/收起”：之前只有函数没有绑定按钮，点了完全没反应 */
    const treeExpand = document.getElementById('tree-expand-one');
    const treeCollapse = document.getElementById('tree-collapse-all');
    if (treeExpand) treeExpand.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (tree) tree.expandOneLevel();
    });
    if (treeCollapse) treeCollapse.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (tree) tree.collapseAll();
    });
    metaFloat = createMetaFloat();
    /* 元数据 / 频谱 / 日志：同样交给 WinMgr，标题拖动、双指缩放、点击置顶一致 */
    WinMgr.register({id: 'meta-float', win: 'meta-float', head: 'mf-head', resize: 'mf-resize', minW: 240, minH: 160});
    WinMgr.register({id: 'log-float', win: 'log-float', head: 'lf-head', resize: 'lf-resize', minW: 240, minH: 160});

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') Settings.close();
    });

    /* 头部按钮 */
    const s1v = document.getElementById('s1-view-btn');
    if (s1v) s1v.addEventListener('click', cycleViewMode);
    const s1sz = document.getElementById('s1-size-btn');
    if (s1sz) s1sz.addEventListener('click', cycleGridSize);

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
      afterMove: async (info) => {
        // 移动会把正在播放的文件从原路径拿走；必须停止，而不只是暂停。
        // 否则 ExoPlayer 仍持有失效路径/旧文件句柄，表现为持续一卡一卡。
        if (info && info.op === 'move' && Player.current) {
          const moved = (info.results || []).some(x =>
            x.status === 'ok' && pathInSrc(Player.current, x.src));
          if (moved) {
            try { Player.close(); } catch (_) {}
            Utils.toast('当前播放文件已被移动，已停止播放');
            Utils.log('warn', '当前播放文件被移动，已停止播放: ' + Player.current, 'organize');
          }
        }
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

    // 更新检查完全异步：启动后延迟触发，不阻塞目录、播放或任何首屏交互。
    if (typeof UpdateChecker !== 'undefined') {
      setTimeout(() => { try { UpdateChecker.autoCheck(); } catch (_) {} }, 2500);
    }
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
    playNext, playPrev, autoplayNext, autoplayOn, applyPlayMode, playMode, cyclePlayMode, playNextFolder,
    openModule, openModules, closeAllModules, openMod: openModule, openMeta,
    openCoverEditor: path => { if (typeof TaskRunner !== 'undefined') TaskRunner.openCoverEditor(path); },
    setUiScale, previewUiScale, commitUiScale, currentUiScale, setCanvasPan, applyCanvasPan, canvasPan, addTargetCurrent, addFavCurrent,
    playbackQueueList: () => playbackList().slice(), hifiQueue, toggleModule,
    get path() { return currentPath; },
    selection: () => (bv ? bv.selected() : []),
    currentParent: () => currentParent,
    directories: () => (bv ? bv.dirs() : []),
    favoriteList: () => favs(),
    removeFavorite: i => removeFavByIndex(i),
    openFavorite: p => openFav(p)
  };
})();

App.init().catch(e => {
  console.error(e);
  try { Utils.log('err', '初始化失败: ' + (e && (e.stack || e.message) || e), 'workbench'); } catch (_) {}
  // 启动错误只进日志浮窗（不弹 toast）：失败时也能直接初始化日志并打开
  try { Logs.init(); Logs.setNs('workbench'); Logs.toggle(true); }
  catch (_) { try { App.openModule('log'); } catch (__) {} }
});
