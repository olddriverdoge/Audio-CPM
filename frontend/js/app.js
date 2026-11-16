/* ---------------- App ---------------- */
const App = (() => {
  let bv1 = null, bv2 = null, meta1 = null, meta2 = null, tree = null;
  let currentPath = '';
  let currentParent = '';
  let srcPath = '';

  function viewMode() { return Store.get(K.viewMode, 'list') === 'grid' ? 'grid' : 'list'; }
  function gridSize() { return Number(Store.get(K.gridSize, 128)) || 128; }
  // 整理页源列表只有 列表 / 网格 两种（旧的 compact 一律当列表）
  function s2ViewMode() { return Store.get(K.s2ViewMode, 'list') === 'grid' ? 'grid' : 'list'; }
  function s2ViewLabel(m) { return m === 'grid' ? '网格' : '列表'; }
  function setS2ViewMode(m) {
    m = (m === 'grid') ? 'grid' : 'list';
    Store.set(K.s2ViewMode, m);
    const btn = document.getElementById('s2-view-btn');
    if (btn) btn.textContent = s2ViewLabel(m);
    if (bv2) bv2.setMode(m);
    Player.syncBar();
  }
  function cycleS2View() { setS2ViewMode(s2ViewMode() === 'grid' ? 'list' : 'grid'); }
  // 当前页签处于网格视图 → 显示底部播放条；列表视图用行内波形
  function isGridView() {
    const p = Store.get(K.page, 'process');
    return p === 'organize' ? s2ViewMode() === 'grid' : viewMode() === 'grid';
  }

  /* 两个页面的文件列表共用同一套选择/计数展示逻辑 */
  function paintSel(bv, infoId, toolsId) {
    const n = bv ? bv.count() : 0;
    const el = document.getElementById(infoId);
    if (el) el.textContent = n === 0 ? '未选择（将处理整个目录）' : '已选 ' + n + ' 个文件';
    const tools = document.getElementById(toolsId);
    if (tools) tools.classList.toggle('hidden', n === 0);
  }
  function paintCounts(c, allId, playedId) {
    const a = document.getElementById(allId);
    const p = document.getElementById(playedId);
    if (a) a.textContent = c.total;
    if (p) p.textContent = c.played;
  }
  function updateSelInfo() { paintSel(bv1, 'sel-info', 'sel-tools'); }
  function updateSelInfo2() { paintSel(bv2, 's2-selinfo', 's2-sel-tools'); MoveMgr.update(); }
  function updateCounts1(c) { paintCounts(c, 'cnt-all', 'cnt-played'); }
  function updateCounts2(c) { paintCounts(c, 's2-cnt-all', 's2-cnt-played'); }

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
  /* 路径引用：local:/sdcard/x、dav:nas/Music/x（旧裸路径按本地处理） */
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
  function refPrefix(parts) {
    return parts.type === 'dav' ? ('dav:' + parts.source) : 'local:';
  }
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

  function renderDirCover(url) {
    const img = document.getElementById('dir-cover');
    if (!img) return;
    if (url) {
      img.src = url;
      img.classList.remove('hidden');
      img.onerror = () => img.classList.add('hidden');
    } else {
      img.classList.add('hidden');
      img.removeAttribute('src');
    }
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
  function showRecent() {
    const arr = Store.get(K.recent, []);
    if (!Array.isArray(arr) || !arr.length) { alert('暂无最近记录'); return; }
    const sel = prompt('选择要跳转的最近目录（输入序号）:\n\n' +
      arr.map((p, i) => (i + 1) + '. ' + p).join('\n'), '1');
    if (!sel) return;
    const idx = parseInt(sel, 10) - 1;
    if (idx >= 0 && idx < arr.length) browse(arr[idx]);
  }

  /* 两个页面的目录加载共用一份实现：kind = 'main'（处理页）| 'src'（整理页源列表） */
  const dirSeq = {main: 0, src: 0};
  async function loadDir(kind, path, opts) {
    const isSrc = kind === 'src';
    if (!path) path = isSrc ? srcPath : currentPath;
    const my = ++dirSeq[kind];
    try {
      const d = await Api.browse(path);
      if (my !== dirSeq[kind]) return false;   // 后发起的跳转优先，丢弃过期响应
      if (isSrc) {
        srcPath = d.path;
        Store.set(K.s2LastPath, d.path);
        renderCrumbs('pb2-crumbs', d.path, p => loadDir('src', p));
        bv2.setData(d);
        meta2.setEmpty('点击右侧文件名查看详情');
        if (!opts || opts.clearUndo !== false) MoveMgr.clearUndo();
        updateSelInfo2();
      } else {
        currentPath = d.path;
        currentParent = d.parent || '';
        Store.set(K.lastPath, d.path);
        renderCrumbs('pb1-crumbs', d.path, p => loadDir('main', p));
        pushRecent(d.path);
        bv1.setData(d);
        renderDirCover(d.cover);
        updateSelInfo();
        if (typeof Sources !== 'undefined') Sources.rememberPath(d.path);
      }
      return true;
    } catch (e) {
      if (my !== dirSeq[kind]) return false;
      const label = isSrc ? '源目录' : '浏览';
      Utils.log('err', label + '失败: ' + e.message);
      Utils.toast(label + '失败: ' + e.message, 'err');
      return false;
    }
  }
  function browse(path) { return loadDir('main', path); }
  function srcBrowse(path, opts) { return loadDir('src', path, opts); }

  function setViewMode(m) {
    if (m !== 'grid') m = 'list';
    Store.set(K.viewMode, m);
    document.querySelectorAll('#view-seg button').forEach(b => {
      b.classList.toggle('active', b.dataset.view === m);
    });
    document.getElementById('gridsize-seg').classList.toggle('hidden', m !== 'grid');
    bv1.setMode(m);
    Player.syncBar();
  }
  function setGridSize(sz) {
    Store.set(K.gridSize, sz);
    document.querySelectorAll('#gridsize-seg button').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.size) === sz);
    });
    bv1.render();
  }

  function setPage(p) {
    p = (p === 'organize') ? 'organize' : 'process';
    Store.set(K.page, p);
    const p1 = document.getElementById('mod1');
    const p2 = document.getElementById('mod2');
    if (p1) p1.classList.toggle('hidden', p !== 'process');
    if (p2) p2.classList.toggle('hidden', p !== 'organize');
    document.querySelectorAll('#page-seg button').forEach(b => {
      b.classList.toggle('active', b.dataset.page === p);
    });
    const viewSeg = document.getElementById('view-seg');
    const gsSeg = document.getElementById('gridsize-seg');
    if (viewSeg) viewSeg.classList.toggle('hidden', p !== 'process');
    if (gsSeg) gsSeg.classList.toggle('hidden', p !== 'process' || viewMode() !== 'grid');
    if (p === 'organize' && bv2 && !bv2.path && (srcPath || currentPath)) {
      srcBrowse(srcPath || currentPath);
    }
    Player.syncBar();
    Player.paintRows();
  }

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
  }
  async function activateTreeRoot(i) {
    if (i < 0 || i >= treeRoots.length) return;
    treeActive = i;
    saveTreeRoots();
    renderTreeTabs();
    const p = treeRoots[i];
    try {
      await tree.setRoot(p);
      Store.set(K.targetPath, p);
    } catch (e) {
      Utils.toast('目标目录读取失败: ' + e.message, 'err');
    }
  }

  /* 两个页面的行点击共用：一次点击开始播放并落到点击位置 */
  function playRowClick(path, e, rowEl) {
    if (!path) return;
    const box = rowEl ? (rowEl.querySelector('.row-wave') || rowEl) : null;
    const rect = box ? box.getBoundingClientRect() : null;
    const ratio = rect && rect.width > 0 ? Math.max(0, Math.min(0.999, (e.clientX - rect.left) / rect.width)) : 0;
    if (path === Player.current) { Player.seekRatio(ratio); return; }
    PlayMgr.play(path, ratio);
  }

  function refreshColumns() {
    if (bv1) bv1.render();
    if (bv2) bv2.render();
  }

  function onPlayed(path) {
    // 播放（含点击/自动播放）不改动选择；选择只由长按进入选择模式后发生
    if (bv1) bv1.onExternalPlayed(path);
    if (bv2) bv2.onExternalPlayed(path);
    // 播放联动：两个页面的元数据面板都跟当前列表联动
    if (meta1 && bv1 && bv1.files.some(f => f.path === path)) meta1.load(path);
    if (meta2 && bv2 && bv2.files.some(f => f.path === path)) meta2.load(path);
    updateSelInfo();
    updateSelInfo2();
  }

  function updateMoveBar() { MoveMgr.update(); }

  /* ---- 顺序自动播放 ---- */
  const AUDIO_EXT = /\.(flac|wav|aif|aiff|mp3|m4a|aac|ogg|opus|ape|wv|dsf|dff)$/i;
  function isAudioPath(p) { return AUDIO_EXT.test(String(p || '')); }
  function playbackList() {
    const p = Store.get(K.page, 'process');
    const arr = (p === 'organize' && bv2) ? bv2.visible() : (bv1 ? bv1.visible() : []);
    return arr.filter(f => f && f.path && isAudioPath(f.path));   // 顺序播放只在音频之间走
  }
  /**
   * 交给原生 ExoPlayer 的顺序队列（后台自动下一首靠它，不依赖 WebView 的 JS 定时器）。
   * 只取本机文件、限定窗口大小，避免把整库塞给播放器。
   */
  function hifiQueue(path) {
    const list = playbackList().filter(f => f.path && f.path.indexOf('dav:') !== 0);
    const i = list.findIndex(f => f.path === path);
    if (i < 0) return null;
    const from = Math.max(0, i - 20), to = Math.min(list.length, i + 80);
    const paths = list.slice(from, to).map(f => f.path);
    return {paths, index: i - from};
  }
  function autoplayOn() { return Store.get(K.autoplay, false) === true; }
  function paintAutoplay() {
    const b = document.getElementById('btn-autoplay');
    if (b) b.classList.toggle('on', autoplayOn());
  }
  function playNext() {
    const list = playbackList().filter(f => f && f.path);
    if (!list.length) return false;
    let i = list.findIndex(f => f.path === Player.current);
    if (i < 0) i = -1;              // 当前曲目不在列表：从第一首开始
    const next = list[i + 1];
    if (!next) { Utils.toast('已播放到列表末尾', 'warn'); return false; }
    PlayMgr.play(next.path);
    return true;
  }
  function autoplayNext() { return autoplayOn() ? playNext() : false; }

  /* 输出格式按后端能力裁剪：app 包里的 ffmpeg 只编了 flac/aac/pcm，mp3/ogg/opus 直接不展示 */
  const FMT_CODEC = v => {
    const c = String(v || '').split('-')[0].toLowerCase();
    return c === 'aiff' ? 'aif' : c;
  };
  async function applyCapabilities() {
    let caps = null;
    try { caps = await Api.caps(); } catch (_) { return; }
    window.AC2CAPS = caps;
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

  async function init() {
    // 先恢复本地 JSON 配置，后续初始化读到的才是一致状态
    await Promise.all([
      (typeof UiCfg !== 'undefined') ? UiCfg.load() : Promise.resolve(),
      (typeof Sources !== 'undefined') ? Sources.refresh() : Promise.resolve(),
    ]);
    if (typeof UiCfg !== 'undefined') UiCfg.init();
    // 能力下发要在任何任务面板交互之前完成，避免先渲染出不可用的格式
    await applyCapabilities();
    if (typeof Sources !== 'undefined') {
      Sources.init();
      Sources.onSelect(async root => {
        applyCaps(root);
        const want = Sources.pathFor(root);
        let ok = await browse(want);
        if (!ok && want !== root.path) ok = await browse(root.path);   // 记忆路径失效时回根目录
        if (!ok) {
          Utils.toast('切换到「' + (root.name || root.id) + '」失败，已保留当前目录', 'err');
          return;
        }
        // 整理页源列表跟随（同一个源、同一路径）
        try { if (bv2) await srcBrowse(want); } catch (_) {}
        // 目标目录切到该源：优先该源自己的标签记忆，没有就用源根
        const savedRoots = Store.get('ac2_tree_roots_' + root.id, null);
        treeRoots = (Array.isArray(savedRoots) && savedRoots.length)
          ? savedRoots.filter(x => typeof x === 'string' && x.trim())
          : [root.path];
        const n = Number(Store.get('ac2_tree_active_' + root.id, 0)) || 0;
        treeActive = Math.max(0, Math.min(treeRoots.length - 1, n));
        saveTreeRoots();
        renderTreeTabs();
        await activateTreeRoot(treeActive);
        Utils.toast('已切换数据源: ' + (root.name || root.id));
      });
      applyCaps(Sources.currentRoot());
    }
    Layout.init();
    Settings.init();
    Columns.init();
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') Settings.close();
    });

    /* Header */
    document.getElementById('view-seg').addEventListener('click', e => {
      const b = e.target.closest('button[data-view]');
      if (b) setViewMode(b.dataset.view);
    });
    document.getElementById('gridsize-seg').addEventListener('click', e => {
      const b = e.target.closest('button[data-size]');
      if (b) setGridSize(Number(b.dataset.size));
    });
    document.getElementById('page-seg').addEventListener('click', e => {
      const b = e.target.closest('button[data-page]');
      if (b) setPage(b.dataset.page);
    });

    /* 全屏（安卓 Chrome 支持 documentElement.requestFullscreen） */
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
    document.querySelectorAll('#view-seg button').forEach(b => {
      b.classList.toggle('active', b.dataset.view === viewMode());
    });

    /* 顺序自动播放开关 */
    const apBtn = document.getElementById('btn-autoplay');
    if (apBtn) {
      apBtn.addEventListener('click', () => {
        const on = !autoplayOn();
        Store.set(K.autoplay, on);
        paintAutoplay();
        Utils.toast(on ? '顺序播放已开启：当前曲目播完自动下一首' : '顺序播放已关闭');
      });
      paintAutoplay();
    }
    document.getElementById('gridsize-seg').classList.toggle('hidden', viewMode() !== 'grid');
    document.querySelectorAll('#gridsize-seg button').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.size) === gridSize());
    });

    /* 整理页：文件选择区视图用一个按钮循环切换，目标目录树不受影响 */
    const s2vBtn = document.getElementById('s2-view-btn');
    if (s2vBtn) {
      s2vBtn.textContent = s2ViewLabel(s2ViewMode());
      s2vBtn.addEventListener('click', cycleS2View);
    }

    /* 移动条收起 / 展开（横屏省空间），状态记忆 */
    const mvBar = document.getElementById('movebar');
    const mvToggle = document.getElementById('mv-toggle');
    function syncMoveBar() {
      const c = Store.get(K.moveCollapsed, false) === true;
      mvBar.classList.toggle('collapsed', c);
      mvToggle.textContent = c ? '⌃ 移动' : '收起 ⌄';
      mvToggle.title = c ? '展开移动条' : '收起移动条（贴右边，省出高度）';
    }
    if (mvToggle) {
      mvToggle.addEventListener('click', () => {
        Store.set(K.moveCollapsed, Store.get(K.moveCollapsed, false) !== true);
        syncMoveBar();
      });
    }
    syncMoveBar();

    /* Views */
    /* 两个页面的文件列表用同一份配置语义（以整理页为准）：点击播放、目录可选、长按菜单、列配置 */
    bv1 = createBrowseView({
      container: document.getElementById('view1'),
      mode: viewMode(),
      gridSize: gridSize,
      folderOrder: 'first',
      onOpenDir: p => browse(p),
      onReload: () => browse(currentPath),
      columns: Columns,
      clickPlays: true,
      selectDirs: true,
      onRowClick: (path, e, rowEl) => playRowClick(path, e, rowEl),
      onCounts: updateCounts1,
      onSelectionChange: updateSelInfo,
      onRender: () => Player.paintRows()
    });
    bv2 = createBrowseView({
      container: document.getElementById('view2'),
      mode: s2ViewMode(),
      gridSize: gridSize,
      folderOrder: 'first',
      onOpenDir: p => srcBrowse(p),
      onReload: () => srcBrowse(srcPath),
      columns: Columns,
      clickPlays: true,
      selectDirs: true,
      onRowClick: (path, e, rowEl) => playRowClick(path, e, rowEl),
      onCounts: updateCounts2,
      onSelectionChange: updateSelInfo2,
      onRender: () => Player.paintRows()
    });
    /* 元数据 / 频谱：同一模块在两个页面各挂一份实例，位置由 HTML 决定 */
    meta1 = createMetaView(document.getElementById('meta1'), {editable: true});
    meta2 = createMetaView(document.getElementById('meta2'), {editable: true});
    // 实时频谱是全局悬浮模块（贴边按钮 + 可调大小浮窗），两页共用
    if (typeof Spectrum !== 'undefined') Spectrum.init();

    /* 处理页右侧栏（元数据 + 频谱）：默认收起贴边，点击展开 */
    const p1side = document.getElementById('p1-side');
    const meta1Head = document.getElementById('meta1-head');
    let p1Collapsed = Store.get(K.meta1Collapsed, true) !== false;
    function applyP1Side() {
      if (!p1side) return;
      p1side.classList.toggle('collapsed', p1Collapsed);
      const chev = document.getElementById('meta1-chev');
      if (chev) chev.textContent = p1Collapsed ? '▸' : '◂';
    }
    if (meta1Head) {
      meta1Head.addEventListener('click', () => {
        p1Collapsed = !p1Collapsed;
        Store.set(K.meta1Collapsed, p1Collapsed);
        applyP1Side();
      });
    }
    applyP1Side();
    tree = createTreeView({
      container: document.getElementById('tree'),
      onSelect: () => MoveMgr.update(),
      onTreeChanged: () => MoveMgr.update()
    });

    MoveMgr.bind({
      getSources: () => bv2.selected(),
      getTarget: () => tree.selected,
      afterMove: async () => {
        await srcBrowse(srcPath, {clearUndo: false});
        bv2.clearSelection();
        updateSelInfo2();
      }
    });

    /* 模块 1 路径：面包屑点段跳转，长按编辑（逻辑在 renderCrumbs 内） */
    document.getElementById('dir-cover').onclick = function() {
      if (this.src) Utils.openModal(this.src);
    };

    /* 模块 1 搜索 / 选择（排序改到表头） */
    document.getElementById('search-input').addEventListener('input', Utils.debounce(e => {
      bv1.setSearch(e.target.value);
    }, 140));
    document.getElementById('btn-selall').onclick = () => bv1.selectAllVisible(true);
    document.getElementById('btn-selclear').onclick = () => bv1.clearSelection();

    /* 任务 + 预设 */
    document.querySelectorAll('input[name="task"]').forEach(r => {
      r.addEventListener('change', () => TaskRunner.syncUI());
    });
    document.getElementById('btn-use-cur-dir').onclick = () => {
      document.getElementById('output-dir').value = currentPath;
    };
    document.getElementById('preset-select').addEventListener('change', () => TaskRunner.applyPreset());
    document.getElementById('btn-save-preset').onclick = () => TaskRunner.saveAsPreset();
    document.getElementById('btn-del-preset').onclick = () => TaskRunner.deletePreset();
    document.getElementById('start-btn').onclick = () => TaskRunner.start();

    /* 日志折叠 */
    document.getElementById('log-toggle').addEventListener('click', () => {
      const log = document.getElementById('log');
      log.classList.toggle('collapsed');
      document.getElementById('log-tri').textContent = log.classList.contains('collapsed') ? '▸' : '▾';
    });

    /* 模块 2 源列表 */
    document.getElementById('s2-search').addEventListener('input', Utils.debounce(e => {
      bv2.setSearch(e.target.value);
    }, 140));
    document.getElementById('s2-selall').onclick = () => bv2.selectAllVisible(true);
    document.getElementById('s2-clear').onclick = () => bv2.clearSelection();

    /* 目录树：路径走面包屑，刷新按钮单独绑定 */
    /* 目标目录多标签：点切换、＋新增、长按移除 */
    const tabsEl = document.getElementById('tree-tabs');
    if (tabsEl) {
      let tabTimer = null;
      tabsEl.addEventListener('pointerdown', e => {
        const b = e.target.closest('.tree-tab[data-i]');
        if (!b) return;
        if (tabTimer) clearTimeout(tabTimer);
        tabTimer = setTimeout(() => {
          tabTimer = null;
          const i = Number(b.dataset.i);
          if (treeRoots.length <= 1) { Utils.toast('至少保留一个目标目录', 'warn'); return; }
          if (!confirm('移除目标目录标签「' + treeBaseName(treeRoots[i]) + '」？')) return;
          treeRoots.splice(i, 1);
          treeActive = Math.max(0, Math.min(treeActive, treeRoots.length - 1));
          saveTreeRoots(); renderTreeTabs(); activateTreeRoot(treeActive);
          try { if (navigator.vibrate) navigator.vibrate(20); } catch (_) {}
        }, 650);
      });
      const stopTabTimer = () => { if (tabTimer) { clearTimeout(tabTimer); tabTimer = null; } };
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => tabsEl.addEventListener(t, stopTabTimer));
      tabsEl.addEventListener('click', e => {
        if (e.target.closest('#tree-tab-add')) {
          const def = treeRoots[treeActive] || defaultRootUri();
          const v = prompt('新增目标目录路径：', def);
          if (!v) return;
          const p = v.trim();
          if (!p) return;
          const i = treeRoots.indexOf(p);
          if (i >= 0) { activateTreeRoot(i); return; }
          treeRoots.push(p);
          treeActive = treeRoots.length - 1;
          saveTreeRoots(); renderTreeTabs(); activateTreeRoot(treeActive);
          return;
        }
        const b = e.target.closest('.tree-tab[data-i]');
        if (b) activateTreeRoot(Number(b.dataset.i));
      });
    }

    /* 移动条 */
    const conflictSel = document.getElementById('mv-conflict');
    const savedConflict = Store.get(K.conflict, 'skip');
    conflictSel.value = ['skip', 'rename', 'overwrite'].indexOf(savedConflict) >= 0 ? savedConflict : 'skip';
    conflictSel.addEventListener('change', e => Store.set(K.conflict, e.target.value));
    document.getElementById('mv-btn').onclick = () => MoveMgr.doMove();
    document.getElementById('mv-undo').onclick = () => MoveMgr.doUndo();

    TaskRunner.syncUI();
    setPage(Store.get(K.page, 'process'));
    await TaskRunner.loadPresets();
    TaskRunner.init();

    const last = Store.get(K.lastPath, '') || (await defaultRoot());
    await browse(last);
    if (typeof Sources !== 'undefined') Sources.syncPick(last);
    const lastSrc = Store.get(K.s2LastPath, '') || currentPath || last;
    await srcBrowse(lastSrc);
    const curRoot = (typeof Sources !== 'undefined') ? Sources.currentRoot() : null;
    const localRoot = curRoot ? curRoot.path : defaultRootUri();
    let target = Store.get(K.targetPath, '') || localRoot;
    if (curRoot && typeof Sources !== 'undefined') {
      const tsrc = Sources.sourceOf(target);
      if (!tsrc || tsrc.id !== curRoot.id) target = localRoot;   // 上次的目标目录不属于当前源 → 用当前源根
    }
    loadTreeRoots(target);
    renderTreeTabs();
    await activateTreeRoot(treeActive);
    updateSelInfo();
    updateSelInfo2();
    Player.paintRows();
    Player.syncBar();

    /* 权限弹窗返回 / 切回前台后自动刷新，避免“授权后要重启 app” */
    let _resumeAt = 0;
    function refreshOnResume() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - _resumeAt < 1200) return;
      _resumeAt = now;
      try { if (currentPath) browse(currentPath); } catch (_) {}
      try { if (srcPath) srcBrowse(srcPath, {clearUndo: false}); } catch (_) {}
    }
    document.addEventListener('visibilitychange', refreshOnResume);
    window.addEventListener('focus', refreshOnResume);

  }

  async function defaultRoot() {
    try {
      const local = (Sources.list || []).find(r => r.kind === 'local');
      const d = await Api.browse(local ? local.path : '');
      return d.path;
    } catch (_) { return 'local:/'; }
  }

  /* 数据源能力：WebDAV 只读源禁用本地处理相关入口 */
  function applyCaps(root) {
    const dav = !!(root && root.kind === 'dav');
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
      startBtn.disabled = dav;
      startBtn.title = dav ? '转码/检查/标签整理只支持本地文件，请先把数据源切回本机' : '';
    }
    const ext = document.getElementById('pb-ext');
    if (ext) ext.style.display = dav ? 'none' : '';
    const pageBtn = document.querySelector('#page-seg button[data-page="process"]');
    if (pageBtn) pageBtn.title = dav ? '当前数据源只读：文件处理仅支持本地' : '';
    const tip = document.getElementById('task-status');
    if (tip && dav) tip.textContent = '当前是 WebDAV 数据源：文件处理仅支持本地';
    else if (tip && !dav && tip.textContent.indexOf('WebDAV') >= 0) tip.textContent = '';
  }

  return {
    init, browse, srcBrowse, onPlayed, updateMoveBar, isGridView, refreshColumns,
    playNext, autoplayNext, autoplayOn, hifiQueue,
    get path() { return currentPath; },
    get srcPath() { return srcPath; },
    selection: () => (bv1 ? bv1.selected() : []),
    currentParent: () => currentParent
  };
})();

App.init().catch(e => {
  console.error(e);
  Utils.log('err', '初始化失败: ' + e.message);
});
