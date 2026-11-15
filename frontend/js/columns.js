/* ---------------- Columns（表头：自定义列 / 列宽 / 排序 / 拖拽排序） ---------------- */
const Columns = (() => {
  const PRESETS = [
    { id: 'name',     label: '文件名' },
    { id: 'size',     label: '大小' },
    { id: 'title',    label: '标题',   key: 'title' },
    { id: 'track',    label: '编号',   key: 'track' },
    { id: 'composer', label: '作曲家', key: 'composer' },
    { id: 'album',    label: '专辑',   key: 'album' },
    { id: 'artist',   label: '作家',   key: 'artist' },
    { id: 'mtime',    label: '修改时间' }
  ];
  const DEF = { ids: ['name', 'size', 'mtime'], custom: [], widths: {} };
  const cache = new Map();
  const inflight = new Set();
  const queue = [];
  let running = 0;
  let cfg = load();

  function load() {
    const v = Store.get(K.columns, null);
    if (!v || typeof v !== 'object') return { v: 3, ids: DEF.ids.slice(), custom: [], widths: {} };
    const custom = Array.isArray(v.custom)
      ? v.custom.filter(c => c && c.key).map(c => ({ key: String(c.key), label: String(c.label || c.key) }))
      : [];
    const known = new Set(PRESETS.map(p => p.id).concat(custom.map(c => 'c:' + c.key)));
    let ids = Array.isArray(v.ids) ? v.ids.filter(id => known.has(id)) : [];
    // 旧版本（v<3）：自定义列固定追加在末尾、不能取消勾选 → 迁移为可勾选项（默认显示）
    if (!v.v || v.v < 3) {
      for (const c of custom) {
        const id = 'c:' + c.key;
        if (ids.indexOf(id) < 0) ids.push(id);
      }
      if (ids.indexOf('mtime') < 0) ids.push('mtime');   // 更旧的 v1 兼容
    }
    const widths = (v.widths && typeof v.widths === 'object') ? v.widths : {};
    return { v: 3, ids: ids.length ? ids : DEF.ids.slice(), custom, widths };
  }
  function save() { Store.set(K.columns, cfg); }

  // 顺序 = 用户勾选先后；自定义列也在 ids 里，可勾选 / 取消 / 拖动排序
  function active() {
    const out = [];
    for (const id of cfg.ids) {
      if (id.indexOf('c:') === 0) {
        const key = id.slice(2);
        const c = cfg.custom.find(x => x.key === key);
        if (c) out.push({ id: id, label: c.label, key: c.key });
        continue;
      }
      const p = PRESETS.find(x => x.id === id);
      if (p) out.push({ id: p.id, label: p.label, key: p.key || '' });
    }
    return out;
  }
  function colById(id) { return active().find(c => c.id === id) || null; }
  function width(id) { return Number(cfg.widths[id]) || 0; }
  function setWidth(id, px) {
    cfg.widths[id] = Math.max(44, Math.min(320, Math.round(px)));
    save();
  }
  function move(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const order = cfg.ids.slice();
    const i = order.indexOf(fromId), j = order.indexOf(toId);
    if (i < 0 || j < 0) return;
    order.splice(i, 1);
    order.splice(j, 0, fromId);
    cfg.ids = order;
    save();
  }
  function validId(id) {
    if (String(id).indexOf('c:') === 0) return cfg.custom.some(c => 'c:' + c.key === id);
    return PRESETS.some(p => p.id === id);
  }
  function toggle(id, on) {
    if (!validId(id)) return;
    cfg.ids = cfg.ids.filter(x => x !== id);
    if (on) cfg.ids.push(id);   // 勾选顺序即列顺序
    save();
  }

  function val(tags, key) {
    const v = tags ? tags[key] : '';
    if (Array.isArray(v)) return v.join(' / ');
    return v === undefined || v === null ? '' : String(v);
  }
  function tagValue(path, key) {
    const c = cache.get(path);
    return c ? val(c.tags, key) : '';
  }

  function styleFor(c) {
    const w = width(c.id);
    if (c.id === 'name') return w ? ' style="width:' + w + 'px;flex:0 0 ' + w + 'px"' : '';
    if (c.id === 'size') return w ? ' style="width:' + w + 'px"' : '';
    return w ? ' style="width:' + w + 'px"' : '';
  }
  function sortMark(key, sorts) {
    const s = (sorts || []).find(x => x.key === key);
    return s ? (s.dir === 'desc' ? '▼' : '▲') : '';
  }

  // 表头：预览图格里放「列」入口；每列可点排序，右缘拖动改列宽，长按拖动换顺序
  function headerHtml(sorts) {
    const esc = Utils.escapeHtml;
    let html = '<span class="icon col-thumb">' +
      '<button type="button" class="col-edit" title="编辑列表列">▦</button></span>';
    for (const c of active()) {
      const cls = c.id === 'name' ? 'name' : (c.id === 'size' ? 'size' : (c.id === 'mtime' ? 'mtime' : 'col'));
      const sortKey = c.key || c.id;
      const mark = sortMark(sortKey, sorts);
      html += '<span class="' + cls + ' hcell" data-colkey="' + esc(c.id) + '" data-sortkey="' +
        esc(sortKey) + '"' + styleFor(c) + ' title="点击排序，长按拖动换列顺序">' +
        esc(c.label) + '<i class="sarrow">' + mark + '</i>' +
        '<b class="col-grip" data-grip="' + esc(c.id) + '"></b></span>';
    }
    return html;
  }

  function cellsHtml(f) {
    const esc = Utils.escapeHtml;
    return active().map(c => {
      if (c.id === 'name') {
        return '<span class="name"' + styleFor(c) + ' data-act="probe" title="' + esc(f.name) + '">' +
          esc(f.name) + '</span>';
      }
      if (c.id === 'size') return '<span class="size"' + styleFor(c) + '>' + Utils.fmtSize(f.size) + '</span>';
      if (c.id === 'mtime') return '<span class="mtime"' + styleFor(c) + '>' + Utils.fmtTime(f.mtime) + '</span>';
      return '<span class="col"' + styleFor(c) + ' data-col="' + esc(c.key) + '" data-path="' + esc(f.path) +
        '" data-mtime="' + (f.mtime || 0) + '"></span>';
    }).join('');
  }

  /* ---- 标签懒加载 ---- */
  function pump() {
    while (running < 3 && queue.length) {
      const job = queue.shift();
      running++;
      Promise.resolve().then(job).finally(() => { running--; pump(); });
    }
  }
  function enqueue(path, mtime) {
    const key = path + '|' + mtime;
    if (inflight.has(key)) return;
    inflight.add(key);
    queue.push(() => Api.probe(path)
      .then(d => { cache.set(path, { mtime, tags: (d && d.tags) || {} }); })
      .catch(() => { cache.set(path, { mtime, tags: {} }); })
      .finally(() => { inflight.delete(key); fill(path); }));
    pump();
  }
  function setCell(el, text) {
    // 单元格可能已被包上 .cell-in（跑马灯），只改内部文本，别把包装冲掉
    const inner = el.querySelector('.cell-in');
    if (inner) inner.textContent = text; else el.textContent = text;
  }
  function fill(path) {
    const c = cache.get(path);
    if (!c) return;
    document.querySelectorAll('[data-col][data-path]').forEach(el => {
      if (el.dataset.path !== path) return;
      setCell(el, val(c.tags, el.dataset.col));
    });
  }
  function hydrate(container) {
    container.querySelectorAll('[data-col][data-path]').forEach(el => {
      const path = el.dataset.path;
      if (!path) return;
      const mtime = Number(el.dataset.mtime) || 0;
      const c = cache.get(path);
      if (c && c.mtime === mtime) { setCell(el, val(c.tags, el.dataset.col)); return; }
      enqueue(path, mtime);
    });
  }

  /* ---- 设置面板 ---- */
  function renderSheet() {
    const esc = Utils.escapeHtml;
    const box = document.getElementById('cols-presets');
    if (box) {
      const presetHtml = PRESETS.map(p =>
        '<label class="col-opt"><input type="checkbox" data-cid="' + p.id + '"' +
        (cfg.ids.indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + esc(p.label) + '</label>').join('');
      // 自定义列与预设一样是可勾选项：取消勾选即隐藏，order 与预设共用
      const customHtml = cfg.custom.map(c => {
        const id = 'c:' + c.key;
        return '<label class="col-opt col-opt-custom"><input type="checkbox" data-cid="' + esc(id) + '"' +
          (cfg.ids.indexOf(id) >= 0 ? ' checked' : '') + '> ' + esc(c.label) +
          ' <b class="col-key">' + esc(c.key) + '</b></label>';
      }).join('');
      box.innerHTML = presetHtml + customHtml;
    }
    const custom = document.getElementById('cols-custom');
    if (custom) {
      custom.innerHTML = cfg.custom.length
        ? cfg.custom.map((c, i) =>
          '<span class="col-chip">' + esc(c.label) + ' <b>' + esc(c.key) + '</b>' +
          '<button type="button" class="col-del" data-i="' + i + '" title="彻底删除该自定义列">✕</button></span>').join('')
        : '<span class="hint">还没有自定义列</span>';
    }
  }
  function refresh() {
    try { if (typeof App !== 'undefined' && App.refreshColumns) App.refreshColumns(); } catch (_) {}
  }
  function open() {
    renderSheet();
    const ps = document.getElementById('player-sheet');
    if (ps) ps.classList.add('hidden');
    document.getElementById('cols-sheet').classList.remove('hidden');
    document.getElementById('sheet-overlay').classList.remove('hidden');
  }
  function close() { document.getElementById('sheet-overlay').classList.add('hidden'); }

  function init() {
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.col-edit');
      if (b) { e.preventDefault(); open(); }
    });
    const closeBtn = document.getElementById('cols-close');
    if (closeBtn) closeBtn.onclick = close;
    const resetBtn = document.getElementById('cols-reset');
    if (resetBtn) resetBtn.onclick = () => {
      cfg = { v: 3, ids: DEF.ids.slice(), custom: [], widths: {} };
      save(); renderSheet(); refresh();
      Utils.toast('已恢复默认列');
    };
    const addBtn = document.getElementById('col-add');
    if (addBtn) addBtn.onclick = () => {
      const keyEl = document.getElementById('col-key');
      const labelEl = document.getElementById('col-label');
      const key = (keyEl.value || '').trim();
      const label = (labelEl.value || '').trim();
      if (!key) { Utils.toast('请填写元数据 key', 'warn'); return; }
      if (cfg.custom.some(c => c.key === key)) { Utils.toast('该 key 已存在', 'warn'); return; }
      cfg.custom.push({ key, label: label || key });
      const id = 'c:' + key;
      if (cfg.ids.indexOf(id) < 0) cfg.ids.push(id);   // 新增即勾选
      keyEl.value = ''; labelEl.value = '';
      save(); renderSheet(); refresh();
    };
    const pre = document.getElementById('cols-presets');
    if (pre) pre.addEventListener('change', e => {
      const cb = e.target.closest('input[data-cid]');
      if (!cb) return;
      toggle(cb.dataset.cid, cb.checked);
      refresh();
    });
    const custom = document.getElementById('cols-custom');
    if (custom) custom.addEventListener('click', e => {
      const btn = e.target.closest('.col-del');
      if (!btn) return;
      const i = Number(btn.dataset.i);
      const c = cfg.custom[i];
      if (!c) return;
      cfg.custom.splice(i, 1);
      cfg.ids = cfg.ids.filter(id => id !== 'c:' + c.key);   // 删除后同时从勾选列表移除
      save(); renderSheet(); refresh();
    });
  }

  return { init, open, close, active, colById, headerHtml, cellsHtml, hydrate, refresh,
           toggle, move, setWidth, width, tagValue, save,
           get: () => ({ ids: cfg.ids.slice(), custom: cfg.custom.map(c => ({ key: c.key, label: c.label })),
                         widths: Object.assign({}, cfg.widths) }) };
})();
