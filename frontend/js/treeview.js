/* ---------------- TreeView ---------------- */
function createTreeView(opts) {
  const container = opts.container;
  const esc = Utils.escapeHtml;
  const nodeMap = new Map();
  let root = '';
  let selected = null;

  function expKey() { return 'ac2_tree_expanded_' + Utils.hash(root); }
  function saveExpanded() {
    const arr = [];
    container.querySelectorAll('.tree-node').forEach(n => {
      const kids = n.querySelector('.tree-children');
      if (kids && kids.style.display !== 'none') arr.push(n.dataset.path);
    });
    Store.set(expKey(), arr.slice(0, 60));
  }
  function savedExpanded() {
    const v = Store.get(expKey(), []);
    return Array.isArray(v) ? v : [];
  }

  function childNodes(node) {
    const kids = node.querySelector('.tree-children');
    if (!kids) return [];
    return Array.from(kids.children).filter(x => x.classList && x.classList.contains('tree-node'));
  }

  function makeNode(path, depth, name, hasChildren) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.dataset.path = path;
    node.dataset.depth = String(depth);
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = (depth * 14 + 2) + 'px';
    row.innerHTML = '<span class="tri">▶</span>' +
      '<span class="icon">📁</span>' +
      '<span class="tname">' + esc(name) + '</span>';
    if (!hasChildren) row.querySelector('.tri').style.visibility = 'hidden';
    const kids = document.createElement('div');
    kids.className = 'tree-children';
    kids.style.display = 'none';
    node.appendChild(row);
    node.appendChild(kids);
    nodeMap.set(path, node);
    return node;
  }

  async function loadChildren(node) {
    if (node.dataset.loaded === '1') return;
    const path = node.dataset.path;
    const kids = node.querySelector('.tree-children');
    const depth = parseInt(node.dataset.depth || '0', 10);
    const r = await Api.tree(path);
    node.dataset.loaded = '1';
    kids.innerHTML = '';
    if (!r.children || !r.children.length) {
      kids.innerHTML = '<div class="tree-empty">（无子目录）</div>';
      return;
    }
    for (const c of r.children) {
      kids.appendChild(makeNode(c.path, depth + 1, c.name, c.has_children));
    }
  }

  async function expandNode(node) {
    try {
      await loadChildren(node);
    } catch (e) {
      Utils.toast('读取目录失败: ' + e.message, 'err');
      return false;
    }
    node.querySelector('.tree-children').style.display = '';
    node.querySelector('.tri').textContent = '▼';
    saveExpanded();
    return true;
  }
  function collapseNode(node) {
    node.querySelector('.tree-children').style.display = 'none';
    node.querySelector('.tri').textContent = '▶';
    saveExpanded();
  }
  async function toggleNode(node) {
    const kids = node.querySelector('.tree-children');
    if (kids.style.display === 'none') await expandNode(node);
    else collapseNode(node);
  }
  function hasKids(node) {
    const tri = node.querySelector('.tri');
    return tri && tri.style.visibility !== 'hidden';
  }

  function selectNode(path) {
    selected = path;
    container.querySelectorAll('.tree-row.sel').forEach(r => r.classList.remove('sel'));
    const n = nodeMap.get(path);
    if (n) n.querySelector('.tree-row').classList.add('sel');
    if (opts.onSelect) opts.onSelect(path);
  }

  /* 只恢复用户上次手动展开的少量节点；WebDAV 下绝不自动递归拉整棵树 */
  async function autoExpand() {
    const wantSet = new Set(savedExpanded().filter(p => p !== root));
    let budget = 6;
    async function walk(node, depth) {
      if (budget <= 0 || depth > 3) return;
      if (!wantSet.has(node.dataset.path) || !hasKids(node)) return;
      budget--;
      const ok = await expandNode(node);
      if (!ok) return;
      for (const k of childNodes(node)) await walk(k, depth + 1);
    }
    const rootNode = nodeMap.get(root);
    if (rootNode) for (const k of childNodes(rootNode)) await walk(k, 1);
  }

  /* 手动「展开下一层」：只对当前已展开的节点各展开一级，限量 12 次请求 */
  async function expandOneLevel() {
    const vis = [];
    container.querySelectorAll('.tree-node').forEach(n => {
      const kids = n.querySelector('.tree-children');
      if (kids && kids.style.display !== 'none') vis.push(n);
    });
    let budget = 12;
    for (const n of vis) {
      for (const k of childNodes(n)) {
        if (budget <= 0) break;
        if (!hasKids(k)) continue;
        if (k.querySelector('.tree-children').style.display !== 'none') continue;
        budget--;
        await expandNode(k);
      }
      if (budget <= 0) break;
    }
    if (budget <= 0) Utils.toast('已展开一层', 'warn');
  }

  /* 手动「全部收起」：只保留根节点一层 */
  function collapseAll() {
    container.querySelectorAll('.tree-node').forEach(n => {
      if (n === nodeMap.get(root)) return;
      const kids = n.querySelector('.tree-children');
      const tri = n.querySelector('.tri');
      if (kids) kids.style.display = 'none';
      if (tri) tri.textContent = '▶';
    });
    saveExpanded();
    Utils.toast('已收起目标目录');
  }

  let rootSeq = 0;
  async function setRoot(path, opt) {
    if (!path) return;
    const my = ++rootSeq;
    root = path;
    Store.set(K.targetPath, path);
    nodeMap.clear();
    container.innerHTML = '';
    selected = null;
    const rootNode = makeNode(root, 0, Utils.basename(root) || root, true);
    container.appendChild(rootNode);
    const ok = await expandNode(rootNode);
    if (my !== rootSeq) return;
    if (!ok) throw new Error('无法读取目标目录');
    if (!opt || opt.expand2 !== false) await autoExpand();
    if (my !== rootSeq) return;
    if (opts.onSelect) opts.onSelect(null);
  }

  function reloadRoot() { return setRoot(root); }

  container.addEventListener('click', async e => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    const node = row.closest('.tree-node');
    if (!node) return;
    if (e.target.closest('.tri')) { await toggleNode(node); return; }
    selectNode(node.dataset.path);
  });

  let pressTimer = null, pressPos = null, pressNode = null;
  function stopPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressPos = null;
    pressNode = null;
  }
  container.addEventListener('pointerdown', e => {
    const row = e.target.closest('.tree-row');
    if (!row || e.target.closest('.tri')) return;
    const node = row.closest('.tree-node');
    if (!node) return;
    pressPos = {x: e.clientX, y: e.clientY};
    pressNode = node;
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (!pressPos || !pressNode) return;
      showMenu(pressNode, pressPos.x, pressPos.y);
      try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) {}
    }, 500);
  });
  container.addEventListener('pointermove', e => {
    if (!pressPos) return;
    if (Math.abs(e.clientX - pressPos.x) > 10 || Math.abs(e.clientY - pressPos.y) > 10) stopPress();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => {
    container.addEventListener(t, stopPress);
  });
  container.addEventListener('contextmenu', e => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    e.preventDefault();
    showMenu(row.closest('.tree-node'), e.clientX, e.clientY);
  });

  const overlay = document.getElementById('menu-overlay');
  const menu = document.getElementById('ctx-menu');

  function showMenu(node, x, y) {
    if (!node) return;
    menu.dataset.path = node.dataset.path;
    menu.innerHTML =
      '<div class="ctx-item" data-cmd="mkdir">新建子文件夹</div>' +
      '<div class="ctx-item" data-cmd="rename">重命名</div>' +
      '<div class="ctx-item danger" data-cmd="rmdir">删除文件夹</div>';
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 140) + 'px';
    overlay.classList.remove('hidden');
  }
  function hideMenu() {
    overlay.classList.add('hidden');
    menu.innerHTML = '';
  }
  overlay.addEventListener('click', e => {
    if (e.target === overlay) hideMenu();
  });
  menu.addEventListener('click', async e => {
    const item = e.target.closest('[data-cmd]');
    if (!item) return;
    const path = menu.dataset.path;
    hideMenu();
    if (item.dataset.cmd === 'mkdir') await doMkdir(path);
    else if (item.dataset.cmd === 'rename') await doRename(path);
    else if (item.dataset.cmd === 'rmdir') await doRmdir(path);
  });

  async function refreshParent(path) {
    const parentPath = Utils.dirname(path);
    const pnode = nodeMap.get(parentPath);
    if (!pnode) return;
    pnode.dataset.loaded = '';
    await expandNode(pnode);
  }

  async function doMkdir(parentPath) {
    const name = prompt('新建文件夹名称：', '');
    if (!name) return;
    try {
      const r = await Api.mkdir(parentPath, name);
      if (!r.ok) { Utils.toast('新建失败: ' + r.error, 'err'); Utils.log('err', '新建失败: ' + r.error, 'organize'); return; }
      const pnode = nodeMap.get(parentPath);
      if (pnode) { pnode.dataset.loaded = ''; await expandNode(pnode); }
      if (nodeMap.has(r.path)) selectNode(r.path);
      Utils.log('ok', '已新建目录: ' + r.path, 'organize');
      if (opts.onTreeChanged) opts.onTreeChanged();
    } catch (e) { Utils.toast('新建失败: ' + e.message, 'err'); Utils.log('err', '新建失败: ' + e.message, 'organize'); }
  }
  async function doRename(path) {
    const oldName = Utils.basename(path);
    const name = prompt('重命名为：', oldName);
    if (!name || name === oldName) return;
    try {
      const r = await Api.renameDir(path, name);
      if (!r.ok) { Utils.toast('重命名失败: ' + r.error, 'err'); Utils.log('err', '重命名失败: ' + r.error, 'organize'); return; }
      if (selected === path) { selected = null; if (opts.onSelect) opts.onSelect(null); }
      await refreshParent(path);
      if (nodeMap.has(r.path)) selectNode(r.path);
      Utils.log('ok', '已重命名: ' + oldName + ' → ' + name, 'organize');
      if (opts.onTreeChanged) opts.onTreeChanged();
    } catch (e) { Utils.toast('重命名失败: ' + e.message, 'err'); Utils.log('err', '重命名失败: ' + e.message, 'organize'); }
  }
  async function doRmdir(path) {
    if (!confirm('删除文件夹？\n' + path + '\n（仅能删除空目录）')) return;
    try {
      const r = await Api.rmdir(path);
      if (!r.ok) { Utils.toast('删除失败: ' + r.error, 'err'); Utils.log('err', '删除目录失败: ' + r.error, 'organize'); return; }
      const node = nodeMap.get(path);
      if (node) {
        const kids = node.querySelectorAll('.tree-node');
        kids.forEach(k => nodeMap.delete(k.dataset.path));
        nodeMap.delete(path);
        node.remove();
      }
      if (selected && (selected === path || selected.indexOf(path + '/') === 0)) {
        selected = null;
        if (opts.onSelect) opts.onSelect(null);
      }
      Utils.log('ok', '已删除目录: ' + path, 'organize');
      if (opts.onTreeChanged) opts.onTreeChanged();
    } catch (e) { Utils.toast('删除失败: ' + e.message, 'err'); Utils.log('err', '删除目录失败: ' + e.message, 'organize'); }
  }

  return {
    setRoot, reloadRoot, selectNode, expandOneLevel, collapseAll,
    get selected() { return selected; },
    get root() { return root; }
  };
}
