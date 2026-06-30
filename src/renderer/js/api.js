// Thin wrapper over window.electronAPI
// All calls return { success: true, data } or { success: false, error }

const api = {
  // --- osu! path ---
  autoDetectOsuPath: () => window.electronAPI.autoDetectOsuPath(),
  getOsuPath: () => window.electronAPI.getOsuPath(),
  getLastSkin: () => window.electronAPI.getLastSkin(),
  setLastSkin: (skinName) => window.electronAPI.setLastSkin(skinName),
  setOsuPath: (p) => window.electronAPI.setOsuPath(p),
  browseForOsuPath: () => window.electronAPI.browseForOsuPath(),

  // --- skins ---
  scanSkins: () => window.electronAPI.scanSkins(),
  readSkinIni: (skinName) => window.electronAPI.readSkinIni(skinName),
  getSkinPath: (skinName) => window.electronAPI.getSkinPath(skinName),

  // --- presets ---
  scanPresets: (skinName) => window.electronAPI.scanPresets(skinName),
  loadPreset: (skinName, presetId) => window.electronAPI.loadPreset(skinName, presetId),
  savePreset: (skinName, presetId, data) => window.electronAPI.savePreset(skinName, presetId, data),
  deletePreset: (skinName, presetId) => window.electronAPI.deletePreset(skinName, presetId),
  deletePresets: (skinName, presetIds) => window.electronAPI.deletePresets(skinName, presetIds),
  applyPreset: (skinName, presetId) => window.electronAPI.applyPreset(skinName, presetId),
  applyMultiplePresets: (skinName, presetIds) => window.electronAPI.applyMultiplePresets(skinName, presetIds),

  // --- groups ---
  addGroup: (skinName, name, parentGroupId) => window.electronAPI.addGroup(skinName, name, parentGroupId),
  removeGroup: (skinName, groupId) => window.electronAPI.removeGroup(skinName, groupId),
  renameGroup: (skinName, groupId, newName) => window.electronAPI.renameGroup(skinName, groupId, newName),
  movePresetGroup: (skinName, presetId, targetGroupId, index) => window.electronAPI.movePresetGroup(skinName, presetId, targetGroupId, index),
  moveGroup: (skinName, groupId, targetGroupId, index) => window.electronAPI.moveGroup(skinName, groupId, targetGroupId, index),
  reorderChildren: (skinName, parentGroupId, childOrder) => window.electronAPI.reorderChildren(skinName, parentGroupId, childOrder),
  setGroupCollapsed: (skinName, groupId, collapsed) => window.electronAPI.setGroupCollapsed(skinName, groupId, collapsed),
  setGroupsCollapsedBatch: (skinName, groupIds, collapsed) => window.electronAPI.setGroupsCollapsedBatch(skinName, groupIds, collapsed),
  deleteGroupRecursive: (skinName, groupId) => window.electronAPI.deleteGroupRecursive(skinName, groupId),

  // --- images / files ---
  getPreviewDataUrl: (imagePath) => window.electronAPI.getPreviewDataUrl(imagePath),

  // --- shortcuts ---
  loadShortcuts: () => window.electronAPI.loadShortcuts(),
  saveShortcuts: (bindings) => window.electronAPI.saveShortcuts(bindings),

  // --- global shortcuts (per-preset) ---
  bindGlobalShortcut: (skinName, presetIds, accelerator) => window.electronAPI.bindGlobalShortcut(skinName, presetIds, accelerator),
  unbindGlobalShortcut: (skinName, presetIds) => window.electronAPI.unbindGlobalShortcut(skinName, presetIds),
  reloadGlobalShortcuts: (skinName) => window.electronAPI.reloadGlobalShortcuts(skinName),

  // --- dialogs ---
  selectFile: (filters, defaultPath) => window.electronAPI.selectFile(filters, defaultPath),
  selectFolder: () => window.electronAPI.selectFolder(),
  showConfirm: (message) => window.electronAPI.showConfirm(message),

  // --- file open (double-click .osp) ---
  getOpenFileArg: () => window.electronAPI.getOpenFileArg(),
  getAppVersion: () => window.electronAPI.getAppVersion(),
  listLocales: () => window.electronAPI.listLocales(),
  checkLatestRelease: () => window.electronAPI.checkLatestRelease(),
  downloadAndRunLatestRelease: () => window.electronAPI.downloadAndRunLatestRelease(),
  onOpenOspFile: (callback) => window.electronAPI.onOpenOspFile(callback),
  onGlobalShortcutApplied: (callback) => window.electronAPI.onGlobalShortcutApplied(callback),
};

// Helper: call API and handle generic error
async function apiCall(fn, ...args) {
  try {
    const result = await fn(...args);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}
