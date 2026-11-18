/* ---------------- 音频输出（EQ / 音效 / 输出信息） ---------------- */
function createAudioPanel() {
  const fw = createFloatWin({
    winId: 'audio-float', headId: 'af-head', resizeId: 'af-resize', minId: 'af-min',
    minW: 300, minH: 320
  });
  const win = document.getElementById('audio-float');
  if (!win) return fw;
  const body = document.getElementById('af-body');
  const dynamic = document.getElementById('af-dynamic');
  const trackEl = document.getElementById('af-track');
  const PRESET_NAMES = ['关闭', '流行', '古典', '摇滚', '人声', '自定义'];
  const fmtDb = v => (v > 0 ? '+' : '') + Number(v || 0) + 'dB';
  const encName = e => (e === 4 ? '32-bit 浮点' : e === 21 ? '24-bit' : e === 22 ? '32-bit' : e === 3 ? '8-bit' : e === 0 ? '编码未知' : '16-bit');
  const encFromBits = b => (b === 24 ? 21 : b === 32 ? 22 : b === 8 ? 3 : 2);
  let cfg = Store.get('ac3_audio_cfg', {}) || {};
  if (Array.isArray(cfg.bands)) {
    cfg.bands = cfg.bands.map(v => Math.max(-2000, Math.min(2000, Number(v) || 0)));
  }
  let info = null;

  function save() { Store.set('ac3_audio_cfg', cfg); }
  function fx(op, a, b) {
    if (!Api.audioFx) return Promise.resolve({ok: false});
    return Api.audioFx(op, a || 0, b || 0).catch(() => ({ok: false}));
  }

  function bindPlayCfg() {
    const modeEl = document.getElementById('cfg-playmode');
    const pkgEl = document.getElementById('cfg-player');
    const actEl = document.getElementById('cfg-activity');
    const hintEl = document.getElementById('cfg-hint');
    const saveBtn = document.getElementById('af-cfg-save');
    if (!modeEl || !pkgEl || !actEl) return;
    function hint(msg) { if (hintEl) hintEl.textContent = msg || ''; }
    function paint() {
      modeEl.value = (Store.get(K.playMode, 'web') === 'system') ? 'system' : 'web';
      const savedPkg = Store.get(K.playerPkg, null);
      pkgEl.value = (savedPkg === null || savedPkg === undefined) ? 'com.maxmpz.audioplayer' : String(savedPkg || '');
      actEl.value = String(Store.get(K.playerAct, '') || '');
      hint(Store.get(K.playerAct, '') ? '当前使用 Activity 直连' : '');
    }
    function save() {
      const mode = modeEl.value === 'system' ? 'system' : 'web';
      const pkg = pkgEl.value.trim();
      const act = actEl.value.trim();
      if (pkg && !/^[A-Za-z0-9._]+$/.test(pkg)) { hint('包名只能包含字母、数字、点、下划线'); return; }
      if (act && !/^[A-Za-z0-9._]+\/[A-Za-z0-9._$]+$/.test(act)) { hint('Activity 格式应为：包名/Activity'); return; }
      Store.set(K.playMode, mode);
      Store.set(K.playerPkg, pkg);
      Store.set(K.playerAct, act);
      hint(mode === 'system' ? ('已保存：系统播放器 ' + (act || pkg || '系统选择')) : '已保存：网页内播放');
      Utils.toast(mode === 'web' ? '已切换为网页内播放' : '已切换为系统播放器');
      Utils.log('info', '播放方式: ' + (mode === 'web' ? '网页内' : ('系统播放器 ' + (act || pkg || '系统选择'))));
    }
    if (saveBtn) saveBtn.addEventListener('click', save);
    modeEl.addEventListener('change', () => hint(modeEl.value === 'system' ? '保存后生效：外部播放器模式' : '保存后生效：网页内播放'));
    paint();
  }

  function applyAll() {
    fx('eq', cfg.eqOn ? 1 : 0);
    // EQ 关闭时不要再单独发送频段/前级；它们属于同一条 EQ 链路，
    // 否则界面显示“关闭”，拖动推子却仍会改变声音。
    if (cfg.eqOn) {
      if (Array.isArray(cfg.bands) && info && info.fx && info.fx.ok) {
        cfg.bands.forEach((lv, i) => fx('band', lv, i));
      }
      fx('preamp', Math.round((cfg.preamp || 0) * 100));
    }
    fx('treble', cfg.treble || 0);
    fx('bass', cfg.bass || 0);
    fx('virt', cfg.virt || 0);
    if (cfg.speed && cfg.speed !== 1) fx('speed', Math.round(cfg.speed * 100));
  }

  function paintEqSwitch() {
    const sw = document.getElementById('af-eq-on');
    if (sw) sw.checked = !!cfg.eqOn;
  }

  function row(label, value) {
    return '<div class="af-row"><span>' + label + '</span><b>' + value + '</b></div>';
  }

  function render() {
    if (!info) return;
    const f = info.format || {};
    const d = info.fx || {};
    const devRate = info.deviceSampleRate || 0;
    const src = info.sourceFormat || {};
    const externalMode = Store.get(K.playMode, 'web') === 'system';
    const webMode = !externalMode && !!(typeof Player !== 'undefined' && Player.current && !Player.hifiActive());
    const playing = !!info.playing;
    const outputReady = !!f.sampleRate && f.configured !== false;
    const isResample = devRate > 0 && f.sampleRate && f.sampleRate !== devRate;
    const fmtLine = (o) => {
      if (!o || !o.sampleRate) return '';
      return (o.sampleRate / 1000).toFixed(1) + ' kHz · ' + encName(o.encoding) + ' · ' + (o.channels || 0) + 'ch';
    };
    let html = '';

    /* ---- EQ ---- */
    html += '<div class="af-sec"><div class="af-sec-h"><span>均衡器 <em>软件 10 段 · 蓝牙/USB 同样生效</em></span>' +
      '<label class="af-switch"><input type="checkbox" id="af-eq-on"' + (cfg.eqOn ? ' checked' : '') +
      '><i></i></label></div>';
    if (d.bands) {
      html += '<div class="af-presets">' + PRESET_NAMES.map((n, i) =>
        '<button type="button" class="af-chip' + ((cfg.preset || 0) === i ? ' on' : '') +
        '" data-preset="' + i + '">' + n + '</button>').join('') + '</div>';
      html += '<div class="af-bands' + (cfg.eqOn ? '' : ' off') + '">';
      (d.freqs || []).forEach((hz, i) => {
        let lv = Array.isArray(cfg.bands) && cfg.bands[i] != null ? cfg.bands[i] : (d.levels ? d.levels[i] : 0);
        lv = Math.max(Number(d.minLevel ?? -2000), Math.min(Number(d.maxLevel ?? 2000), Number(lv) || 0));
        const label = hz >= 1000 ? (hz / 1000) + 'k' : hz + '';
        html += '<div class="af-band"><span class="af-db">' + (lv / 100).toFixed(1) + '</span>' +
          '<input type="range" class="af-slider af-vslider" data-band="' + i + '" min="' + d.minLevel +
          '" max="' + d.maxLevel + '" value="' + lv + '" step="50" aria-label="' + label + 'Hz"' +
          (cfg.eqOn ? '' : ' disabled') + '>' +
          '<span class="af-f">' + label + '</span></div>';
      });
      html += '</div>';
      html += '<div class="af-pre' + (cfg.eqOn ? '' : ' off') + '"><span>前级增益</span><input type="range" class="af-slider" id="af-preamp" min="-20" max="20" step="0.5" value="' + (cfg.preamp || 0) + '"' + (cfg.eqOn ? '' : ' disabled') + '><span class="af-db" id="af-preamp-v">' + fmtDb(cfg.preamp || 0) + '</span></div>';
    } else {
      html += '<div class="af-na">EQ 参数读取失败，可尝试关掉再打开本模块</div>';
    }
    html += '</div>';

    /* ---- 音效 ---- */
    html += '<div class="af-sec"><div class="af-sec-h"><span>音效</span></div>';
    const trebleOk = d.treble === true, bassOk = d.bass === true, virtOk = d.virt === true;
    html += '<div class="af-fx' + (trebleOk ? '' : ' off') + '"><label class="af-switch"><input type="checkbox" id="af-treble-on"' + (cfg.treble ? ' checked' : '') + (trebleOk ? '' : ' disabled') + '><i></i></label>' +
      '<span>高音增强</span><input type="range" class="af-slider" id="af-treble" min="0" max="1000" step="50" value="' + (cfg.treble || 0) + '"></div>';
    html += '<div class="af-fx' + (bassOk ? '' : ' off') + '"><label class="af-switch"><input type="checkbox" id="af-bass-on"' + (cfg.bass ? ' checked' : '') + (bassOk ? '' : ' disabled') + '><i></i></label>' +
      '<span>低音增强</span><input type="range" class="af-slider" id="af-bass" min="0" max="1000" step="50" value="' + (cfg.bass || 0) + '"></div>';
    html += '<div class="af-fx' + (virtOk ? '' : ' off') + '"><label class="af-switch"><input type="checkbox" id="af-virt-on"' + (cfg.virt ? ' checked' : '') + (virtOk ? '' : ' disabled') + '><i></i></label>' +
      '<span>虚拟环绕</span><input type="range" class="af-slider" id="af-virt" min="0" max="1000" step="50" value="' + (cfg.virt || 0) + '"></div>';
    html += '<div class="af-fx"><span class="af-cap">播放速度</span><select id="af-speed" class="af-select">' +
      [0.5, 0.75, 1, 1.25, 1.5, 2].map(s => '<option value="' + s + '"' +
        (Math.abs((cfg.speed || 1) - s) < 0.01 ? ' selected' : '') + '>' + s + 'x</option>').join('') +
      '</select></div>';
    html += '</div>';

    /* ---- 输出信息 ---- */
    html += '<div class="af-sec"><div class="af-sec-h"><span>输出信息</span></div>';
    html += row('播放状态', playing ? (webMode ? '网页播放中' : '播放中') : (externalMode ? '外部播放器模式' : (webMode ? '网页内未播放' : '未播放')));
    if (outputReady) {
      html += row('实际输出', fmtLine(f));
      html += row('音源格式', fmtLine(src));
    } else if (src.sampleRate) {
      html += row('音源格式', fmtLine(src) + (info.sourceCodec ? ' · ' + info.sourceCodec : ''));
      html += row('实际输出', webMode
        ? (playing ? '网页内播放（WebView / 系统混音）' : '尚未开始播放')
        : (playing ? '播放中，输出格式尚未就绪' : '尚未开始播放'));
    } else if (webMode) {
      html += row('音源格式', '读取中 / 未知');
      html += row('实际输出', playing ? '网页内播放（WebView / 系统混音，采样率由系统决定）' : '尚未开始播放');
    } else {
      html += row('实际输出', playing ? '播放中，未读到格式' : '尚未开始播放');
    }
    if (src.sampleRate && outputReady) html += row('音源格式', fmtLine(src) + (info.sourceCodec ? ' · ' + info.sourceCodec : ''));
    html += row('设备原生采样率', devRate ? (devRate / 1000).toFixed(1) + ' kHz' : '未知');
    if (info.framesPerBuffer) html += row('缓冲', info.framesPerBuffer + ' 帧 · 约 ' + (info.latencyMs || 0) + ' ms');
    if (outputReady) html += row('重采样', isResample ? '是（' + (f.sampleRate / 1000).toFixed(1) + ' → ' + (devRate / 1000).toFixed(1) + ' kHz）' : '否');
    html += row('输出方式', externalMode ? '外部播放器（目标 App）'
      : (webMode ? '网页内播放（WebView / 系统混音）' : '共享混音（ExoPlayer）'));
    if (externalMode) {
      html += '<div class="af-na">外部播放器模式下，解码与输出由目标播放器负责；本应用只能确认播放请求已发送，读不到它的实际采样率/位深。需要精确输出信息请切回网页内播放。</div>';
    } else if (webMode) {
      html += '<div class="af-na">网页内播放由 WebView 解码，实际输出采样率/位深由系统混音决定，无法精确读取；上面的音源格式来自当前文件探测。EQ/音效在网页播放链路不会经过原生 PCM 旁路。</div>';
    } else {
      html += '<div class="af-na">EQ 与音效在 PCM 链路上处理，不依赖系统 AudioEffect，因此不会出现“设备不支持”。独占/bit-perfect 需自写 AAudio 输出，仍是共享混音；DSD 走 PCM 转换后播放。</div>';
    }
    html += '</div>';

    if (dynamic) dynamic.innerHTML = html;
    bind();
  }

  function bind() {
    const eqOn = document.getElementById('af-eq-on');
    if (eqOn) eqOn.addEventListener('change', () => {
      cfg.eqOn = !!eqOn.checked; save();
      fx('eq', cfg.eqOn ? 1 : 0);
      if (cfg.eqOn) {
        if (Array.isArray(cfg.bands) && info && info.fx && info.fx.ok) {
          cfg.bands.forEach((lv, i) => fx('band', lv, i));
        }
        fx('preamp', Math.round((cfg.preamp || 0) * 100));
      }
      // 关闭时立即把推子置为 disabled，触摸事件不再被滑杆吃掉，页面可以正常上下滚。
      render();
    });
    document.querySelectorAll('.af-chip[data-preset]').forEach(b => {
      b.addEventListener('click', () => {
        const p = Number(b.dataset.preset);
        cfg.preset = p;
        if (p !== 5) { cfg.bands = null; fx('preset', p); }
        // “关闭”预设必须真的关掉 EQ；原来的实现只把增益归零，
        // EQ 仍处于开启状态，所以拖频段/前级还会影响输出。
        cfg.eqOn = p !== 0;
        save();
        fx('eq', cfg.eqOn ? 1 : 0);
        if (cfg.eqOn) fx('preamp', Math.round((cfg.preamp || 0) * 100));
        paintEqSwitch();
        document.querySelectorAll('.af-chip[data-preset]').forEach(x => x.classList.toggle('on', x === b));
        render();
      });
    });
    document.querySelectorAll('.af-slider[data-band]').forEach(sl => {
      const db = sl.parentElement.querySelector('.af-db');
      let t = 0;
      sl.addEventListener('input', () => {
        if (db) db.textContent = (Number(sl.value) / 100).toFixed(1);
        cfg.preset = 5;
        document.querySelectorAll('.af-chip[data-preset]').forEach(x => x.classList.toggle('on', x.dataset.preset === '5'));
      });
      sl.addEventListener('change', () => {
        const i = Number(sl.dataset.band);
        if (!Array.isArray(cfg.bands)) cfg.bands = (info && info.fx && info.fx.levels) ? info.fx.levels.slice() : [];
        cfg.bands[i] = Number(sl.value);
        save();
        clearTimeout(t);
        if (cfg.eqOn) {
          t = setTimeout(() => fx('band', Number(sl.value), i), 60);
        }
      });
    });
    const pre = document.getElementById('af-preamp');
    if (pre) {
      pre.addEventListener('input', () => {
        const v = document.getElementById('af-preamp-v');
        if (v) v.textContent = fmtDb(Number(pre.value));
      });
      pre.addEventListener('change', () => {
        cfg.preamp = Number(pre.value); save();
        if (cfg.eqOn) fx('preamp', Math.round(cfg.preamp * 100));
      });
    }
    const trebleOn = document.getElementById('af-treble-on');
    const trebleR = document.getElementById('af-treble');
    if (trebleOn) trebleOn.addEventListener('change', () => {
      if (trebleOn.checked && trebleR && Number(trebleR.value) === 0) trebleR.value = '500';
      cfg.treble = trebleOn.checked ? Number(trebleR ? trebleR.value : 500) : 0;
      save(); fx('treble', cfg.treble);
    });
    if (trebleR) trebleR.addEventListener('change', () => {
      if (trebleOn && trebleOn.checked) { cfg.treble = Number(trebleR.value); save(); fx('treble', cfg.treble); }
    });
    const bassOn = document.getElementById('af-bass-on');
    const bassR = document.getElementById('af-bass');
    if (bassOn) bassOn.addEventListener('change', () => {
      if (bassOn.checked && bassR && Number(bassR.value) === 0) bassR.value = '500';
      cfg.bass = bassOn.checked ? Number(bassR ? bassR.value : 500) : 0;
      save(); fx('bass', cfg.bass);
    });
    if (bassR) bassR.addEventListener('change', () => {
      if (bassOn && bassOn.checked) { cfg.bass = Number(bassR.value); save(); fx('bass', cfg.bass); }
    });
    const vzOn = document.getElementById('af-virt-on');
    const vzR = document.getElementById('af-virt');
    if (vzOn) vzOn.addEventListener('change', () => {
      if (vzOn.checked && vzR && Number(vzR.value) === 0) vzR.value = '500';
      cfg.virt = vzOn.checked ? Number(vzR ? vzR.value : 500) : 0;
      save(); fx('virt', cfg.virt);
    });
    if (vzR) vzR.addEventListener('change', () => {
      if (vzOn && vzOn.checked) { cfg.virt = Number(vzR.value); save(); fx('virt', cfg.virt); }
    });
    const sp = document.getElementById('af-speed');
    if (sp) sp.addEventListener('change', () => {
      cfg.speed = Number(sp.value); save(); fx('speed', Math.round(cfg.speed * 100));
    });
  }

  function renderInfoFail(reason) {
    const isAndroid = !!(window.AUDIOCPM_CAPS && window.AUDIOCPM_CAPS.android);
    const tr = s => (typeof I18n !== 'undefined') ? I18n.t(s) : s;
    let friendly = String(reason || '');
    if (friendly === 'not_supported') friendly = tr('当前环境不支持原生音频输出');
    else if (friendly === 'audioInfo 返回 ok=false') friendly = tr('音频输出信息读取失败');
    if (dynamic) dynamic.innerHTML = '<div class="detail-empty" style="text-align:left;line-height:1.8">' +
      (isAndroid
        ? Utils.escapeHtml(tr('音频输出信息暂时没有读到。')) + '<br>' + Utils.escapeHtml(tr('播放本身不受影响（仍可正常出声）；原因已写入「日志」模块。'))
        : Utils.escapeHtml(tr('当前是网页/桌面模式，没有原生音频输出；音效与输出信息仅在 App 内可用。'))) +
      (friendly ? '<br><span style="color:#7d8b9c;font-size:10.5px">' + Utils.escapeHtml(friendly.slice(0, 160)) + '</span>' : '') +
      '<div style="margin-top:8px"><button type="button" class="small" id="af-info-retry">' + Utils.escapeHtml(tr('重试')) + '</button></div></div>';
    if (trackEl) trackEl.textContent = isAndroid ? tr('信息读取失败') : tr('不可用');
    const retry = document.getElementById('af-info-retry');
    if (retry) retry.addEventListener('click', () => load());
  }

  async function enrichWebInfo(info) {
    const external = Store.get(K.playMode, 'web') === 'system';
    let hifi = false;
    try { hifi = !!(typeof Player !== 'undefined' && Player.hifiActive && Player.hifiActive()); } catch (_) {}
    if (external || hifi) return;
    info.web = !!(typeof Player !== 'undefined' && Player.current);
    if (!info.web) return;
    try { info.playing = !!Player.isPlaying(); } catch (_) {}
    const src = info.sourceFormat || {};
    if (src.sampleRate) return;
    const path = Player.current;
    if (!path) return;
    try {
      // 网页/WebDAV 播放没有原生 ExoPlayer 的 sourceFormat；从当前文件探测一次，
      // 只用于展示“音源格式”。4 秒超时就放弃，不能把输出面板拖住。
      const d = await Promise.race([
        Api.probe(path),
        new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), 4000))
      ]);
      const a = (d && d.audio) || {};
      if (a.sample_rate) {
        info.sourceFormat = {
          sampleRate: Number(a.sample_rate) || 0,
          channels: Number(a.channels) || 0,
          encoding: encFromBits(Number(a.bits_per_sample) || 0)
        };
      }
      if (a.codec_name) info.sourceCodec = String(a.codec_name);
    } catch (_) {}
  }

  async function load() {
    let reason = '';
    info = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await Api.audioInfo();
        if (r && r.ok) { info = r; break; }
        reason = (r && (r.error || r.detail)) || 'audioInfo 返回 ok=false';
      } catch (e) { reason = (e && e.message) || String(e); }
      if (i < 2) await new Promise(res => setTimeout(res, 320 * (i + 1)));
    }
    if (!info || !info.ok) {
      try { Utils.log('err', '音频信息读取失败: ' + (reason || '未知'), 'workbench'); } catch (_) {}
      renderInfoFail(reason);
      return;
    }
    await enrichWebInfo(info);
    if (trackEl) {
      const f = info.format || {};
      const src = info.sourceFormat || {};
      const fmt = (f.sampleRate && f.configured !== false) ? ((f.sampleRate / 1000).toFixed(1) + 'k · ' + encName(f.encoding)) : '';
      const sfmt = (src.sampleRate ? ((src.sampleRate / 1000).toFixed(1) + 'k · ' + encName(src.encoding)) : '');
      trackEl.textContent = info.playing
        ? (fmt || sfmt || ((typeof I18n !== 'undefined') ? I18n.t(info.web ? '网页播放中' : '播放中') : (info.web ? '网页播放中' : '播放中')))
        : (info.pending ? ((typeof I18n !== 'undefined') ? I18n.t('待播放') : '待播放')
          : (fmt || sfmt || ((typeof I18n !== 'undefined') ? I18n.t('未播放') : '未播放')));
    }
    const f = info.format || {};
    if (info.playing && !info.web && (!f.sampleRate || f.configured === false)) {
      try {
        Utils.log('warn', '音频输出信息未就绪: ' + JSON.stringify({
          playing: info.playing,
          format: f,
          sourceFormat: info.sourceFormat || {},
          player: info.player
        }), 'workbench');
      } catch (_) {}
    }
    render();
    applyAll();
  }

  bindPlayCfg();
  fw.onToggle(open => { if (open) load(); });
  return fw;
}
