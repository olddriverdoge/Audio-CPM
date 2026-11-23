/* ---------------- 曲库：独立模块，先验证索引/搜索/目录引导 ---------------- */
function createLibraryPanel() {
  const tr = s => (typeof I18n !== 'undefined') ? I18n.t(s) : s;
  const fw = createFloatWin({
    winId: 'fw-library', headId: 'fw-library-head', resizeId: 'fw-library-resize',
    minId: 'fw-library-min', storeKey: 'ac3_win_library',
    defW: Math.min(760, Math.max(320, window.innerWidth - 24)),
    defH: Math.min(600, Math.max(360, window.innerHeight - 170)),
    minW: 300, minH: 280
  });
  const win = document.getElementById('fw-library');
  if (!win) return fw;
  const listEl = document.getElementById('lib-list');
  const footEl = document.getElementById('lib-foot');
  const headEl = document.getElementById('lib-head-state');
  const searchEl = document.getElementById('lib-search');
  const clearEl = document.getElementById('lib-search-clear');
  const fieldsEl = document.getElementById('lib-fields');
  const scanBtn = document.getElementById('lib-scan');
  const progressEl = document.getElementById('lib-progress');
  const progressText = document.getElementById('lib-progress-text');
  const cancelBtn = document.getElementById('lib-cancel');
  const setupEl = document.getElementById('lib-setup');
  const setupList = document.getElementById('lib-setup-list');
  const setupHint = document.getElementById('lib-setup-hint');
  const setupSave = document.getElementById('lib-setup-save');
  const pickerEl = document.getElementById('lib-picker');
  const pickerList = document.getElementById('lib-picker-list');
  const pickerPath = document.getElementById('lib-picker-path');
  const pickerChoose = document.getElementById('lib-picker-choose');
  const pickerUp = document.getElementById('lib-picker-up');

  const FIELD_DEFS = [
    ['title', '标题'],
    ['artist', '艺术家'],
    ['album', '专辑'],
    ['genre', '流派'],
    ['year', '年份'],
    ['composer', '作曲家'],
    ['folder', '文件夹'],
  ];
  const FIELD_LABEL = Object.fromEntries(FIELD_DEFS);
  const DEFAULT_FIELDS = ['title', 'artist', 'album', 'folder'];

  let state = null;
  let selectedDirs = [];
  let pickPath = '';
  let pickParent = '';
  let searchTimer = 0;
  let pollTimer = 0;
  let autoTimer = 0;
  let searchSeq = 0;
  let lastQuery = null;
  let lastResults = [];
  let wasScanning = false;
  let searching = false;
  let fields = Store.get('ac3_library_fields', DEFAULT_FIELDS);
  if (!Array.isArray(fields) || !fields.length) fields = DEFAULT_FIELDS.slice();
  fields = fields.filter(f => FIELD_LABEL[f]);
  if (!fields.length) fields = DEFAULT_FIELDS.slice();

  const stripLocal = p => String(p || '').replace(/^local:/, '');
  const shortName = p => {
    const s = stripLocal(p).replace(/\/+$/, '');
    const parts = s.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : s || '/';
  };
  const parentOf = p => {
    const s = stripLocal(p).replace(/\/+$/, '');
    const i = s.lastIndexOf('/');
    return i > 0 ? s.slice(0, i) : (i === 0 ? '/' : '');
  };
  const fmtTime = ts => {
    if (!ts) return '尚未扫描';
    const d = new Date(ts * 1000);
    if (!isFinite(d.getTime())) return '尚未扫描';
    const now = new Date();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  };
  const fmtDuration = s => {
    s = Number(s) || 0;
    if (!s) return '';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  };
  const trackNum = s => String(s || '').split('/')[0].trim();

  function saveFields() {
    Store.set('ac3_library_fields', fields.slice());
  }
  function renderFields() {
    fieldsEl.innerHTML = FIELD_DEFS.map(([f, label]) =>
      '<button type="button" class="lib-field' + (fields.indexOf(f) >= 0 ? ' on' : '') +
      '" data-field="' + f + '" aria-pressed="' + (fields.indexOf(f) >= 0 ? 'true' : 'false') + '">' +
      Utils.escapeHtml(tr(label)) + '</button>').join('');
  }

  function renderSetup() {
    if (!setupList) return;
    setupList.innerHTML = selectedDirs.length
      ? selectedDirs.map((p, i) =>
          '<div class="lib-setup-dir"><div class="lib-setup-dir-main"><b>' +
          Utils.escapeHtml(shortName(p)) + '</b><small>' + Utils.escapeHtml(p) + '</small></div>' +
          '<button type="button" class="small" data-rm-dir="' + i + '" title="移除目录">✕</button></div>').join('')
      : '<div class="lib-empty">还没有选择目录。点下方“添加目录”，或直接使用当前浏览目录。</div>';
    if (setupHint) {
      const broad = selectedDirs.some(p => stripLocal(p).replace(/\/+$/, '').split('/').filter(Boolean).length <= 2);
      setupHint.textContent = selectedDirs.length
        ? (broad ? '所选的目录层级很靠上，可能会扫描大量文件；建议只选音乐文件夹。'
                 : '只扫描以上目录；子目录会包含，其他位置不会扫描。')
        : '建议只选音乐文件夹，不要选整个存储根目录。';
    }
    if (setupSave) setupSave.disabled = !selectedDirs.length;
  }
  function showSetup(show) {
    if (!setupEl) return;
    setupEl.classList.toggle('hidden', !show);
    if (show) { renderSetup(); setupEl.scrollTop = 0; }
  }

  function paintState() {
    const st = state || {};
    const scanning = !!st.scanning;
    const count = Number(st.count) || 0;
    if (headEl) headEl.textContent = selectedDirs.length ? (count ? count + ' 首' : '尚未扫描') : '未配置目录';
    if (progressEl) progressEl.classList.toggle('hidden', !scanning);
    if (scanBtn) { scanBtn.disabled = scanning; scanBtn.textContent = scanning ? '扫描中' : '扫描'; }
    if (progressText) {
      const p = st.progress || {};
      const total = Number(p.total) || 0, done = Number(p.done) || 0;
      if (scanning) {
        progressText.textContent = total
          ? ('扫描中 ' + done + '/' + total + ' · 新增 ' + (p.added || 0) + ' · 更新 ' + (p.updated || 0) +
             (p.current ? ' · ' + Utils.basename(p.current) : ''))
          : '正在统计文件…';
      } else if (p.lastError && p.lastError !== '扫描已取消') {
        progressText.textContent = '扫描结束：' + p.lastError;
      }
    }
    if (footEl) {
      if (!selectedDirs.length) footEl.textContent = '先选择曲库目录，再手动扫描';
      else if (scanning) footEl.textContent = '增量扫描进行中，播放和文件浏览不受影响';
      else footEl.textContent = '共 ' + count + ' 首 · 上次扫描 ' + fmtTime(st.lastScan) +
        ' · 打开时超过 30 分钟自动增量';
    }
  }

  async function loadState() {
    try {
      state = await Api.libraryState();
      selectedDirs = (state.dirs || []).slice();
      paintState();
      if (!selectedDirs.length || state.configured === false) {
        showSetup(true);
      } else {
        showSetup(false);
      }
      return state;
    } catch (e) {
      if (footEl) footEl.textContent = '曲库状态读取失败：' + (e.message || e);
      return null;
    }
  }

  async function saveDirs() {
    if (!selectedDirs.length) {
      setupHint.textContent = '至少选择一个目录。';
      return;
    }
    try {
      setupSave.disabled = true;
      const out = await Api.libraryConfig(selectedDirs);
      if (!out.ok) throw new Error(out.error || '保存失败');
      selectedDirs = (out.dirs || selectedDirs).slice();
      state = out.state || state;
      showSetup(false);
      paintState();
      Utils.toast('曲库目录已保存，开始建立索引');
      await startScan(false);
    } catch (e) {
      setupSave.disabled = false;
      setupHint.textContent = '保存失败：' + (e.message || e);
    }
  }

  async function startScan(force) {
    if (!selectedDirs.length) { showSetup(true); return; }
    try {
      const out = await Api.libraryScan(!!force);
      if (!out.ok) throw new Error(out.error || '无法开始扫描');
      if (out.state) { state = out.state; paintState(); }
      Utils.log('info', '曲库开始增量扫描');
    } catch (e) {
      Utils.toast('扫描失败: ' + (e.message || e), 'err');
    }
  }

  async function refreshState(silent) {
    try {
      const prevScan = !!(state && state.scanning);
      const next = await Api.libraryState();
      state = next;
      selectedDirs = (next.dirs || []).slice();
      paintState();
      if (next.scanning) {
        wasScanning = true;
      } else if (prevScan || wasScanning) {
        wasScanning = false;
        if (!silent) runSearch(true);
      }
      return next;
    } catch (_) { return null; }
  }

  async function runSearch(immediate) {
    if (!selectedDirs.length) {
      lastResults = [];
      if (listEl) listEl.innerHTML = '<div class="lib-empty">先选择曲库目录，再建立索引。</div>';
      return;
    }
    const seq = ++searchSeq;
    const q = String(searchEl.value || '').trim();
    searching = true;
    try {
      const r = await Api.librarySearch(q, fields);
      if (seq !== searchSeq) return;
      if (!r.ok) throw new Error(r.error || '搜索失败');
      lastQuery = q;
      lastResults = r.tracks || [];
      renderResults(r);
    } catch (e) {
      if (seq === searchSeq && listEl) {
        listEl.innerHTML = '<div class="lib-empty" style="color:var(--err)">' +
          Utils.escapeHtml('搜索失败：' + (e.message || e)) + '</div>';
      }
    } finally {
      if (seq === searchSeq) searching = false;
    }
  }

  function renderResults(r) {
    if (!listEl) return;
    const total = Number(r.total) || 0;
    const tracks = r.tracks || [];
    if (!tracks.length) {
      listEl.innerHTML = '<div class="lib-empty">' +
        (lastQuery ? '没有匹配的音频。<br>可减少搜索字段或换关键词。' :
         '曲库还没有音频。点“扫描”建立索引。') + '</div>';
    } else {
      const cur = String((typeof Player !== 'undefined' && Player.current) || '').replace(/^local:/, '');
      listEl.innerHTML = tracks.map(t => {
        const p = t.path || '';
        const on = String(p).replace(/^local:/, '') === cur;
        const artist = t.artist || t.albumArtist || '';
        const sub = [artist, t.album].filter(Boolean).join(' · ') || t.folder || t.dir;
        const side = [];
        if (trackNum(t.track)) side.push('#' + trackNum(t.track));
        if (t.year) side.push(t.year);
        if (fmtDuration(t.duration)) side.push(fmtDuration(t.duration));
        return '<div class="lib-row' + (on ? ' on' : '') + '" data-path="' + Utils.escapeHtml(p) +
          '" title="' + Utils.escapeHtml(p) + '">' +
          '<span class="lib-row-ico">' + (on ? '▶' : '♪') + '</span>' +
          '<span class="lib-row-main"><span class="lib-row-title">' +
          Utils.escapeHtml(t.title || t.name) + '</span><span class="lib-row-sub">' +
          Utils.escapeHtml(sub) + '</span></span>' +
          '<span class="lib-row-side">' + (side.length ? '<b>' + Utils.escapeHtml(side[0]) + '</b>' +
          Utils.escapeHtml(side.slice(1).join(' · ')) : '') + '</span></div>';
      }).join('');
    }
    if (footEl) {
      const scanned = state ? fmtTime(state.lastScan) : '尚未扫描';
      footEl.textContent = (r.query ? '匹配 ' + total + ' 首' : '共 ' + total + ' 首') +
        ' · 上次扫描 ' + scanned + (total > tracks.length ? ' · 显示前 ' + tracks.length + ' 首' : '');
    }
  }

  async function beginPicker(start) {
    if (!pickerEl) return;
    pickerEl.classList.remove('hidden');
    await pickerGo(start || stripLocal(typeof App !== 'undefined' && App.path ? App.path : ''));
  }

  async function pickerGo(path) {
    if (!pickerEl) return;
    if (String(path).indexOf('dav:') === 0) {
      Utils.toast('曲库暂只支持本地目录', 'warn');
      return;
    }
    pickerList.innerHTML = '<div class="lib-empty">加载中…</div>';
    try {
      const d = await Api.browse(path || '');
      pickPath = d.path || path || '';
      pickParent = d.parent || parentOf(pickPath);
      if (pickerPath) pickerPath.textContent = stripLocal(pickPath);
      const dirs = d.dirs || [];
      pickerList.innerHTML = dirs.length
        ? dirs.map(x => '<div class="lib-picker-row dir" data-dir="' + Utils.escapeHtml(x.path) + '">' +
            '📁 ' + Utils.escapeHtml(x.name) + '</div>').join('')
        : '<div class="lib-empty">当前目录下没有子目录。可直接点右下角“选择当前目录”。</div>';
      pickerList.scrollTop = 0;
    } catch (e) {
      pickerList.innerHTML = '<div class="lib-empty" style="color:var(--err)">' +
        Utils.escapeHtml('读取目录失败：' + (e.message || e)) + '</div>';
    }
  }

  function closePicker() { if (pickerEl) pickerEl.classList.add('hidden'); }

  function addDir(raw) {
    let p = stripLocal(raw).replace(/\/+$/, '');
    if (!p) return;
    if (p === '/' || p === '/sdcard' || p === '/storage/emulated/0') {
      Utils.toast('不建议索引整个存储根目录，请选择具体音乐文件夹', 'warn');
    }
    const exists = selectedDirs.some(d => stripLocal(d).replace(/\/+$/, '') === p);
    if (exists) { Utils.toast('该目录已经在曲库中'); return; }
    selectedDirs.push(p);
    renderSetup();
  }

  if (fieldsEl) {
    fieldsEl.addEventListener('click', e => {
      const b = e.target.closest('[data-field]');
      if (!b) return;
      const f = b.dataset.field;
      if (fields.indexOf(f) >= 0) {
        if (fields.length === 1) { Utils.toast('至少保留一个搜索字段', 'warn'); return; }
        fields = fields.filter(x => x !== f);
      } else {
        fields.push(f);
      }
      saveFields();
      renderFields();
      runSearch();
    });
  }

  if (searchEl) {
    searchEl.addEventListener('input', () => {
      if (clearEl) clearEl.classList.toggle('hidden', !searchEl.value);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(), 260);
    });
    searchEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); runSearch(); }
    });
  }
  if (clearEl) clearEl.addEventListener('click', () => {
    searchEl.value = '';
    clearEl.classList.add('hidden');
    runSearch(true);
  });

  if (listEl) {
    listEl.addEventListener('click', e => {
      const row = e.target.closest('.lib-row');
      if (!row || !row.dataset.path) return;
      PlayMgr.play(row.dataset.path, 0, {quiet: true}).catch(() => {});
    });
  }

  if (scanBtn) scanBtn.addEventListener('click', () => startScan(false));
  if (cancelBtn) cancelBtn.addEventListener('click', async () => {
    try { await Api.libraryCancel(); } catch (e) { Utils.toast('取消失败: ' + (e.message || e), 'warn'); }
    refreshState();
  });

  document.getElementById('lib-dirs-btn').addEventListener('click', () => showSetup(true));
  document.getElementById('lib-setup-close').addEventListener('click', () => showSetup(false));
  document.getElementById('lib-setup-cancel').addEventListener('click', () => showSetup(false));
  document.getElementById('lib-setup-save').addEventListener('click', saveDirs);
  document.getElementById('lib-use-current').addEventListener('click', () => {
    const p = (typeof App !== 'undefined' && App.path) ? App.path : '';
    if (!p || p.indexOf('dav:') === 0) { Utils.toast('当前目录不是本地目录', 'warn'); return; }
    addDir(p);
  });
  document.getElementById('lib-add-dir').addEventListener('click', () => beginPicker(
    (selectedDirs[0] || (typeof App !== 'undefined' && App.path) || '')));
  if (setupList) setupList.addEventListener('click', e => {
    const b = e.target.closest('[data-rm-dir]');
    if (!b) return;
    selectedDirs.splice(Number(b.dataset.rmDir), 1);
    renderSetup();
  });
  if (pickerEl) pickerEl.addEventListener('click', e => {
    if (e.target === pickerEl) { closePicker(); return; }
  });
  document.getElementById('lib-picker-close').addEventListener('click', closePicker);
  if (pickerChoose) pickerChoose.addEventListener('click', () => {
    if (pickPath) addDir(pickPath);
    closePicker();
  });
  if (pickerUp) pickerUp.addEventListener('click', () => { if (pickParent) pickerGo(pickParent); });
  if (pickerList) pickerList.addEventListener('click', e => {
    const row = e.target.closest('[data-dir]');
    if (row) pickerGo(row.dataset.dir);
  });

  function maybeAutoScan() {
    if (!state || !selectedDirs.length) return;
    if (state.scanning) return;
    const last = Number(state.lastScan) || 0;
    if (!last || (Date.now() / 1000 - last) > 30 * 60) startScan(false);
  }

  renderFields();
  renderSetup();

  fw.onToggle(open => {
    if (open) {
      loadState().then(() => {
        if (selectedDirs.length) {
          runSearch(true);
          maybeAutoScan();
        }
      });
      clearInterval(pollTimer);
      pollTimer = setInterval(refreshState, 1800);
      clearInterval(autoTimer);
      autoTimer = setInterval(maybeAutoScan, 60 * 1000);
    } else {
      clearInterval(pollTimer); pollTimer = 0;
      clearInterval(autoTimer); autoTimer = 0;
    }
  });

  return fw;
}
