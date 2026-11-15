/* ---------------- MetaView ---------------- */
function createMetaView(container, opts) {
  opts = opts || {};
  const editable = opts.editable !== false;
  const esc = Utils.escapeHtml;
  let curPath = null;
  let curTags = {};

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
      (d.has_cover ? '✓ 有' : '✗ 无') + '</span></div>';

    // 2) 元数据（可编辑优先，否则只读列表）
    if (editable) {
      html += '<h3>元数据（可编辑）</h3><div class="tag-edit-wrap"></div>' +
        '<div class="tag-tools">' +
        '<input type="text" class="newkey" placeholder="key">' +
        '<input type="text" class="newval" placeholder="value">' +
        '<button type="button" class="small" data-act="probe-add">+ 添加</button>' +
        '<button type="button" class="primary small" data-act="probe-save">💾 保存元数据</button>' +
        '<span class="save-msg"></span>' +
        '</div>';
    } else if (tagKeys.length) {
      html += '<h3>元数据</h3>';
      for (const k of tagKeys) {
        let v = tags[k];
        if (typeof v === 'string' && v.length > 200) v = v.slice(0, 200) + '...';
        html += kv(k, v);
      }
    } else {
      html += '<h3>元数据</h3><div class="detail-empty">无标签</div>';
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
    if (editable) renderTagTable(tags);
  }

  async function load(path) {
    if (!path) return;
    curPath = path;
    setEmpty('加载中...');
    try {
      const d = await Api.probe(path);
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
    if (act === 'probe-add') addTag();
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
