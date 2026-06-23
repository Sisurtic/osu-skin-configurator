// Internationalization (i18n) core.
//
// Active locale is detected once at load time from (in order) a user-chosen
// locale persisted in localStorage, then navigator.language (mirrors the OS
// language). There IS an in-app language switcher in the toolbar; switching
// does NOT reload — it calls applyStatic() + a full re-render so all text
// updates in one frame. Fallback chain: active → 'zh-CN' → raw key.
//
// Locale dictionaries are loaded once at startup by app.js via the Rust
// `locales_list` command (which scans the bundled locales folder and returns
// { tag: dict } sorted by filename). app.js calls i18n.load(dicts) before the
// first render. To add a language: drop a new <tag>.json into the locales
// folder — the backend discovers it, no code/index.html changes needed.
(function () {
  const FALLBACK = 'zh-CN';
  const STORAGE_KEY = 'osc-locale';

  // Display labels for the switcher dropdown. Each locale carries its own name
  // in a `_name` key inside its JSON; we read that. LOCALE_LABELS is just a
  // last-resort fallback for the raw tag if a file omits `_name`.
  const LOCALE_LABELS = {};

  // The loaded dictionaries: { tag: { ...nestedKeys } }. Populated by load().
  let dicts = {};
  // Ordered tag list as returned by the backend (folder/filename order).
  let orderedTags = [];

  function hasLocale(tag) {
    return !!dicts[tag];
  }

  // Called by app.js after fetching locales_list. Accepts the backend payload
  // { tags: [...], dicts: {...} } (preferred, carries folder order) OR a plain
  // { tag: dict } object.
  function load(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.tags)) {
      orderedTags = payload.tags.slice();
    }
    const d = payload.dicts || payload;
    if (d && typeof d === 'object') {
      for (const tag of Object.keys(d)) {
        dicts[tag] = d[tag];
        // Also mirror to window.__LOCALES__ for non-t() access (e.g. easterEggs).
        window.__LOCALES__ = window.__LOCALES__ || {};
        window.__LOCALES__[tag] = d[tag];
      }
    }
  }

  // All currently registered locales, in folder/filename order from the backend.
  function available() {
    const tags = orderedTags.length ? orderedTags.slice() : Object.keys(dicts);
    if (tags.indexOf(FALLBACK) === -1) tags.unshift(FALLBACK);
    return tags;
  }

  function detect() {
    const stored = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; } })();
    if (stored && hasLocale(stored)) return stored;
    const raw = (navigator.language || navigator.userLanguage || FALLBACK).toLowerCase();
    if (raw.startsWith('zh-tw') || raw.startsWith('zh-hk') ||
        raw.startsWith('zh-hant') || raw.startsWith('zh-mo')) return 'zh-TW';
    if (raw.startsWith('zh')) return 'zh-CN';
    if (raw.startsWith('ja')) return 'ja';
    if (raw.startsWith('ko')) return 'ko-KR';
    if (raw.startsWith('ru')) return 'ru-RU';
    if (raw.startsWith('en')) return 'en';
    return 'en';
  }

  let active = null; // resolved on first applyLocale()/t()

  function dictFor(tag) {
    return dicts[tag] || {};
  }

  function lookup(tag, key) {
    const parts = key.split('.');
    let cur = dictFor(tag);
    for (const p of parts) {
      cur = cur && cur[p];
      if (cur === undefined) break;
    }
    return cur;
  }

  function t(key, params) {
    if (active === null) active = detect();
    let s = lookup(active, key);
    if (s === undefined) s = lookup(FALLBACK, key);
    if (s === undefined) return key;
    if (params) {
      for (const k in params) {
        s = String(s).split('{' + k + '}').join(params[k]);
      }
    }
    return s;
  }

  function locale() {
    if (active === null) active = detect();
    return active;
  }

  function labelFor(tag) {
    // Prefer the language's own name declared inside its JSON (_name key).
    const d = dicts[tag];
    if (d && d._name) return d._name;
    return LOCALE_LABELS[tag] || tag;
  }

  // Apply the detected/chosen locale to static HTML, and set the active locale.
  // app.js calls this after load() and before the first render.
  function applyLocale() {
    if (active === null) active = detect();
    applyStatic();
  }

  // Re-render hook — set by app.js to a function that forces every subscribed
  // component + the current view to re-render (no reload).
  let _rerenderAll = null;
  function onRerender(fn) { _rerenderAll = fn; }

  // Switch and persist. No reload: translate static HTML, then trigger a full
  // re-render so all dynamically-rendered strings update together.
  function setLocale(tag) {
    if (tag === locale() || !hasLocale(tag)) return;
    try { localStorage.setItem(STORAGE_KEY, tag); } catch (_) {}
    active = tag;
    applyStatic();
    if (typeof _rerenderAll === 'function') _rerenderAll();
  }

  // Translate static HTML elements carrying data-i18n* attributes, and sync
  // <html lang> + <title>.
  function applyStatic() {
    if (active === null) active = detect();
    document.documentElement.setAttribute('lang', active);
    const nodes = document.querySelectorAll('[data-i18n]');
    for (const el of nodes) {
      const v = t(el.getAttribute('data-i18n'));
      if (v) el.textContent = v;
    }
    const titled = document.querySelectorAll('[data-i18n-title]');
    for (const el of titled) {
      const v = t(el.getAttribute('data-i18n-title'));
      if (v) el.title = v;
    }
    const ph = document.querySelectorAll('[data-i18n-placeholder]');
    for (const el of ph) {
      const v = t(el.getAttribute('data-i18n-placeholder'));
      if (v) el.placeholder = v;
    }
    const docTitle = lookup(active, 'app.title') || lookup(FALLBACK, 'app.title');
    if (docTitle) document.title = docTitle;
  }

  window.i18n = { t, locale, setLocale, applyLocale, applyStatic, load, available, labelFor, onRerender, FALLBACK };
})();
