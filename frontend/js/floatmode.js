/* ---------------- 全局浮窗（系统级悬浮窗，Android） ----------------
 * 由 FloatingPlayService 承载：一个只有播放管理页的 WebView，
 * 盖在其他 App 上层，不依赖工作台页面。页面通过 AudioCpmFloat 桥
 * 拖动/缩放/关闭原生窗口；播放走本地 HiFi 服务（/api/playback/*）。
 */
const FLOAT_QUERY = (() => {
  try { return new URLSearchParams(location.search).get('float') === '1'; } catch (_) { return false; }
})();
window.__AC2_FLOAT_MODE = FLOAT_QUERY;

const FloatMode = (() => {
  function t(s) { try { return I18n.t(s); } catch (_) { return s; } }
  function bridge() { return window.AudioCpmFloat || null; }
  function native() { return window.AudioCpmNative || null; }
  function parse(raw) { try { return JSON.parse(raw || '{}') || {}; } catch (_) { return {}; } }

  function status() {
    const n = native();
    if (!n || typeof n.floatPlayStatus !== 'function') {
      return {ok: false, unsupported: true, permission: false, running: false};
    }
    return parse(n.floatPlayStatus());
  }

  function start() {
    const n = native();
    if (!n || typeof n.floatPlayStart !== 'function') {
      Utils.toast(t('仅 Android App 支持全局浮窗'), 'warn');
      return;
    }
    const r = parse(n.floatPlayStart());
    if (r.need_permission) {
      Utils.toast(t('请在系统设置里允许“显示在其他应用上层”'), 'warn');
      return;
    }
    if (!r.ok) {
      Utils.toast(r.error ? String(r.error) : t('浮窗启动失败'), 'err');
      return;
    }
    Utils.toast(t('播放管理已作为全局浮窗启动'));
    refreshSettings();
  }

  function stop() {
    const n = native();
    if (n && typeof n.floatPlayStop === 'function') n.floatPlayStop();
    refreshSettings();
  }

  function refreshSettings() {
    const badge = document.getElementById('float-badge');
    const statusEl = document.getElementById('float-status');
    const btn = document.getElementById('float-start');
    if (!badge && !statusEl) return;
    const s = status();
    if (s.unsupported) {
      if (badge) badge.textContent = t('浏览器');
      if (statusEl) statusEl.textContent = t('仅 Android App 内可用');
      if (btn) btn.disabled = true;
      return;
    }
    if (btn) btn.disabled = false;
    if (badge) badge.textContent = s.permission ? (s.running ? t('已开启') : t('可开启')) : t('未授权');
    if (statusEl) {
      statusEl.textContent = !s.permission
        ? t('需要“显示在其他应用上层”权限；授权后点开启。')
        : (s.running ? t('播放管理正在其他应用上层显示。') : t('点开启后，播放管理会盖在其他应用上。'));
      statusEl.classList.toggle('err', !s.permission);
      statusEl.classList.toggle('ok', !!s.permission && !!s.running);
    }
    if (btn) btn.textContent = s.running ? t('关闭全局浮窗') : t('开启全局浮窗');
  }

  /* 浮窗内的标题栏拖动 / 右下角缩放，交给原生窗口 */
  function bindWindowGestures() {
    if (!FLOAT_QUERY) return;
    const head = document.getElementById('pf-head');
    const resize = document.getElementById('pf-resize');
    if (head) {
      let last = null;
      head.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;
        last = {x: e.clientX, y: e.clientY};
        try { head.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      }, true);
      head.addEventListener('pointermove', e => {
        if (!last) return;
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        last = {x: e.clientX, y: e.clientY};
        const b = bridge();
        if (b && typeof b.moveBy === 'function') b.moveBy(dx, dy);
        e.preventDefault();
      }, true);
      ['pointerup', 'pointercancel'].forEach(t => head.addEventListener(t, () => { last = null; }, true));
    }
    if (resize) {
      let last = null;
      resize.addEventListener('pointerdown', e => {
        last = {x: e.clientX, y: e.clientY, w: window.innerWidth, h: window.innerHeight};
        try { resize.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      }, true);
      resize.addEventListener('pointermove', e => {
        if (!last) return;
        const b = bridge();
        if (b && typeof b.resizeTo === 'function') {
          b.resizeTo(last.w + (e.clientX - last.x), last.h + (e.clientY - last.y));
        }
        e.preventDefault();
      }, true);
      ['pointerup', 'pointercancel'].forEach(t => resize.addEventListener(t, () => { last = null; }, true));
    }
  }

  function bindParts() {
    const head = document.getElementById('pf-head');
    if (head && FLOAT_QUERY) {
      const min = document.getElementById('pf-min');
      if (min) {
        min.addEventListener('click', e => {
          const b = bridge();
          if (b && typeof b.close === 'function') { e.stopPropagation(); e.preventDefault(); b.close(); }
        }, true);
      }
    }
    const pin = document.getElementById('pf-float');
    if (pin) {
      pin.addEventListener('click', e => {
        e.stopPropagation();
        if (FLOAT_QUERY) {
          const b = bridge(); if (b && b.close) b.close();
        } else start();
      });
    }
    const btn = document.getElementById('float-start');
    if (btn) {
      btn.addEventListener('click', () => {
        const s = status();
        if (s.running) stop(); else start();
      });
    }
  }

  /* 浮窗页启动：只打开播放管理 + 内嵌声谱，并接管已经在本机 HiFi 服务里
     播放的曲目（不重新起播、不依赖工作台页面是否在前台）。 */
  async function boot() {
    document.body.classList.add('float-mode');
    // 播放窗口原本嵌在 .app 的 canvas 里；浮窗模式要脱离工作台，挂到 body 下，
    // 否则隐藏 .app 时窗口会一起消失（尺寸算出来是 0）。
    try {
      const w = document.getElementById('play-float');
      if (w && w.parentElement !== document.body) document.body.appendChild(w);
      if (w) {
        ['left', 'top', 'right', 'bottom', 'width', 'height', 'transform'].forEach(k => w.style.removeProperty(k));
        w.classList.remove('hidden');
      }
    } catch (_) {}
    try { App.openModule('play'); } catch (_) {}
    try {
      const panel = document.getElementById('pf-q-toggle');
      if (panel && App.openModules && App.openModules().indexOf('play') < 0) App.openModule('play');
    } catch (_) {}
    bindWindowGestures();
    bindParts();
    for (let i = 0; i < 4; i++) {
      try { if (Player.hydrateNative) await Player.hydrateNative(); } catch (_) {}
      await new Promise(r => setTimeout(r, 400));
    }
    refreshSettings();
  }

  function initSettings() {
    if (FLOAT_QUERY) return;
    bindParts();
    refreshSettings();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshSettings(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettings);
  } else {
    initSettings();
  }

  return {boot, start, stop, status, refresh: refreshSettings};
})();
