/* ---------------- Wave（波形预览：渲染一次成 dataURL，播放条与列表行复用） ---------------- */
const Wave = (() => {
  const cache = new Map();

  // 竖条包络，返回 PNG dataURL；模糊交给 CSS filter，避免逐帧重绘
  function render(peaks) {
    const w = 900, h = 64;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return '';
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#fed7aa');
    g.addColorStop(0.5, '#fb923c');
    g.addColorStop(1, '#ea580c');
    ctx.fillStyle = g;
    const n = peaks.length || 1;
    const bw = w / n;
    const gap = Math.min(1.6, bw * 0.3);
    for (let i = 0; i < n; i++) {
      const v = Math.max(0.04, Math.min(1, Number(peaks[i]) || 0));
      const bh = Math.max(1.5, v * (h - 4) * 0.82);
      const x = i * bw + gap / 2;
      const bwi = Math.max(1, bw - gap);
      const y = (h - bh) / 2;
      const r = Math.min(bwi / 2, bh / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + bwi - r, y);
      ctx.quadraticCurveTo(x + bwi, y, x + bwi, y + r);
      ctx.lineTo(x + bwi, y + bh - r);
      ctx.quadraticCurveTo(x + bwi, y + bh, x + bwi - r, y + bh);
      ctx.lineTo(x + r, y + bh);
      ctx.quadraticCurveTo(x, y + bh, x, y + bh - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
    }
    try { return cv.toDataURL('image/png'); } catch (_) { return ''; }
  }

  async function get(path) {
    if (!path) return '';
    if (cache.has(path)) return cache.get(path);
    try {
      const d = await Api.waveform(path, 160);
      const url = render(d.peaks || []);
      if (url) {
        cache.set(path, url);
        if (cache.size > 40) cache.delete(cache.keys().next().value);
      }
      return url;
    } catch (_) {
      return '';
    }
  }
  return {get};
})();
