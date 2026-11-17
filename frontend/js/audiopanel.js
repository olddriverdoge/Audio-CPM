/* ---------------- 音频输出（EQ / 音效 / 输出信息） ---------------- */
function createAudioPanel() {
  const fw = createFloatWin({
    winId: 'audio-float', headId: 'af-head', resizeId: 'af-resize', minId: 'af-min',
    minW: 300, minH: 320
  });
  const win = document.getElementById('audio-float');
  if (!win) return fw;
  const body = document.getElementById('af-body');
  const trackEl = document.getElementById('af-track');
  const PRESET_NAMES = ['关闭', '流行', '古典', '摇滚', '人声', '自定义'];
  const encName = e => (e === 4 ? '32-bit 浮点' : e === 21 ? '24-bit' : e === 22 ? '32-bit' : e === 3 ? '8-bit' : '16-bit');
  let cfg = Store.get('ac3_audio_cfg', {}) || {};
  let info = null;

  function save() { Store.set('ac3_audio_cfg', cfg); }
  function fx(op, a, b) {
    if (!Api.audioFx) return Promise.resolve({ok: false});
    return Api.audioFx(op, a || 0, b || 0).catch(() => ({ok: false}));
  }

  function applyAll() {
    fx('eq', cfg.eqOn ? 1 : 0);
    if (Array.isArray(cfg.bands) && info && info.fx && info.fx.ok) {
      cfg.bands.forEach((lv, i) => fx('band', lv, i));
    }
    fx('bass', cfg.bass || 0);
    fx('virt', cfg.virt || 0);
    fx('loud', Math.round((cfg.preamp || 0) * 100));
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
    html += '<div class="af-sec"><div class="af-sec-h"><span>均衡器</span>' +
      '<label class="af-switch"><input type="checkbox" id="af-eq-on"' + (cfg.eqOn ? ' checked' : '') +
      '><i></i></label></div>';
    if (d.eq) {
      html += '<div class="af-presets">' + PRESET_NAMES.map((n, i) =>
        '<button type="button" class="af-chip' + ((cfg.preset || 0) === i ? ' on' : '') +
        '" data-preset="' + i + '">' + n + '</button>').join('') + '</div>';
      html += '<div class="af-bands">';
      (d.freqs || []).forEach((hz, i) => {
        const lv = Array.isArray(cfg.bands) && cfg.bands[i] != null ? cfg.bands[i] : (d.levels ? d.levels[i] : 0);
        const label = hz >= 1000 ? (hz / 1000) + 'k' : hz + '';
        html += '<div class="af-band"><span class="af-f">' + label + '</span>' +
          '<input type="range" class="af-slider" data-band="' + i + '" min="' + d.minLevel +
          '" max="' + d.maxLevel + '" value="' + lv + '" step="50">' +
          '<span class="af-db">' + (lv / 100).toFixed(1) + '</span></div>';
      });
      html += '</div>';
      html += '<div class="af-pre"><span>前级增益（响度）</span><input type="range" class="af-slider" id="af-preamp" min="0" max="20" step="0.5" value="' + (cfg.preamp || 0) + '"><span class="af-db" id="af-preamp-v">+' + (cfg.preamp || 0) + 'dB</span></div>';
    } else {
      html += '<div class="af-na">此设备不支持系统均衡器</div>';
    }
    html += '</div>';

    /* ---- 音效 ---- */
    html += '<div class="af-sec"><div class="af-sec-h"><span>音效</span></div>';
    html += '<div class="af-fx"><label class="af-switch"><input type="checkbox" id="af-bass-on"' + (cfg.bass ? ' checked' : '') + '><i></i></label>' +
      '<span>低音增强</span><input type="range" class="af-slider" id="af-bass" min="0" max="1000" step="50" value="' + (cfg.bass || 0) + '"></div>';
    html += '<div class="af-fx"><label class="af-switch"><input type="checkbox" id="af-virt-on"' + (cfg.virt ? ' checked' : '') + '><i></i></label>' +
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
    html += '<div class="af-na">独占/bit-perfect 直通需要自写 AAudio 输出，暂未启用；DSD 需转 PCM。</div>';
    html += '</div>';

    body.innerHTML = html;
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
        if (v) v.textContent = '+' + Number(pre.value) + 'dB';
      });
      pre.addEventListener('change', () => {
        cfg.preamp = Number(pre.value); save(); fx('loud', Math.round(cfg.preamp * 100));
      });
    }
    const bassOn = document.getElementById('af-bass-on');
    const bassR = document.getElementById('af-bass');
    if (bassOn) bassOn.addEventListener('change', () => {
      cfg.bass = bassOn.checked ? Number(bassR ? bassR.value : 500) : 0;
      save(); fx('bass', cfg.bass);
    });
    if (bassR) bassR.addEventListener('change', () => {
      if (bassOn && bassOn.checked) { cfg.bass = Number(bassR.value); save(); fx('bass', cfg.bass); }
    });
    const vzOn = document.getElementById('af-virt-on');
    const vzR = document.getElementById('af-virt');
    if (vzOn) vzOn.addEventListener('change', () => {
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

  async function load() {
    try { info = await Api.audioInfo(); } catch (_) { info = {ok: false}; }
    if (!info || !info.ok) {
      body.innerHTML = '<div class="detail-empty">桌面/网页模式没有原生音频输出，音效与输出信息仅在 App 内可用。</div>';
      if (trackEl) trackEl.textContent = '不可用';
      return;
    }
    if (trackEl) {
      const f = info.format || {};
      trackEl.textContent = f.sampleRate ? ((f.sampleRate / 1000).toFixed(1) + 'k · ' + encName(f.encoding)) : '未播放';
    }
    render();
    applyAll();
  }

  fw.onToggle(open => { if (open) load(); });
  return fw;
}
