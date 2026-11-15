/* ---------------- ThumbMgr ---------------- */
const ThumbMgr = (() => {
  const obsMap = new WeakMap();
  function attach(container, size) {
    const old = obsMap.get(container);
    if (old) old.disconnect();
    const imgs = container.querySelectorAll('img[data-thumb]');
    if (!('IntersectionObserver' in window)) {
      imgs.forEach(img => { img.src = img.dataset.thumb; });
      return;
    }
    const obs = new IntersectionObserver((entries, o) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        o.unobserve(en.target);
        const img = en.target;
        if (img.dataset.failed) continue;
        img.src = img.dataset.thumb;
      }
    }, {rootMargin: '200px'});
    imgs.forEach(img => obs.observe(img));
    obsMap.set(container, obs);
  }
  function detach(container) {
    const o = obsMap.get(container);
    if (o) { o.disconnect(); obsMap.delete(container); }
  }
  function onError(img) {
    img.dataset.failed = '1';
    img.style.display = 'none';
  }
  return {attach, detach, onError};
})();
