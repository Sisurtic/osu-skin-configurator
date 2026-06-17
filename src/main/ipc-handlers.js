const { ipcMain, dialog, BrowserWindow } = require('electron');
const { autoDetectOsuPath } = require('./osu-path');
const { getOsuPath, setOsuPath, getLastSkin, setLastSkin, getShortcutBindings, setShortcutBindings } = require('./config-store');
const { scanSkins, getSkinPath } = require('./skin-scanner');
const { readSkinIni } = require('./ini-reader');
const {
  scanSkin,
  loadPreset,
  savePreset,
  deletePreset,
  addGroup,
  removeGroup,
  renameGroup,
  movePreset,
  moveGroup,
  reorderChildren,
  setGroupCollapsed,
  deleteGroupRecursive,
  getPreviewDataUrl,
} = require('./preset-manager');
const { applyPreset, applyMultiplePresets } = require('./preset-applier');
const globalShortcutManager = require('./global-shortcut-manager');

function wrap(fn) {
  return async (_event, ...args) => {
    try {
      const result = await fn(...args);
      return { success: true, data: result !== undefined ? result : undefined };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };
}

function getSkinPathFromName(skinName) {
  const osuPath = getOsuPath();
  if (!osuPath) throw new Error('未设置 osu! 路径');
  return getSkinPath(osuPath, skinName);
}

function registerIpcHandlers() {
  // ── osu! path ──
  ipcMain.handle('osu:auto-detect', wrap(() => autoDetectOsuPath()));
  ipcMain.handle('osu:get-path', wrap(() => getOsuPath()));
  ipcMain.handle('osu:get-last-skin', wrap(() => getLastSkin()));
  ipcMain.handle('osu:set-path', wrap((p) => {
    setOsuPath(p);
    return true;
  }));
  ipcMain.handle('osu:browse', wrap(async () => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      properties: ['openDirectory'],
      title: '选择 osu! 安装目录 (包含 osu!.exe)',
    });
    return result.canceled ? null : result.filePaths[0];
  }));

  // ── skins ──
  ipcMain.handle('skins:scan', wrap(() => {
    const osuPath = getOsuPath();
    if (!osuPath) return [];
    return scanSkins(osuPath);
  }));
  ipcMain.handle('skins:read-ini', wrap((skinName) => {
    const skinPath = getSkinPathFromName(skinName);
    const sections = readSkinIni(skinPath);
    return sections.map(entry => ({
      section: entry.section,
      keys: Object.fromEntries(entry.keys),
    }));
  }));
  ipcMain.handle('skins:get-path', wrap((skinName) => {
    return getSkinPathFromName(skinName);
  }));

  // ── presets ──
  ipcMain.handle('presets:scan', wrap((skinName) => {
    const skinPath = getSkinPathFromName(skinName);
    return scanSkin(skinPath);
  }));
  ipcMain.handle('presets:load', wrap((skinName, presetId) => {
    const skinPath = getSkinPathFromName(skinName);
    return loadPreset(skinPath, presetId);
  }));
  ipcMain.handle('presets:save', wrap((skinName, presetId, data) => {
    const skinPath = getSkinPathFromName(skinName);
    const assignedId = savePreset(skinPath, presetId, data);
    setLastSkin(skinName);
    return assignedId;
  }));
  ipcMain.handle('presets:delete', wrap((skinName, presetId) => {
    const skinPath = getSkinPathFromName(skinName);
    deletePreset(skinPath, presetId);
    return true;
  }));
  ipcMain.handle('presets:apply', wrap((skinName, presetId) => {
    const skinPath = getSkinPathFromName(skinName);
    return applyPreset(skinPath, presetId);
  }));
  ipcMain.handle('presets:apply-multiple', wrap((skinName, presetIds) => {
    const skinPath = getSkinPathFromName(skinName);
    return applyMultiplePresets(skinPath, presetIds);
  }));

  // ── groups ──
  ipcMain.handle('groups:add', wrap((skinName, name, parentGroupId) => {
    const skinPath = getSkinPathFromName(skinName);
    return addGroup(skinPath, name, parentGroupId);
  }));
  ipcMain.handle('groups:remove', wrap((skinName, groupId) => {
    const skinPath = getSkinPathFromName(skinName);
    removeGroup(skinPath, groupId);
    return true;
  }));
  ipcMain.handle('groups:rename', wrap((skinName, groupId, newName) => {
    const skinPath = getSkinPathFromName(skinName);
    renameGroup(skinPath, groupId, newName);
    return true;
  }));
  ipcMain.handle('groups:move-preset', wrap((skinName, presetId, targetGroupId, index) => {
    const skinPath = getSkinPathFromName(skinName);
    movePreset(skinPath, presetId, targetGroupId, index);
    return true;
  }));
  ipcMain.handle('groups:move', wrap((skinName, groupId, targetGroupId, index) => {
    const skinPath = getSkinPathFromName(skinName);
    moveGroup(skinPath, groupId, targetGroupId, index);
    return true;
  }));
  ipcMain.handle('groups:reorder', wrap((skinName, parentGroupId, childOrder) => {
    const skinPath = getSkinPathFromName(skinName);
    reorderChildren(skinPath, parentGroupId, childOrder);
    return true;
  }));
  ipcMain.handle('groups:set-collapsed', wrap((skinName, groupId, collapsed) => {
    const skinPath = getSkinPathFromName(skinName);
    setGroupCollapsed(skinPath, groupId, collapsed);
    return true;
  }));
  ipcMain.handle('groups:delete-recursive', wrap((skinName, groupId) => {
    const skinPath = getSkinPathFromName(skinName);
    return deleteGroupRecursive(skinPath, groupId);
  }));

  // ── images / files ──
  ipcMain.handle('image:get-preview', wrap((imagePath) => {
    return getPreviewDataUrl(imagePath);
  }));

  // ── shortcuts ──
  ipcMain.handle('shortcuts:load', wrap(() => getShortcutBindings()));
  ipcMain.handle('shortcuts:save', wrap((bindings) => {
    setShortcutBindings(bindings);
    return true;
  }));

  // ── global shortcuts (per-preset) ──
  ipcMain.handle('global-shortcuts:bind', wrap((skinName, presetIds, accelerator) => {
    const skinPath = getSkinPathFromName(skinName);
    const ok = globalShortcutManager.bind(skinPath, presetIds || [], accelerator);
    if (!ok) throw new Error('快捷键已被占用或无效');
    return true;
  }));
  ipcMain.handle('global-shortcuts:unbind', wrap((skinName, presetIds) => {
    const skinPath = getSkinPathFromName(skinName);
    globalShortcutManager.unbind(skinPath, presetIds || []);
    return true;
  }));
  ipcMain.handle('global-shortcuts:reload', wrap((skinName) => {
    const skinPath = skinName ? getSkinPathFromName(skinName) : null;
    globalShortcutManager.reload(skinPath);
    return true;
  }));

  // ── dialogs ──
  ipcMain.handle('dialog:select-file', wrap(async (filters, defaultPath) => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      filters: filters || [],
      properties: ['openFile', 'multiSelections'],
      defaultPath: defaultPath || undefined,
    });
    return result.canceled ? null : result.filePaths;
  }));
  ipcMain.handle('dialog:select-folder', wrap(async () => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  }));
  ipcMain.handle('dialog:confirm', wrap(async (message) => {
    const result = await dialog.showMessageBox(BrowserWindow.getFocusedWindow(), {
      type: 'question',
      buttons: ['取消', '确认'],
      defaultId: 1,
      title: '确认',
      message,
    });
    return result.response === 1;
  }));
}

module.exports = { registerIpcHandlers };
