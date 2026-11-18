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
  const encName = e => (e === 4 ? '32-bit 浮点' : e === 21 ? '24-bit' : e === 22 ? '32-bit' : e === 3 ? '8-bit' : '16-bit');
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
    if (Array.isArray(cfg.bands) && info && info.fx && info.fx.ok) {
      cfg.bands.forEach((lv, i) => fx('band', lv, i));
    }
    fx('treble', cfg.treble || 0);
    fx('bass', cfg.bass || 0);
    fx('virt', cfg.virt || 0);
    fx('preamp', Math.round((cfg.preamp || 0) * 100));
    if (cfg.speed && cfg.speed !== 1) fx('speed', Math.round(cfg.speed * 100));
  }

  function row(label, value) {
    return '<div class="af-row"><span>' + label + '</span><b>' + value + '</b></div>';
  }

  function render() {
    if (!info) return;
    const f = info.format || {};
    const d = info.fx || {};
    const devRate = info.deviceSampleRate || 0;
    const isResample = devRate > 0 && f.sampleRate && f.sampleRate !== devRate;
    let html = '';

    /* ---- EQ ---- */
    html += '<div class="af-sec"><div class="af-sec-h"><span>均衡器 <em>软件 10 段 · 蓝牙/USB 同样生效</em></span>' +
      '<label class="af-switch"><input type="checkbox" id="af-eq-on"' + (cfg.eqOn ? ' checked' : '') +
      '><i></i></label></div>';
    if (d.bands) {
      html += '<div class="af-presets">' + PRESET_NAMES.map((n, i) =>
        '<button type="button" class="af-chip' + ((cfg.preset || 0) === i ? ' on' : '') +
        '" data-preset="' + i + '">' + n + '</button>').join('') + '</div>';
      html += '<div class="af-bands">';
      (d.freqs || []).forEach((hz, i) => {
        let lv = Array.isArray(cfg.bands) && cfg.bands[i] != null ? cfg.bands[i] : (d.levels ? d.levels[i] : 0);
        lv = Math.max(Number(d.minLevel ?? -2000), Math.min(Number(d.maxLevel ?? 2000), Number(lv) || 0));
        const label = hz >= 1000 ? (hz / 1000) + 'k' : hz + '';
        html += '<div class="af-band"><span class="af-db">' + (lv / 100).toFixed(1) + '</span>' +
          '<input type="range" class="af-slider af-vslider" data-band="' + i + '" min="' + d.minLevel +
          '" max="' + d.maxLevel + '" value="' + lv + '" step="50" aria-label="' + label + 'Hz">' +
          '<span class="af-f">' + label + '</span></div>';
      });
      html += '</div>';
      html += '<div class="af-pre"><span>前级增益</span><input type="range" class="af-slider" id="af-preamp" min="-20" max="20" step="0.5" value="' + (cfg.preamp || 0) + '"><span class="af-db" id="af-preamp-v">' + fmtDb(cfg.preamp || 0) + '</span></div>';
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
    if (f.sampleRate) {
      html += row('实际输出', (f.sampleRate / 1000).toFixed(1) + ' kHz · ' + encName(f.encoding) + ' · ' + (f.channels || 0) + 'ch');
    } else {
      html += row('实际输出', '尚未开始播放');
    }
    html += row('设备原生采样率', devRate ? (devRate / 1000).toFixed(1) + ' kHz' : '未知');
    if (info.framesPerBuffer) html += row('缓冲', info.framesPerBuffer + ' 帧 · 约 ' + (info.latencyMs || 0) + ' ms');
    html += row('重采样', isResample ? '是（' + (f.sampleRate / 1000).toFixed(1) + ' → ' + (devRate / 1000).toFixed(1) + ' kHz）' : '否');
    html += row('输出方式', '共享混音（ExoPlayer）');
    html += '<div class="af-na">EQ 与音效在 PCM 链路上处理，不依赖系统 AudioEffect，因此不会出现“设备不支持”。独占/bit-perfect 需自写 AAudio 输出，仍是共享混音；DSD 走 PCM 转换后播放。</div>';
    html += '</div>';

    if (dynamic) dynamic.innerHTML = html;
    bind();
  }

  function bind() {
    const eqOn = document.getElementById('af-eq-on');
    if (eqOn) eqOn.addEventListener('change', () => {
      cfg.eqOn = eqOn.checked; save(); fx('eq', cfg.eqOn ? 1 : 0);
    });
    document.querySelectorAll('.af-chip[data-preset]').forEach(b => {
      b.addEventListener('click', () => {
        const p = Number(b.dataset.preset);
        cfg.preset = p;
        if (p !== 5) { cfg.bands = null; fx('preset', p); }
        save();
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
        t = setTimeout(() => fx('band', Number(sl.value), i), 60);
      });
    });
    const pre = document.getElementById('af-preamp');
    if (pre) {
      pre.addEventListener('input', () => {
        const v = document.getElementById('af-preamp-v');
        if (v) v.textContent = fmtDb(Number(pre.value));
      });
      pre.addEventListener('change', () => {
        cfg.preamp = Number(pre.value); save(); fx('preamp', Math.round(cfg.preamp * 100));
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
    if (dynamic) dynamic.innerHTML = '<div class="detail-empty" style="text-align:left;line-height:1.8">' +
      (isAndroid
        ? '音频输出信息暂时没有读到。<br>播放本身不受影响（仍可正常出声）；原因已写入「日志」模块。'
        : '当前是网页/桌面模式，没有原生音频输出；音效与输出信息仅在 App 内可用。') +
      (reason ? '<br><span style="color:#7d8b9c;font-size:10.5px">' + Utils.escapeHtml(String(reason).slice(0, 160)) + '</span>' : '') +
      '<div style="margin-top:8px"><button type="button" class="small" id="af-info-retry">重试</button></div></div>';
    if (trackEl) trackEl.textContent = isAndroid ? '信息读取失败' : '不可用';
    const retry = document.getElementById('af-info-retry');
    if (retry) retry.addEventListener('click', () => load());
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
    if (trackEl) {
      const f = info.format || {};
      trackEl.textContent = info.pending ? '待播放'
        : (f.sampleRate ? ((f.sampleRate / 1000).toFixed(1) + 'k · ' + encName(f.encoding)) : '未播放');
    }
    render();
    applyAll();
  }

  bindPlayCfg();
  fw.onToggle(open => { if (open) load(); });
  return fw;
}
