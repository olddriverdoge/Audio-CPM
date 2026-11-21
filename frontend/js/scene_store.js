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
        viewport: o.viewport,
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
  function applyDefaults(scenes, viewport) {
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
        uiScale: s.uiScale, canvas: s.canvas,
        // 记住这份几何是在哪个视口下导出的；换手机/转屏时由 Adaptive 等比适配。
        viewport: viewport || (typeof Adaptive !== 'undefined' ? Adaptive.inferViewport(s.geo || {}) : null),
        updatedAt: 0
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
      canvas: (App.canvasPan ? App.canvasPan() : null),
      viewport: (typeof Adaptive !== 'undefined' ? (() => {
        const v = Adaptive.currentViewport();
        return {w: v.w, h: v.h};
      })() : null)
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
    const fitted = (typeof Adaptive !== 'undefined' && s.viewport)
      ? Adaptive.fitScene(s, s.viewport, {force: false}) : s;
    const userGeometry = !isBuiltin(s) || !!s.custom;
    if (userGeometry) {
      if (fitted.uiScale && App.commitUiScale) { try { App.commitUiScale(fitted.uiScale); } catch (_) {} }
      if (fitted.canvas && App.setCanvasPan) { try { App.setCanvasPan(fitted.canvas.x, fitted.canvas.y, true); } catch (_) {} }
      Object.keys(fitted.geo || {}).forEach(id => Store.set('ac3_geo_' + id, fitted.geo[id]));
    }
    modulesOf(s).forEach(m => setTimeout(() => App.openModule(m), 0));
    setTimeout(render, 80);
    // 只有用户自己的场景（或已覆盖过的内置场景）才落它保存的几何。
    // 内置场景的默认定义永远不能覆盖用户历史尺寸，也不再调用 fitCurrent
    // 去“重排所有窗口”，否则刚打开就会把用户调好的大小改回默认。
    if (userGeometry && fitted !== s) {
      setTimeout(() => {
        Object.keys(fitted.geo || {}).forEach(id => {
          const g = fitted.geo[id];
          const el = document.getElementById(id);
          const ctl = el && WinMgr.find(el);
          if (ctl && ctl.place) ctl.place({x: g.x, y: g.y, w: g.w * (fitted.uiScale || 1), h: g.h * (fitted.uiScale || 1)}, true);
        });
      }, 180);
    }
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
        '<div class="ss-row" data-id="' + esc(s.id) + '" role="button" tabindex="0" ' +
        'title="用当前布局更新「' + esc(sceneName(s)) + '」">' +
        '<div class="ss-meta"><b>' + esc(sceneName(s)) + '</b><span>' + esc(sceneDesc(s)) + '</span></div>' +
        '<span class="ss-update" aria-hidden="true">点击更新</span>' +
        '</div>'
      ).join('');
  }

  function saveCurrent() { openSave(); }

  /* 行点击即可用当前布局更新已有场景：不再保留单独的「覆盖」按钮，
     但仍保留一次确认，避免误点把调好的布局冲掉。 */
  function overwriteScene(id) {
    const s = all().filter(x => x.id === id)[0];
    if (!s) return;
    const layout = currentLayout();
    if (!layout) return;
    if (!confirm('用当前布局更新场景「' + sceneName(s) + '」？\n会同时保存窗口位置、窗口大小和缩放。')) return;
    if (isBuiltin(s)) {
      const o = overrides();
      o[id] = Object.assign({}, o[id] || {}, {
        id: id, name: s.name, desc: s.desc,
        modules: layout.modules, geo: layout.geo,
        uiScale: layout.uiScale, canvas: layout.canvas,
        viewport: layout.viewport, updatedAt: Date.now()
      });
      saveOverrides(o);
      Store.set(HIDDEN, hiddenIds().filter(x => x !== id));
    } else {
      const list = customs().map(x => x.id === id
        ? Object.assign({}, x, {modules: layout.modules, geo: layout.geo,
            uiScale: layout.uiScale, canvas: layout.canvas,
            viewport: layout.viewport, updatedAt: Date.now()})
        : x);
      saveCustom(list);
    }
    render();
    renderSaveList();
    closeSave();
    Utils.toast('已更新场景：' + sceneName(s));
  }

  function createScene() {
    const layout = currentLayout();
    if (!layout) return;
    const raw = prompt('新场景名称：', '');
    if (!raw) return;
    const name = raw.trim().slice(0, 20);
    if (!name) return;
    const exists = all().some(s => nameKey(sceneName(s)) === nameKey(name) || nameKey(s.name) === nameKey(name));
    if (exists) {
      Utils.toast('同名场景已存在，请换一个名称', 'warn');
      return;
    }
    const list = customs();
    list.push({id: 'c' + Date.now(), name: name, modules: layout.modules,
               geo: layout.geo, uiScale: layout.uiScale, canvas: layout.canvas,
               viewport: layout.viewport});
    saveCustom(list);
    render();
    renderSaveList();
    closeSave();
    Utils.toast('已保存场景：' + name);
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

  /* 转屏/窗口宽高比例变化：把当前已打开场景按新方向重排，避免横屏时
     只在纵向等比缩小。用户手动拖动后的自由布局仍然保留，直到下一次转屏。 */
  let lastLandscape = null;
  /* 以“当前实际窗口几何”为源做自适应，而不是拿回场景里保存的旧几何：
     视口变化只允许把跑出屏幕的窗口收回、或真正转屏时重排，
     绝不把用户调过的尺寸/位置覆盖成场景默认值。 */
  function fitCurrent(opts) {
    const force = !!(opts && opts.force);
    if (typeof Adaptive === 'undefined' || typeof WinMgr === 'undefined') return false;
    const mods = (App.openModules ? App.openModules() : []);
    if (!mods.length) return false;
    const vp = Adaptive.currentViewport();
    /* 真正转屏且横屏时才按左右分列重排；其余情况只把跑出可视区的窗口
       收回来，绝不因为窗口之间正常重叠/顺序而重排成默认尺寸。 */
    if (force && Adaptive.isLandscape(vp)) {
      const live = snapshotGeo(mods);
      if (!Object.keys(live).length) return false;
      const fitted = Adaptive.fitScene({modules: mods, geo: live,
        uiScale: (App.currentUiScale ? App.currentUiScale() : 1)}, vp, {force: true});
      const z = Number(fitted.uiScale) || 1;
      if (App.commitUiScale) { try { App.commitUiScale(z); } catch (_) {} }
      Object.keys(fitted.geo || {}).forEach(id => {
        const g = fitted.geo[id];
        const el = document.getElementById(id);
        const ctl = el && WinMgr.find(el);
        if (ctl && ctl.place) ctl.place({x: g.x, y: g.y, w: g.w * z, h: g.h * z}, true);
      });
      return true;
    }
    let changed = false;
    mods.forEach(m => {
      const id = WIN[m];
      const el = id && document.getElementById(id);
      if (!el || el.classList.contains('hidden')) return;
      const ctl = WinMgr.find(el);
      if (!ctl || !ctl.rect) return;
      const cur = Object.assign({}, ctl.rect);
      const maxW = Math.max(120, vp.right - vp.left);
      const maxH = Math.max(120, vp.bottom - vp.top);
      let w = cur.w, h = cur.h;
      // 只在明显超出可用区（>110%）时才压缩，避免普通抖动把尺寸改小。
      if (w > maxW * 1.1) w = maxW;
      if (h > maxH * 1.1) h = maxH;
      w = Math.min(w, maxW); h = Math.min(h, maxH);
      const x = Math.max(vp.left, Math.min(cur.x, vp.right - w));
      const y = Math.max(vp.top, Math.min(cur.y, vp.bottom - h));
      if (Math.abs(w - cur.w) > 2 || Math.abs(h - cur.h) > 2
          || Math.abs(x - cur.x) > 2 || Math.abs(y - cur.y) > 2) {
        ctl.place({x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h)}, true);
        changed = true;
      }
    });
    return changed;
  }
  function watchOrientation() {
    if (typeof Adaptive === 'undefined') return;
    lastLandscape = Adaptive.isLandscape();
    let w0 = window.innerWidth, h0 = window.innerHeight, pending = 0;
    /* 只有窗口的宽高真的发生了方向性变化（长边/短边互换）才重排；
       Android 上状态栏/地址栏/播放条出现带来的几十像素抖动不算转屏，
       否则会把用户调好的窗口尺寸一遍遍改回场景默认值。 */
    const realFlip = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const crossed = (w > h) !== (w0 > h0);
      const swapped = Math.abs(w - h0) < 120 && Math.abs(h - w0) < 120;
      const delta = Math.abs(w - w0) > 80 || Math.abs(h - h0) > 80;
      return (crossed || swapped) && delta;
    };
    const check = () => {
      if (pending) { clearTimeout(pending); pending = 0; }
      pending = setTimeout(() => {
        pending = 0;
        const now = Adaptive.isLandscape();
        if (!realFlip() || now === lastLandscape) return;
        lastLandscape = now;
        w0 = window.innerWidth; h0 = window.innerHeight;
        setTimeout(() => fitCurrent({force: true}), 180);
        setTimeout(() => fitCurrent({force: true}), 500);
      }, 150);
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', () => {
      setTimeout(() => { w0 = window.innerWidth; h0 = window.innerHeight; }, 120);
      setTimeout(check, 150);
    });
  }

  function init() {
    watchOrientation();
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
    if (listEl) listEl.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.ss-row');
      if (!row) return;
      e.preventDefault();
      overwriteScene(row.dataset.id);
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
          exportBuiltins, applyDefaults, fitCurrent};
})();
