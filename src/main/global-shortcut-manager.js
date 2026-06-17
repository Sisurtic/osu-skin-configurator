// Registers per-preset global shortcuts (Electron globalShortcut).
// On trigger: if osu! is foreground → apply matched presets → system notification.
const { globalShortcut, Notification } = require('electron');
const { scanSkin, loadPreset, savePreset } = require('./preset-manager');
const { applyMultiplePresets } = require('./preset-applier');
const { isOsuFocused } = require('./foreground-detector');

let currentSkinPath = null;
let currentPresets = [];   // snapshot of presets with meta.shortcut

function registerAll(skinPath) {
  unregisterAll();
  currentSkinPath = skinPath || null;
  if (!currentSkinPath) return;
  try {
    const res = scanSkin(currentSkinPath);
    currentPresets = (res && res.presets) || [];
  } catch (e) {
    currentPresets = [];
    return;
  }
  // Register each distinct shortcut once; callback matches all presets sharing it.
  const accelerators = new Set();
  for (const p of currentPresets) {
    const acc = p.meta && p.meta.shortcut;
    if (acc) accelerators.add(acc);
  }
  for (const acc of accelerators) {
    try {
      globalShortcut.register(acc, () => onTrigger(acc));
    } catch (e) { /* ignore individual registration failures */ }
  }
}

function unregisterAll() {
  try { globalShortcut.unregisterAll(); } catch (e) { /* noop */ }
}

function onTrigger(accelerator) {
  console.log('[global-shortcut] triggered:', accelerator);
  const osuFocus = isOsuFocused();
  console.log('[global-shortcut] osu! foreground:', osuFocus);
  if (!osuFocus) return;
  if (!currentSkinPath) { console.log('[global-shortcut] no skinPath'); return; }
  const matched = currentPresets.filter(p => p.meta && p.meta.shortcut === accelerator);
  console.log('[global-shortcut] matched presets:', matched.length);
  if (matched.length === 0) return;
  const ids = matched.map(p => p.id);
  let result;
  try {
    result = applyMultiplePresets(currentSkinPath, ids);
    console.log('[global-shortcut] applied:', JSON.stringify({ ids, warnings: result?.warnings?.length || 0 }));
  } catch (e) {
    console.error('[global-shortcut] apply failed:', e.message);
    notify('应用预设失败', e.message || String(e));
    return;
  }
  const names = matched.map(p => (p.meta && p.meta.name) || ('预设 ' + p.id));
  const warnCount = (result && result.warnings) ? result.warnings.length : 0;
  const body = warnCount > 0 ? `已应用 ${names.length} 个：${names.join('、')}（${warnCount} 条警告）` : `已应用：${names.join('、')}`;
  notify('已应用预设', body);
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: false }).show();
    }
  } catch (e) { /* noop */ }
}

// Set meta.shortcut on the given presets (persist), then re-register.
function bindShortcuts(skinPath, presetIds, accelerator) {
  for (const id of presetIds) {
    const loaded = loadPreset(skinPath, id);
    if (!loaded) continue;
    const merged = Object.assign({}, loaded, {
      meta: Object.assign({}, loaded.meta || {}, { shortcut: accelerator }),
      actions: loaded.actions || { skinIni: [], fileCopies: [], fileDeletes: [] },
    });
    savePreset(skinPath, id, merged);
  }
  registerAll(skinPath);
  // Verify the accelerator is actually registered (conflict check)
  const ok = !accelerator || globalShortcut.isRegistered(accelerator);
  return ok;
}

// Clear meta.shortcut on the given presets, then re-register.
function unbindShortcuts(skinPath, presetIds) {
  for (const id of presetIds) {
    const loaded = loadPreset(skinPath, id);
    if (!loaded) continue;
    const meta = Object.assign({}, loaded.meta || {});
    delete meta.shortcut;
    const merged = Object.assign({}, loaded, {
      meta,
      actions: loaded.actions || { skinIni: [], fileCopies: [], fileDeletes: [] },
    });
    savePreset(skinPath, id, merged);
  }
  registerAll(skinPath);
  return true;
}

module.exports = {
  init: (skinPath) => registerAll(skinPath),
  reload: (skinPath) => registerAll(skinPath),
  destroy: unregisterAll,
  bind: bindShortcuts,
  unbind: unbindShortcuts,
};
