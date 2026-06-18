// Tauri frontend bridge. Builds the SAME window.electronAPI object the renderer
// already uses (api.js forwards to it), so the rest of the renderer is unchanged.
// Uses Tauri v2's global API (window.__TAURI__.*, enabled via app.withGlobalTauri).
//
// IMPORTANT: Tauri v2 invoke args keys must match the Rust parameter names
// verbatim (snake_case). We pass { skin_name: ... } etc. Every call returns the
// { success, data } / { success, error } envelope the Rust commands emit.

(function () {
  const T = window.__TAURI__;
  const invoke = T.core.invoke;

  function call(cmd, args) {
    return invoke(cmd, args);
  }

  const dlg = T.dialog;

  window.electronAPI = {
    // --- osu! path ---
    autoDetectOsuPath: () => call('osu_auto_detect'),
    getOsuPath: () => call('osu_get_path'),
    getLastSkin: () => call('osu_get_last_skin'),
    setLastSkin: (skinName) => call('osu_set_last_skin', { skinName }),
    setOsuPath: (p) => call('osu_set_path', { p }),
    browseForOsuPath: async () => {
      const chosen = await dlg.open({ directory: true, title: '选择 osu! 安装目录 (包含 osu!.exe)' });
      if (!chosen) return { success: true, data: null };
      const p = Array.isArray(chosen) ? chosen[0] : chosen;
      return { success: true, data: p };
    },

    // --- skins ---
    scanSkins: () => call('skins_scan'),
    readSkinIni: (skinName) => call('skins_read_ini', { skinName }),
    getSkinPath: (skinName) => call('skins_get_path', { skinName }),

    // --- presets ---
    scanPresets: (skinName) => call('presets_scan', { skinName }),
    loadPreset: (skinName, presetId) => call('presets_load', { skinName, presetId }),
    savePreset: (skinName, presetId, data) => call('presets_save', { skinName, presetId, data }),
    deletePreset: (skinName, presetId) => call('presets_delete', { skinName, presetId }),
    applyPreset: (skinName, presetId) => call('presets_apply', { skinName, presetId }),
    applyMultiplePresets: (skinName, presetIds) => call('presets_apply_multiple', { skinName, presetIds }),

    // --- groups ---
    addGroup: (skinName, name, parentGroupId) => call('groups_add', { skinName, name, parentGroupId }),
    removeGroup: (skinName, groupId) => call('groups_remove', { skinName, groupId }),
    renameGroup: (skinName, groupId, newName) => call('groups_rename', { skinName, groupId, newName }),
    movePresetGroup: (skinName, presetId, targetGroupId, index) => call('groups_move_preset', { skinName, presetId, targetGroupId, index }),
    moveGroup: (skinName, groupId, targetGroupId, index) => call('groups_move', { skinName, groupId, targetGroupId, index }),
    reorderChildren: (skinName, parentGroupId, childOrder) => call('groups_reorder', { skinName, parentGroupId, childOrder }),
    setGroupCollapsed: (skinName, groupId, collapsed) => call('groups_set_collapsed', { skinName, groupId, collapsed }),
    deleteGroupRecursive: (skinName, groupId) => call('groups_delete_recursive', { skinName, groupId }),

    // --- images ---
    getPreviewDataUrl: (imagePath) => call('image_get_preview', { imagePath }),

    // --- in-app shortcuts ---
    loadShortcuts: () => call('shortcuts_load'),
    saveShortcuts: (bindings) => call('shortcuts_save', { bindings }),

    // --- global shortcuts (per-preset) ---
    bindGlobalShortcut: (skinName, presetIds, accelerator) => call('global_shortcuts_bind', { skinName, presetIds, accelerator }),
    unbindGlobalShortcut: (skinName, presetIds) => call('global_shortcuts_unbind', { skinName, presetIds }),
    reloadGlobalShortcuts: (skinName) => call('global_shortcuts_reload', { skinName }),

    // --- dialogs ---
    selectFile: async (filters, defaultPath) => {
      const chosen = await dlg.open({ multiple: true, filters: filters || [], defaultPath: defaultPath || undefined });
      if (!chosen) return { success: true, data: null };
      const arr = Array.isArray(chosen) ? chosen : [chosen];
      return { success: true, data: arr };
    },
    selectFolder: async () => {
      const chosen = await dlg.open({ directory: true });
      if (!chosen) return { success: true, data: null };
      const p = Array.isArray(chosen) ? chosen[0] : chosen;
      return { success: true, data: p };
    },
    showConfirm: async (message) => {
      const ok = await dlg.ask(message, { title: '确认', kind: 'info' });
      return { success: true, data: ok };
    },

    // --- file open (.osp double-click) ---
    getOpenFileArg: () => call('app_get_open_file'),
    getAppVersion: () => call('app_get_version'),
    onOpenOspFile: (callback) => {
      if (!T || !T.event || !T.event.listen) return;
      T.event.listen('open-osp-file', (event) => {
        callback(event.payload);
      });
    },
  };
})();
