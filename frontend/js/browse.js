/* ---------------- BrowseView ---------------- */
function createBrowseView(cfg) {
  const el = cfg.container;
  const st = {
    mode: cfg.mode || 'list',
    path: '', parent: '', dirs: [], files: [],
    sel: new Set(),
    by: cfg.by || 'name',
    order: cfg.order || 'asc',
    folderOrder: cfg.folderOrder || 'first',
    search: '', playedOnly: false, selMode: false,
    sorts: Array.isArray(cfg.sorts) ? cfg.sorts : []
  };

  const esc = Utils.escapeHtml;
  const isDavPath = p => String(p || '').indexOf('dav:') === 0;
  const NS = cfg.ns || 'process';       // 日志归属页（列表 1=处理 / 列表 2=整理）
  function lg(level, text) { Utils.log(level, text, NS); }

  function searchFiles() {
    const q = (st.search || '').trim().toLowerCase();
    if (!q) return st.files.slice();
    return st.files.filter(f => (f.name || '').toLowerCase().indexOf(q) >= 0);
  }
  function counts() {
    const base = searchFiles();
    return {total: base.length, played: PlayMgr.countIn(base.map(f => f.path))};
  }
  function sortVal(o, key) {
    if (key === 'name') return o.name || '';
    if (key === 'mtime') return o.mtime || 0;
    if (key === 'size') return o.file ? (o.file.size || 0) : (o.size || 0);
    const path = o.file ? o.file.path : (o.dir ? o.dir.path : (o.path || ''));
    return (cfg.columns && path) ? (cfg.columns.tagValue(path, key) || '') : '';
  }
  function cmpVal(a, b) {
    if (typeof a === 'number' || typeof b === 'number') return (Number(a) || 0) - (Number(b) || 0);
    return Utils.collator.compare(String(a), String(b));
  }
  // 多列排序：条件按点击先后生效，同值落到名称兜底
  function compareBy(a, b) {
    for (const s of st.sorts) {
      const d = cmpVal(sortVal(a, s.key), sortVal(b, s.key));
      if (d) return s.dir === 'desc' ? -d : d;
    }
    return 0;
  }
  function sortFiles(arr) {
    const out = arr.slice();
    out.sort((a, b) => compareBy(a, b) || Utils.collator.compare(a.name || '', b.name || ''));
    return out;
  }
  function visibleFiles() {
    const base = searchFiles();
    const arr = st.playedOnly ? base.filter(f => PlayMgr.isPlayed(f.path)) : base;
    return sortFiles(arr);
  }
  function itemComparator() {
    return (a, b) => compareBy(a, b) || Utils.collator.compare(a.name || '', b.name || '');
  }
  function orderedDirs() {
    return st.dirs.slice().sort(itemComparator());
  }
  function listItems(files, dirs) {
    if (st.folderOrder === 'first') {
      return dirs.map(d => ({dir: d})).concat(files.map(f => ({file: f})));
    }
    if (st.folderOrder === 'last') {
      return files.map(f => ({file: f})).concat(dirs.map(d => ({dir: d})));
    }
    const items = dirs.map(d => ({dir: d, name: d.name, mtime: d.mtime}))
                     .concat(files.map(f => ({file: f, name: f.name, mtime: f.mtime})));
    items.sort(itemComparator());
    return items;
  }

  function renderList(files, dirs) {
    const cols = cfg.columns;
    let html = '';
    if (st.mode !== 'compact') {
      const shown = files.filter(f => st.sel.has(f.path)).length;
      const allSel = files.length > 0 && shown === files.length;
      html += '<div class="item head">' +
        '<input type="checkbox" class="chk" data-act="selall"' + (allSel ? ' checked' : '') + '>' +
        (cols ? cols.headerHtml(st.sorts) : '<span class="name">文件名</span>') +
        '</div>';
    } else if (st.parent && st.parent !== st.path) {
      // 源文件选择：提供“返回上级”，避免只能靠地址栏
      html += '<div class="item dir" data-dir-path="' + esc(st.parent) + '">' +
        '<span class="chk" style="visibility:hidden"></span>' +
        '<span class="icon">⬆</span>' +
        '<span class="name">.. 上级目录</span></div>';
    }
    for (const it of listItems(files, dirs)) {
      if (it.dir) {
        const d = it.dir;
        const dsel = st.sel.has(d.path);
        html += '<div class="item dir' + (dsel ? ' sel' : '') + '" data-dir-path="' + esc(d.path) + '">' +
            (cfg.selectDirs
            ? '<input type="checkbox" class="chk dir-chk" data-dir-path="' + esc(d.path) + '"' +
              (dsel ? ' checked' : '') + '>'
            : '<span class="chk" style="visibility:hidden"></span>') +
          '<span class="icon dir-icon"><span class="ph">📁</span>' +
            (isDavPath(d.path) ? '' : '<img data-thumb="' + esc(Api.folderCoverUrl(d.path)) + '" alt="" onerror="ThumbMgr.onError(this)">') +
          '</span>' +
          '<span class="name">' + esc(d.name) + '</span>' +
          '<span class="mtime">' + Utils.fmtTime(d.mtime) + '</span>' +
          '</div>';
        continue;
      }
      const f = it.file;
      const sel = st.sel.has(f.path);
      // WebDAV 音频不要为每一行自动拉封面：十几个文件会同时发起远端 Range 请求，
      // 目录一打开就把 WebDAV 连接和线程打满，表现为进目录就卡死。
      const thumb = f.type === 'image' ? Api.imageUrl(f.path) : (isDavPath(f.path) ? '' : Api.thumbUrl(f.path, 48));
      const icon = thumb
        ? '<img class="row-thumb" data-thumb="' + esc(thumb) + '" alt="" onerror="ThumbMgr.onError(this)">'
        : (f.type === 'image' ? '🖼' : '♪');
      html += '<div class="item file' + (sel ? ' sel' : '') + '" data-path="' + esc(f.path) + '">' +
        '<input type="checkbox" class="chk file-chk" data-path="' + esc(f.path) + '"' +
        (sel ? ' checked' : '') + '>' +
        '<span class="icon">' + icon + '</span>' +
        (cols ? cols.cellsHtml(f)
          : '<span class="name" data-act="probe" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
            '<span class="size">' + Utils.fmtSize(f.size) + '</span>' +
            '<span class="mtime">' + Utils.fmtTime(f.mtime) + '</span>') +
        '</div>';
    }
    return html;
  }

  function renderGrid(files, dirs) {
    const size = Math.max(48, Number(cfg.gridSize ? cfg.gridSize() : 128) || 128);
    const w = size + 18;
    let html = '<div class="grid">';
    if (st.parent && st.parent !== st.path) {
      // 与列表模式的“.. 上级目录”保持一致，避免网格模式下无法返回
      html += '<div class="tile" data-dir-path="' + esc(st.parent) + '" style="width:' + w + 'px">' +
        '<div class="tile-cover dir"><span class="ph">⬆</span></div>' +
        '<div class="tile-name" title="返回上级">.. 上级目录</div></div>';
    }
    const dirHtml = d => {
      const dsel = st.sel.has(d.path);
      return '<div class="tile' + (dsel ? ' sel' : '') + '" data-dir-path="' + esc(d.path) + '" style="width:' + w + 'px">' +
        '<div class="tile-cover dir"><span class="ph">📁</span>' +
        (isDavPath(d.path) ? '' : '<img data-thumb="' + esc(Api.folderCoverUrl(d.path)) + '" alt="" onerror="ThumbMgr.onError(this)">') +
        (cfg.selectDirs
          ? '<input type="checkbox" class="chk tile-chk dir-chk" data-dir-path="' + esc(d.path) + '"' +
            (dsel ? ' checked' : '') + '>'
          : '') +
        '</div>' +
        '<div class="tile-name" title="' + esc(d.name) + '">' + esc(d.name) + '</div></div>';
    };
    const fileHtml = f => {
      const sel = st.sel.has(f.path);
      const played = PlayMgr.isPlayed(f.path);
      const isImg = f.type === 'image';
      const url = isImg ? Api.imageUrl(f.path) : (isDavPath(f.path) ? '' : Api.thumbUrl(f.path, size));
      return '<div class="tile' + (sel ? ' sel' : '') + '" data-path="' + esc(f.path) +
        '" style="width:' + w + 'px">' +
        '<div class="tile-cover" data-act="modal">' +
          '<span class="ph">' + (isImg ? '🖼' : '♪') + '</span>' +
          (url ? '<img data-thumb="' + esc(url) + '" alt="" onerror="ThumbMgr.onError(this)">' : '') +
          '<input type="checkbox" class="chk tile-chk" data-path="' + esc(f.path) + '"' +
          (sel ? ' checked' : '') + '>' +
          '<button type="button" class="tile-play" data-act="play" title="播放">▶</button>' +
          '<span class="played-dot' + (played ? ' on' : '') + '"></span>' +
        '</div>' +
        '<div class="tile-name" data-act="probe" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
        '</div>';
    };
    if (st.folderOrder !== 'last') { for (const d of dirs) html += dirHtml(d); }
    for (const f of files) html += fileHtml(f);
    if (st.folderOrder === 'last') { for (const d of dirs) html += dirHtml(d); }
    return html + '</div>';
  }

  function render() {
    const top = el.scrollTop;
    const files = visibleFiles();
    const dirs = orderedDirs();
    let html;
    if (st.mode === 'grid') html = renderGrid(files, dirs);
    else html = renderList(files, dirs);
    const hasParentRow = st.mode === 'compact' && st.parent && st.parent !== st.path;
    const hasAny = files.length > 0 || dirs.length > 0 || hasParentRow;
    if (!hasAny) {
      html = '<div class="empty">' + (st.search || st.playedOnly ? '（无匹配文件）' : '（空目录）') + '</div>';
    }
    el.innerHTML = html;
    el.classList.toggle('sel-mode', !!st.selMode);
    ThumbMgr.attach(el, st.mode === 'grid' ? (cfg.gridSize ? cfg.gridSize() : 128) : 48);
    if (cfg.columns) cfg.columns.hydrate(el);
    el.scrollTop = top;
    if (cfg.onCounts) cfg.onCounts(counts());
    notifySel();
    if (cfg.onRender) cfg.onRender(el);
    scheduleMarquee();
  }

  /* ---- 超宽内容自动横向滚动（跑马灯）：只给真正溢出的单元格挂 .mq ---- */
  let mqTimer = 0;
  function scheduleMarquee() {
    if (mqTimer) clearTimeout(mqTimer);
    mqTimer = setTimeout(applyMarquee, 240);
  }
  function applyMarquee() {
    mqTimer = 0;
    const nodes = el.querySelectorAll('.item:not(.head) .name, .item:not(.head) .col, .tile-name');
    // 三遍走：①补齐 .cell-in 包装（写） ②一次读完所有宽度（只读，浏览器只排一次版） ③统一写样式
    const list = [];
    nodes.forEach(n => {
      let inner = n.querySelector(':scope > .cell-in');
      if (!inner) {
        inner = document.createElement('span');
        inner.className = 'cell-in';
        while (n.firstChild) inner.appendChild(n.firstChild);
        n.appendChild(inner);
      }
      list.push({n, inner});
    });
    const measures = list.map(it => ({n: it.n, over: it.inner.offsetWidth - it.n.clientWidth}));
    for (const m of measures) {
      const n = m.n;
      if (m.over < 6) {
        if (n.classList.contains('mq')) {
          n.classList.remove('mq');
          n.style.removeProperty('--mq-shift');
          n.style.removeProperty('--mq-dur');
        }
        continue;
      }
      n.classList.add('mq');
      n.style.setProperty('--mq-shift', (-m.over - 4) + 'px');
      n.style.setProperty('--mq-dur', Math.max(6, Math.round(m.over / 26)) + 's');
    }
  }

  function notifySel() {
    if (cfg.onSelectionChange) cfg.onSelectionChange(st.sel.size);
  }
  function selectAll(sel) {
    const files = visibleFiles();
    for (const f of files) {
      if (sel) st.sel.add(f.path); else st.sel.delete(f.path);
    }
    if (cfg.selectDirs) {
      for (const d of st.dirs) {
        if (sel) st.sel.add(d.path); else st.sel.delete(d.path);
      }
    }
    st.selMode = sel ? true : st.sel.size > 0;
    render();
  }

  let suppressClick = false;
  // 长按是选择/菜单操作，屏蔽浏览器右键与长按上下文菜单
  el.addEventListener('contextmenu', e => {
    if (e.target.closest('input, textarea')) return;
    e.preventDefault();
  });
  el.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target;
    if (t.tagName === 'INPUT') return;
    const ce = t.closest('.col-edit');
    if (ce) { e.preventDefault(); if (cfg.columns && cfg.columns.open) cfg.columns.open(); return; }
    const actEl = t.closest('[data-act]');
    if (actEl) {
      const act = actEl.dataset.act;
      if (act === 'selall') return;
      const row = actEl.closest('[data-path]');
      const path = row ? row.dataset.path : '';
      if (act === 'probe') {
        e.preventDefault();
        if (cfg.clickPlays) { if (cfg.onRowClick) cfg.onRowClick(path, e, row); return; }
        if (cfg.onProbe) cfg.onProbe(path);
        return;
      }
      if (act === 'play') {
        e.preventDefault();
        e.stopPropagation();
        PlayMgr.play(path);
        return;
      }
      if (act === 'modal') {
        // 整理页：点磁贴=播放/按位置跳转；处理页：正在播放的再点=暂停
        if (cfg.clickPlays) { if (cfg.onRowClick) cfg.onRowClick(path, e, actEl); return; }
        if (path && Player.current === path) { PlayMgr.play(path); return; }
        const img = actEl.querySelector('img');
        if (img && img.style.display !== 'none' && img.getAttribute('src')) {
          Utils.openModal(img.src);
        }
        return;
      }
    }
    const anyFile = t.closest('.item.file[data-path], .tile[data-path]');
    if (anyFile && cfg.onRowClick) { cfg.onRowClick(anyFile.dataset.path, e, anyFile); return; }
    const curTile = t.closest('.tile[data-path]');
    if (curTile && curTile.dataset.path && curTile.dataset.path === Player.current) {
      PlayMgr.play(curTile.dataset.path);  // 网格：点磁贴空白也算再次点击
      return;
    }
    const dirEl = t.closest('[data-dir-path]');
    if (dirEl && cfg.onOpenDir) cfg.onOpenDir(dirEl.dataset.dirPath);
  });

  /* ---- 表头：轻点排序 / 拖动列宽 / 按住拖动换列顺序（触屏友好） ---- */
  let hState = null;
  function findColCell(node) {
    return node && node.closest ? node.closest('.item.head [data-colkey]') : null;
  }
  function cycleSort(key) {
    const i = st.sorts.findIndex(x => x.key === key);
    if (i < 0) st.sorts.push({ key: key, dir: 'asc' });
    else if (st.sorts[i].dir === 'asc') st.sorts[i].dir = 'desc';
    else st.sorts.splice(i, 1);
    render();
  }
  el.addEventListener('pointerdown', e => {
    if (!cfg.columns) return;
    const grip = e.target.closest && e.target.closest('.col-grip');
    const cell = grip ? findColCell(grip) : findColCell(e.target);
    if (!cell) return;
    if (hState) return;
    // 命中列右缘 12px 内也算拖宽（手柄肉眼难瞄，手指更甚）
    let nearEdge = false;
    if (!grip) {
      const rect = cell.getBoundingClientRect();
      nearEdge = rect.width > 0 && Math.abs(e.clientX - rect.right) <= 12;
    }
    hState = {
      grip: !!grip || nearEdge, key: cell.dataset.colkey,
      sortKey: cell.dataset.sortkey || cell.dataset.colkey, cell: cell,
      x0: e.clientX, y0: e.clientY, w0: cell.offsetWidth || cfg.columns.width(cell.dataset.colkey) || 92,
      moved: false, dragging: false, armed: false, t0: Date.now()
    };
    if (hState.grip) {
      const g = grip || cell.querySelector('.col-grip');
      if (g) g.classList.add('active');
      // 拖宽立即锁触控滚动；其余场景先不锁，保证表头起手右滑能横向滚动看完整列
      cell.classList.add('touch-none');
      try { cell.setPointerCapture(e.pointerId); } catch (_) {}
    } else {
      // 按住 300ms 不动 → 进入拖拽换列模式，再锁触控
      hState.armTimer = setTimeout(() => {
        if (!hState || hState.cell !== cell || hState.moved) return;
        hState.armed = true;
        cell.classList.add('touch-none');
        try { cell.setPointerCapture(e.pointerId); } catch (_) {}
      }, 300);
    }
    if (hState.grip && e.cancelable) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
  });
  el.addEventListener('pointermove', e => {
    if (!hState) return;
    const dx = e.clientX - hState.x0, dy = e.clientY - hState.y0;
    if (!hState.moved && Math.abs(dx) + Math.abs(dy) > 6) hState.moved = true;
    if (!hState.grip && !hState.armed) return;   // 未进入拖拽模式：交给浏览器横向滚动
    if (hState.grip) {
      const w = Math.max(44, Math.min(320, Math.round(hState.w0 + dx)));
      cfg.columns.setWidth(hState.key, w);
      if (hState.cell) {
        hState.cell.style.width = w + 'px';
        if (hState.key === 'name') hState.cell.style.flex = '0 0 ' + w + 'px';
      }
      if (e.cancelable) e.preventDefault();
      return;
    }
    if (!hState.moved) return;
    hState.dragging = true;
    hState.cell.classList.add('dragging');
    const over = document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
    const target = findColCell(over);
    el.querySelectorAll('.item.head .hcell.drop').forEach(n => n.classList.remove('drop'));
    if (target && target.dataset.colkey !== hState.key) target.classList.add('drop');
  });
  function endHeader(e) {
    if (!hState) return;
    const stt = hState;
    hState = null;
    if (stt.armTimer) clearTimeout(stt.armTimer);
    el.querySelectorAll('.col-grip.active').forEach(n => n.classList.remove('active'));
    if (stt.cell) stt.cell.classList.remove('touch-none');
    if (stt.grip) {
      cfg.columns.save();
      cfg.columns.refresh();
      return;
    }
    if (stt.dragging) {
      const drop = el.querySelector('.item.head .hcell.drop');
      el.querySelectorAll('.item.head .hcell.drop').forEach(n => n.classList.remove('drop'));
      if (drop && drop.dataset.colkey !== stt.key) cfg.columns.move(stt.key, drop.dataset.colkey);
      cfg.columns.refresh();
      return;
    }
    // 轻点（未拖动）→ 三态排序
    if (!stt.moved && Date.now() - stt.t0 < 800) cycleSort(stt.sortKey || stt.key);
  }
  ['pointerup', 'pointercancel'].forEach(t => el.addEventListener(t, endHeader));

  /* 长按文件进入选择模式（默认不显示复选框，避免误触和占位） */
  let pressTimer = null, pressPt = null, pressPath = '', pressIsDir = false;
  function stopPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressPt = null;
  }
  function enterSelMode(path) {
    st.selMode = true;
    el.classList.add('sel-mode');
    if (path) st.sel.add(path);
    render();
    notifySel();
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 700);
    try { if (navigator.vibrate) navigator.vibrate(20); } catch (_) {}
  }

  /* ---- 批量删除：由工具栏「删除」按钮触发（全选/清空旁），保留确认逻辑 ---- */
  async function deleteSelected() {
    const paths = Array.from(st.sel);
    if (!paths.length) { Utils.toast('没有选中的文件', 'warn'); return; }
    const dirCount = paths.filter(p => st.dirs.some(d => d.path === p)).length;
    const msg = dirCount > 0
      ? '删除选中的 ' + paths.length + ' 项（含 ' + dirCount + ' 个文件夹）？\n文件夹内容会一并删除，且无法恢复。'
      : '删除选中的 ' + paths.length + ' 个文件？\n此操作无法恢复。';
    if (!confirm(msg)) return;
    try {
      const r = await Api.remove(paths);
      let ok = 0, bad = 0;
      for (const one of (r.results || [])) {
        if (one.status === 'ok') { ok++; st.sel.delete(one.src || one.path || ''); }
        else { bad++; lg('err', '删除失败: ' + Utils.basename(one.src || one.path || '') + ' ' + (one.reason || '')); }
      }
      if (cfg.onDeleted) {
        try { await cfg.onDeleted({paths: paths, results: r.results || []}); } catch (_) {}
      }
      lg(bad ? 'warn' : 'ok', '删除完成: 成功 ' + ok + ' / 失败 ' + bad);
      Utils.toast(bad ? ('删除完成，' + bad + ' 项失败') : ('已删除 ' + ok + ' 项'));
      if (cfg.onReload) await cfg.onReload(); else render();
    } catch (e) {
      Utils.toast('删除失败: ' + e.message, 'err');
    }
  }
  el.addEventListener('pointerdown', e => {
    const row = e.target.closest('.item.file, .tile, .item.dir[data-dir-path]');
    if (!row) return;
    const filePath = row.dataset.path || '';
    const dirPath = row.dataset.dirPath || '';
    if (!filePath && !dirPath) return;
    if (e.target.closest('input, button')) return;
    pressPt = {x: e.clientX, y: e.clientY};
    pressPath = filePath || dirPath;
    pressIsDir = !filePath && !!dirPath;
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 700);
      try { if (navigator.vibrate) navigator.vibrate(20); } catch (_) {}
      enterSelMode(pressPath);
    }, 500);
  });
  el.addEventListener('pointermove', e => {
    if (!pressPt) return;
    if (Math.abs(e.clientX - pressPt.x) > 10 || Math.abs(e.clientY - pressPt.y) > 10) stopPress();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, stopPress));

  el.addEventListener('change', e => {
    const cb = e.target;
    if (!cb.classList || !cb.classList.contains('chk')) return;
    if (cb.dataset.act === 'selall') { selectAll(!!cb.checked); return; }
    const p = cb.dataset.path || cb.dataset.dirPath;
    if (!p) return;
    if (cb.checked) st.sel.add(p); else st.sel.delete(p);
    const row = cb.closest('.item, .tile');
    if (row) row.classList.toggle('sel', cb.checked);
    notifySel();
  });

  const api = {
    get path() { return st.path; },
    get parent() { return st.parent; },
    get files() { return st.files.slice(); },
    setData(data) {
      st.path = data.path || '';
      st.parent = data.parent || '';
      st.dirs = data.dirs || [];
      st.files = data.files || [];
      const present = new Set(st.files.map(f => f.path));
      if (cfg.selectDirs) for (const d of st.dirs) present.add(d.path);
      for (const p of Array.from(st.sel)) if (!present.has(p)) st.sel.delete(p);
      st.selMode = false;   // 换目录时退出选择模式
      el.scrollTop = 0;     // 进入新目录 / 返回上级后回到列表顶部
      render();
    },
    render,
    setMode(m) { st.mode = m; render(); },
    setSort(by, order, folderOrder) {
      if (by !== undefined && by !== null) st.by = by;
      if (order) st.order = order;
      if (folderOrder) st.folderOrder = folderOrder;
      render();
    },
    setSearch(q) { st.search = q || ''; render(); },
    setPlayedOnly(v) { st.playedOnly = !!v; render(); },
    selected() { return Array.from(st.sel); },
    count() { return st.sel.size; },
    selectAll(v) { selectAll(!!v); },
    clearSelection() { st.sel.clear(); st.selMode = false; render(); },
    deleteSelected,
    setSelMode(v) { st.selMode = !!v; render(); },
    // 播放只触发重绘（补波形），绝不改动选择
    onExternalPlayed(path) {
      if (!st.files.some(f => f.path === path)) return;
      // 只切换播放高亮，绝不重建整表：切歌时 el.innerHTML 全量重建 + 逐格量宽会让整个 app 卡死
      el.querySelectorAll('.item.file.playing').forEach(n => {
        if (n.dataset.path !== path) {
          n.classList.remove('playing');
          const w = n.querySelector('.row-wave');
          if (w) w.remove();
        }
      });
      el.querySelectorAll('.item.file[data-path]').forEach(n => {
        if (n.dataset.path === path) n.classList.add('playing');
      });
      el.querySelectorAll('.tile').forEach(n => {
        n.classList.toggle('playing', n.dataset.path === path);
      });
    },
    selectAllVisible(sel) { selectAll(sel); },
    visible() { return visibleFiles(); }
  };
  return api;
}
