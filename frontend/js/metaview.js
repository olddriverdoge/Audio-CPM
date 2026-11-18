/* ---------------- MetaView ---------------- */
function createMetaView(container, opts) {
  opts = opts || {};
  /* 默认只读：先展示 metadata，点「编辑」才进入可编辑并出现保存按钮 */
  const canEdit = opts.editable !== false;
  const esc = Utils.escapeHtml;
  const tr = s => (typeof I18n !== 'undefined') ? I18n.t(s) : s;
  let curPath = null;
  let curTags = {};
  let curData = null;
  let editing = false;

  function kv(k, v) {
    if (v === undefined || v === null || v === '') return '';
    return '<div class="kv"><span class="k">' + esc(k) + '</span>' +
           '<span class="v">' + esc(String(v)) + '</span></div>';
  }
  function setEmpty(msg) {
    container.innerHTML = '<div class="detail-empty">' + esc(msg) + '</div>';
  }
  function setMsg(text, cls) {
    const el = container.querySelector('.save-msg');
    if (!el) return;
    el.className = 'save-msg ' + (cls || '');
    el.textContent = text;
  }

  function renderTagTable(tags) {
    const wrap = container.querySelector('.tag-edit-wrap');
    if (!wrap) return;
    const keys = Object.keys(tags || {});
    if (!keys.length) {
      wrap.innerHTML = '<div class="detail-empty">无标签，可直接在下方添加</div>';
      return;
    }
    let html = '<table class="tag-edit-table">';
    for (const k of keys) {
      const v = tags[k] == null ? '' : String(tags[k]);
      html += '<tr data-key="' + esc(k) + '">' +
        '<td class="k">' + esc(k) + '</td>' +
        '<td><input type="text" value="' + esc(v) + '" data-orig="' + esc(v) + '"></td>' +
        '<td style="width:20px"><button type="button" class="del-btn" data-act="probe-del" title="删除">×</button></td>' +
        '</tr>';
    }
    wrap.innerHTML = html + '</table>';
  }

  function render(d) {
    if (!d) { setEmpty('无数据'); return; }
    if (d.error) { container.innerHTML = '<div style="color:var(--err)">错误: ' + esc(d.error) + '</div>'; return; }
    const tags = d.tags || {};
    const tagKeys = Object.keys(tags);
    let html = '';

    // 1) 封面优先
    html += '<h3>封面</h3>';
    if (d.has_cover) {
      html += '<div class="cover-box"><img src="' + esc(Api.coverUrl(d.path)) +
        '" data-act="modal" loading="lazy" onerror="this.style.display=\'none\'"></div>';
    } else {
      html += '<div class="detail-empty">无内嵌封面</div>';
    }
    html += '<div class="kv"><span class="k">内嵌封面</span><span class="v">' +
      (d.has_cover ? tr('✓ 有') : tr('✗ 无')) + '</span></div>';

    // 2) 元数据：默认只读展示，点「编辑」才切换成可编辑表格
    if (canEdit && editing) {
      html += '<h3>元数据（可编辑）</h3><div class="tag-edit-wrap"></div>' +
        '<div class="tag-tools">' +
        '<input type="text" class="newkey" placeholder="key">' +
        '<input type="text" class="newval" placeholder="value">' +
        '<button type="button" class="small" data-act="probe-add">+ 添加</button>' +
        '<button type="button" class="primary small" data-act="probe-save">💾 保存元数据</button>' +
        '<span class="save-msg"></span>' +
        '</div>';
    } else if (tagKeys.length) {
      html += '<h3>元数据' + (canEdit ?
        ' <button type="button" class="small" data-act="probe-edit">✎ 编辑</button>' : '') + '</h3>';
      for (const k of tagKeys) {
        let v = tags[k];
        if (typeof v === 'string' && v.length > 200) v = v.slice(0, 200) + '...';
        html += kv(k, v);
      }
    } else {
      html += '<h3>元数据' + (canEdit ?
        ' <button type="button" class="small" data-act="probe-edit">✎ 编辑</button>' : '') +
        '</h3><div class="detail-empty">无标签</div>';
    }

    // 3) 文件 / 格式 / 音频流等靠后
    html += '<h3>文件</h3>' + kv('名称', d.name) + kv('路径', d.path);
    if (d.format) {
      html += '<h3>格式</h3>' +
        kv('format', d.format.format_name) +
        kv('时长', d.format.duration ? parseFloat(d.format.duration).toFixed(2) + ' s' : '-') +
        kv('大小', d.format.size ? Utils.fmtSize(parseInt(d.format.size)) : '-') +
        kv('总比特率', d.format.bit_rate ? Math.round(parseInt(d.format.bit_rate)/1000) + ' kbps' : '-') +
        kv('流数量', d.format.nb_streams);
    }
    if (d.audio) {
      html += '<h3>音频流</h3>' +
        kv('编码', d.audio.codec_name + (d.audio.codec_long_name ? ' (' + d.audio.codec_long_name + ')' : '')) +
        kv('采样格式', d.audio.sample_fmt) +
        kv('采样率', d.audio.sample_rate ? d.audio.sample_rate + ' Hz' : '-') +
        kv('声道', d.audio.channels + (d.audio.channel_layout ? ' (' + d.audio.channel_layout + ')' : '')) +
        kv('位深', d.audio.bits_per_raw_sample || d.audio.bits_per_sample || '-') +
        kv('比特率', d.audio.bit_rate ? Math.round(parseInt(d.audio.bit_rate)/1000) + ' kbps' : '-');
    } else {
      html += '<h3>音频流</h3><div style="color:var(--warn)">无音频流</div>';
    }

    container.innerHTML = html;
    if (canEdit && editing) renderTagTable(tags);
  }

  async function load(path) {
    if (!path) return;
    curPath = path;
    setEmpty('加载中...');
    try {
      const d = await Api.probe(path);
      curData = d;
      curTags = Object.assign({}, d.tags || {});
      render(d);
    } catch (e) {
      container.innerHTML = '<div class="detail-empty" style="color:var(--err)">probe 失败: ' +
        esc(e.message) + '</div>';
    }
  }

  function addTag() {
    const kEl = container.querySelector('.newkey');
    const vEl = container.querySelector('.newval');
    const k = kEl ? kEl.value.trim() : '';
    const v = vEl ? vEl.value : '';
    if (!k) { alert('请输入 key'); return; }
    let table = container.querySelector('.tag-edit-table');
    const wrap = container.querySelector('.tag-edit-wrap');
    if (!table && wrap) {
      wrap.innerHTML = '<table class="tag-edit-table"></table>';
      table = wrap.querySelector('.tag-edit-table');
    }
    if (!table) return;
    const tr = document.createElement('tr');
    tr.setAttribute('data-key', k);
    tr.innerHTML = '<td class="k">' + esc(k) + '</td>' +
      '<td><input type="text" value="' + esc(v) + '" data-orig=""></td>' +
      '<td style="width:20px"><button type="button" class="del-btn" data-act="probe-del">×</button></td>';
    table.appendChild(tr);
    if (kEl) kEl.value = '';
    if (vEl) vEl.value = '';
  }

  async function save() {
    if (!curPath) return;
    const table = container.querySelector('.tag-edit-table');
    const edits = {};
    const keys = new Set();
    const rows = table ? table.querySelectorAll('tr') : [];
    for (const tr of rows) {
      const k = tr.getAttribute('data-key');
      keys.add(k);
      const inp = tr.querySelector('input');
      if (!inp) continue;
      const v = inp.value;
      const orig = inp.getAttribute('data-orig') || '';
      if (v !== orig) edits[k] = v;
    }
    const removes = Object.keys(curTags).filter(k => !keys.has(k));
    if (!Object.keys(edits).length && !removes.length) { setMsg('无改动', ''); return; }
    setMsg('保存中...', '');
    try {
      const r = await Api.editTags(curPath, edits, removes);
      if (r.ok) {
        setMsg('✓ 已保存', 'ok');
        Utils.log('ok', '元数据保存成功: ' + Utils.basename(curPath));
        editing = false;                 // 保存后回到只读态
        const p = curPath;
        setTimeout(() => load(p), 250);
      } else {
        setMsg('✗ ' + (r.error || '失败'), 'err');
        Utils.log('err', '元数据保存失败: ' + (r.error || ''));
      }
    } catch (e) {
      setMsg('✗ ' + e.message, 'err');
    }
  }

  container.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'probe-edit') { editing = true; if (curData) render(curData); }
    else if (act === 'probe-add') addTag();
    else if (act === 'probe-save') save();
    else if (act === 'probe-del') {
      const tr = t.closest('tr');
      if (tr) tr.remove();
    } else if (act === 'modal') {
      Utils.openModal(t.tagName === 'IMG' ? t.src : Api.coverUrl(curPath));
    }
  });

  return {load, setEmpty, get path() { return curPath; }};
}

