/* ---------------- MoveMgr ---------------- */
const MoveMgr = (() => {
  function lg(level, text) { Utils.log(level, text, 'organize'); }
  let pairs = [];
  let ctx = null;

  function bind(c) { ctx = c; update(); }
  function update() {
    const n = ctx && ctx.getSources ? ctx.getSources().length : 0;
    const t = ctx && ctx.getTarget ? ctx.getTarget() : '';
    const cEl = document.getElementById('mv-count');
    if (cEl) cEl.textContent = '已选 ' + n + ' 项';
    const fl = document.getElementById('mv-fab-label');
    if (fl) fl.textContent = n > 0 ? ('移动 ' + n) : '移动';
    const b = document.getElementById('mv-btn');
    if (b) b.disabled = !(n > 0 && !!t);
    const u = document.getElementById('mv-undo');
    if (u) u.disabled = pairs.length === 0;
  }
  async function doMove() {
    if (!ctx) return;
    const sources = ctx.getSources();
    const target = ctx.getTarget();
    const conflict = Store.get(K.conflict, 'skip') || 'skip';
    if (!sources.length) { Utils.toast('请先选择要移动的文件', 'warn'); return; }
    if (!target) { Utils.toast('请先在右侧目录树选择目标', 'warn'); return; }
    if (conflict === 'overwrite' && !confirm('覆盖同名文件？此操作不可撤销（除单级撤销外）')) return;
    const btn = document.getElementById('mv-btn');
    if (btn) btn.disabled = true;
    try {
      const r = await Api.move(sources, target, conflict);
      pairs = (r.results || []).filter(x => x.status === 'ok').map(x => ({src: x.src, dst: x.dst}));
      lg(r.failed ? 'warn' : 'ok',
        '移动完成: 成功 ' + r.moved + ' / 跳过 ' + r.skipped + ' / 失败 ' + r.failed);
      for (const x of (r.results || [])) {
        if (x.status === 'error') {
          lg('err', '移动失败: ' + Utils.basename(x.src) + ' ' + (x.reason || ''));
        }
      }
      await ctx.afterMove();
    } catch (e) {
      Utils.toast('移动失败: ' + e.message, 'err');
      lg('err', '移动失败: ' + e.message);
    } finally {
      update();
    }
  }
  async function doUndo() {
    if (!pairs.length || !ctx) return;
    const list = pairs.slice();
    pairs = [];
    update();
    let ok = 0, bad = 0;
    for (const p of list) {
      try {
        const r = await Api.move([p.dst], Utils.dirname(p.src), 'skip');
        const res = (r.results || [])[0];
        if (res && res.status === 'ok') ok++; else bad++;
      } catch (e) { bad++; }
    }
    lg(bad ? 'warn' : 'ok', '撤销完成: 恢复 ' + ok + ' / 跳过 ' + bad);
    await ctx.afterMove();
    update();
  }
  function clearUndo() { pairs = []; update(); }

  return {bind, update, doMove, doUndo, clearUndo,
          get pairs() { return pairs.slice(); }};
})();
