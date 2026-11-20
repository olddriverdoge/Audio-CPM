/* ---------------- FilePicker：应用内单文件选择（封面等，返回 local:/ 路径） ---------------- */
const FilePicker = (() => {
  const IMG = /\.(jpg|jpeg|png|bmp|webp)$/i;
  let m = null, listEl = null, pathEl = null, resolver = null, cur = null;

  function close(val) {
    if (m) { m.remove(); m = null; }
    const r = resolver; resolver = null;
    if (r) r(val || null);
  }

  function ensure() {
    if (m) return;
    m = document.createElement('div');
    m.className = 'fp-modal';
    m.innerHTML =
      '<div class="fp-box">' +
        '<div class="fp-head"><span class="fp-title">选择图片</span>' +
        '<button type="button" class="small" data-fp="up">↑ 上级</button>' +
        '<button type="button" class="small" data-fp="close">✕</button></div>' +
        '<div class="fp-path"></div>' +
        '<div class="fp-list"></div>' +
      '</div>';
    document.body.appendChild(m);
    listEl = m.querySelector('.fp-list');
    pathEl = m.querySelector('.fp-path');
    m.addEventListener('click', e => {
      if (e.target === m) { close(null); return; }
      const act = e.target.closest('[data-fp]');
      if (act) {
        const a = act.dataset.fp;
        if (a === 'close') close(null);
        else if (a === 'up' && cur) go(cur.parent);
        return;
      }
      const row = e.target.closest('.fp-row');
      if (!row) return;
      if (row.dataset.dir) go(row.dataset.dir); else close(row.dataset.path);
    });
  }

  async function go(p) {
    ensure();
    listEl.innerHTML = '<div class="detail-empty">加载中...</div>';
    try {
      const d = await Api.browse(p || '');
      cur = {path: d.path, parent: d.parent};
      pathEl.textContent = d.path;
      const dirs = (d.dirs || []).map(x =>
        '<div class="fp-row" data-dir="' + Utils.escapeHtml(x.path) + '">📁 ' +
        Utils.escapeHtml(x.name) + '</div>');
      const imgs = (d.files || []).filter(f => IMG.test(f.name)).map(f =>
        '<div class="fp-row" data-path="' + Utils.escapeHtml(f.path) + '">' +
        '<img class="fp-thumb" loading="lazy" src="' + Api.imageUrl(f.path) + '">' +
        '<span>' + Utils.escapeHtml(f.name) + '</span></div>');
      listEl.innerHTML = dirs.join('') + (imgs.length ? imgs.join('') :
        '<div class="detail-empty">当前目录没有图片，可进入子目录或上级目录</div>');
      listEl.scrollTop = 0;
    } catch (e) {
      listEl.innerHTML = '<div class="detail-empty" style="color:var(--err)">' +
        Utils.escapeHtml(e.message) + '</div>';
    }
  }

  /* 系统文件选择器：Android 原生 ACTION_OPEN_DOCUMENT，结果由 AudioCpmNative 异步回调。
     返回 null 表示当前环境没有原生选择器（网页版），由 pickCover 回退到应用内选择器。 */
  function pickSystemImage() {
    if (!window.AudioCpmNative || typeof window.AudioCpmNative.pickImage !== 'function') return null;
    return new Promise(resolve => {
      let settled = false;
      const done = val => {
        if (settled) return;
        settled = true;
        try { window.AudioCpmPickResult = null; } catch (_) {}
        resolve(val);
      };
      window.AudioCpmPickResult = raw => {
        let d = null;
        try { d = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) {}
        if (!d) { Utils.toast('系统选择器返回异常', 'err'); done(null); return; }
        if (d.ok && d.path) { done(String(d.path)); return; }
        if (!d.canceled && d.error) Utils.toast('系统选择器失败: ' + d.error, 'err');
        done(null);
      };
      let started = null;
      try { started = JSON.parse(window.AudioCpmNative.pickImage() || '{}'); }
      catch (e) { started = null; }
      if (!started || !started.ok) {
        if (started && started.error && started.error !== 'busy') {
          Utils.toast('系统选择器不可用: ' + started.error, 'warn');
        }
        // undefined 表示原生选择器没起来，pickCover 会回退应用内选择；null 才是用户取消。
        done(undefined);
      }
    });
  }

  /* 替换封面优先系统选择器；只有网页版/无原生桥时才用应用内选择。 */
  function pickCover(startPath) {
    const sys = pickSystemImage();
    if (!sys) return pickImage(startPath);
    return sys.then(v => (v === undefined) ? pickImage(startPath) : v);
  }

  /* 返回 Promise<string|null> */
  function pickImage(startPath) {
    ensure();
    resolver = null;
    return new Promise(res => {
      resolver = res;
      const start = startPath || (typeof App !== 'undefined' ? App.path : '');
      go(start);
    });
  }

  return {pickImage, pickCover, pickSystemImage};
})();
