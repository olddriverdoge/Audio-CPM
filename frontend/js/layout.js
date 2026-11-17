/* ---------------- Layout ---------------- */
const Layout = (() => {
  let rightEl = null, srcEl = null, treeCollapsed = true;

  function bindSplit(el, onMove, onEnd) {
    if (!el) return;                       // 工作台改造后分隔条可能不存在
    let dragging = false;
    const move = e => {
      if (!dragging) return;
      onMove(e.clientX, e.clientY);
      if (e.cancelable) e.preventDefault();
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      w.removeEventListener('pointermove', move);
      w.removeEventListener('pointerup', up);
      w.removeEventListener('pointercancel', up);
      if (onEnd) onEnd();
    };
    const w = el.ownerDocument.defaultView || window;
    el.addEventListener('pointerdown', e => {
      dragging = true;
      el.classList.add('dragging');
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      w.addEventListener('pointermove', move);
      w.addEventListener('pointerup', up);
      w.addEventListener('pointercancel', up);
      if (e.cancelable) e.preventDefault();
    });
  }

  function init() {
    const right = document.getElementById('m2-right');
    const src = document.getElementById('m2-src');
    const split3 = document.getElementById('split3');

    let r3 = Utils.clamp(Number(Store.get(K.split3, 0.45)) || 0.45, 0.15, 0.8);
    function apply() {
      if (src) src.style.flex = '0 0 ' + (r3 * 100).toFixed(2) + '%';
    }
    apply();

    /* 目标目录默认收起：只留标题行，点开显示标签/路径/树 */
    const treeEl = document.getElementById('m2-tree');
    const treeHead = document.getElementById('tree-head');
    const treeCaret = document.getElementById('tree-caret');
    treeCollapsed = Store.get(K.treeCollapsed, true) !== false;
    function applyTree() {
      if (!treeEl) return;
      treeEl.classList.toggle('collapsed', treeCollapsed);
      if (right) right.classList.toggle('tree-collapsed', treeCollapsed);
      if (treeCaret) treeCaret.textContent = treeCollapsed ? '▸' : '▾';
    }
    if (treeHead) {
      treeHead.addEventListener('click', () => {
        treeCollapsed = !treeCollapsed;
        Store.set(K.treeCollapsed, treeCollapsed);
        applyTree();
      });
    }
    applyTree();

    bindSplit(split3, (x, y) => {
      if (!right) return;
      const rect = right.getBoundingClientRect();
      if (rect.height <= 0) return;
      r3 = Utils.clamp((y - rect.top) / rect.height, 0.15, 0.8);
      apply();
    }, () => Store.set(K.split3, r3));
  }
  return {init};
})();
