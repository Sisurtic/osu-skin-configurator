// Tauri frontend bridge. Builds the window.tauriAPI object the renderer uses
// (api.js forwards to it).
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

  window.tauriAPI = {
    // --- osu! path ---
    autoDetectOsuPath: () => call('osu_auto_detect'),
    getOsuPath: () => call('osu_get_path'),
    getLastSkin: () => call('osu_get_last_skin'),
    setLastSkin: (skinName) => call('osu_set_last_skin', { skinName }),
    setOsuPath: (p) => call('osu_set_path', { p }),
    browseForOsuPath: async () => {
      const chosen = await dlg.open({ directory: true, title: i18n.t('dialog.browseOsuTitle') });
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
    deletePresets: (skinName, presetIds) => call('presets_delete_multiple', { skinName, presetIds }),
    applyPreset: (skinName, presetId) => call('presets_apply', { skinName, presetId }),
    applyMultiplePresets: (skinName, presetIds) => call('presets_apply_multiple', { skinName, presetIds }),

    // --- groups ---
    addGroup: (skinName, name, parentGroupId, kind) => call('groups_add', { skinName, name, parentGroupId, kind }),
    removeGroup: (skinName, groupId) => call('groups_remove', { skinName, groupId }),
    renameGroup: (skinName, groupId, newName) => call('groups_rename', { skinName, groupId, newName }),
    movePresetGroup: (skinName, presetId, targetGroupId, index) => call('groups_move_preset', { skinName, presetId, targetGroupId, index }),
    moveGroup: (skinName, groupId, targetGroupId, index) => call('groups_move', { skinName, groupId, targetGroupId, index }),
    reorderChildren: (skinName, parentGroupId, childOrder) => call('groups_reorder', { skinName, parentGroupId, childOrder }),
    setGroupCollapsed: (skinName, groupId, collapsed) => call('groups_set_collapsed', { skinName, groupId, collapsed }),
    setGroupsCollapsedBatch: (skinName, groupIds, collapsed) => call('groups_set_collapsed_batch', { skinName, groupIds, collapsed }),
    deleteGroupRecursive: (skinName, groupId) => call('groups_delete_recursive', { skinName, groupId }),
    setGroupDescription: (skinName, groupId, description) => call('groups_set_description', { skinName, groupId, description }),
    setGroupPreview: (skinName, groupId, preview) => call('groups_set_preview', { skinName, groupId, path: preview?.path ?? null, kind: preview?.kind ?? null, frames: preview?.frames ?? null, fps: preview?.fps ?? null }),
    setGroupActions: (skinName, groupId, actions) => call('groups_set_actions', { skinName, groupId, actions }),
    applyGroup: (skinName, groupId, presetIds) => call('groups_apply', { skinName, groupId, presetIds: presetIds ?? null }),
    flattenGroupSubgroups: (skinName, groupId) => call('groups_flatten_subgroups', { skinName, groupId }),
    setTableState: (skinName, expanded, rowSelection) => call('set_table_state', { skinName, expanded, rowSelection }),

    // --- images ---
    getPreviewDataUrl: (imagePath) => call('image_get_preview', { imagePath }),

    // --- in-app shortcuts ---
    loadShortcuts: () => call('shortcuts_load'),
    saveShortcuts: (bindings) => call('shortcuts_save', { bindings }),

    // --- global shortcuts (per-preset) ---
    bindGlobalShortcut: (skinName, presetIds, accelerator) => call('global_shortcuts_bind', { skinName, presetIds, accelerator }),
    bindGlobalShortcutBatch: (skinName, presetIds, groupIds, accelerator) => call('global_shortcuts_bind_batch', { skinName, presetIds, groupIds, accelerator }),
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
      const ok = await dlg.ask(message, { title: i18n.t('dialog.confirm'), kind: 'info' });
      return { success: true, data: ok };
    },

    // --- file open (.osp double-click) ---
    getOpenFileArg: () => call('app_get_open_file'),
    getAppVersion: () => call('app_get_version'),
    listLocales: () => call('locales_list'),
    checkLatestRelease: () => call('check_latest_release'),
    downloadAndRunLatestRelease: () => call('download_and_run_latest_release'),
    onOpenOspFile: (callback) => {
      if (!T || !T.event || !T.event.listen) return;
      T.event.listen('open-osp-file', (event) => {
        callback(event.payload);
      });
    },
    // Fired by the backend after a global shortcut applies a preset — the skin's
    // image files may have changed, so drop every cached image and re-read on demand.
    onGlobalShortcutApplied: (callback) => {
      if (!T || !T.event || !T.event.listen) return;
      T.event.listen('global-shortcut-applied', (event) => {
        callback(event.payload);
      });
    },
  };
})();
