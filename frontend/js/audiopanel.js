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
  // 与 SoftwareEqProcessor.PRESETS 一致（dB × 100）。切换预设时前端推子要立即
  // 跟着变，不能等下一次 audioInfo 刷新，否则声音变了但界面还是旧曲线。
  const PRESET_LEVELS = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 100, 300, 300, 200, 0, -100, -100, 0],
    [100, 200, 300, 200, 0, 0, -100, -100, 0, 100],
    [300, 300, 100, -100, -200, 0, 200, 400, 400, 200],
    [-200, -100, 0, 200, 400, 400, 300, 100, 0, -100],
    null
  ];
  const fmtDb = v => (v > 0 ? '+' : '') + Number(v || 0) + 'dB';
  const encName = e => (e === 4 ? '32-bit 浮点' : e === 21 ? '24-bit' : e === 22 ? '32-bit' : e === 3 ? '8-bit' : e === 0 ? '编码未知' : '16-bit');
  const encFromBits = b => (b === 24 ? 21 : b === 32 ? 22 : b === 8 ? 3 : 2);
  let cfg = Store.get('ac3_audio_cfg', {}) || {};
  if (Array.isArray(cfg.bands)) {
    cfg.bands = cfg.bands.map(v => Math.max(-1000, Math.min(1000, Number(v) || 0)));
  }
  cfg.preamp = Math.max(-10, Math.min(10, Number(cfg.preamp) || 0));
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


  const DEVICE_TYPES = {
    usb_device: 'USB DAC', usb_headset: 'USB 耳机', wired_headphones: '有线耳机',
    wired_headset: '有线耳麦', bluetooth_a2dp: '蓝牙', bluetooth_sco: '蓝牙通话',
    ble_headset: 'BLE 耳机', ble_speaker: 'BLE 音箱', speaker: '扬声器', earpiece: '听筒',
    hdmi: 'HDMI', hdmi_arc: 'HDMI ARC', hdmi_earc: 'HDMI eARC', line_analog: '模拟线路',
    line_digital: '数字线路', other: '其他'
  };
  function deviceLabel(d) {
    const type = DEVICE_TYPES[d.type] || d.type || '设备';
    const name = String(d.name || '').trim();
    const rates = Array.isArray(d.sampleRates) ? d.sampleRates : [];
    const maxRate = rates.length ? Math.max.apply(null, rates) : 0;
    return type + (name ? ' · ' + name : '') + (maxRate ? ' · ' + (maxRate / 1000).toFixed(1) + 'kHz' : '');
  }
  function deviceShort(d) {
    return d ? (DEVICE_TYPES[d.type] || d.type || '设备') : '系统默认';
  }
  function deviceKey(d) {
    return d ? String(d.key || ((d.type || 'other') + '|' + String(d.name || ''))) : 'default';
  }
  /* 把当前实际输出广播给频谱模块：延迟按这个 key 分别保存。 */
  function publishActive(devices) {
    const active = (devices || []).find(d => !!d.active) || null;
    const detail = {
      key: active ? deviceKey(active) : 'default',
      id: active ? Number(active.id) || 0 : 0,
      label: active ? deviceLabel(active) : '系统默认',
      short: active ? deviceShort(active) : '系统默认',
      active: !!active
    };
    window.__AUDIO_CPM_OUTPUT = detail;
    try { window.dispatchEvent(new CustomEvent('ac2-output-device', {detail})); } catch (_) {}
    return detail;
  }

  function bindRoute() {
    const sel = document.getElementById('af-device');
    const hintEl = document.getElementById('af-device-hint');
    if (!sel) return;
    function hint(msg) { if (hintEl) hintEl.textContent = msg || ''; }
    async function loadDevices() {
      try {
        const r = await Api.audioDevices();
        if (!Array.isArray(r)) { hint('设备列表读取失败'); return; }
        const saved = Number(Store.get(K.audioDevice, 0)) || 0;
        const active = r.find(d => !!d.active) || null;
        const detail = publishActive(r);
        const savedDev = r.find(d => Number(d.id) === saved) || null;
        // 只在用户没有正在操作下拉框时重建，避免 3 秒轮询把点选打断。
        if (document.activeElement !== sel) {
          const defText = active ? ('系统默认（当前：' + deviceShort(active) + '）') : '系统默认';
          const opts = ['<option value="0">' + Utils.escapeHtml(defText) + '</option>'].concat(r.map(d =>
            '<option value="' + Number(d.id) + '">' + Utils.escapeHtml(deviceLabel(d)) + '</option>'));
          sel.innerHTML = opts.join('');
          sel.value = (saved === 0 || savedDev) ? String(saved) : '0';
        }
        if (savedDev && saved !== 0) {
          hint('已选：' + deviceLabel(savedDev) + ' · 当前输出：' +
            (active ? deviceLabel(active) : '系统默认'));
        } else if (saved && !savedDev) {
          // 设备拔掉了：UI 回到默认，但不清用户的选择，插回后仍可恢复。
          hint('上次选择的设备未连接 · 当前输出：' + (active ? deviceLabel(active) : '系统默认'));
        } else {
          hint('系统默认 · 当前输出：' + (active ? deviceLabel(active) : '系统默认'));
        }
        // 给频谱模块一个简短的设备标签，不改它自己的配置。
        try { if (window.__ac2OutputDetail !== detail) window.__ac2OutputDetail = detail; } catch (_) {}
      } catch (e) {
        hint('设备列表读取失败: ' + ((e && e.message) || e));
      }
    }
    sel.addEventListener('change', async () => {
      const id = Number(sel.value) || 0;
      try {
        const r = await Api.setAudioDevice(id);
        if (r && r.ok) {
          Store.set(K.audioDevice, id);
          const d = Array.from(sel.options).find(o => Number(o.value) === id);
          hint('已切换：' + (id ? (d ? d.textContent : ('设备 ' + id)) : '系统默认'));
          Utils.log('info', '输出设备: ' + (id ? String(id) : '系统默认'), 'workbench');
        } else {
          hint('切换失败: ' + ((r && r.error) || '设备不可用'));
          loadDevices();
        }
      } catch (e) {
        hint('切换失败: ' + ((e && e.message) || e));
      }
    });
    loadDevices();
    return loadDevices;
  }

  function applyAll() {
    fx('eq', cfg.eqOn ? 1 : 0);
    // EQ 关闭时不要再单独发送频段/前级；它们属于同一条 EQ 链路，
    // 否则界面显示“关闭”，拖动推子却仍会改变声音。
    if (cfg.eqOn) {
      // 不再依赖面板 info：切歌/进程重建后也要把保存的 10 段参数重新下发。
      if (Array.isArray(cfg.bands)) {
        cfg.bands.forEach((lv, i) => fx('band', lv, i));
      }
      fx('preamp', Math.round((cfg.preamp || 0) * 100));
    }
    fx('treble', cfg.treble || 0);
    fx('bass', cfg.bass || 0);
    fx('virt', cfg.virt || 0);
    if (cfg.speed && cfg.speed !== 1) fx('speed', Math.round(cfg.speed * 100));
  }

  /* 切歌时 App.onPlayed 会调用；合并短时间内的多次调用，避免连播时重复下发 20 次。 */
  window.__ac2ReapplyAudioFx = () => {
    if (reapplyTimer) clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(() => { reapplyTimer = 0; applyAll(); }, 80);
  };

  function paintEqSwitch() {
    const sw = document.getElementById('af-eq-on');
    if (sw) sw.checked = !!cfg.eqOn;
  }

  function row(label, value) {
    return '<div class="af-row"><span>' + label + '</span><b>' + value + '</b></div>';
  }

  function render() {
    if (!info) return;
    const rawF = info.format || {};
    const aa = info.aaudio || {};
    // 原生 AAudio 在部分 ROM 上会先于 SpectrumProcessor 报告格式；用 AAudio 的实际流参数补足，
    // 避免“播放中但未读到格式”。
    const f = (rawF.sampleRate ? rawF : (aa.sampleRate ? {
      sampleRate: aa.sampleRate, channels: aa.channels, encoding: aa.encoding, configured: true
    } : rawF));
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
        lv = Math.max(Number(d.minLevel ?? -1000), Math.min(Number(d.maxLevel ?? 1000), Number(lv) || 0));
        const label = hz >= 1000 ? (hz / 1000) + 'k' : hz + '';
        html += '<div class="af-band"><span class="af-db">' + (lv / 100).toFixed(1) + 'dB</span>' +
          '<input type="range" class="af-slider af-vslider" data-band="' + i + '" min="' + d.minLevel +
          '" max="' + d.maxLevel + '" value="' + lv + '" step="50" aria-label="' + label + 'Hz"' +
          (cfg.eqOn ? '' : ' disabled') + '>' +
          '<span class="af-f">' + label + '</span></div>';
      });
      html += '</div>';
      html += '<div class="af-pre' + (cfg.eqOn ? '' : ' off') + '"><span>前级增益</span><input type="range" class="af-slider" id="af-preamp" min="-10" max="10" step="0.5" value="' + (cfg.preamp || 0) + '"' + (cfg.eqOn ? '' : ' disabled') + '><span class="af-db" id="af-preamp-v">' + fmtDb(cfg.preamp || 0) + '</span></div>';
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
      const wr = info.webSampleRate || devRate;
      html += row('实际输出', webMode
        ? (playing ? '网页内播放（WebView / 系统混音' + (wr ? ' · ' + (wr / 1000).toFixed(1) + ' kHz' : '') + '）' : '尚未开始播放')
        : (playing ? '播放中，输出格式尚未就绪' : '尚未开始播放'));
    } else if (webMode) {
      html += row('音源格式', '读取中 / 未读取到');
      const wr = info.webSampleRate || devRate;
      html += row('实际输出', playing
        ? ('网页内播放（WebView / 系统混音' + (wr ? ' · ' + (wr / 1000).toFixed(1) + ' kHz' : '，采样率由系统决定') + '）')
        : '尚未开始播放');
    } else {
      html += row('实际输出', playing ? '播放中，未读到格式' : '尚未开始播放');
    }
    html += row('设备原生采样率', devRate ? (devRate / 1000).toFixed(1) + ' kHz' : '未知');
    if (webMode && info.webSampleRate) html += row('WebAudio 采样率', (info.webSampleRate / 1000).toFixed(1) + ' kHz');
    if (info.framesPerBuffer) html += row('缓冲', info.framesPerBuffer + ' 帧 · 约 ' + (info.latencyMs || 0) + ' ms');
    if (outputReady) html += row('重采样', isResample ? '是（' + (f.sampleRate / 1000).toFixed(1) + ' → ' + (devRate / 1000).toFixed(1) + ' kHz）' : '否');
    html += row('输出方式', externalMode ? '外部播放器（目标 App）'
      : (webMode ? '网页内播放（WebView / 系统混音）'
        : (aa.active ? (aa.exclusive ? 'AAudio 独占（ExoPlayer）' : 'AAudio 共享（ExoPlayer）')
          : (aa.error ? '共享混音（AAudio 不可用）' : '共享混音（ExoPlayer）'))));
    if (aa.error) {
      html += '<div class="af-na">AAudio: ' + Utils.escapeHtml(String(aa.error)) + '</div>';
    }
    if (externalMode) {
      html += '<div class="af-na">外部播放器模式下，解码与输出由目标播放器负责；本应用只能确认播放请求已发送，读不到它的实际采样率/位深。需要精确输出信息请切回网页内播放。</div>';
    } else if (webMode) {
      html += '<div class="af-na">网页内播放由 WebView 解码，实际输出采样率/位深由系统混音决定，无法精确读取；上面的音源格式来自当前文件探测。EQ/音效在网页播放链路不会经过原生 PCM 旁路。</div>';
    } else {
      html += '<div class="af-na">EQ 与音效在 PCM 链路上处理，不依赖系统 AudioEffect，因此不会出现“设备不支持”。'
        + (aa.active ? '当前使用 AAudio exclusive，实际参数以硬件协商为准；设备拒绝时会自动回退共享混音。'
          : '当前为共享混音；AAudio exclusive 不可用时自动回退。')
        + 'DSD 走 PCM 转换后播放。</div>';
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
        if (Array.isArray(cfg.bands)) {
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
        if (p !== 5) {
          cfg.bands = PRESET_LEVELS[p].slice();
          fx('preset', p);
        } else {
          cfg.bands = null;
        }
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
        if (db) db.textContent = (Number(sl.value) / 100).toFixed(1) + 'dB';
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
    if (external) return;
    // Player 的实际播放状态优先：原生桥的 playing 可能滞后一帧，不能让它把正在播放判成“未播放”。
    try {
      if (typeof Player !== 'undefined' && Player.isPlaying) {
        info.playing = !!Player.isPlaying();
      }
    } catch (_) {}
    let hifi = false;
    try { hifi = !!(typeof Player !== 'undefined' && Player.hifiActive && Player.hifiActive()); } catch (_) {}
    // 原生 ExoPlayer 的 getCurrentTracks 偶尔拿不到 selected audio group（尤其刚切歌），
    // 但前端 probe 已经有当前文件的音频流信息；HiFi 模式也要用它补“音源格式”。
    if (!info.sourceFormat || !info.sourceFormat.sampleRate) {
      try {
        const a0 = (Player.meta && Player.meta.audio) || null;
        if (a0 && a0.sample_rate) {
          info.sourceFormat = {
            sampleRate: Number(a0.sample_rate) || 0,
            channels: Number(a0.channels) || 0,
            encoding: encFromBits(Number(a0.bits_per_sample) || 0)
          };
          if (a0.codec_name) info.sourceCodec = String(a0.codec_name);
        }
      } catch (_) {}
    }
    if (hifi) return;
    info.web = !!(typeof Player !== 'undefined' && Player.current);
    if (!info.web) return;
    // WebAudio 的 AudioContext 采样率能给出 WebDAV 播放链实际使用的处理采样率；
    // 没有频谱核时退回 AudioManager 的 primary output 采样率。
    try {
      const core = window.__ac2WebAudioCore;
      if (core && core.ctx && core.ctx.sampleRate) info.webSampleRate = core.ctx.sampleRate;
    } catch (_) {}
    if (!info.webSampleRate) info.webSampleRate = info.deviceSampleRate || 0;
    const src = info.sourceFormat || {};
    if (src.sampleRate) return;
    // 先吃播放器已经拿到的元数据，避免同一首曲子重复 probe；WebDAV 的 probe 失败时
    // 仍能从 Player.meta.audio 显示音源格式。
    try {
      const a0 = (Player.meta && Player.meta.audio) || null;
      if (a0 && a0.sample_rate) {
        info.sourceFormat = {
          sampleRate: Number(a0.sample_rate) || 0,
          channels: Number(a0.channels) || 0,
          encoding: encFromBits(Number(a0.bits_per_sample) || 0)
        };
        if (a0.codec_name) info.sourceCodec = String(a0.codec_name);
        return;
      }
    } catch (_) {}
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

  // audioInfo 的原生桥偶尔会因某个可选字段异常而整体回退；HiFi 活跃时用 state
  // 的 AAudio 实测参数补齐，保证面板至少能显示真实输出与 AAudio 状态。
  async function enrichNativeInfo(info) {
    // 不要求前端 Player 还持有当前曲目：Activity/WebView 重建后，后台
    // PlaybackService 可能仍在播放，此时只有 state 知道真实状态。
    try {
      const st = await Api.playbackState();
      if (!st || !st.ok) return;
      if (st.aaudio) info.aaudio = st.aaudio;
      const aa = info.aaudio || {};
      if (st.playing) {
        info.playing = true;
        info.web = false;
        info.nativeActive = true;
      }
      if ((!info.format || !info.format.sampleRate) && aa.sampleRate) {
        info.format = {sampleRate: aa.sampleRate, channels: aa.channels,
          encoding: aa.encoding, enabled: true, configured: true};
      }
      if ((!info.sourceFormat || !info.sourceFormat.sampleRate) && st.sourceFormat && st.sourceFormat.sampleRate) {
        info.sourceFormat = st.sourceFormat;
      }
      if (st.error) info.error = st.error;
    } catch (_) {}
  }

  let refreshTimer = 0, devTimer = 0, reapplyTimer = 0, lastInfoKey = '';

  function paintTrack() {
    if (!trackEl || !info) return;
    const f = info.format || {};
    const src = info.sourceFormat || {};
    const fmt = (f.sampleRate && f.configured !== false) ? ((f.sampleRate / 1000).toFixed(1) + 'k · ' + encName(f.encoding)) : '';
    const sfmt = (src.sampleRate ? ((src.sampleRate / 1000).toFixed(1) + 'k · ' + encName(src.encoding)) : '');
    trackEl.textContent = info.playing
      ? (fmt || sfmt || ((typeof I18n !== 'undefined') ? I18n.t(info.web ? '网页播放中' : '播放中') : (info.web ? '网页播放中' : '播放中')))
      : (info.pending ? ((typeof I18n !== 'undefined') ? I18n.t('待播放') : '待播放')
        : (fmt || sfmt || ((typeof I18n !== 'undefined') ? I18n.t('未播放') : '未播放')));
  }

  function infoKey() {
    const f = (info && info.format) || {};
    const src = (info && info.sourceFormat) || {};
    const aa = (info && info.aaudio) || {};
    return [!!(info && info.playing), !!(info && info.web), !!(info && info.pending),
      f.sampleRate || 0, f.configured !== false, src.sampleRate || 0,
      !!aa.active, aa.sampleRate || 0, info && info.deviceSampleRate || 0].join('|');
  }

  // 定时轻刷新：面板打开期间播放/暂停会变化，不能只在打开时读一次，否则一直显示“未播放”。
  // 只有播放状态或格式变化才重绘，避免每 1.5 秒重建 EQ 推子、打断拖动。
  async function refresh() {
    try {
      const prev = info;
      const r = await Api.audioInfo();
      if (!r || !r.ok) return;
      info = r;
      // audioInfo 的原生桥偶发整体回退（pending + 空 format），不能让它把
      // 上一帧的好数据冲掉；只在拿不到格式时保留上一帧的输出/AAudio 参数。
      if (r.pending || !r.format || !r.format.sampleRate) {
        if (prev && prev.format && prev.format.sampleRate) {
          info.format = prev.format;
          info.aaudio = prev.aaudio || info.aaudio;
          if (!info.deviceSampleRate) info.deviceSampleRate = prev.deviceSampleRate;
          if (!info.sourceFormat || !info.sourceFormat.sampleRate) info.sourceFormat = prev.sourceFormat || info.sourceFormat;
        }
      }
      await enrichWebInfo(info);
      await enrichNativeInfo(info);
      paintTrack();
      const key = infoKey();
      if (key !== lastInfoKey) { lastInfoKey = key; render(); }
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
    await enrichNativeInfo(info);
    paintTrack();
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
    lastInfoKey = infoKey();
    render();
    applyAll();
  }

  function bindVolume() {
    const slider = document.getElementById('af-vol');
    const val = document.getElementById('af-vol-val');
    const ico = document.getElementById('af-vol-ico');
    if (!slider) return;
    function paint(v) {
      const x = Math.max(0, Math.min(1, Number(v) || 0));
      if (String(slider.value) !== String(x)) slider.value = String(x);
      if (val) val.textContent = Math.round(x * 100) + '%';
      if (ico) ico.textContent = x === 0 ? '🔇' : (x < 0.5 ? '🔉' : '🔊');
    }
    paint(typeof Player !== 'undefined' && Player.getVolume ? Player.getVolume() : 1);
    slider.addEventListener('input', () => {
      if (typeof Player !== 'undefined' && Player.setVolume) Player.setVolume(Number(slider.value));
      paint(slider.value);
    });
    document.addEventListener('ac2-volume', e => paint((e.detail || {}).volume));
  }

  bindVolume();
  bindPlayCfg();
  const reloadDevices = bindRoute();
  fw.onToggle(open => {
    if (open) {
      load();
      if (reloadDevices) reloadDevices();
      clearInterval(refreshTimer);
      refreshTimer = setInterval(refresh, 1500);
      clearInterval(devTimer);
      // 连接/摘下蓝牙、插拔 USB 时，面板不能一直停在打开时的旧设备。
      devTimer = setInterval(() => { if (reloadDevices) reloadDevices(); }, 3000);
    } else {
      clearInterval(refreshTimer);
      refreshTimer = 0;
      clearInterval(devTimer);
      devTimer = 0;
    }
  });
  return fw;
}
