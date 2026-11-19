/* ---------------- I18n：源码中文为 key，运行时翻译 + 缺省回退 -------------------- */
const I18n = (() => {
  const AUTO = 'auto';
  const SUPPORTED = ['zh-CN', 'en-US', 'ja-JP', 'de-DE', 'ru-RU', 'vi-VN', 'hi-IN'];
  const FALLBACK = 'en-US';
  const SKIP = [
    '#view1', '#tree', '#scene-tabs', '#sh-grid', '#pb1-crumbs',
    '#browse-track', '#tree-track', '#af-track', '#mf-track', '#pf-track', '#lf-ns',
    '#source-select', '#pb-title', '#pb-meta', '#pf-title', '#pf-sub', '#pf-queue',
    '#lf-body', '#meta3 .v', '#meta3 .tag-edit-wrap', '#src-list', '#cols-custom', '#task-presets', '#tree-tabs',
    '#pb-cover', '#pf-cover'
  ].join(',');
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];

  let locale = 'zh-CN';
  let dict = Object.create(null);
  let fallback = Object.create(null);
  let patterns = [];
  let started = false;
  let observer = null;

  function normalize(code) {
    const raw = String(code || '').trim().replace('_', '-');
    const low = raw.toLowerCase();
    if (!low) return 'zh-CN';
    if (low === 'zh' || low.startsWith('zh-')) {
      // 目前只提供简体中文；繁体市场后续可单独加 zh-Hant。
      return 'zh-CN';
    }
    if (low === 'en' || low.startsWith('en-')) return 'en-US';
    if (low === 'ja' || low.startsWith('ja-')) return 'ja-JP';
    if (low === 'de' || low.startsWith('de-')) return 'de-DE';
    if (low === 'ru' || low.startsWith('ru-')) return 'ru-RU';
    if (low === 'vi' || low.startsWith('vi-')) return 'vi-VN';
    if (low === 'hi' || low.startsWith('hi-')) return 'hi-IN';
    // 未支持的语言统一回退英文；不要回退中文，否则外语系统用户会看到中文界面。
    return FALLBACK;
  }

  function savedMode() {
    if (typeof Store === 'undefined') return AUTO;
    const saved = String(Store.get(K.lang, '') || '');
    if (!saved || saved === AUTO) return AUTO;
    return SUPPORTED.indexOf(saved) >= 0 ? saved : normalize(saved);
  }

  function detect() {
    const saved = savedMode();
    if (saved !== AUTO) return saved;
    let langs = [];
    try {
      langs = (navigator.languages && navigator.languages.length)
        ? Array.from(navigator.languages) : [navigator.language || ''];
    } catch (_) {}
    // 系统首选语言不匹配时直接回退英文；不要继续尝试后面的语言，
    // 否则“系统首选法语、第二语言中文”会意外变成中文界面。
    if (!langs.length || !String(langs[0] || '').trim()) return FALLBACK;
    return normalize(langs[0]);
  }

  async function load(code) {
    const r = await fetch('/i18n/' + code + '.json', {cache: 'no-store'});
    if (!r.ok) throw new Error('i18n ' + code + ' HTTP ' + r.status);
    return r.json();
  }

  function lookup(key) {
    const v = dict[key];
    if (v !== undefined && v !== null) return v;
    const f = fallback[key];
    return (f !== undefined && f !== null) ? f : null;
  }

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildPatterns() {
    patterns = [];
    const keys = Object.create(null);
    Object.keys(fallback).forEach(k => { keys[k] = 1; });
    Object.keys(dict).forEach(k => { keys[k] = 1; });
    for (const key of Object.keys(keys)) {
      if (!/\{[a-zA-Z0-9_]+\}/.test(key)) continue;
      const names = [];
      let src = '^';
      let last = 0;
      const re = /\{([a-zA-Z0-9_]+)\}/g;
      let m;
      while ((m = re.exec(key))) {
        src += escRe(key.slice(last, m.index)) + '([\\s\\S]+?)';
        names.push(m[1]);
        last = re.lastIndex;
      }
      src += escRe(key.slice(last)) + '$';
      const tpl = lookup(key);
      if (!tpl) continue;
      try {
        patterns.push({re: new RegExp(src, 'u'), names, tpl});
      } catch (_) {}
    }
    // 长句优先，避免短模式抢先匹配。
    patterns.sort((a, b) => b.re.source.length - a.re.source.length);
  }

  function fill(tpl, m, names, extra) {
    const vals = Object.create(null);
    if (extra) Object.keys(extra).forEach(k => { vals[k] = extra[k]; });
    names.forEach((name, i) => { vals[name] = m[i + 1]; });
    return String(tpl).replace(/\{([a-zA-Z0-9_]+)\}/g, (all, name) => {
      return vals[name] !== undefined ? vals[name] : all;
    });
  }

  function tr(input, vars) {
    if (input === null || input === undefined) return '';
    const raw = String(input);
    if (locale === 'zh-CN') return raw;
    const mm = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const lead = mm ? mm[1] : '';
    const text = mm ? mm[2] : raw;
    const tail = mm ? mm[3] : '';
    if (!text) return raw;
    const exact = lookup(text);
    if (exact !== null) return lead + fill(exact, [], [], vars) + tail;
    for (const p of patterns) {
      const m = text.match(p.re);
      if (m) return lead + fill(p.tpl, m, p.names, vars) + tail;
    }
    return vars ? lead + fill(text, [], [], vars) + tail : raw;
  }

  function shouldSkip(el) {
    if (!el) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    try { return !!el.closest(SKIP + ',[data-i18n-skip]'); } catch (_) { return false; }
  }

  function translateNode(node) {
    if (!node || node.nodeType !== 3) return;
    const parent = node.parentElement;
    if (!parent || shouldSkip(parent)) return;
    const next = tr(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function applyAttrs(el) {
    if (!el || el.nodeType !== 1 || shouldSkip(el)) return;
    for (const name of ATTRS) {
      const val = el.getAttribute(name);
      if (!val) continue;
      const next = tr(val);
      if (next !== val) el.setAttribute(name, next);
    }
  }

  function apply(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateNode(root); return; }
    const base = root.nodeType === 9 ? root.body : root;
    if (!base) return;
    if (base.nodeType === 1) applyAttrs(base);
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) translateNode(walker.currentNode);
    if (base.querySelectorAll) {
      base.querySelectorAll('[title],[placeholder],[aria-label],[alt]').forEach(applyAttrs);
    }
  }

  function observe() {
    if (observer || !document.body) return;
    observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'characterData') {
          translateNode(m.target);
        } else if (m.type === 'attributes') {
          applyAttrs(m.target);
        } else {
          m.addedNodes.forEach(n => apply(n));
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  function bindDialogs() {
    if (bindDialogs.done) return;
    bindDialogs.done = true;
    const c = window.confirm;
    const a = window.alert;
    const p = window.prompt;
    if (c) window.confirm = function(msg) { return c.call(window, tr(msg)); };
    if (a) window.alert = function(msg) { return a.call(window, tr(msg)); };
    if (p) window.prompt = function(msg, def) { return p.call(window, tr(msg), def); };
  }

  async function init() {
    if (started) return locale;
    started = true;
    locale = detect();
    if (locale !== 'zh-CN') {
      try { fallback = await load(FALLBACK); }
      catch (e) { console.warn('i18n fallback load failed', e && e.message || e); }
      try { dict = (locale === FALLBACK) ? fallback : await load(locale); }
      catch (e) { console.warn('i18n language load failed', e && e.message || e); }
    }
    document.documentElement.lang = locale;
    buildPatterns();
    apply(document.body);
    bindDialogs();
    observe();
    return locale;
  }

  function setLocale(code) {
    const raw = String(code || '').trim();
    const next = raw.toLowerCase() === AUTO ? AUTO : normalize(raw);
    const prev = savedMode();
    if (typeof Store !== 'undefined') Store.set(K.lang, next);
    if (next === prev) return;
    location.reload();
  }

  return {
    init, setLocale, tr, t: tr, message: tr, apply,
    get locale() { return locale; },
    get mode() { return savedMode(); },
    get languages() { return SUPPORTED.slice(); }
  };
})();
