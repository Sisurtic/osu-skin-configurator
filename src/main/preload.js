const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- osu! path ---
  autoDetectOsuPath: () => ipcRenderer.invoke('osu:auto-detect'),
  getOsuPath: () => ipcRenderer.invoke('osu:get-path'),
  getLastSkin: () => ipcRenderer.invoke('osu:get-last-skin'),
  setOsuPath: (p) => ipcRenderer.invoke('osu:set-path', p),
  browseForOsuPath: () => ipcRenderer.invoke('osu:browse'),

  // --- skins ---
  scanSkins: () => ipcRenderer.invoke('skins:scan'),
  readSkinIni: (skinName) => ipcRenderer.invoke('skins:read-ini', skinName),
  getSkinPath: (skinName) => ipcRenderer.invoke('skins:get-path', skinName),

  // --- presets ---
  scanPresets: (skinName) => ipcRenderer.invoke('presets:scan', skinName),
  loadPreset: (skinName, presetId) => ipcRenderer.invoke('presets:load', skinName, presetId),
  savePreset: (skinName, presetId, data) => ipcRenderer.invoke('presets:save', skinName, presetId, data),
  deletePreset: (skinName, presetId) => ipcRenderer.invoke('presets:delete', skinName, presetId),
  applyPreset: (skinName, presetId) => ipcRenderer.invoke('presets:apply', skinName, presetId),
  applyMultiplePresets: (skinName, presetIds) => ipcRenderer.invoke('presets:apply-multiple', skinName, presetIds),

  // --- groups ---
  addGroup: (skinName, name, parentGroupId) => ipcRenderer.invoke('groups:add', skinName, name, parentGroupId),
  removeGroup: (skinName, groupId) => ipcRenderer.invoke('groups:remove', skinName, groupId),
  renameGroup: (skinName, groupId, newName) => ipcRenderer.invoke('groups:rename', skinName, groupId, newName),
  movePresetGroup: (skinName, presetId, targetGroupId, index) => ipcRenderer.invoke('groups:move-preset', skinName, presetId, targetGroupId, index),
  moveGroup: (skinName, groupId, targetGroupId, index) => ipcRenderer.invoke('groups:move', skinName, groupId, targetGroupId, index),
  reorderChildren: (skinName, parentGroupId, childOrder) => ipcRenderer.invoke('groups:reorder', skinName, parentGroupId, childOrder),
  setGroupCollapsed: (skinName, groupId, collapsed) => ipcRenderer.invoke('groups:set-collapsed', skinName, groupId, collapsed),
  deleteGroupRecursive: (skinName, groupId) => ipcRenderer.invoke('groups:delete-recursive', skinName, groupId),

  // --- images / files ---
  getPreviewDataUrl: (imagePath) => ipcRenderer.invoke('image:get-preview', imagePath),

  // --- shortcuts ---
  loadShortcuts: () => ipcRenderer.invoke('shortcuts:load'),
  saveShortcuts: (bindings) => ipcRenderer.invoke('shortcuts:save', bindings),

  // --- global shortcuts (per-preset) ---
  bindGlobalShortcut: (skinName, presetIds, accelerator) => ipcRenderer.invoke('global-shortcuts:bind', skinName, presetIds, accelerator),
  unbindGlobalShortcut: (skinName, presetIds) => ipcRenderer.invoke('global-shortcuts:unbind', skinName, presetIds),
  reloadGlobalShortcuts: (skinName) => ipcRenderer.invoke('global-shortcuts:reload', skinName),

  // --- dialogs ---
  selectFile: (filters, defaultPath) => ipcRenderer.invoke('dialog:select-file', filters, defaultPath),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  showConfirm: (message) => ipcRenderer.invoke('dialog:confirm', message),

  // --- file open (double-click .osp in Explorer) ---
  getOpenFileArg: () => ipcRenderer.invoke('app:get-open-file'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  onOpenOspFile: (callback) => {
    ipcRenderer.on('open-osp-file', (_event, skinName) => callback(skinName));
  },
});
