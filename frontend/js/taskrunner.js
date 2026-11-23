/* ---------------- TaskRunner ---------------- */
const TaskRunner = (() => {
  function lg(level, text) { Utils.log(level, text, 'process'); }
  let evtSource = null, startTime = 0, totalFiles = 0, doneFiles = 0;
  let taskId = null;
  let taskPresets = {presets: {}};
  /* 元数据“编辑封面”进来时，只处理当前这首歌，而不是整个目录。 */
  let coverTarget = null;

  function currentTask() {
    const r = document.querySelector('input[name="task"]:checked');
    return r ? r.value : 'convert';
  }
  function syncUI() {
    const t = currentTask();
    document.getElementById('ui-convert').classList.toggle('hidden', t !== 'convert');
    document.getElementById('ui-tags').classList.toggle('hidden', t !== 'tags');
    const meta = document.getElementById('ui-metadata');
    if (meta) meta.classList.toggle('hidden', t !== 'metadata');
    document.getElementById('ui-cover').classList.toggle('hidden', t !== 'cover');
    const prow = document.getElementById('preset-row');
    if (prow) prow.classList.toggle('hidden', t !== 'convert');
  }

  async function loadTaskPresets() {
    try { taskPresets = await Api.taskPresets(); }
    catch (e) { taskPresets = {presets: {}}; }
    if (!taskPresets || typeof taskPresets.presets !== 'object') taskPresets = {presets: {}};
    const sel = document.getElementById('preset-select');
    sel.innerHTML = '<option value="">' + ((typeof I18n !== 'undefined') ? I18n.t('— 手动配置 —') : '— 手动配置 —') + '</option>';
    for (const name of Object.keys(taskPresets.presets)) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = (typeof I18n !== 'undefined') ? I18n.t(name) : name;
      sel.appendChild(o);
    }
  }
  function applyPreset() {
    const name = document.getElementById('preset-select').value;
    if (!name || !taskPresets.presets[name]) return;
    const p = taskPresets.presets[name];
    coverTarget = null;
    document.querySelectorAll('input[name="task"]').forEach(r => { r.checked = (r.value === p.task); });
    syncUI();
    if (p.task === 'convert') {
      if (p.format) document.getElementById('fmt-select').value = p.format;
      if (p.output_dir !== undefined) document.getElementById('output-dir').value = p.output_dir;
      if (p.delete_source !== undefined) document.getElementById('delete-source').checked = !!p.delete_source;
      if (p.also_tags !== undefined) document.getElementById('also-tags').checked = !!p.also_tags;
    } else if (p.task === 'tags') {
      if (p.name_pattern !== undefined) document.getElementById('name-pattern').value = p.name_pattern;
    } else if (p.task === 'metadata') {
      if (p.meta_mode) document.getElementById('meta-mode').value = p.meta_mode;
      if (p.filename_template !== undefined) {
        const tpl = document.getElementById('meta-template');
        if (tpl) tpl.value = p.filename_template === 'auto' ? '' : p.filename_template;
      }
      if (p.tags && typeof p.tags === 'object') {
        document.querySelectorAll('[data-meta-field]').forEach(inp => {
          inp.value = p.tags[inp.dataset.metaField] || '';
        });
      }
      if (p.skip_existing !== undefined) {
        document.getElementById('meta-skip-existing').checked = !!p.skip_existing;
      }
      syncMetaUI();
    } else if (p.task === 'cover') {
      const cp = document.getElementById('cover-path');
      if (cp && p.cover_path) cp.value = p.cover_path;
    }
  }
  function collectConfig() {
    const task = currentTask();
    const cfg = {task, path: (task === 'cover' && coverTarget) ? coverTarget.dir : App.path};
    if (task === 'convert') {
      cfg.format = document.getElementById('fmt-select').value;
      cfg.output_dir = document.getElementById('output-dir').value.trim();
      cfg.delete_source = document.getElementById('delete-source').checked;
      cfg.also_tags = document.getElementById('also-tags').checked;
      cfg.name_pattern = document.getElementById('name-pattern').value;
    } else if (task === 'tags') {
      // 目标格式已移除：重命名对所有音频格式生效
      cfg.name_pattern = document.getElementById('name-pattern').value;
    } else if (task === 'metadata') {
      cfg.meta_mode = document.getElementById('meta-mode').value === 'filename' ? 'filename' : 'fixed';
      cfg.tags = collectMetaTags();
      cfg.filename_template = getMetaTemplate();
      cfg.skip_existing = !!document.getElementById('meta-skip-existing').checked;
    } else if (task === 'cover') {
      // 目标格式已移除：所有音频格式都会替换封面；可单独指定封面图片
      const cp = document.getElementById('cover-path');
      cfg.cover_path = cp ? cp.value.trim() : '';
    }
    if (task === 'cover' && coverTarget) {
      cfg.only_files = [coverTarget.path];
      return cfg;
    }
    const sel = App.selection();
    if (sel.length) cfg.only_files = sel;
    return cfg;
  }
  const META_INPUTS = {
    title: 'meta-title', artist: 'meta-artist', album: 'meta-album',
    album_artist: 'meta-album-artist', composer: 'meta-composer', genre: 'meta-genre',
    year: 'meta-year', track: 'meta-track', disc: 'meta-disc', comment: 'meta-comment'
  };
  function collectMetaTags() {
    const out = {};
    for (const [field, id] of Object.entries(META_INPUTS)) {
      const inp = document.getElementById(id);
      const v = inp ? inp.value.trim() : '';
      if (v) out[field] = v;
    }
    return out;
  }
  function syncMetaUI() {
    const mode = document.getElementById('meta-mode').value;
    document.getElementById('meta-fixed').classList.toggle('hidden', mode !== 'fixed');
    document.getElementById('meta-filename').classList.toggle('hidden', mode !== 'filename');
  }
  function syncMetaTemplate() {
    const sel = document.getElementById('meta-template-preset');
    const inp = document.getElementById('meta-template');
    if (!sel || !inp) return;
    if (sel.value === 'auto') {
      inp.value = '';
      inp.disabled = true;
      inp.placeholder = '自动识别常见文件名，不用填模板';
    } else if (sel.value) {
      inp.value = sel.value;
      inp.disabled = false;
      inp.placeholder = '{artist} - {title}';
    } else {
      inp.disabled = false;
      inp.placeholder = '{artist} - {title}';
      inp.focus();
    }
  }
  function getMetaTemplate() {
    const sel = document.getElementById('meta-template-preset');
    if (sel && sel.value === 'auto') return 'auto';
    const inp = document.getElementById('meta-template');
    return inp ? inp.value.trim() : '';
  }
  async function previewMetadata() {
    if (!App.path) { Utils.toast('请先选择目录'); return; }
    const cfg = collectConfig();
    if (cfg.meta_mode === 'fixed') {
      if (!Object.keys(cfg.tags).length) { Utils.toast('至少填一个要写入的字段', 'warn'); return; }
    } else if (!getMetaTemplate()) {
      Utils.toast('请填写文件名模板', 'warn'); return;
    }
    if (typeof App.openMod === 'function') App.openModule('log');
    lg('info', '元数据预览（不改文件）：' +
      (cfg.meta_mode === 'filename' ? ('模板 ' + (getMetaTemplate() === 'auto' ? '自动识别' : getMetaTemplate())) : '固定值'));
    try {
      const r = await Api.metadataPreview({
        path: App.path, meta_mode: cfg.meta_mode, tags: cfg.tags,
        filename_template: cfg.filename_template, skip_existing: cfg.skip_existing,
        only_files: App.selection(), limit: 30
      });
      if (!r || !r.total) { lg('warn', '当前目录没有可编辑的音频文件'); return; }
      if (cfg.meta_mode === 'filename') {
        lg('info', '实际使用模板：' + (r.template || '') + ' · 匹配 ' + (r.matched || 0) + ' / ' + r.total);
        if (!r.matched) lg('warn', '没有文件名匹配这个模板；可以换成“自动识别”或按实际文件名改模板');
      }
      lg('info', '共 ' + r.total + ' 个，预览前 ' + r.shown + ' 个：');
      (r.items || []).forEach(it => {
        if (it.error) { lg('err', it.file + ' — ' + it.error); return; }
        const tags = Object.entries(it.tags || {}).map(([k, v]) => k + '=' + v).join(' | ');
        lg(tags ? 'ok' : 'info', it.file + (tags ? '  →  ' + tags : '（没有要改的字段）'));
      });
    } catch (e) {
      lg('err', '预览失败: ' + e.message);
    }
  }
  async function saveAsPreset() {
    const name = prompt('预设名称：', '');
    if (!name) return;
    const p = collectConfig();
    delete p.path;
    delete p.only_files;
    taskPresets.presets[name] = p;
    try {
      await Api.saveTaskPresets(taskPresets);
      await loadTaskPresets();
      document.getElementById('preset-select').value = name;
      lg('ok', '预设已保存: ' + name);
    } catch (e) { lg('err', '保存失败: ' + e.message); }
  }
  async function deletePreset() {
    const name = document.getElementById('preset-select').value;
    if (!name) return;
    if (!confirm('删除预设 "' + name + '" ？')) return;
    delete taskPresets.presets[name];
    try {
      await Api.saveTaskPresets(taskPresets);
      await loadTaskPresets();
      lg('info', '已删除预设: ' + name);
    } catch (e) { lg('err', '删除失败: ' + e.message); }
  }

  async function start() {
    const cfg = collectConfig();
    if (!cfg.path) { alert('请先选择目录'); return; }
    if (typeof Logs !== 'undefined') Logs.clear('process');
    const bar = document.getElementById('progress-bar');
    bar.style.width = '0%';
    bar.classList.remove('indeterminate');
    document.getElementById('progress-status').textContent = '启动任务...';
    document.getElementById('task-status').textContent = '';
    setRunning(true);
    startTime = Date.now();
    totalFiles = 0; doneFiles = 0;
    try {
      const data = await Api.start(cfg);
      taskId = data.task_id;
      subscribe(data.task_id);
    } catch (e) {
      lg('err', '启动失败: ' + e.message);
      setRunning(false);
    }
  }
  function setRunning(on) {
    document.getElementById('start-btn').disabled = !!on;
    const cb = document.getElementById('cancel-btn');
    if (cb) cb.classList.toggle('hidden', !on);
  }
  async function previewNames() {
    if (!App.path) { Utils.toast('请先选择目录'); return; }
    const pattern = document.getElementById('name-pattern').value;
    if (typeof App.openMod === 'function') App.openModule('log');
    lg('info', '重命名预览（不改文件）：' + (pattern || '默认格式'));
    try {
      const r = await Api.renamePreview({path: App.path, name_pattern: pattern,
                                          only_files: App.selection(), limit: 30});
      if (!r || !r.total) { lg('warn', '当前目录没有可重命名的音频文件'); return; }
      lg('info', '共 ' + r.total + ' 个，预览前 ' + r.shown + ' 个：');
      (r.items || []).forEach(it => {
        if (it.error) lg('err', it.file + ' — ' + it.error);
        else if (it.new === it.file) lg('info', it.file + '（不变）');
        else lg('ok', it.file + '  →  ' + it.new);
      });
    } catch (e) {
      lg('err', '预览失败: ' + e.message);
    }
  }

  async function cancel() {
    if (!taskId) return;
    const cb = document.getElementById('cancel-btn');
    if (cb) { cb.disabled = true; cb.textContent = '取消中…'; }
    try {
      await Api.cancelTask(taskId);
      lg('warn', '已请求取消任务…');
    } catch (e) {
      lg('err', '取消失败: ' + e.message);
      if (cb) { cb.disabled = false; cb.textContent = '取消'; }
    }
  }
  async function checkUnfinished() {
    try {
      const r = await Api.tasks();
      const list = (r && r.tasks) || [];
      const bad = list.slice().reverse().find(t => t.status === 'interrupted' || t.status === 'running' || t.status === 'queued');
      if (bad) {
        const el = document.getElementById('task-status');
        if (el) el.textContent = (bad.status === 'interrupted' ? '上次未完成 ' : '进行中 ') + (bad.description || bad.id || '');
        lg('warn', '检测到未完成任务：' + (bad.description || bad.id) + '（' + bad.status + '）');
      }
    } catch (_) {}
  }
  function subscribe(taskId) {
    if (evtSource) evtSource.close();
    evtSource = new EventSource('/api/task/' + taskId + '/stream');
    evtSource.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      handleEvent(msg);
    };
  }
  function handleEvent(msg) {
    if (msg.type === 'progress') handleProgress(msg.data || {});
    else if (msg.type === 'done') finish(true, msg.data);
    else if (msg.type === 'error') finish(false, msg.data);
    else if (msg.type === 'cancelled') finishCancelled();
  }
  function finishCancelled() {
    if (evtSource) { evtSource.close(); evtSource = null; }
    setRunning(false);
    const cb = document.getElementById('cancel-btn');
    if (cb) { cb.disabled = false; cb.textContent = '取消'; }
    const bar = document.getElementById('progress-bar');
    bar.classList.remove('indeterminate');
    document.getElementById('progress-status').textContent = '已取消';
    document.getElementById('task-status').textContent = '⊘';
    lg('warn', '任务已取消');
  }
  function handleProgress(ev) {
    const bar = document.getElementById('progress-bar');
    const bname = Utils.basename;
    switch (ev.event) {
      case 'plan':
        totalFiles = ev.total || 0; doneFiles = 0;
        lg('info', '[' + ev.phase + '] 共 ' + totalFiles + ' 个文件 @ ' + ev.folder);
        if (ev.cover) lg('info', '封面: ' + ev.cover);
        document.getElementById('progress-status').textContent = ev.phase + ': 0 / ' + totalFiles;
        bar.classList.add('indeterminate');
        break;
      case 'probe':
        lg('info', '[probe] ' + bname(ev.file));
        break;
      case 'file_progress':
        if (totalFiles > 0) {
          const overall = ((ev.index - 1) + (ev.percent / 100)) / totalFiles * 100;
          bar.classList.remove('indeterminate');
          bar.style.width = Math.min(99, overall).toFixed(1) + '%';
        }
        document.getElementById('progress-status').textContent =
          '处理 ' + ev.index + '/' + totalFiles + ' · ' + bname(ev.file) + ' · ' + ev.percent + '%';
        break;
      case 'file_done':
        doneFiles = ev.index;
        if (ev.status === 'ok') {
          lg('ok', '✓ [' + ev.index + '/' + totalFiles + '] ' + bname(ev.file) +
            (ev.output ? '  →  ' + bname(ev.output) : ''));
        } else {
          lg('err', '✗ [' + ev.index + '/' + totalFiles + '] ' + bname(ev.file) +
            '  ' + (ev.error || ''));
        }
        if (totalFiles > 0) {
          bar.classList.remove('indeterminate');
          bar.style.width = (doneFiles / totalFiles * 100).toFixed(1) + '%';
        }
        document.getElementById('progress-status').textContent = '进度 ' + doneFiles + ' / ' + totalFiles;
        break;
      case 'file_skip':
        doneFiles = ev.index;
        lg('warn', '跳过 [' + ev.index + '/' + totalFiles + '] ' + bname(ev.file) +
          ' (' + ev.reason + ')');
        break;
      case 'phase':
        lg('info', '--- 阶段: ' + ev.phase + ' ---');
        break;
    }
  }
  function finish(ok, data) {
    if (evtSource) { evtSource.close(); evtSource = null; }
    setRunning(false);
    const cb = document.getElementById('cancel-btn');
    if (cb) { cb.disabled = false; cb.textContent = '取消'; }
    const bar = document.getElementById('progress-bar');
    bar.classList.remove('indeterminate');
    bar.style.width = '100%';
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (ok) {
      document.getElementById('progress-status').textContent = '完成 · 用时 ' + elapsed + 's';
      const s = (data && data.success !== undefined) ? data.success :
                (data && data.convert ? data.convert.success : '');
      const f = (data && data.failed !== undefined) ? data.failed :
                (data && data.convert ? data.convert.failed : '');
      if (typeof s === 'number') lg('ok', '任务完成：成功 ' + s + ' / 失败 ' + f);
      else lg('ok', '任务完成');
      document.getElementById('task-status').textContent = '✔';
      if (App.path) setTimeout(() => App.browse(App.path), 500);
    } else {
      document.getElementById('progress-status').textContent = '出错 · 用时 ' + elapsed + 's';
      lg('err', '任务失败: ' + (data && data.error ? data.error : 'unknown'));
      document.getElementById('task-status').textContent = '✘';
    }
  }

  /** 由元数据“编辑封面”调用：切到替换封面，并把目标限定为当前文件。 */
  function openCoverEditor(path) {
    const raw = String(path || '').trim();
    if (raw.indexOf('dav:') === 0) {
      Utils.toast('WebDAV 文件不支持替换封面，请切回本机数据源', 'warn');
      return;
    }
    coverTarget = null;
    if (raw) {
      const local = raw.replace(/^local:/, '');
      coverTarget = {path: raw, dir: Utils.dirname(local), name: Utils.basename(local)};
    }
    document.querySelectorAll('input[name="task"]').forEach(r => { r.checked = (r.value === 'cover'); });
    syncUI();
    if (typeof App !== 'undefined' && App.openModule) App.openModule('task');
    setTimeout(() => {
      const btn = document.getElementById('btn-pick-cover');
      if (btn) btn.focus();
    }, 60);
  }

  function init() {
    // 之前这里只绑了取消，开始按钮完全没有 click 监听：
    // 选中目录后点“开始执行”不会有任何请求，看起来就是没反应。
    const startBtn = document.getElementById('start-btn');
    if (startBtn) startBtn.addEventListener('click', start);
    const cb = document.getElementById('cancel-btn');
    if (cb) cb.addEventListener('click', cancel);
    const savePreset = document.getElementById('btn-save-preset');
    if (savePreset) savePreset.addEventListener('click', saveAsPreset);
    const delPreset = document.getElementById('btn-del-preset');
    if (delPreset) delPreset.addEventListener('click', deletePreset);
    const presetSel = document.getElementById('preset-select');
    if (presetSel) presetSel.addEventListener('change', applyPreset);
    // 任务类型切换必须刷新各自的配置面板；之前只在模块打开时 syncUI，
    // 导致“重命名 / 替换封面”的界面切过去看不到。
    document.querySelectorAll('input[name="task"]').forEach(r => {
      r.addEventListener('change', () => {
        if (r.checked && r.value !== 'cover') coverTarget = null;
        syncUI();
      });
    });
    const pickCover = document.getElementById('btn-pick-cover');
    if (pickCover) pickCover.addEventListener('click', async () => {
      const inp = document.getElementById('cover-path');
      if (pickCover.disabled) return;
      pickCover.disabled = true;
      try {
        const p = await FilePicker.pickCover(App.path);
        if (p) {
          if (inp) inp.value = p;
          Utils.toast('已选择封面图片');
          lg('info', '封面图片: ' + p);
        }
      } catch (e) {
        Utils.toast('选择封面失败: ' + (e && e.message || e), 'err');
      } finally {
        pickCover.disabled = false;
      }
    });
    const metaMode = document.getElementById('meta-mode');
    if (metaMode) metaMode.addEventListener('change', syncMetaUI);
    const metaPreset = document.getElementById('meta-template-preset');
    if (metaPreset) metaPreset.addEventListener('change', syncMetaTemplate);
    const metaTemplate = document.getElementById('meta-template');
    if (metaTemplate) metaTemplate.addEventListener('input', () => {
      const sel = document.getElementById('meta-template-preset');
      if (sel && sel.value !== '') sel.value = '';
    });
    const previewMeta = document.getElementById('btn-preview-meta');
    if (previewMeta) previewMeta.addEventListener('click', previewMetadata);
    syncMetaUI();
    syncMetaTemplate();
    const previewName = document.getElementById('btn-preview-name');
    if (previewName) previewName.addEventListener('click', previewNames);
    const useCur = document.getElementById('btn-use-cur-dir');
    if (useCur) useCur.addEventListener('click', () => {
      const inp = document.getElementById('output-dir');
      if (!inp) return;
      if (!App.path) { Utils.toast('先打开一个目录', 'warn'); return; }
      inp.value = App.path;
      Utils.toast('已填入当前路径');
    });
    checkUnfinished();
  }

  return {init, syncUI, loadTaskPresets, applyPreset, saveAsPreset, deletePreset, start, previewNames, previewMetadata,
          openCoverEditor, currentTask, collectConfig, checkUnfinished};
})();
