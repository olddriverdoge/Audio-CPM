/* ---------------- Sources（数据源：本地 / WebDAV） ---------------- */
const Sources = (() => {
  let list = [];
  let current = '';
  let onChange = null;
  const esc = s => Utils.escapeHtml(s);
  const val = id => {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };
  const PICK_KEY = 'ac2_source_id';
  const PATH_KEY = 'ac2_src_paths';

  function pathsMap() {
    try { return JSON.parse(localStorage.getItem(PATH_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }

  function sourceOf(uri) {
    const s = String(uri || '');
    if (s.indexOf('dav:') === 0) {
      const body = s.slice(4);
      const i = body.indexOf('/');
      return rootOf(i >= 0 ? body.slice(0, i) : body);
    }
    return rootOf('local');
  }

  function rememberPath(uri) {
    const src = sourceOf(uri);
    if (!src) return;
    const m = pathsMap();
    m[src.id] = uri;
    try { localStorage.setItem(PATH_KEY, JSON.stringify(m)); } catch (_) {}
  }

  function pathFor(root) {
    if (!root) return '';
    const saved = pathsMap()[root.id];
    return saved || root.path;
  }

  function syncPick(uri) {
    const src = sourceOf(uri);
    const sel = document.getElementById('source-select');
    if (!src || !sel) return;
    if (sel.value !== src.id) {
      sel.value = src.id;
      current = src.id;
      savePick(src.id);
    }
  }

  function pick() {
    try { return localStorage.getItem(PICK_KEY) || ''; } catch (_) { return ''; }
  }
  function savePick(id) {
    try { localStorage.setItem(PICK_KEY, id || ''); } catch (_) {}
  }
  function toast(msg, type) { Utils.toast(msg, type); }

  function renderSelect() {
    const sel = document.getElementById('source-select');
    if (!sel) return;
    const saved = pick();
    sel.innerHTML = list.map(r =>
      '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('') ||
      '<option value="">无数据源</option>';
    if (saved && list.some(r => r.id === saved)) sel.value = saved;
    else if (list[0]) sel.value = list[0].id;
    current = sel.value;
  }

  function renderList() {
    const box = document.getElementById('src-list');
    if (!box) return;
    box.innerHTML = list.map(r => {
      const tag = r.kind === 'dav' ? (r.readonly === false ? 'dav·可写' : 'dav·只读') : '本地';
      return '<span class="col-chip">' + esc(r.name) + ' <b>' + tag + '</b>' +
        (r.kind === 'dav'
          ? '<button type="button" class="col-del" data-src-del="' + esc(r.id) + '" title="删除该源">✕</button>'
          : '') + '</span>';
    }).join('') || '<span class="hint">还没有数据源</span>';
  }

  async function refresh() {
    try {
      const r = await Api.roots();
      list = r.roots || [];
    } catch (_) {
      list = [];
    }
    renderSelect();
    renderList();
    return list;
  }

  function rootOf(id) { return list.find(r => r.id === id) || null; }
  function currentRoot() { return rootOf(current) || list[0] || null; }
  function onSelect(cb) { onChange = cb; }

  async function pickSource(id) {
    current = id;
    savePick(id);
    const sel = document.getElementById('source-select');
    if (sel && sel.value !== id) sel.value = id;
    const r = rootOf(id);
    if (r && onChange) await onChange(r);
  }

  function formData() {
    return {
      name: val('src-name'),
      url: val('src-url'),
      username: val('src-user'),
      password: val('src-pass'),
      readonly: document.getElementById('src-readonly')
        ? document.getElementById('src-readonly').checked : true,
    };
  }

  async function saveDav() {
    const d = formData();
    if (!d.url) { toast('请填写 WebDAV 地址', 'warn'); return; }
    const id = (d.name || 'dav').replace(/[^A-Za-z0-9_-]/g, '').toLowerCase() || ('dav' + Date.now().toString(36));
    try {
      const r = await Api.saveSource(Object.assign({id: id, kind: 'dav'}, d));
      list = r.roots || list;
      renderSelect(); renderList();
      toast('已保存存储源');
      try { if (typeof UiCfg !== 'undefined') UiCfg.refresh(); } catch (_) {}
      // 保存后直接切到该源，立刻能看到是否可浏览
      if (list.some(x => x.id === id)) await pickSource(id);
    } catch (e) { toast('保存失败: ' + e.message, 'err'); }
  }

  async function testConn() {
    const d = formData();
    if (!d.url) { toast('请填写 WebDAV 地址', 'warn'); return; }
    try {
      const r = await Api.testSource({url: d.url, username: d.username, password: d.password});
      if (r.ok) toast('连接成功' + (r.writable ? '（可写）' : '（只读）'));
      else toast('连接失败: ' + (r.error || '未知错误'), 'err');
    } catch (e) { toast('测试失败: ' + e.message, 'err'); }
  }

  async function del(id) {
    if (!confirm('删除存储源「' + id + '」？只删除连接配置，不动服务器上的文件。')) return;
    try {
      const r = await Api.deleteSource(id);
      list = r.roots || list;
      renderSelect(); renderList();
      toast('已删除存储源');
    } catch (e) { toast('删除失败: ' + e.message, 'err'); }
  }

  function init() {
    const sel = document.getElementById('source-select');
    if (sel) sel.addEventListener('change', e => pickSource(e.target.value));
    const save = document.getElementById('src-save');
    if (save) save.onclick = saveDav;
    const test = document.getElementById('src-test');
    if (test) test.onclick = testConn;
    const box = document.getElementById('src-list');
    if (box) box.addEventListener('click', e => {
      const b = e.target.closest('[data-src-del]');
      if (b) del(b.dataset.srcDel);
    });
  }

  return {init, refresh, rootOf, currentRoot, onSelect, sourceOf,
          rememberPath, pathFor, syncPick,
          get list() { return list.slice(); }, get current() { return current; }};
})();