/* ---------------- MetaFloat：元数据独立浮窗（与频谱浮窗同交互：拖动/缩放/记忆） ---------------- */
function createMetaFloat() {
  const box = document.getElementById('meta-float');
  const fab = document.getElementById('meta-fab');
  const head = document.getElementById('mf-head');
  const trackEl = document.getElementById('mf-track');
  const minBtn = document.getElementById('mf-min');
  const resize = document.getElementById('mf-resize');
  const view = createMetaView(document.getElementById('meta3'), {editable: true});
  if (!box || !fab) return {load: () => {}, setEmpty: () => {}};
  if (trackEl && typeof I18n !== 'undefined') trackEl.textContent = I18n.t('点击文件查看详情');
  let open = false;
  /* 与频谱/声谱浮窗完全一致的开关语义：展开后按钮隐藏，收起用浮窗自己的"—"，
     状态以 DOM 的 hidden 为准，避免重复 init 或拖动拦截 click 造成"点了不收"的死状态。 */
  function shown() { return !box.classList.contains('hidden'); }

  function clampX(x) {
    const w = box.offsetWidth || 320;
    return Math.max(4, Math.min(window.innerWidth - w - 4, x));
  }
  function clampY(y) {
    const h = box.offsetHeight || 360;
    return Math.max(4, Math.min(window.innerHeight - h - 4, y));
  }
  function applyPos() {
    const saved = Store.get(K.metaPos, null);
    if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) {
      box.style.left = clampX(Number(saved.x)) + 'px';
      box.style.top = clampY(Number(saved.y)) + 'px';
      box.style.right = 'auto';
      box.style.bottom = 'auto';
      return;
    }
    // 默认：右贴边，频谱浮窗上方
    box.style.left = 'auto';
    box.style.right = '10px';
    box.style.top = 'auto';
    box.style.bottom = '132px';
  }
  function applySize() {
    const saved = Store.get(K.metaSize, null);
    if (saved && Number(saved.w) >= 200 && Number(saved.h) >= 140) {
      box.style.width = Math.min(window.innerWidth - 8, Number(saved.w)) + 'px';
      box.style.height = Math.min(window.innerHeight - 8, Number(saved.h)) + 'px';
    } else {
      box.style.width = '320px';
      box.style.height = '400px';
    }
  }
  function savePos() {
    const r = box.getBoundingClientRect();
    Store.set(K.metaPos, {x: Math.round(r.left), y: Math.round(r.top)});
  }

  function toggle(force) {
    open = (typeof force === 'boolean') ? force : !shown();
    if (open) {
      applySize(); applyPos();
      box.classList.remove('hidden');
      if (fab) fab.style.display = 'none';     // 展开时按钮收起，和频谱/声谱一致
    } else {
      savePos();                              // 先量再藏（hidden 之后尺寸为 0）
      box.classList.add('hidden');
      if (fab) fab.style.display = '';
    }
    if (fab) fab.classList.toggle('on', open);
  }
  if (fab) fab.addEventListener('click', () => toggle());
  if (minBtn) minBtn.addEventListener('click', () => toggle(false));

  /* 拖动/缩放/置顶统一交给 WinMgr（见 app.js 注册） */

  window.addEventListener('resize', () => {
    if (!open) return;
    const r = box.getBoundingClientRect();
    box.style.left = clampX(r.left) + 'px';
    box.style.top = clampY(r.top) + 'px';
  });

  function load(path) {
    if (trackEl) trackEl.textContent = path ? Utils.basename(path) : ((typeof I18n !== 'undefined') ? I18n.t('点击文件查看详情') : '点击文件查看详情');
    if (trackEl) trackEl.title = path || '';
    return view.load(path);
  }
  function setEmpty(msg) { view.setEmpty(msg); if (trackEl) trackEl.textContent = (typeof I18n !== 'undefined') ? I18n.t('点击文件查看详情') : '点击文件查看详情'; }
  return {toggle, load, setEmpty,
          get open() { return open; },
          get path() { return view.path; }};
}
