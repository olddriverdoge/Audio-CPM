/* ---------------- Defaults（界面默认配置导出 / 首次安装注入） ----------------
 * 用户在设置里点“导出当前配置”，把本机人工调好的 3 个内置场景、频谱/声谱
 * 参数和文件列表表头打成 JSON。导出文件可以直接放到 frontend/defaults.json，
 * 生产包与测试包都会在首次启动时补入缺失的配置，但绝不覆盖本机已有值。
 */
const Defaults = (() => {
  const SCHEMA = 'audio-cpm-ui-defaults';
  const SCHEMA_VERSION = 1;
  const MARKER = 'ac3_defaults_applied';
  // 只导出“外观/默认布局”，不碰路径、最近文件、更新状态、存储源密码等个人状态。
  const PREF_KEYS = [
    'ac2_view_mode', 'ac2_grid_size', 'ac2_sort_by', 'ac2_sort_order', 'ac2_folder_order',
    'ac2_layout_split3', 'ac2_tree_collapsed', 'ac3_ui_scale', 'ac3_canvas_pan',
    'ac2_columns', 'ac2_columns_s2',
    'ac2_spectrum_size', 'ac2_spectrum_mode', 'ac2_spectrum_pos', 'ac2_spectrum_delay',
    'ac2_spectrum_x', 'ac2_spectrum_db', 'ac2_spectrum_rel',
    'ac2_spectrum_peak', 'ac2_spectrum_bars', 'ac2_spectrum_stop', 'ac2_wf_bright',
    'ac2_wf_top', 'ac2_wf_grid', 'ac2_wf_pal', 'ac2_wf_bands', 'ac2_wf_y',
    'ac2_win_spectrum', 'ac2_fab_spectrum', 'ac2_fab_meta', 'ac2_fab_move', 'ac2_fab_log',
    'ac2_win_log', 'ac2_meta_pos', 'ac2_meta_size', 'ac2_move_pos', 'ac2_movebar_collapsed',
    'ac2_meta_collapsed', 'ac2_meta1_collapsed',
    'ac3_audio_cfg', 'ac2_play_mode', 'ac2_autoplay'
  ];

  function hasKey(key) {
    try { return localStorage.getItem(key) !== null; } catch (_) { return false; }
  }
  function prefValue(key) {
    try { return Store.get(key, null); } catch (_) { return null; }
  }

  function snapshot() {
    const prefs = {};
    PREF_KEYS.forEach(key => {
      if (!hasKey(key)) return;
      const v = prefValue(key);
      if (v === null || v === undefined) return;
      prefs[key] = v;
    });
    return {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      defaultScenes: (typeof SceneStore !== 'undefined' && SceneStore.exportBuiltins)
        ? SceneStore.exportBuiltins() : [],
      // 记录源设备视口，换手机/横竖屏时 SceneStore 用 Adaptive 等比适配，
      // 不再把某一台手机的绝对 x/y/w/h 原样搬到另一台设备。
      viewport: (typeof Adaptive !== 'undefined'
        ? (() => { const v = Adaptive.currentViewport(); return {w: v.w, h: v.h, dpr: devicePixelRatio || 1}; })()
        : {w: window.innerWidth, h: window.innerHeight, dpr: devicePixelRatio || 1}),
      prefs: prefs
    };
  }

  async function exportCurrent() {
    const body = snapshot();
    const r = await fetch('/api/ui/defaults/export', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    let data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || !data.ok) {
      throw new Error(data.error || data.detail || ('HTTP ' + r.status));
    }
    return data;
  }

  async function apply(force) {
    // 自动化测试需要可复现的原始默认，显式 ?defaults=0 跳过仓库 bundle；
    // 生产环境不带该参数，首次启动仍会注入用户导出的真实配置。
    try {
      if (!force && new URLSearchParams(location.search).get('defaults') === '0') return 0;
    } catch (_) {}
    let data = null;
    try {
      const r = await fetch('/defaults.json?t=' + Date.now(), {cache: 'no-store'});
      if (!r.ok) return 0;
      data = await r.json();
    } catch (_) { return 0; }
    if (!data || data.schema !== SCHEMA) return 0;
    const hasContent = (Array.isArray(data.defaultScenes) && data.defaultScenes.length)
      || (data.prefs && Object.keys(data.prefs).length);
    if (!hasContent) return 0;
    const revision = String(data.revision || data.exportedAt || data.schemaVersion || SCHEMA_VERSION);
    try {
      if (localStorage.getItem(MARKER) === revision) return 0;
    } catch (_) {}
    let changed = 0;
    try {
      changed += (SceneStore.applyDefaults(data.defaultScenes || [], data.viewport || null) || 0);
    } catch (_) {}
    const prefs = data.prefs && typeof data.prefs === 'object' ? data.prefs : {};
    Object.keys(prefs).forEach(key => {
      if (hasKey(key)) return;
      const v = prefs[key];
      if (v === null || v === undefined) return;
      try { Store.set(key, v); changed++; } catch (_) {}
    });
    try { localStorage.setItem(MARKER, revision); } catch (_) {}
    return changed;
  }

  function init() {
    const btn = document.getElementById('cfg-export');
    const link = document.getElementById('cfg-export-link');
    const state = document.getElementById('cfg-export-state');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        if (state) state.textContent = I18n.tr('导出中…');
        try {
          const d = await exportCurrent();
          if (state) state.textContent = I18n.tr('已导出 {n} 个场景 / {p} 项设置', {
            n: d.scenes || 0, p: d.prefs || 0
          });
          if (link) {
            const href = new URL(d.download || '/api/ui/defaults/export', location.href).href;
            link.href = href;
            link.dataset.url = href;
            link.classList.remove('hidden');
            link.textContent = I18n.tr('下载配置 JSON');
          }
          Utils.toast(I18n.tr('配置已导出，可下载 JSON'));
        } catch (e) {
          if (state) state.textContent = I18n.tr('导出失败');
          Utils.toast(I18n.tr('导出失败：{msg}', {msg: (e && e.message) || e}), 'err');
        } finally {
          btn.disabled = false;
        }
      });
    }
    if (link) {
      link.addEventListener('click', e => {
        const b = window.AudioCpmNative;
        if (!b || typeof b.openExternalUrl !== 'function') return;
        e.preventDefault();
        try {
          const r = JSON.parse(b.openExternalUrl(link.href) || '{}');
          if (!r.ok) Utils.toast(I18n.tr('无法打开浏览器，请手动访问 ') + link.href, 'warn');
        } catch (_) {
          Utils.toast(I18n.tr('无法打开浏览器，请手动访问 ') + link.href, 'warn');
        }
      });
    }
    // 控制台入口：AC2ExportDefaults() 也会收集当前 localStorage 并 POST 到本机服务。
    window.AC2ExportDefaults = () => exportCurrent();
  }

  return {apply, init, snapshot, exportCurrent};
})();
