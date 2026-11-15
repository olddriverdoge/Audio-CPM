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
  function open() {
    const cs = document.getElementById('cols-sheet');
    if (cs) cs.classList.add('hidden');
    document.getElementById('cfg-playmode').value = playMode();
    document.getElementById('cfg-player').value = playerPkg();
    document.getElementById('cfg-activity').value = playerActivity();
    hint(playerActivity() ? '当前使用 Activity 直连' : '');
    document.getElementById('sheet-overlay').classList.remove('hidden');
    if (typeof UiCfg !== 'undefined') UiCfg.refresh();
  }
  function close() {
    document.getElementById('sheet-overlay').classList.add('hidden');
  }
  function save() {
    const mode = document.getElementById('cfg-playmode').value === 'system' ? 'system' : 'web';
    const pkg = document.getElementById('cfg-player').value.trim();
    const act = document.getElementById('cfg-activity').value.trim();
    if (pkg && !/^[A-Za-z0-9._]+$/.test(pkg)) { hint('包名只能包含字母、数字、点、下划线'); return; }
    if (act && !/^[A-Za-z0-9._]+\/[A-Za-z0-9._$]+$/.test(act)) { hint('Activity 格式应为：包名/Activity'); return; }
    Store.set(K.playMode, mode);
    Store.set(K.playerPkg, pkg);
    Store.set(K.playerAct, act);
    close();
    Utils.toast(mode === 'web' ? '已切换为网页内播放' : '已切换为系统播放器');
    Utils.log('info', '播放方式: ' + (mode === 'web' ? '网页内' : ('系统播放器 ' + (act || pkg || '系统选择'))));
  }
  function reset() {
    document.getElementById('cfg-playmode').value = 'web';
    document.getElementById('cfg-player').value = DEFAULT_PKG;
    document.getElementById('cfg-activity').value = '';
    hint('已恢复默认：网页内播放，点保存生效');
  }
  function init() {
    document.getElementById('btn-player-cfg').onclick = open;
    document.getElementById('cfg-save').onclick = save;
    document.getElementById('cfg-cancel').onclick = close;
    document.getElementById('cfg-reset').onclick = reset;
    document.getElementById('sheet-overlay').addEventListener('click', e => {
      if (e.target.id === 'sheet-overlay') close();
    });
  }
  return {init, open, close, save, playerPkg, playerActivity, playMode};
})();
