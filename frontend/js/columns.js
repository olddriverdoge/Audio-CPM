/* ---------------- Columns（表头：自定义列 / 列宽 / 排序 / 拖拽排序） ----------------
 * 两个页面的文件选择器共用 BrowseView 组件，但表头配置各自独立：
 * createColumns(storeKey) 每调用一次得到一份独立配置（列顺序/列宽/自定义列）。
 * 右下角列编辑弹窗（cols-sheet）编辑"最近打开它的那一份"配置。
 */
const Columns = (() => {
  const tr = s => (typeof I18n !== 'undefined') ? I18n.t(s) : s;
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
  let cur = null;                 // 列编辑弹窗当前作用的那一份配置

  function createColumns(storeKey) {
    let cfg = load(storeKey);

    function load(storeKey) {
      const v = Store.get(storeKey, null);
      if (!v || typeof v !== 'object') return { v: 3, ids: DEF.ids.slice(), custom: [], widths: {} };
      const custom = Array.isArray(v.custom)
        ? v.custom.filter(c => c && c.key).map(c => ({ key: String(c.key), label: String(c.label || c.key) }))
        : [];
      const known = new Set(PRESETS.map(p => p.id).concat(custom.map(c => 'c:' + c.key)));
      let ids = Array.isArray(v.ids) ? v.ids.filter(id => known.has(id)) : [];
      if (!v.v || v.v < 3) {
        for (const c of custom) {
          const id = 'c:' + c.key;
          if (ids.indexOf(id) < 0) ids.push(id);
        }
        if (ids.indexOf('mtime') < 0) ids.push('mtime');
      }
      const widths = (v.widths && typeof v.widths === 'object') ? v.widths : {};
      return { v: 3, ids: ids.length ? ids : DEF.ids.slice(), custom, widths };
    }
    function save() { Store.set(storeKey, cfg); }

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
        if (p) out.push({ id: p.id, label: tr(p.label), key: p.key || '' });
      }
      return out;
    }
    function colById(id) { return active().find(c => c.id === id) || null; }
    function width(id) { return Number(cfg.widths[id]) || 0; }
    function setWidth(id, px) {
      cfg.widths[id] = Math.max(32, Math.min(320, Math.round(px)));
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
      if (on) cfg.ids.push(id);
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
      // 列宽必须不可压缩（flex:0 0 auto）：否则总宽超过面板时各列被挤扁，
      // 内容看起来"超出框架"却又滑不到。name 留 200px 基准并可 grow，填满剩余空间。
      if (c.id === 'name') {
        return ' style="width:' + (w || 120) + 'px;flex:1 0 auto"';
      }
      return w ? ' style="width:' + w + 'px;flex:0 0 auto"' : ' style="flex:0 0 auto"';
    }
    function sortMark(key, sorts) {
      const s = (sorts || []).find(x => x.key === key);
      return s ? (s.dir === 'desc' ? '▼' : '▲') : '';
    }

    function headerHtml(sorts) {
      const esc = Utils.escapeHtml;
      let html = '<span class="icon col-thumb">' +
        '<button type="button" class="col-edit" title="编辑列表列（本页独立配置）">▦</button></span>';
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

    function hydrate(container) {
      container.querySelectorAll('[data-col][data-path]').forEach(el => {
        const path = el.dataset.path;
        if (!path) return;
        // WebDAV 的自定义标签列不做整页探测：每个文件都要 stat + 远端读元数据，
        // 十几个 FLAC 的目录会在渲染时排队打满后端；点文件名仍可单独 probe。
        if (String(path).indexOf('dav:') === 0) { setCell(el, ''); return; }
        const mtime = Number(el.dataset.mtime) || 0;
        const c = cache.get(path);
        if (c && c.mtime === mtime) { setCell(el, val(c.tags, el.dataset.col)); return; }
        enqueue(path, mtime);
      });
    }

    function open() {
      cur = inst;
      renderSheet();
      const ps = document.getElementById('player-sheet');
      if (ps) ps.classList.add('hidden');
      document.getElementById('cols-sheet').classList.remove('hidden');
      document.getElementById('sheet-overlay').classList.remove('hidden');
    }
    function refresh() {
      try { if (typeof App !== 'undefined' && App.refreshColumns) App.refreshColumns(); } catch (_) {}
    }
    function renderSheet() {
      const t = cur || inst;
      const esc = Utils.escapeHtml;
      const box = document.getElementById('cols-presets');
      if (box) {
        const presetHtml = PRESETS.map(p =>
          '<label class="col-opt"><input type="checkbox" data-cid="' + p.id + '"' +
          (t.cfg.ids.indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + esc(tr(p.label)) + '</label>').join('');
        const customHtml = t.cfg.custom.map(c => {
          const id = 'c:' + c.key;
          return '<label class="col-opt col-opt-custom"><input type="checkbox" data-cid="' + esc(id) + '"' +
            (t.cfg.ids.indexOf(id) >= 0 ? ' checked' : '') + '> ' + esc(c.label) +
            ' <b class="col-key">' + esc(c.key) + '</b></label>';
        }).join('');
        box.innerHTML = presetHtml + customHtml;
      }
      const custom = document.getElementById('cols-custom');
      if (custom) {
        custom.innerHTML = t.cfg.custom.length
          ? t.cfg.custom.map((c, i) =>
            '<span class="col-chip">' + esc(c.label) + ' <b>' + esc(c.key) + '</b>' +
            '<button type="button" class="col-del" data-i="' + i + '" title="彻底删除该自定义列">✕</button></span>').join('')
          : '<span class="hint">还没有自定义列</span>';
      }
    }

    const inst = {
      active, colById, headerHtml, cellsHtml, hydrate, refresh, open,
      toggle, move, setWidth, width, tagValue, save,
      renderSheet,
      get cfg() { return cfg; },
      get: () => ({ ids: cfg.ids.slice(), custom: cfg.custom.map(c => ({ key: c.key, label: c.label })),
                   widths: Object.assign({}, cfg.widths) })
    };
    return inst;
  }

  /* ---- 标签懒加载（两个视图共享探测缓存） ---- */
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
  function val(tags, key) {
    const v = tags ? tags[key] : '';
    if (Array.isArray(v)) return v.join(' / ');
    return v === undefined || v === null ? '' : String(v);
  }

  /* ---- 列编辑弹窗事件（全局绑定一次，作用于最近打开的那份配置） ---- */
  function bindSheet() {
    const closeBtn = document.getElementById('cols-close');
    if (closeBtn) closeBtn.onclick = () => {
      document.getElementById('sheet-overlay').classList.add('hidden');
    };
    const resetBtn = document.getElementById('cols-reset');
    if (resetBtn) resetBtn.onclick = () => {
      if (!cur) return;
      cur.cfg = { v: 3, ids: DEF.ids.slice(), custom: [], widths: {} };
      cur.save(); cur.renderSheet(); cur.refresh();
      Utils.toast('已恢复默认列（仅当前页）');
    };
    const addBtn = document.getElementById('col-add');
    if (addBtn) addBtn.onclick = () => {
      if (!cur) return;
      const keyEl = document.getElementById('col-key');
      const labelEl = document.getElementById('col-label');
      const key = (keyEl.value || '').trim();
      const label = (labelEl.value || '').trim();
      if (!key) { Utils.toast('请填写元数据 key', 'warn'); return; }
      if (cur.cfg.custom.some(c => c.key === key)) { Utils.toast('该 key 已存在', 'warn'); return; }
      cur.cfg.custom.push({ key, label: label || key });
      const id = 'c:' + key;
      if (cur.cfg.ids.indexOf(id) < 0) cur.cfg.ids.push(id);
      keyEl.value = ''; labelEl.value = '';
      cur.save(); cur.renderSheet(); cur.refresh();
    };
    const pre = document.getElementById('cols-presets');
    if (pre) pre.addEventListener('change', e => {
      if (!cur) return;
      const cb = e.target.closest('input[data-cid]');
      if (!cb) return;
      cur.toggle(cb.dataset.cid, cb.checked);
      cur.refresh();
    });
    const custom = document.getElementById('cols-custom');
    if (custom) custom.addEventListener('click', e => {
      if (!cur) return;
      const btn = e.target.closest('.col-del');
      if (!btn) return;
      const i = Number(btn.dataset.i);
      const c = cur.cfg.custom[i];
      if (!c) return;
      cur.cfg.custom.splice(i, 1);
      cur.cfg.ids = cur.cfg.ids.filter(id => id !== 'c:' + c.key);
      cur.save(); cur.renderSheet(); cur.refresh();
    });
  }

  return { create: createColumns, bindSheet };
})();
