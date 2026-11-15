/* ---------------- Layout ---------------- */
const Layout = (() => {
  let leftEl = null, rowEl = null, metaChev = null, metaCollapsed = true;
  let treeCollapsed = true;

  function applyMeta() {
    if (!leftEl) return;
    leftEl.classList.toggle('collapsed', metaCollapsed);
    if (rowEl) rowEl.classList.toggle('meta-collapsed', metaCollapsed);
    if (metaChev) metaChev.textContent = metaCollapsed ? '▸' : '◂';
  }
  function setMetaCollapsed(v) {
    metaCollapsed = !!v;
    Store.set(K.metaCollapsed, metaCollapsed);
    applyMeta();
  }
  function expandMeta() { if (metaCollapsed) setMetaCollapsed(false); }
  function bindSplit(el, onMove, onEnd) {
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
    const row = document.getElementById('m2-row');
    const left = document.getElementById('m2-left');
    const split2 = document.getElementById('split2');
    const right = document.getElementById('m2-right');
    const src = document.getElementById('m2-src');
    const split3 = document.getElementById('split3');

    let r2 = Utils.clamp(Number(Store.get(K.split2, 0.32)) || 0.32, 0.15, 0.7);
    let r3 = Utils.clamp(Number(Store.get(K.split3, 0.45)) || 0.45, 0.15, 0.8);

    function apply() {
      left.style.flex = '0 0 ' + (r2 * 100).toFixed(2) + '%';
      src.style.flex = '0 0 ' + (r3 * 100).toFixed(2) + '%';
    }
    apply();

    /* 元数据默认贴边收起，点竖排标签展开，省出高度/宽度给右侧模块 */
    leftEl = left;
    rowEl = row;
    metaChev = document.getElementById('meta2-chev');
    metaCollapsed = Store.get(K.metaCollapsed, true) !== false;
    const metaHead = document.getElementById('meta2-head');
    if (metaHead) {
      metaHead.addEventListener('click', () => setMetaCollapsed(!metaCollapsed));
    }
    leftEl.addEventListener('click', e => {
      if (e.target.closest('#meta2-head')) return;  // 标题自己负责切换，避免冒泡后又被展开
      if (metaCollapsed) setMetaCollapsed(false);
    });
    applyMeta();

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

    bindSplit(split2, (x) => {
      const rect = row.getBoundingClientRect();
      if (rect.width <= 0) return;
      r2 = Utils.clamp((x - rect.left) / rect.width, 0.15, 0.7);
      apply();
    }, () => Store.set(K.split2, r2));

    bindSplit(split3, (x, y) => {
      const rect = right.getBoundingClientRect();
      if (rect.height <= 0) return;
      r3 = Utils.clamp((y - rect.top) / rect.height, 0.15, 0.8);
      apply();
    }, () => Store.set(K.split3, r3));
  }
  return {init, expandMeta, setMetaCollapsed,
          get metaCollapsed() { return metaCollapsed; }};
})();
