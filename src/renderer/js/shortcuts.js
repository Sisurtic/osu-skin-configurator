// Keyboard shortcut registry — manages bindings, matching, and rebinding
(function () {
  const DEFAULTS = [
    { id: 'refresh',     key: 'Ctrl+R',  descKey: 'shortcutsDesc.refresh',     modes: ['use','edit'] },
    { id: 'toggle-mode', key: 'Ctrl+E',  descKey: 'shortcutsDesc.toggleMode',  modes: ['use','edit'] },
    { id: 'save',        key: 'Ctrl+S',  descKey: 'shortcutsDesc.save',        modes: ['edit'] },
    { id: 'new-preset',  key: 'Ctrl+N',  descKey: 'shortcutsDesc.newPreset',   modes: ['edit'] },
    { id: 'new-group',   key: 'Ctrl+G',  descKey: 'shortcutsDesc.newGroup',    modes: ['edit'] },
    { id: 'new-table-group', key: 'Ctrl+Shift+G', descKey: 'shortcutsDesc.newTableGroup', modes: ['edit'] },
    { id: 'copy-item',     key: 'Ctrl+Shift+C', descKey: 'shortcutsDesc.copyItem',     modes: ['edit'] },
    { id: 'copy-actions',  key: 'Ctrl+C',  descKey: 'shortcutsDesc.copyActions',  modes: ['edit'] },
    { id: 'paste-actions', key: 'Ctrl+V',  descKey: 'shortcutsDesc.pasteActions', modes: ['edit'] },
    { id: 'apply',       key: 'Space',   descKey: 'shortcutsDesc.apply',       modes: ['use','edit'] },
  ];

  // Current bindings (id → key string). Loaded from config on startup.
  let bindings = {};

  function getBinding(id) {
    return bindings[id] || getDefaultKey(id);
  }

  function getDefaultKey(id) {
    const def = DEFAULTS.find(d => d.id === id);
    return def ? def.key : null;
  }

  function setBinding(id, newKey) {
    bindings[id] = newKey;
    state.set('shortcutBindings', { ...bindings });
  }

  function getAll() {
    return DEFAULTS.map(d => ({
      id: d.id,
      key: getBinding(d.id),
      desc: i18n.t(d.descKey),
      modes: d.modes,
    }));
  }

  // Keys that must not be bound as a standalone global shortcut (no modifier).
  const FORBIDDEN_BARE_KEYS = new Set(['Escape', ' ', 'Tab', 'Backspace', 'Delete', 'Enter']);
  // Letters, digits, punctuation — too disruptive if bound WITHOUT a modifier
  // (would block them system-wide). Allowed WITH Ctrl/Alt/Shift.
  const COMMON_KEYS = /^[a-zA-Z0-9`~!@#$%^&*()\-_=+\[\]{}\\|;:'",<.>\/?]$/;

  // Parse a KeyboardEvent into an accelerator-grammar string for an
  // OS-level GLOBAL shortcut, e.g. "Ctrl+Alt+Shift+A", "Ctrl+F1", "Alt+num5".
  // Unlike keyToString (in-app program shortcuts, bare keys allowed), a global
  // accelerator REQUIRES a Ctrl/Alt modifier and blocks bare letters/digits
  // (which would be swallowed system-wide). Returns null for bare modifier
  // presses or forbidden bare keys.
  function keyToAccelerator(e) {
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return null;
    const hasModifier = e.ctrlKey || e.altKey;
    if (!hasModifier && FORBIDDEN_BARE_KEYS.has(e.key)) return null;
    if (!hasModifier && COMMON_KEYS.test(e.key)) return null;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let k = e.key;
    if (e.code && e.code.startsWith('Numpad')) {
      const np = e.code.slice(6);
      k = /^\d$/.test(np) ? 'num' + np : 'num' + np.toLowerCase();
    } else if (k === ' ') k = 'Space';
    else if (k.length === 1) k = k.toUpperCase();
    parts.push(k);
    return parts.join('+');
  }

  // Parse a KeyboardEvent into a canonical key string, e.g. "Ctrl+S", "Delete"
  // Returns null for modifier-only presses.
  function keyToString(e) {
    const key = e.key;
    // Ignore pure modifier keys
    if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    // Normalize key name
    let keyName = key;
    if (key === ' ') {
      keyName = 'Space';
    } else if (key.length === 1) {
      keyName = key.toUpperCase();
    }
    parts.push(keyName);
    return parts.join('+');
  }

  // Build a normalized string from a binding string (e.g. "Ctrl+S") for comparison
  function normalize(str) {
    return str.split('+').map(s => s.trim()).sort().join('+');
  }

  // Match a KeyboardEvent against all bindings. Returns the action id or null.
  function matchAction(e) {
    const str = keyToString(e);
    if (!str) return null;
    const norm = normalize(str);
    for (const d of DEFAULTS) {
      const bound = getBinding(d.id);
      if (!bound) continue;
      if (normalize(bound) === norm) return d.id;
    }
    return null;
  }

  // Initialize bindings from loaded data
  function init(loadedBindings) {
    bindings = loadedBindings || {};
  }

  // Get raw bindings for persistence
  function getRawBindings() {
    return { ...bindings };
  }

  window.Shortcuts = { getBinding, setBinding, getAll, keyToString, keyToAccelerator, matchAction, init, getRawBindings, DEFAULTS };
})();
