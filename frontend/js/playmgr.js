/* ---------------- PlayMgr ---------------- */
const PlayMgr = (() => {
  let list = Store.get(K.played, []);
  if (!Array.isArray(list)) list = [];
  const set = new Set(list);

  function persist() { Store.set(K.played, list.slice(0, 200)); }
  function markPlayed(p) {
    if (!p) return;
    list = [p].concat(list.filter(x => x !== p)).slice(0, 200);
    set.add(p);
    persist();
  }
  function isPlayed(p) { return set.has(p); }
  function countIn(paths) {
    let n = 0;
    for (const p of paths) if (set.has(p)) n++;
    return n;
  }
  async function playExternal(path) {
    if (!path) return;
    try {
      const r = await Api.play(path, Settings.playerPkg(), Settings.playerActivity());
      if (r.status === 'ok') {
        Utils.toast('已发送播放请求');
        markPlayed(path);
        App.onPlayed(path);
      } else if (r.status === 'blocked') {
        Utils.toast('该文件不在公共存储，系统播放器无法访问', 'warn');
        Utils.log('warn', '播放被阻止（非公共存储）: ' + path);
      } else {
        Utils.toast('播放失败: ' + (r.message || '未知错误'), 'err');
        Utils.log('err', '播放失败: ' + (r.message || ''));
      }
    } catch (e) {
      Utils.toast('播放失败: ' + e.message, 'err');
    }
  }
  async function play(path, startRatio) {
    if (!path) return;
    if (Settings.playMode() === 'system') return playExternal(path);
    if (Player.current === path && !startRatio) { Player.toggle(); return; }  // 同一首：播放 / 暂停
    try {
      await Player.open(path, startRatio);
      markPlayed(path);
      App.onPlayed(path);
    } catch (e) {
      Utils.toast('播放失败: ' + e.message, 'err');
    }
  }
  return {play, playExternal, markPlayed, isPlayed, countIn, all: () => list.slice()};
})();
