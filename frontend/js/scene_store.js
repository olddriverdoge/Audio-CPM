/* ---------------- 场景（Scene）：一套模块布局，点一下摆好 ---------------- */
const SceneStore = (() => {
  const STORE = 'ac3_scenes';
  const LABEL = {
    browse: '文件浏览', task: '批处理', tree: '目标路径',
    meta: '元数据', spectrum: '频谱声谱', log: '日志', play: '播放管理', audio: '音频输出'
  };
  const DEFAULTS = [
    {id: 'builtin-convert', name: '文件转码', desc: '文件选择 · 批处理 · 日志', modules: ['browse', 'task', 'log']},
    {id: 'builtin-organize', name: '文件整理', desc: '文件选择 · 目标路径（移动/复制）', modules: ['browse', 'tree']},
    {id: 'builtin-listen', name: '听歌', desc: '文件选择 · 播放管理', modules: ['browse', 'play']}
  ];

  /* 场景里存的是“模块 id 列表”；兼容早期字段名 mods */
  function modulesOf(s) {
    if (!s) return [];
    if (Array.isArray(s.modules)) return s.modules;
    return Array.isArray(s.mods) ? s.mods : [];
  }
  function customs() {
    const a = Store.get(STORE, []);
    return Array.isArray(a) ? a.filter(x => x && x.id && modulesOf(x).length) : [];
  }
  function saveCustom(list) { Store.set(STORE, list); }
  function all() {
    return DEFAULTS.concat(customs().map(x => Object.assign({}, x, {modules: modulesOf(x), custom: true})));
  }

  const WIN = {
    browse: 'fw-browse', task: 'fw-task', tree: 'fw-tree', play: 'play-float',
    audio: 'audio-float', meta: 'meta-float', spectrum: 'spectrum-float', log: 'log-float'
  };

  function esc(s) { return Utils.escapeHtml(String(s == null ? '' : s)); }

  /* 把当前浮窗的位置/尺寸一起存进预设，换场景时原样还原 */
  function snapshotGeo(mods) {
    const geo = {};
    mods.forEach(m => {
      const id = WIN[m];
      if (!id) return;
      const g = Store.get('ac3_geo_' + id, null);
      if (g && Number.isFinite(Number(g.w)) && Number.isFinite(Number(g.h))) geo[id] = g;
    });
    return geo;
  }

  function renderTabs() {
    const tabs = document.getElementById('scene-tabs');
    if (!tabs) return;
    const open = (App.openModules ? App.openModules() : []);
    tabs.innerHTML = all().map(s => {
      const active = modulesOf(s).length === open.length && modulesOf(s).every(m => open.indexOf(m) >= 0);
      return '<button type="button" class="scene-chip' + (active ? ' on' : '') + '" data-scene-id="' +
        esc(s.id) + '" title="' + esc(modulesOf(s).map(m => LABEL[m] || m).join(' · ')) + '">' +
        '<span class="scene-name">' + esc(s.name) + '</span>' +
        (s.custom ? '<i class="scene-x" data-del-scene="' + esc(s.id) + '" title="删除场景">✕</i>' : '') +
        '</button>';
    }).join('');
  }

  function render() {
    renderTabs();
    const grid = document.getElementById('sh-grid');
    if (!grid) return;
    const open = (App.openModules ? App.openModules() : []);
    grid.innerHTML = all().map(s => {
      const active = modulesOf(s).length === open.length && modulesOf(s).every(m => open.indexOf(m) >= 0);
      const desc = modulesOf(s).map(m => LABEL[m] || m).join(' · ');
      return '<div class="sh-card' + (active ? ' on' : '') + '" data-id="' + esc(s.id) + '">' +
        '<span class="sh-name">' + esc(s.name) + '</span>' +
        '<span class="sh-desc">' + esc(desc) + '</span>' +
        (s.custom ? '<b class="sh-del" data-del="' + esc(s.id) + '" title="删除该预设">✕</b>' : '') +
        '</div>';
    }).join('');
  }

  function apply(s) {
    if (!s) return;
    if (App.closeAllModules) App.closeAllModules();
    // 先写回几何，再展开：WinMgr 打开时按保存的坐标夹取
    Object.keys(s.geo || {}).forEach(id => Store.set('ac3_geo_' + id, s.geo[id]));
    modulesOf(s).forEach(m => setTimeout(() => App.openModule(m), 0));
    setTimeout(render, 80);
  }

  function saveCurrent() {
    const modules = App.openModules ? App.openModules() : [];
    if (!modules.length) { Utils.toast('先打开几个模块再保存', 'warn'); return; }
    const name = prompt('场景名称：', '');
    if (!name) return;
    const list = customs();
    list.push({id: 'c' + Date.now(), name: name.trim().slice(0, 20), modules: modules,
               geo: snapshotGeo(modules)});
    saveCustom(list);
    render();
    Utils.toast('已保存场景：' + name.trim());
  }

  function remove(id) {
    if (!confirm('删除这个场景？')) return;
    saveCustom(customs().filter(x => x.id !== id));
    render();
  }

  function init() {
    render();
    const tabs = document.getElementById('scene-tabs');
    if (tabs) {
      tabs.addEventListener('click', e => {
        const del = e.target.closest('[data-del-scene]');
        if (del) { e.preventDefault(); e.stopPropagation(); remove(del.dataset.delScene); return; }
        const chip = e.target.closest('[data-scene-id]');
        if (!chip) return;
        const s = all().filter(x => x.id === chip.dataset.sceneId)[0];
        apply(s);
      });
    }
    const add = document.getElementById('scene-add');
    if (add) add.onclick = saveCurrent;
    const grid = document.getElementById('sh-grid');
    if (grid) {
      grid.addEventListener('click', e => {
        const del = e.target.closest('[data-del]');
        if (del) { e.stopPropagation(); remove(del.dataset.del); return; }
        const card = e.target.closest('.sh-card');
        if (!card) return;
        const s = all().filter(x => x.id === card.dataset.id)[0];
        apply(s);
      });
    }
  }

  return {init, render, saveCurrent, renderTabs};
})();
