/* ---------------- TaskRunner ---------------- */
const TaskRunner = (() => {
  function lg(level, text) { Utils.log(level, text, 'process'); }
  let evtSource = null, startTime = 0, totalFiles = 0, doneFiles = 0;
  let taskId = null;
  let taskPresets = {presets: {}};

  function currentTask() {
    const r = document.querySelector('input[name="task"]:checked');
    return r ? r.value : 'convert';
  }
  function syncUI() {
    const t = currentTask();
    document.getElementById('ui-convert').classList.toggle('hidden', t !== 'convert');
    document.getElementById('ui-tags').classList.toggle('hidden', t !== 'tags');
    document.getElementById('ui-cover').classList.toggle('hidden', t !== 'cover');
    const prow = document.getElementById('preset-row');
    if (prow) prow.classList.toggle('hidden', t !== 'convert');
  }

  async function loadTaskPresets() {
    try { taskPresets = await Api.taskPresets(); }
    catch (e) { taskPresets = {presets: {}}; }
    if (!taskPresets || typeof taskPresets.presets !== 'object') taskPresets = {presets: {}};
    const sel = document.getElementById('preset-select');
    sel.innerHTML = '<option value="">— 手动配置 —</option>';
    for (const name of Object.keys(taskPresets.presets)) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      sel.appendChild(o);
    }
  }
  function applyPreset() {
    const name = document.getElementById('preset-select').value;
    if (!name || !taskPresets.presets[name]) return;
    const p = taskPresets.presets[name];
    document.querySelectorAll('input[name="task"]').forEach(r => { r.checked = (r.value === p.task); });
    syncUI();
    if (p.task === 'convert') {
      if (p.format) document.getElementById('fmt-select').value = p.format;
      if (p.output_dir !== undefined) document.getElementById('output-dir').value = p.output_dir;
      if (p.delete_source !== undefined) document.getElementById('delete-source').checked = !!p.delete_source;
      if (p.also_tags !== undefined) document.getElementById('also-tags').checked = !!p.also_tags;
    } else if (p.task === 'tags') {
      if (p.name_pattern !== undefined) document.getElementById('name-pattern').value = p.name_pattern;
    } else if (p.task === 'cover') {
      const cp = document.getElementById('cover-path');
      if (cp && p.cover_path) cp.value = p.cover_path;
    }
  }
  function collectConfig() {
    const task = currentTask();
    const cfg = {task, path: App.path};
    if (task === 'convert') {
      cfg.format = document.getElementById('fmt-select').value;
      cfg.output_dir = document.getElementById('output-dir').value.trim();
      cfg.delete_source = document.getElementById('delete-source').checked;
      cfg.also_tags = document.getElementById('also-tags').checked;
      cfg.name_pattern = document.getElementById('name-pattern').value;
    } else if (task === 'tags') {
      // 目标格式已移除：重命名对所有音频格式生效
      cfg.name_pattern = document.getElementById('name-pattern').value;
    } else if (task === 'cover') {
      // 目标格式已移除：所有音频格式都会替换封面；可单独指定封面图片
      const cp = document.getElementById('cover-path');
      cfg.cover_path = cp ? cp.value.trim() : '';
    }
    const sel = App.selection();
    if (sel.length) cfg.only_files = sel;
    return cfg;
  }
  async function saveAsPreset() {
    const name = prompt('预设名称：', '');
    if (!name) return;
    const p = collectConfig();
    delete p.path;
    delete p.only_files;
    taskPresets.presets[name] = p;
    try {
      await Api.saveTaskPresets(presets);
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
      await Api.saveTaskPresets(presets);
      await loadTaskPresets();
      lg('info', '已删除预设: ' + name);
    } catch (e) { lg('err', '删除失败: ' + e.message); }
  }

  async function start() {
    if (!App.path) { alert('请先选择目录'); return; }
    const cfg = collectConfig();
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

  function init() {
    const cb = document.getElementById('cancel-btn');
    if (cb) cb.addEventListener('click', cancel);
    // 任务类型切换必须刷新各自的配置面板；之前只在模块打开时 syncUI，
    // 导致“重命名 / 替换封面”的界面切过去看不到。
    document.querySelectorAll('input[name="task"]').forEach(r => {
      r.addEventListener('change', syncUI);
    });
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

  return {init, syncUI, loadTaskPresets, applyPreset, saveAsPreset, deletePreset, start, previewNames,
          currentTask, collectConfig, checkUnfinished};
})();
