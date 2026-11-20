/* ---------------- 更新检查 / 应用内下载提示 ---------------- */
const UpdateChecker = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  let state = null;
  let checking = false;
  let initialized = false;

  function t(s, vars) {
    try { return (typeof I18n !== 'undefined') ? I18n.tr(s, vars) : s; }
    catch (_) { return s; }
  }
  // zh-CN 下 I18n.tr 按设计直接返回 key，不会替换占位符；这里统一补一次。
  function trf(s, vars) {
    let out = String(t(s));
    if (vars) {
      Object.keys(vars).forEach(k => {
        out = out.split('{' + k + '}').join(String(vars[k]));
      });
    }
    return out;
  }
  function el(id) { return document.getElementById(id); }
  function setText(id, text) { const e = el(id); if (e) e.textContent = text == null ? '' : String(text); }
  function show(id) { const e = el(id); if (e) e.classList.remove('hidden'); }
  function hide(id) { const e = el(id); if (e) e.classList.add('hidden'); }

  function channelLabel(ch) {
    return ch === 'test' ? t('测试版（Action 构建）') : t('正式版（Release）');
  }
  function currentLabel(data) {
    const v = data && data.current_version;
    return v ? ('v' + v) : t('未知');
  }
  function versionLabel(data) {
    return data && data.latest_version ? ('v' + data.latest_version) : '';
  }
  function safeDownload(url) {
    return /^https:\/\/github\.com\/olddriverdoge\/Audio-CPM\/releases\/download\//i.test(String(url || ''));
  }
  function nativeBridge() {
    return (typeof window !== 'undefined' && window.AudioCpmNative
      && typeof window.AudioCpmNative.downloadUpdate === 'function') ? window.AudioCpmNative : null;
  }

  function setStatus(msg, kind) {
    const e = el('upd-status');
    if (!e) return;
    e.textContent = msg || '';
    e.classList.toggle('err', kind === 'err');
    e.classList.toggle('ok', kind === 'ok');
  }
  function setBusy(busy) {
    checking = busy;
    const b = el('upd-check');
    if (b) {
      b.disabled = busy;
      b.textContent = busy ? t('检查中…') : t('检查更新');
    }
  }

  function paint(data) {
    state = data || null;
    const d = data || {};
    setText('upd-current', currentLabel(d));
    setText('upd-channel-badge', channelLabel(d.channel));
    const card = el('upd-card');
    const banner = el('update-banner');
    if (!d.ok) {
      if (card) card.classList.add('hidden');
      if (banner) banner.classList.add('hidden');
      setStatus(t('检查更新失败，网络或 GitHub 不可用，不影响使用'), 'err');
      return;
    }
    if (!d.update_available || !d.asset || !safeDownload(d.asset.url)) {
      if (card) card.classList.add('hidden');
      if (banner) banner.classList.add('hidden');
      setStatus(trf('已是最新版本（{ver}）', {ver: d.current_version || ''}), 'ok');
      return;
    }
    setText('upd-ver', versionLabel(d));
    setText('upd-date', d.release && d.release.published_at ? d.release.published_at.slice(0, 10) : '');
    setText('upd-notes', (d.release && d.release.body) ? d.release.body : '');
    setText('ub-ver', versionLabel(d));
    setText('ub-channel', channelLabel(d.channel));
    setStatus(trf('发现新版本 {ver}', {ver: versionLabel(d)}));
    if (card) card.classList.remove('hidden');
    const dismissed = String(Store.get(K.updateDismissed, '') || '');
    if (banner) {
      if (dismissed === String(d.latest_version || '')) banner.classList.add('hidden');
      else banner.classList.remove('hidden');
    }
  }

  async function check(manual) {
    if (checking) return;
    setBusy(true);
    if (manual) setStatus(t('检查中…'));
    try {
      const data = await Api.appUpdate(!!manual);
      Store.set(K.updateLast, Date.now());
      paint(data);
      if (manual) {
        if (!data.ok) Utils.toast(t('检查更新失败，网络或 GitHub 不可用'), 'warn');
        else if (data.update_available) Utils.toast(trf('发现新版本 {ver}', {ver: versionLabel(data)}));
        else Utils.toast(t('已是最新版本'));
      }
    } catch (e) {
      const msg = t('检查更新失败，网络或 GitHub 不可用，不影响使用');
      setStatus(msg, 'err');
      hide('update-banner');
      hide('upd-card');
      if (manual) Utils.toast(msg, 'warn');
    } finally {
      setBusy(false);
      Store.set(K.updateLast, Date.now());
    }
  }

  function autoCheck() {
    if (checking) return;
    const caps = (typeof window !== 'undefined' && window.AUDIOCPM_CAPS) || {};
    if (!caps.app_version) return;
    const last = Number(Store.get(K.updateLast, 0) || 0);
    if (last && Date.now() - last < DAY) return;
    check(false);
  }

  function dismiss() {
    if (state && state.latest_version) Store.set(K.updateDismissed, String(state.latest_version));
    hide('update-banner');
  }

  function download() {
    const a = state && state.asset;
    if (!a || !a.url) { Utils.toast(t('没有可下载的更新包'), 'warn'); return; }
    if (!safeDownload(a.url)) { Utils.toast(t('更新下载地址不受信任'), 'err'); return; }
    const name = String(a.name || ('Audio-CPM-' + (state.latest_version || 'update') + '.apk'));
    const bridge = nativeBridge();
    if (bridge) {
      try {
        const r = JSON.parse(bridge.downloadUpdate(a.url, name) || '{}');
        if (r && r.ok) {
          dismiss();
          setStatus(t('已开始下载，完成后请在通知栏或下载目录查看'), 'ok');
          Utils.toast(t('已开始下载更新包'));
          return;
        }
        Utils.log('warn', '更新下载失败: ' + (r && (r.error || r.message) || 'unknown'), 'workbench');
      } catch (e) {
        Utils.log('warn', '更新下载异常: ' + (e && e.message || e), 'workbench');
      }
    }
    // 浏览器 / 原生下载失败时的兜底：交给外部浏览器打开 GitHub 资产地址。
    try {
      window.open(a.url, '_blank', 'noopener');
      dismiss();
      setStatus(t('已打开下载页面'), 'ok');
    } catch (e) {
      Utils.toast(t('无法打开下载页面'), 'err');
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const c = el('upd-check');
    if (c) c.onclick = () => check(true);
    const b = el('ub-download');
    if (b) b.onclick = download;
    const s = el('upd-download');
    if (s) s.onclick = download;
    const x = el('ub-close');
    if (x) x.onclick = dismiss;
    const later = el('upd-later');
    if (later) later.onclick = dismiss;
    setBusy(false);
    setStatus(t('尚未检查更新'));
    const caps = (typeof window !== 'undefined' && window.AUDIOCPM_CAPS) || {};
    if (caps.app_version) {
      setText('upd-current', 'v' + caps.app_version);
      setText('upd-channel-badge', channelLabel(caps.update_channel));
    } else {
      setText('upd-current', '');
      const c = el('upd-check');
      if (c) c.disabled = true;
      setStatus(t('仅 Android App 内支持更新检查'));
    }
    // 启动时只恢复本地已知的版本信息，不主动联网；网络请求由 autoCheck 异步发起。
    if (typeof window !== 'undefined' && window.AudioCpmNative) {
      // 当前版本由 /api/app_update 返回，避免前端猜测。
    }
  }

  return { init, autoCheck, check, paint, download, dismiss };
})();
