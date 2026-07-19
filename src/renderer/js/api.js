// Thin wrapper over window.tauriAPI
// All calls return { success: true, data } or { success: false, error }

const api = {
  // --- osu! path ---
  autoDetectOsuPath: () => window.tauriAPI.autoDetectOsuPath(),
  getOsuPath: () => window.tauriAPI.getOsuPath(),
  getLastSkin: () => window.tauriAPI.getLastSkin(),
  setLastSkin: (skinName) => window.tauriAPI.setLastSkin(skinName),
  setOsuPath: (p) => window.tauriAPI.setOsuPath(p),
  browseForOsuPath: () => window.tauriAPI.browseForOsuPath(),

  // --- skins ---
  scanSkins: () => window.tauriAPI.scanSkins(),
  readSkinIni: (skinName) => window.tauriAPI.readSkinIni(skinName),
  getSkinPath: (skinName) => window.tauriAPI.getSkinPath(skinName),

  // --- presets ---
  scanPresets: (skinName) => window.tauriAPI.scanPresets(skinName),
  loadPreset: (skinName, presetId) => window.tauriAPI.loadPreset(skinName, presetId),
  savePreset: (skinName, presetId, data) => window.tauriAPI.savePreset(skinName, presetId, data),
  deletePreset: (skinName, presetId) => window.tauriAPI.deletePreset(skinName, presetId),
  deletePresets: (skinName, presetIds) => window.tauriAPI.deletePresets(skinName, presetIds),
  applyPreset: (skinName, presetId) => window.tauriAPI.applyPreset(skinName, presetId),
  applyMultiplePresets: (skinName, presetIds) => window.tauriAPI.applyMultiplePresets(skinName, presetIds),

  // --- groups ---
  addGroup: (skinName, name, parentGroupId, kind) => window.tauriAPI.addGroup(skinName, name, parentGroupId, kind),
  removeGroup: (skinName, groupId) => window.tauriAPI.removeGroup(skinName, groupId),
  renameGroup: (skinName, groupId, newName) => window.tauriAPI.renameGroup(skinName, groupId, newName),
  movePresetGroup: (skinName, presetId, targetGroupId, index) => window.tauriAPI.movePresetGroup(skinName, presetId, targetGroupId, index),
  moveGroup: (skinName, groupId, targetGroupId, index) => window.tauriAPI.moveGroup(skinName, groupId, targetGroupId, index),
  reorderChildren: (skinName, parentGroupId, childOrder) => window.tauriAPI.reorderChildren(skinName, parentGroupId, childOrder),
  setGroupCollapsed: (skinName, groupId, collapsed) => window.tauriAPI.setGroupCollapsed(skinName, groupId, collapsed),
  setGroupsCollapsedBatch: (skinName, groupIds, collapsed) => window.tauriAPI.setGroupsCollapsedBatch(skinName, groupIds, collapsed),
  deleteGroupRecursive: (skinName, groupId) => window.tauriAPI.deleteGroupRecursive(skinName, groupId),
  setGroupDescription: (skinName, groupId, description) => window.tauriAPI.setGroupDescription(skinName, groupId, description),
  setGroupPreview: (skinName, groupId, preview) => window.tauriAPI.setGroupPreview(skinName, groupId, preview),
  setGroupActions: (skinName, groupId, actions) => window.tauriAPI.setGroupActions(skinName, groupId, actions),
  applyGroup: (skinName, groupId, presetIds) => window.tauriAPI.applyGroup(skinName, groupId, presetIds),
  flattenGroupSubgroups: (skinName, groupId) => window.tauriAPI.flattenGroupSubgroups(skinName, groupId),
  setTableState: (skinName, expanded, rowSelection) => window.tauriAPI.setTableState(skinName, expanded, rowSelection),

  // --- images / files ---
  getPreviewDataUrl: (imagePath) => window.tauriAPI.getPreviewDataUrl(imagePath),

  // --- shortcuts ---
  loadShortcuts: () => window.tauriAPI.loadShortcuts(),
  saveShortcuts: (bindings) => window.tauriAPI.saveShortcuts(bindings),

  // --- global shortcuts (per-preset) ---
  bindGlobalShortcut: (skinName, presetIds, accelerator) => window.tauriAPI.bindGlobalShortcut(skinName, presetIds, accelerator),
  bindGlobalShortcutBatch: (skinName, presetIds, groupIds, accelerator) => window.tauriAPI.bindGlobalShortcutBatch(skinName, presetIds, groupIds, accelerator),
  unbindGlobalShortcut: (skinName, presetIds) => window.tauriAPI.unbindGlobalShortcut(skinName, presetIds),
  reloadGlobalShortcuts: (skinName) => window.tauriAPI.reloadGlobalShortcuts(skinName),

  // --- dialogs ---
  selectFile: (filters, defaultPath) => window.tauriAPI.selectFile(filters, defaultPath),
  selectFolder: () => window.tauriAPI.selectFolder(),
  showConfirm: (message) => window.tauriAPI.showConfirm(message),

  // --- file open (double-click .osp) ---
  getOpenFileArg: () => window.tauriAPI.getOpenFileArg(),
  getAppVersion: () => window.tauriAPI.getAppVersion(),
  listLocales: () => window.tauriAPI.listLocales(),
  checkLatestRelease: () => window.tauriAPI.checkLatestRelease(),
  downloadAndRunLatestRelease: () => window.tauriAPI.downloadAndRunLatestRelease(),
  onOpenOspFile: (callback) => window.tauriAPI.onOpenOspFile(callback),
  onGlobalShortcutApplied: (callback) => window.tauriAPI.onGlobalShortcutApplied(callback),
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
