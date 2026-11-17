/* ---------------- 场景预设：工作台背景的“一键摆好模块”管理界面 ---------------- */
const Scenes = (() => {
  const STORE = 'ac3_scenes';
  const LABEL = {
    browse: '文件浏览', task: '批处理', tree: '目标路径',
    meta: '元数据', spectrum: '频谱声谱', log: '日志', play: '播放管理', audio: '音频输出'
  };
  const DEFAULTS = [
    {id: 'builtin-convert', name: '文件转码', desc: '文件选择 · 批处理 · 日志', mods: ['browse', 'task', 'log']},
    {id: 'builtin-organize', name: '文件整理', desc: '文件选择 · 目标路径（移动/复制）', mods: ['browse', 'tree']},
    {id: 'builtin-listen', name: '听歌', desc: '文件选择 · 播放管理', mods: ['browse', 'play']}
  ];

  function customs() {
    const a = Store.get(STORE, []);
    return Array.isArray(a) ? a.filter(x => x && x.id && Array.isArray(x.mods)) : [];
  }
  function saveCustom(list) { Store.set(STORE, list); }
  function all() { return DEFAULTS.concat(customs().map(x => Object.assign({}, x, {custom: true}))); }

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

  function render() {
    const grid = document.getElementById('sh-grid');
    if (!grid) return;
    const open = (App.openMods ? App.openMods() : []);
    grid.innerHTML = all().map(s => {
      const active = s.mods.length === open.length && s.mods.every(m => open.indexOf(m) >= 0);
      const desc = s.mods.map(m => LABEL[m] || m).join(' · ');
      return '<div class="sh-card' + (active ? ' on' : '') + '" data-id="' + esc(s.id) + '">' +
        '<span class="sh-name">' + esc(s.name) + '</span>' +
        '<span class="sh-desc">' + esc(desc) + '</span>' +
        (s.custom ? '<b class="sh-del" data-del="' + esc(s.id) + '" title="删除该预设">✕</b>' : '') +
        '</div>';
    }).join('');
  }

  function apply(s) {
    if (!s) return;
    if (App.closeAllMods) App.closeAllMods();
    // 先写回几何，再展开：WinMgr 打开时按保存的坐标夹取
    Object.keys(s.geo || {}).forEach(id => Store.set('ac3_geo_' + id, s.geo[id]));
    s.mods.forEach(m => setTimeout(() => App.openMod(m), 0));
    setTimeout(render, 80);
  }

  function saveCurrent() {
    const mods = App.openMods ? App.openMods() : [];
    if (!mods.length) { Utils.toast('先打开几个模块再保存', 'warn'); return; }
    const name = prompt('预设名称：', '');
    if (!name) return;
    const list = customs();
    list.push({id: 'c' + Date.now(), name: name.trim().slice(0, 20), mods: mods,
               geo: snapshotGeo(mods)});
    saveCustom(list);
    render();
    Utils.toast('已保存预设：' + name.trim());
  }

  function remove(id) {
    if (!confirm('删除这个预设？')) return;
    saveCustom(customs().filter(x => x.id !== id));
    render();
  }

  function init() {
    render();
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
    const save = document.getElementById('sh-save');
    if (save) save.onclick = saveCurrent;
  }

  return {init, render, saveCurrent};
})();
