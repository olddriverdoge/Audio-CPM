/* ---------------- Api ---------------- */
const Api = (() => {
  const enc = encodeURIComponent;
  async function jfetch(url, opts) {
    let r;
    try { r = await fetch(url, opts); }
    catch (e) { throw new Error(I18n.tr('网络错误: {msg}', {msg: e.message})); }
    if (!r.ok) {
      let text = '';
      try { text = await r.text(); } catch (_) {}
      let msg = text;
      try { const j = JSON.parse(text); msg = j.detail || j.message || text; } catch (_) {}
      throw new Error(I18n.tr((msg || ('HTTP ' + r.status)).slice(0, 300)));
    }
    try { return await r.json(); }
    catch (e) { throw new Error(I18n.tr('响应解析失败')); }
  }
  const jpost = (url, body) => jfetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  return {
    caps: () => jfetch('/api/capabilities'),
    browse: p => jfetch('/api/browse?path=' + enc(p)),
    probe: p => jfetch('/api/probe_file?path=' + enc(p)),
    editTags: (path, tags, remove) => jpost('/api/edit_tags', {path, tags, remove}),
    play: (path, player, activity) => jpost('/api/play', {path, player, activity}),
    tree: p => jfetch('/api/tree?path=' + enc(p)),
    move: (sources, target, conflict) => jpost('/api/move', {sources, target, conflict}),
    copy: (sources, target, conflict) => jpost('/api/copy', {sources, target, conflict}),
    mkdir: (parent, name) => jpost('/api/mkdir', {parent, name}),
    rmdir: path => jpost('/api/rmdir', {path}),
    renameDir: (path, new_name) => jpost('/api/rename_dir', {path, new_name}),
    remove: paths => jpost('/api/delete', {paths}),
    start: cfg => jpost('/api/start', cfg),
    cancelTask: id => jpost('/api/task/' + id + '/cancel', {}),
    tasks: () => jfetch('/api/tasks'),
    taskPresets: () => jfetch('/api/task-presets'),
    saveTaskPresets: data => jpost('/api/task-presets', data),
    roots: () => jfetch('/api/roots'),
    sources: () => jfetch('/api/storage/sources'),
    saveSource: data => jpost('/api/storage/sources', data),
    deleteSource: id => jpost('/api/storage/sources/delete', {id}),
    testSource: data => jpost('/api/storage/test', data),
    thumbUrl: (p, size) => '/api/thumb?path=' + enc(p) + '&size=' + size,
    waveform: (p, n) => jfetch('/api/waveform?path=' + enc(p) + '&buckets=' + (n || 160)),
    imageUrl: p => '/api/image?path=' + enc(p),
    coverUrl: p => '/api/cover?path=' + enc(p) + '&t=' + Date.now(),
    playbackOpen: (path, startMs, sampleRate, bitDepth, channels) => jpost('/api/playback/open', {path, startMs, sampleRate, bitDepth, channels}),
    playbackMeta: (path, tags) => jpost('/api/playback/meta', {
      path,
      title: tags && tags.title || '',
      artist: tags && tags.artist || '',
      composer: tags && tags.composer || '',
      album: tags && tags.album || ''
    }),
    playbackState: () => jfetch('/api/playback/state'),
  playbackQueue: (paths, index, startMs) => jpost('/api/playback/queue', {paths, index, startMs}),
    playbackSpectrum: enabled => jfetch('/api/playback/spectrum' + (enabled === undefined ? '' : ('?enabled=' + (enabled ? '1' : '0')))),
    playbackPause: () => jpost('/api/playback/pause', {}),
    playbackResume: () => jpost('/api/playback/resume', {}),
    playbackStop: () => jpost('/api/playback/stop', {}),
    playbackSeek: ms => jpost('/api/playback/seek', {positionMs: ms}),
    playbackVolume: v => jpost('/api/playback/volume', {volume: v}),
    playbackMode: (repeat, shuffle) => jpost('/api/playback/mode', {repeat, shuffle}),
    playbackSkip: dir => jpost('/api/playback/skip', {dir}),
    audioFx: (op, a, b) => jpost('/api/audio/fx', {op, a, b}),
    audioInfo: () => jfetch('/api/audio/info'),
    audioDevices: () => jfetch('/api/audio/devices'),
    setAudioDevice: id => jpost('/api/audio/device', {id: Number(id) || 0}),
    renamePreview: cfg => jpost('/api/tasks/rename-preview', cfg),
    appUpdate: force => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      return jfetch('/api/app_update' + (force ? '?force=1' : ''), {signal: ctrl.signal})
        .finally(() => clearTimeout(timer));
    }
  };
})();
