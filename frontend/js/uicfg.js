/* ---------------- UiCfg：界面配置持久化（本地 JSON + 命名预设） ---------------- */
const UiCfg = (() => {
  const rawSet = Store.set.bind(Store);
  const rawRemove = Store.remove.bind(Store);
  let applying = false, ready = false, timer = null, saving = false;
  let file = '', presets = {}, active = '';

  function snapshot() {
    const out = {};
    Object.keys(K).forEach(name => {
      const v = Store.get(K[name], null);
      if (v !== null && v !== undefined) out[K[name]] = v;
    });
    return out;
  }

  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    applying = true;
    try {
      Object.keys(K).forEach(name => {
        const key = K[name];
        if (Object.prototype.hasOwnProperty.call(cfg, key)) rawSet(key, cfg[key]);
      });
    } finally { applying = false; }
  }

  // 拦截 Store 写操作：本地照常写，额外防抖同步到后端 JSON 文件
  Store.set = function (key, val) {
    rawSet(key, val);
    if (!applying) schedule();
  };
  Store.remove = function (key) {
    rawRemove(key);
    if (!applying) schedule();
  };

  function schedule() {
    if (!ready || applying) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; save(); }, 800);
  }

  async function save() {
    if (saving) { schedule(); return; }
    saving = true;
    try {
      const r = await Api.saveUiConfig({config: snapshot()});
      if (r && r.file) file = r.file;
    } catch (_) {
      // 后端不可用时静默：localStorage 仍可用
    } finally { saving = false; }
  }

  async function pull() {
    const r = await Api.uiConfig();
    file = r.file || file;
    presets = r.presets || {};
    active = r.active || '';
    return r;
  }

  async function load() {
    try {
      const r = await pull();
      if (r.config && Object.keys(r.config).length) applyConfig(r.config);
      ready = true;
      if (!r.config || !Object.keys(r.config).length) schedule(); // 首次：把本地配置推到文件
    } catch (_) {
      ready = true;
    }
  }

  function toast(m, t) { if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(m, t || 'ok'); }

  function paint() {
    const hint = document.getElementById('uicfg-file');
    if (hint) hint.textContent = file ? ('配置文件：' + file) : '';
    const sel = document.getElementById('uicfg-presets');
    if (!sel) return;
    const names = Object.keys(presets);
    sel.innerHTML = names.length
      ? names.map(n => '<option value="' + Utils.escapeHtml(n) + '"' +
          (n === active ? ' selected' : '') + '>' + Utils.escapeHtml(n) + '</option>').join('')
      : '<option value="">（暂无预设）</option>';
  }

  async function refresh() {
    try { await pull(); } catch (_) {}
    paint();
  }

  async function savePreset() {
    const inp = document.getElementById('uicfg-name');
    const name = (inp ? inp.value : '').trim();
    if (!name) { toast('先输入预设名', 'warn'); return; }
    try {
      const r = await Api.saveUiPreset(name, snapshot());
      presets = r.presets || presets;
      active = r.active || name;
      if (inp) inp.value = '';
      paint();
      toast('已保存预设「' + name + '」');
    } catch (e) { toast('保存失败: ' + e.message, 'err'); }
  }

  async function loadPreset() {
    const sel = document.getElementById('uicfg-presets');
    const name = sel ? sel.value : '';
    if (!name) { toast('没有可加载的预设', 'warn'); return; }
    if (!confirm('加载预设「' + name + '」？当前配置会被覆盖，页面将刷新')) return;
    try {
      const r = await Api.loadUiPreset(name);
      applyConfig(r.config || {});
      await Api.saveUiConfig({config: snapshot()}).catch(() => {});
      toast('已加载，正在刷新…');
      setTimeout(() => location.reload(), 300);
    } catch (e) { toast('加载失败: ' + e.message, 'err'); }
  }

  async function deletePreset() {
    const sel = document.getElementById('uicfg-presets');
    const name = sel ? sel.value : '';
    if (!name) { toast('没有可删除的预设', 'warn'); return; }
    if (!confirm('删除预设「' + name + '」？')) return;
    try {
      const r = await Api.deleteUiPreset(name);
      presets = r.presets || {};
      active = r.active || '';
      paint();
      toast('已删除预设「' + name + '」');
    } catch (e) { toast('删除失败: ' + e.message, 'err'); }
  }

  async function exportJson() {
    let r = null;
    try { r = await Api.uiConfig(); } catch (_) {}
    const data = {
      config: (r && r.config) || snapshot(),
      presets: (r && r.presets) || presets,
      active: (r && r.active) || active
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ac2_ui_config.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('已导出 JSON');
  }

  async function importJson(f) {
    if (!f) return;
    let data = null;
    try { data = JSON.parse(await f.text()); }
    catch (e) { toast('JSON 解析失败', 'err'); return; }
    const raw = (data && data.config && typeof data.config === 'object') ? data.config : data;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      toast('格式不对：应为 {config:{...}} 或平铺的配置对象', 'err'); return;
    }
    const clean = {};
    Object.keys(raw).forEach(k => {
      if (String(k).indexOf('ac2_') === 0) clean[k] = raw[k];
    });
    if (!Object.keys(clean).length) { toast('没有可导入的配置项（需 ac2_ 前缀）', 'warn'); return; }
    try {
      await Api.saveUiConfig({config: clean});
      applyConfig(clean);
      toast('已导入，正在刷新…');
      setTimeout(() => location.reload(), 300);
    } catch (e) { toast('导入失败: ' + e.message, 'err'); }
  }

  function init() {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    on('uicfg-save', savePreset);
    on('uicfg-load', loadPreset);
    on('uicfg-del', deletePreset);
    on('uicfg-export', exportJson);
    on('uicfg-import', () => {
      const f = document.getElementById('uicfg-file-input');
      if (f) f.click();
    });
    const inp = document.getElementById('uicfg-file-input');
    if (inp) inp.addEventListener('change', () => {
      importJson(inp.files && inp.files[0]);
      inp.value = '';
    });
  }

  return {init, load, refresh, snapshot, configFile: () => file};
})();
