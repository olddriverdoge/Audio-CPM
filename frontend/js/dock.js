/* ---------------- Dock：贴边悬浮按钮（收起态可拖动、松手自动左右贴边） ---------------- */
const Dock = (() => {
  const PAD = 8;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* 收起态按钮：竖向可拖，松手吸附到最近的一侧；位置记忆 */
  function bindFab(fab, storeKey, defSide) {
    if (!fab) return {place() {}};
    let st = Store.get(storeKey, null);
    if (!st || !Number.isFinite(Number(st.y))) st = null;
    function place() {
      if (!st) {   // 没有记忆就用 CSS 默认位置
        fab.style.top = ''; fab.style.bottom = ''; fab.style.left = ''; fab.style.right = '';
        return;
      }
      const w = fab.offsetWidth || 90, h = fab.offsetHeight || 30;
      fab.style.top = clamp(Number(st.y), 4, window.innerHeight - h - 4) + 'px';
      fab.style.bottom = 'auto';
      fab.style.left = st.side === 'left' ? PAD + 'px' : 'auto';
      fab.style.right = st.side === 'right' ? PAD + 'px' : 'auto';
    }
    let st0 = null, moved = false;
    fab.addEventListener('pointerdown', e => {
      const r = fab.getBoundingClientRect();
      st0 = {x: e.clientX, y: e.clientY, l: r.left, t: r.top};
      moved = false;
      fab.style.left = Math.round(r.left) + 'px';
      fab.style.right = 'auto';
      fab.style.top = Math.round(r.top) + 'px';
      fab.style.bottom = 'auto';
      try { fab.setPointerCapture(e.pointerId); } catch (_) {}
    });
    fab.addEventListener('pointermove', e => {
      if (!st0) return;
      const dx = e.clientX - st0.x, dy = e.clientY - st0.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      const w = fab.offsetWidth || 90, h = fab.offsetHeight || 30;
      fab.style.left = clamp(st0.l + dx, 2, window.innerWidth - w - 2) + 'px';
      fab.style.top = clamp(st0.t + dy, 2, window.innerHeight - h - 2) + 'px';
      if (e.cancelable) e.preventDefault();
    });
    const up = () => {
      if (!st0) return;
      st0 = null;
      if (!moved) { place(); return; }   // 没拖动就维持原位置，交给 click 打开
      const r = fab.getBoundingClientRect();
      st = {side: (r.left + r.width / 2) < window.innerWidth / 2 ? 'left' : 'right',
            y: Math.round(clamp(r.top, 4, window.innerHeight - r.height - 4))};
      Store.set(storeKey, st);
      fab.classList.add('snapping');
      place();
      setTimeout(() => fab.classList.remove('snapping'), 160);
    };
    ['pointerup', 'pointercancel'].forEach(t => fab.addEventListener(t, up));
    // 拖动结束后浏览器仍会补一个 click，拦住它，避免"拖完就展开"
    fab.addEventListener('click', e => {
      if (moved) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); moved = false; }
    }, true);
    window.addEventListener('resize', place);
    place();
    return {place, get state() { return st; }};
  }

  /* 展开态浮窗：完全自由定位（不吸附边缘），位置记忆 */
  function bindWin(box, head, storeKey) {
    if (!box || !head) return {apply() {}};
    function apply() {
      const st = Store.get(storeKey, null);
      if (st && Number.isFinite(Number(st.x)) && Number.isFinite(Number(st.y))) {
        box.style.left = clamp(Number(st.x), 2, window.innerWidth - 60) + 'px';
        box.style.top = clamp(Number(st.y), 2, window.innerHeight - 40) + 'px';
        box.style.right = 'auto'; box.style.bottom = 'auto';
      }
    }
    let st0 = null;
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = box.getBoundingClientRect();
      st0 = {x: e.clientX, y: e.clientY, l: r.left, t: r.top};
      box.style.left = Math.round(r.left) + 'px';
      box.style.top = Math.round(r.top) + 'px';
      box.style.right = 'auto'; box.style.bottom = 'auto';
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      if (e.cancelable) e.preventDefault();
    });
    head.addEventListener('pointermove', e => {
      if (!st0) return;
      const w = box.offsetWidth || 300, h = box.offsetHeight || 160;
      box.style.left = clamp(st0.l + e.clientX - st0.x, 2, window.innerWidth - w - 2) + 'px';
      box.style.top = clamp(st0.t + e.clientY - st0.y, 2, window.innerHeight - h - 2) + 'px';
      if (e.cancelable) e.preventDefault();
    });
    ['pointerup', 'pointercancel'].forEach(t => head.addEventListener(t, () => {
      if (!st0) return;
      st0 = null;
      const r = box.getBoundingClientRect();
      Store.set(storeKey, {x: Math.round(r.left), y: Math.round(r.top)});
    }));
    window.addEventListener('resize', () => {
      if (!Store.get(storeKey, null)) return;
      const r = box.getBoundingClientRect();
      box.style.left = clamp(r.left, 2, window.innerWidth - 60) + 'px';
      box.style.top = clamp(r.top, 2, window.innerHeight - 40) + 'px';
    });
    return {apply};
  }

  return {bindFab, bindWin};
})();
