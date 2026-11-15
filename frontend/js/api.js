/* ---------------- Api ---------------- */
const Api = (() => {
  const enc = encodeURIComponent;
  async function jfetch(url, opts) {
    let r;
    try { r = await fetch(url, opts); }
    catch (e) { throw new Error('网络错误: ' + e.message); }
    if (!r.ok) {
      let text = '';
      try { text = await r.text(); } catch (_) {}
      let msg = text;
      try { const j = JSON.parse(text); msg = j.detail || j.message || text; } catch (_) {}
      throw new Error((msg || ('HTTP ' + r.status)).slice(0, 300));
    }
    try { return await r.json(); }
    catch (e) { throw new Error('响应解析失败'); }
  }
  const jpost = (url, body) => jfetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  return {
    browse: p => jfetch('/api/browse?path=' + enc(p)),
    probe: p => jfetch('/api/probe_file?path=' + enc(p)),
    editTags: (path, tags, remove) => jpost('/api/edit_tags', {path, tags, remove}),
    play: (path, player, activity) => jpost('/api/play', {path, player, activity}),
    tree: p => jfetch('/api/tree?path=' + enc(p)),
    move: (sources, target, conflict) => jpost('/api/move', {sources, target, conflict}),
    mkdir: (parent, name) => jpost('/api/mkdir', {parent, name}),
    rmdir: path => jpost('/api/rmdir', {path}),
    renameDir: (path, new_name) => jpost('/api/rename_dir', {path, new_name}),
    remove: paths => jpost('/api/delete', {paths}),
    start: cfg => jpost('/api/start', cfg),
    cancelTask: id => jpost('/api/task/' + id + '/cancel', {}),
    tasks: () => jfetch('/api/tasks'),
    presets: () => jfetch('/api/presets'),
    savePresets: data => jpost('/api/presets', data),
    roots: () => jfetch('/api/roots'),
    sources: () => jfetch('/api/storage/sources'),
    saveSource: data => jpost('/api/storage/sources', data),
    deleteSource: id => jpost('/api/storage/sources/delete', {id}),
    testSource: data => jpost('/api/storage/test', data),
    uiConfig: () => jfetch('/api/ui_config'),
    saveUiConfig: data => jpost('/api/ui_config', data),
    saveUiPreset: (name, config) => jpost('/api/ui_config/preset', {name, config}),
    loadUiPreset: name => jpost('/api/ui_config/preset/load', {name}),
    deleteUiPreset: name => jpost('/api/ui_config/preset/delete', {name}),
    thumbUrl: (p, size) => '/api/thumb?path=' + enc(p) + '&size=' + size,
    waveform: (p, n) => jfetch('/api/waveform?path=' + enc(p) + '&buckets=' + (n || 160)),
    imageUrl: p => '/api/image?path=' + enc(p),
    coverUrl: p => '/api/cover?path=' + enc(p) + '&t=' + Date.now()
  };
})();
