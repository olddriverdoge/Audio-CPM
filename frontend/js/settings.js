/* ---------------- Settings（播放器配置） ---------------- */
const Settings = (() => {
  const DEFAULT_PKG = 'com.maxmpz.audioplayer';

  function playerPkg() {
    const v = Store.get(K.playerPkg, null);
    if (v === null || v === undefined) return DEFAULT_PKG;
    return String(v || '').trim();
  }
  function playerActivity() {
    return String(Store.get(K.playerAct, '') || '').trim();
  }
  function playMode() {
    return Store.get(K.playMode, 'web') === 'system' ? 'system' : 'web';
  }
  function hint(msg) {
    const el = document.getElementById('cfg-hint');
    if (el) el.textContent = msg || '';
  }
  function paintScale() {
    const sel = document.getElementById('ui-scale');
    if (!sel) return;
    const v = String(Store.get(K.uiScale, 1) || 1);
    sel.value = v;
    if (!sel.value) sel.value = '1';
  }
  function open() {
    paintScale();
    const cs = document.getElementById('cols-sheet');
    if (cs) cs.classList.add('hidden');
    const ps = document.getElementById('player-sheet');
    if (ps) ps.classList.remove('hidden');
    document.getElementById('sheet-overlay').classList.remove('hidden');
  }
  function close() {
    document.getElementById('sheet-overlay').classList.add('hidden');
  }
  function save() {
    // 这里只负责关闭设置页；播放器配置在「音频输出」模块内保存
    close();
  }
  function reset() {}
  function init() {
    document.getElementById('btn-player-cfg').onclick = open;
    const scaleSel = document.getElementById('ui-scale');
    if (scaleSel) {
      paintScale();
      scaleSel.addEventListener('change', () => {
        const v = Number(scaleSel.value);
        if (typeof App !== 'undefined' && App.setUiScale) App.setUiScale(v, true);
      });
    }
    document.getElementById('cfg-save').onclick = save;
    document.getElementById('cfg-cancel').onclick = close;
    const rst = document.getElementById('cfg-reset');
    if (rst) rst.onclick = reset;
    document.getElementById('sheet-overlay').addEventListener('click', e => {
      if (e.target.id === 'sheet-overlay') close();
    });
  }
  return {init, open, close, save, playerPkg, playerActivity, playMode};
})();
