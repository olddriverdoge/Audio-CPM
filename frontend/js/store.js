/* ---------------- Store ---------------- */
const Store = {
  get(key, def) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return def;
      try { return JSON.parse(v); } catch (_) { return v; }
    } catch (e) { return def; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} }
};
