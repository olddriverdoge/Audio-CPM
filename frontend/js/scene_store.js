/* ---------------- 场景（Scene）：一套模块布局，点一下摆好 ---------------- */
const SceneStore = (() => {
  const STORE = 'ac3_scenes';
  const HIDDEN = 'ac3_scenes_hidden';
  const OVERRIDES = 'ac3_scene_overrides';   // 内置场景的用户覆盖，独立保存，升级不回写
  const LABEL = {
    browse: '文件浏览', task: '批处理', tree: '目标目录',
    meta: '元数据', spectrum: '频谱声谱', log: '日志', play: '播放管理', audio: '音频输出'
  };
  const DEFAULTS = [
    {id: 'builtin-convert', name: '文件转码', desc: '文件选择 · 批处理 · 日志', modules: ['browse', 'task', 'log']},
    {id: 'builtin-organize', name: '文件整理', desc: '文件选择 · 目标路径（移动/复制）', modules: ['browse', 'tree']},
    {id: 'builtin-listen', name: '听歌', desc: '文件选择 · 播放管理', modules: ['browse', 'play']}
  ];

  function modulesOf(s) {
    if (!s) return [];
    if (Array.isArray(s.modules)) return s.modules;
    return Array.isArray(s.mods) ? s.mods : [];
  }
  function obj(key) {
    const v = Store.get(key, {});
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  }
  function customs() {
    const a = Store.get(STORE, []);
    return Array.isArray(a) ? a.filter(x => x && x.id && modulesOf(x).length) : [];
  }
  function saveCustom(list) { Store.set(STORE, list); }
  function overrides() { return obj(OVERRIDES); }
  function saveOverrides(o) { Store.set(OVERRIDES, o); }
  function hiddenIds() {
    const a = Store.get(HIDDEN, []);
    return Array.isArray(a) ? a.filter(Boolean) : [];
  }
  function nameKey(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function sceneName(s) { return isBuiltin(s) ? tr(s.name) : String(s.name || ''); }
  function sceneDesc(s) {
    if (isBuiltin(s) && !s.custom) return tr(s.desc);
    return modulesOf(s).map(modLabel).join(' · ');
  }

  function all() {
    const hid = hiddenIds();
    const ov = overrides();
    const list = customs();
    // 用户已有同名场景优先；即使新版 App 又带了同名默认场景，也不能顶掉它。
    const customNames = new Set();
    list.forEach(x => {
      customNames.add(nameKey(x.name));
      customNames.add(nameKey(sceneName(x)));
    });
    const defaults = DEFAULTS.filter(d =>
      hid.indexOf(d.id) < 0 &&
      !customNames.has(nameKey(d.name)) &&
      !customNames.has(nameKey(tr(d.name)))
    ).map(d => {
      const o = ov[d.id];
      if (!o || !modulesOf(o).length) return d;
      return Object.assign({}, d, o, {
        id: d.id,
        name: d.name,                 // 保留内置场景原始名，语言切换后仍能翻译
        desc: d.desc,
        modules: modulesOf(o),
        geo: o.geo || {},
        uiScale: o.uiScale,
        canvas: o.canvas,
        custom: true
      });
    });
    return defaults.concat(list.filter(x => hid.indexOf(x.id) < 0).map(x =>
      Object.assign({}, x, {modules: modulesOf(x), custom: true})));
  }

  const WIN = {
    browse: 'fw-browse', task: 'fw-task', tree: 'fw-tree', play: 'play-float',
    audio: 'audio-float', meta: 'meta-float', spectrum: 'spectrum-float', log: 'log-float'
  };

  function esc(s) { return Utils.escapeHtml(String(s == null ? '' : s)); }
  function tr(s) { return (typeof I18n !== 'undefined') ? I18n.t(s) : s; }
  function modLabel(m) { return tr(LABEL[m] || m); }
  function isBuiltin(s) { return !!(s && String(s.id || '').indexOf('builtin-') === 0); }

  /* 窗口几何是 WinMgr 持久化的逻辑尺寸；scale 是该窗口自己的缩放。 */
  function snapshotGeo(mods) {
    const geo = {};
    mods.forEach(m => {
      const id = WIN[m];
      if (!id) return;
      const g = Store.get('ac3_geo_' + id, null);
      if (!g || !Number.isFinite(Number(g.w)) || !Number.isFinite(Number(g.h))) return;
      geo[id] = {
        x: Number.isFinite(Number(g.x)) ? Number(g.x) : 0,
        y: Number.isFinite(Number(g.y)) ? Number(g.y) : 0,
        w: Number(g.w), h: Number(g.h),
        scale: Number.isFinite(Number(g.scale)) ? Number(g.scale) : 1
      };
    });
    return geo;
  }

  /* 导出内置场景的当前版本：即使没有点“覆盖”，也把当前窗口几何一起带上。
     这是给仓库默认配置用的快照，不改变本机任何设置。 */
  function exportBuiltins() {
    const ov = overrides();
    return DEFAULTS.map(d => {
      const o = ov[d.id] || {};
      const modules = modulesOf(o).length ? modulesOf(o) : modulesOf(d);
      const geo = (o.geo && Object.keys(o.geo).length) ? o.geo : snapshotGeo(modules);
      const uiScale = Number.isFinite(Number(o.uiScale)) && Number(o.uiScale) > 0
        ? Number(o.uiScale) : (Number(Store.get('ac3_ui_scale', 1)) || 1);
      const canvas = o.canvas && Number.isFinite(Number(o.canvas.x)) && Number.isFinite(Number(o.canvas.y))
        ? {x: Number(o.canvas.x), y: Number(o.canvas.y)}
        : (Store.get('ac3_canvas_pan', null) || null);
      return {
        id: d.id, name: d.name, desc: d.desc, modules: modules,
        geo: geo, uiScale: uiScale, canvas: canvas
      };
    });
  }

  /* 把仓库默认配置里的内置场景灌入用户覆盖表。只补缺失的 id，
     绝不覆盖本机已经调好的场景。 */
  function applyDefaults(scenes) {
    if (!Array.isArray(scenes) || !scenes.length) return 0;
    const ov = overrides();
    let n = 0;
    scenes.forEach(s => {
      if (!s || !isBuiltin(s)) return;
      if (!DEFAULTS.some(d => d.id === s.id)) return;
      if (ov[s.id]) return;
      const modules = modulesOf(s);
      if (!modules.length) return;
      ov[s.id] = {
        id: s.id, name: s.name, desc: s.desc,
        modules: modules, geo: s.geo || {},
        uiScale: s.uiScale, canvas: s.canvas, updatedAt: 0
      };
      n++;
    });
    if (n) saveOverrides(ov);
    return n;
  }

  function currentLayout() {
    const modules = App.openModules ? App.openModules() : [];
    if (!modules.length) { Utils.toast('先打开几个模块再保存', 'warn'); return null; }
    // 把当前内存里的位置/尺寸/scale 立刻写回 Store，再快照；否则仅拖动后还未
    // 触发 pointerup 时保存，会拿到上一版几何。
    try { if (typeof WinMgr !== 'undefined' && WinMgr.persistAll) WinMgr.persistAll(); } catch (_) {}
    return {
      modules: modules,
      geo: snapshotGeo(modules),
      uiScale: (App.currentUiScale ? App.currentUiScale() : 1),
      canvas: (App.canvasPan ? App.canvasPan() : null)
    };
  }

  function renderTabs() {
    const tabs = document.getElementById('scene-tabs');
    if (!tabs) return;
    const open = (App.openModules ? App.openModules() : []);
    tabs.innerHTML = all().map(s => {
      const active = modulesOf(s).length === open.length && modulesOf(s).every(m => open.indexOf(m) >= 0);
      return '<button type="button" class="scene-chip' + (active ? ' on' : '') + '" data-scene-id="' +
        esc(s.id) + '" title="' + esc(modulesOf(s).map(modLabel).join(' · ')) + '">' +
        '<span class="scene-name">' + esc(sceneName(s)) + '</span>' +
        '</button>';
    }).join('');
  }

  function render() {
    renderTabs();
    const restore = document.getElementById('scene-restore');
    if (restore) restore.classList.toggle('hidden', hiddenIds().length === 0);
    const grid = document.getElementById('sh-grid');
    if (!grid) return;
    const open = (App.openModules ? App.openModules() : []);
    grid.innerHTML = all().map(s => {
      const active = modulesOf(s).length === open.length && modulesOf(s).every(m => open.indexOf(m) >= 0);
      const desc = modulesOf(s).map(modLabel).join(' · ');
      return '<div class="sh-card' + (active ? ' on' : '') + '" data-id="' + esc(s.id) + '">' +
        '<span class="sh-name">' + esc(sceneName(s)) + '</span>' +
        '<span class="sh-desc">' + esc(sceneDesc(s)) + '</span>' +
        '<b class="sh-del" data-del="' + esc(s.id) + '" title="删除该场景">✕</b>' +
        '</div>';
    }).join('');
  }

  function apply(s) {
    if (!s) return;
    if (App.closeAllModules) App.closeAllModules();
    // 内置场景只有在用户覆盖过（custom=true）时才恢复几何；默认定义永远不能
    // 覆盖用户历史保存的窗口位置/大小/scale。
    const userGeometry = !isBuiltin(s) || !!s.custom;
    if (userGeometry) {
      if (s.uiScale && App.commitUiScale) { try { App.commitUiScale(s.uiScale); } catch (_) {} }
      if (s.canvas && App.setCanvasPan) { try { App.setCanvasPan(s.canvas.x, s.canvas.y, true); } catch (_) {} }
      Object.keys(s.geo || {}).forEach(id => Store.set('ac3_geo_' + id, s.geo[id]));
    }
    modulesOf(s).forEach(m => setTimeout(() => App.openModule(m), 0));
    setTimeout(render, 80);
  }

  function closeSave() {
    const overlay = document.getElementById('scene-save-overlay');
    if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden', 'true'); }
  }

  function openSave() {
    renderSaveList();
    const overlay = document.getElementById('scene-save-overlay');
    if (overlay) { overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden', 'false'); }
  }

  function renderSaveList() {
    const listEl = document.getElementById('ss-list');
    if (!listEl) return;
    const scenes = all();
    listEl.innerHTML = '<button type="button" class="ss-new">＋ 新建场景</button>' +
      scenes.map(s =>
        '<div class="ss-row" data-id="' + esc(s.id) + '">' +
        '<div class="ss-meta"><b>' + esc(sceneName(s)) + '</b><span>' + esc(sceneDesc(s)) + '</span></div>' +
        '<button type="button" class="ss-overwrite" data-overwrite="' + esc(s.id) + '">覆盖</button>' +
        '</div>'
      ).join('');
  }

  function saveCurrent() { openSave(); }

  function createScene() {
    const layout = currentLayout();
    if (!layout) return;
    const raw = prompt('新场景名称：', '');
    if (!raw) return;
    const name = raw.trim().slice(0, 20);
    if (!name) return;
    const exists = all().some(s => nameKey(sceneName(s)) === nameKey(name) || nameKey(s.name) === nameKey(name));
    if (exists) {
      Utils.toast('同名场景已存在，请在列表中选中它进行覆盖，或换一个名称', 'warn');
      return;
    }
    const list = customs();
    list.push({id: 'c' + Date.now(), name: name, modules: layout.modules,
               geo: layout.geo, uiScale: layout.uiScale, canvas: layout.canvas});
    saveCustom(list);
    render();
    renderSaveList();
    closeSave();
    Utils.toast('已保存场景：' + name);
  }

  function overwriteScene(id) {
    const s = all().filter(x => x.id === id)[0];
    if (!s) return;
    const layout = currentLayout();
    if (!layout) return;
    if (!confirm('用当前布局覆盖场景「' + sceneName(s) + '」？\n将同时保存窗口位置、窗口大小和缩放。')) return;
    if (DEFAULTS.some(x => x.id === id)) {
      // 内置场景：覆盖写独立键，App 升级时默认定义不会回写这里。
      const o = overrides();
      o[id] = {
        id: id, name: s.name, desc: s.desc,
        modules: layout.modules, geo: layout.geo,
        uiScale: layout.uiScale, canvas: layout.canvas, updatedAt: Date.now()
      };
      saveOverrides(o);
      Store.set(HIDDEN, hiddenIds().filter(x => x !== id));
    } else {
      const list = customs().map(x => x.id === id
        ? Object.assign({}, x, {modules: layout.modules, geo: layout.geo,
            uiScale: layout.uiScale, canvas: layout.canvas, updatedAt: Date.now()})
        : x);
      saveCustom(list);
    }
    render();
    renderSaveList();
    closeSave();
    Utils.toast('已覆盖场景：' + sceneName(s));
  }

  function remove(id) {
    if (!confirm('删除这个场景？')) return;
    if (DEFAULTS.some(x => x.id === id)) {
      Store.set(HIDDEN, hiddenIds().concat([id]));
      const o = overrides();
      delete o[id];
      saveOverrides(o);
    } else {
      saveCustom(customs().filter(x => x.id !== id));
    }
    render();
    renderSaveList();
  }

  function init() {
    render();
    const tabs = document.getElementById('scene-tabs');
    if (tabs) {
      tabs.addEventListener('click', e => {
        const chip = e.target.closest('[data-scene-id]');
        if (!chip) return;
        const s = all().filter(x => x.id === chip.dataset.sceneId)[0];
        apply(s);
      });
    }
    const add = document.getElementById('scene-add');
    if (add) add.onclick = openSave;

    const listEl = document.getElementById('ss-list');
    if (listEl) listEl.addEventListener('click', e => {
      if (e.target.closest('.ss-new')) { createScene(); return; }
      const row = e.target.closest('.ss-row');
      if (row) overwriteScene(row.dataset.id);
    });
    const cancel = document.getElementById('ss-cancel');
    if (cancel) cancel.onclick = closeSave;
    const overlay = document.getElementById('scene-save-overlay');
    if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) closeSave(); });

    const restore = document.getElementById('scene-restore');
    if (restore) restore.onclick = () => { Store.remove(HIDDEN); Store.remove(OVERRIDES); render(); };
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

  return {init, render, saveCurrent, renderTabs, openSave, closeSave,
          exportBuiltins, applyDefaults};
})();
