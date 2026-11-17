/* 工作台浮窗：拖动/双指缩放/置顶/边界夹取都由 WinMgr 统一处理 */
function createFloatWin(cfg) {
  const win = document.getElementById(cfg.winId);
  if (!win) return {open() {}, close() {}, toggle() {}, isOpen: () => false, onToggle() {}, apply() {}};
  const ctl = WinMgr.register({
    id: cfg.winId,
    win,
    head: cfg.headId,
    resize: cfg.resizeId,
    minW: cfg.minW,
    minH: cfg.minH,
    contentSized: !!cfg.contentSized
  });
  let open = false, onChange = null;
  function setOpen(v, silent) {
    open = !!v;
    win.classList.toggle('hidden', !open);
    if (open) { ctl.apply(); ctl.raise(); }
    if (!silent) {
      if (open && cfg.onOpen) { try { cfg.onOpen(); } catch (_) {} }
      if (!open && cfg.onClose) { try { cfg.onClose(); } catch (_) {} }
      if (onChange) { try { onChange(open); } catch (_) {} }
    }
  }
  const minBtn = cfg.minId ? document.getElementById(cfg.minId) : null;
  if (minBtn) minBtn.addEventListener('click', () => setOpen(false));
  setOpen(false, true);
  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    isOpen: () => open,
    onToggle: fn => { onChange = fn; },
    apply: () => ctl.apply(),
    raise: () => ctl.raise()
  };
}
