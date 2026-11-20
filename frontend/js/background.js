/* ---------------- 后台运行 / 电池优化引导 ---------------- */
const BackgroundKeeper = (() => {
  let initialized = false;

  function t(s) {
    try { return (typeof I18n !== 'undefined') ? I18n.tr(s) : s; }
    catch (_) { return s; }
  }
  function el(id) { return document.getElementById(id); }
  function setText(id, text) { const e = el(id); if (e) e.textContent = text == null ? '' : String(text); }
  function setStatus(msg, kind) {
    const e = el('bg-status');
    if (!e) return;
    e.textContent = msg || '';
    e.classList.toggle('err', kind === 'err');
    e.classList.toggle('ok', kind === 'ok');
  }
  function setBadge(msg) { setText('bg-badge', msg); }
  function bridge() {
    const b = (typeof window !== 'undefined') ? window.AudioCpmNative : null;
    return b && typeof b.backgroundStatus === 'function' ? b : null;
  }
  function parse(raw) {
    try { return JSON.parse(raw || '{}') || {}; } catch (_) { return {}; }
  }
  function disableAll(disabled) {
    ['bg-allow', 'bg-settings', 'bg-battery'].forEach(id => {
      const b = el(id);
      if (b) b.disabled = !!disabled;
    });
  }
  function refresh() {
    const b = bridge();
    if (!b) {
      setBadge(t('浏览器'));
      setStatus(t('仅 Android App 内可配置后台运行'));
      disableAll(true);
      return;
    }
    disableAll(false);
    const d = parse(b.backgroundStatus());
    if (!d.ok) {
      setBadge(t('受限'));
      setStatus(t('后台状态读取失败'), 'err');
      return;
    }
    if (d.battery_optimized) {
      setBadge(t('受限'));
      setStatus(t('电池优化未关闭，后台可能被系统中断。'), 'err');
    } else {
      setBadge(t('已启用'));
      setStatus(t('后台服务运行中，电池优化未限制。'), 'ok');
    }
  }
  function openBattery() {
    const b = bridge();
    if (!b) return;
    if (typeof b.openBatterySettings === 'function') {
      const d = parse(b.openBatterySettings());
      if (!d.ok) Utils.toast(t('无法打开系统电池设置'), 'warn');
    }
  }
  function openApp() {
    const b = bridge();
    if (!b) return;
    if (typeof b.openAppSettings === 'function') {
      const d = parse(b.openAppSettings());
      if (!d.ok) Utils.toast(t('无法打开应用设置'), 'warn');
    }
  }
  function allow() {
    const b = bridge();
    if (!b) return;
    if (typeof b.requestBackground !== 'function') {
      openBattery();
      return;
    }
    const d = parse(b.requestBackground());
    if (d.ok) {
      Utils.toast(t('已打开系统设置，请选择“不限制后台”或关闭电池优化'), 'ok');
    } else {
      openBattery();
    }
  }
  function init() {
    if (initialized) return;
    initialized = true;
    const a = el('bg-allow');
    if (a) a.onclick = allow;
    const s = el('bg-settings');
    if (s) s.onclick = openApp;
    const b = el('bg-battery');
    if (b) b.onclick = openBattery;
    refresh();
    window.addEventListener('focus', () => { try { refresh(); } catch (_) {} });
  }
  return { init, refresh, allow, openApp, openBattery };
})();
