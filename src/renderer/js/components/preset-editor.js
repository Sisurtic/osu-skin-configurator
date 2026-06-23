// Preset editor — tab container + save/apply/delete toolbar
(function () {
  const viewEl = document.getElementById('view-editor');

  // Editor state for the currently editing preset
  let editData = {
    meta: { name: '', description: '' },
    actions: { skinIni: [], fileCopies: [], fileDeletes: [] },
    _previewPath: null,
    _isNew: true,
  };

  function getSkinIniActions() { return editData.actions.skinIni; }
  function setSkinIniActions(v) { editData.actions.skinIni = v; state.set('presetDirty', true); }
  function getFileCopies() { return editData.actions.fileCopies; }
  function setFileCopies(v) { editData.actions.fileCopies = v; state.set('presetDirty', true); }
  function getFileDeletes() { return editData.actions.fileDeletes || []; }
  function setFileDeletes(v) { editData.actions.fileDeletes = v; state.set('presetDirty', true); }
  function getPreviewDataUrl() { return editData._previewPath; }
  function setPreviewDataUrl(v) { editData._previewPath = v; state.set('presetDirty', true); }
  function getPresetMeta() { return editData; }

  const skinName = () => state.get('selectedSkin');
  const presetId = () => state.get('selectedPreset'); // number | '__new__' | null

  // Initialize sub-editors
  IniEditor.init(getSkinIniActions, setSkinIniActions, async () => {
    const sn = skinName();
    if (!sn) return null;
    const r = await api.getSkinPath(sn);
    return r.success ? r.data : null;
  });
  FileCopyEditor.init(getFileCopies, setFileCopies, getFileDeletes, setFileDeletes, skinName, () => state.get('selectedPreset'), async () => {
    const sn = skinName();
    if (!sn) return null;
    const r = await api.getSkinPath(sn);
    return r.success ? r.data : null;
  });
  PreviewUpload.init(getPresetMeta, setPreviewDataUrl, skinName, () => state.get('selectedPreset'));

  function render() {
    const prevActiveTab = viewEl.querySelector('.tab--active');
    const savedTabName = prevActiveTab ? prevActiveTab.dataset.tab : 'basic';

    viewEl.innerHTML = `
      <div class="tabs">
        <div class="tab tab--active" data-tab="basic" tabindex="0">${i18n.t('preset.tabBasic')}</div>
        <div class="tab" data-tab="ini" tabindex="0">${i18n.t('preset.tabIni')}</div>
        <div class="tab" data-tab="files" tabindex="0">${i18n.t('preset.tabFiles')}</div>
      </div>

      <div class="tab-content tab-content--active" id="tab-basic"></div>
      <div class="tab-content" id="tab-ini"></div>
      <div class="tab-content" id="tab-files"></div>
    `;

    if (savedTabName !== 'basic') {
      const targetTab = viewEl.querySelector(`.tab[data-tab="${savedTabName}"]`);
      const targetContent = document.getElementById(`tab-${savedTabName}`);
      if (targetTab && targetContent) {
        viewEl.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
        viewEl.querySelectorAll('.tab-content').forEach(c => c.classList.remove('tab-content--active'));
        targetTab.classList.add('tab--active');
        targetContent.classList.add('tab-content--active');
      }
    }

    viewEl.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        viewEl.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
        viewEl.querySelectorAll('.tab-content').forEach(c => c.classList.remove('tab-content--active'));
        tab.classList.add('tab--active');
        const targetId = `tab-${tab.dataset.tab}`;
        const targetEl = document.getElementById(targetId);
        targetEl.classList.add('tab-content--active');
        // Switching to the ini/files tab makes it visible (clientWidth > 0);
        // apply column widths + re-trigger edge-fade now that the container
        // has a real size.
        if (tab.dataset.tab === 'ini' && window.IniEditor && window.IniEditor.layoutColumns) {
          window.IniEditor.layoutColumns(targetEl);
        } else if (tab.dataset.tab === 'files' && window.FileCopyEditor && window.FileCopyEditor.layoutColumns) {
          window.FileCopyEditor.layoutColumns(targetEl);
        }
        // Re-trigger scroll event on next frame so edge-fade overlays
        // re-calculate position (getBoundingClientRect needs visible layout).
        requestAnimationFrame(() => {
          const scroll = targetEl.querySelector('.ini-table-body-scroll, .files-table-body-scroll');
          if (scroll) scroll.dispatchEvent(new Event('scroll'));
        });
      });

      tab.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          const targetId = `tab-${tab.dataset.tab}`;
          const targetEl = document.getElementById(targetId);
          if (targetEl) {
            const focusable = targetEl.querySelector(
              'input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (focusable) focusable.focus();
          }
        }
      });
    });

    renderBasicTab();
    IniEditor.render(document.getElementById('tab-ini'));
    FileCopyEditor.render(document.getElementById('tab-files'));
  }

  function renderBasicTab() {
    const meta = editData.meta;
    const tab = document.getElementById('tab-basic');
    tab.innerHTML = `
      <div class="form-group">
        <label class="form-label">${i18n.t('preset.nameLabel')}</label>
        <input type="text" class="form-input" id="preset-name" value="${escapeHtml(meta.name)}" placeholder="${i18n.t('preset.namePlaceholder')}" autocomplete="off" spellcheck="false">
      </div>
      <div class="form-group">
        <label class="form-label">${i18n.t('preset.descLabel')}</label>
        <textarea class="form-input" id="preset-desc" placeholder="${i18n.t('preset.descPlaceholder')}">${escapeHtml(meta.description || '')}</textarea>
      </div>
      <div id="preview-slot"></div>
    `;

    // Bind input changes to editData + dirty tracking
    ['name', 'desc'].forEach(field => {
      const el = document.getElementById(`preset-${field}`);
      if (!el) return;
      const handler = () => {
        if (field === 'desc') editData.meta.description = el.value;
        else editData.meta[field] = el.value;
        state.set('presetDirty', true);
      };
      el.addEventListener('input', handler);
    });

    // Tab cycling: preset-name → preset-desc → preview controls → ...
    if (!tab._tabBound) {
      tab._tabBound = true;
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const focusable = [...tab.querySelectorAll('#preset-name, #preset-desc, #upload-zone, #btn-change-preview, #btn-remove-preview')]
          .filter(el => el && !el.hidden);
        if (focusable.length <= 1) return;
        const activeEl = document.activeElement;
        const idx = focusable.indexOf(activeEl);
        if (idx < 0) return;
        e.preventDefault();
        const next = e.shiftKey
          ? (idx <= 0 ? focusable.length - 1 : idx - 1)
          : (idx >= focusable.length - 1 ? 0 : idx + 1);
        focusable[next].focus();
      });
    }

    // Preview image picker (merged into basic tab). Placed last + wrapped so
    // any error here never blocks the name/desc input handlers above.
    try { PreviewUpload.render(document.getElementById('preview-slot')); } catch (_) { /* ignore */ }
  }

  async function doSave() {
    const sk = skinName();
    if (!sk) { Toast.error(i18n.t('toast.selectSkinFirst')); return false; }

    const name = editData.meta.name.trim();
    if (!name) { Toast.error(i18n.t('preset.nameRequired')); return false; }

    const currentId = presetId();
    const idToSend = (currentId === '__new__') ? null : currentId;

    // Build save data
    const dataToSave = {
      meta: { ...editData.meta, previewPath: editData._previewPath || '' },
      actions: {
        skinIni: [...editData.actions.skinIni],
        fileCopies: (editData.actions.fileCopies || []).map(c => ({ source: c.source, destination: c.destination })),
        fileDeletes: (editData.actions.fileDeletes || []).map(d => ({ path: d.path })),
      },
    };

    const result = await api.savePreset(sk, idToSend, dataToSave);
    if (result.success) {
      state.set('presetDirty', false);
      if (currentId !== '__new__') {
        state.set('selectedPreset', result.data);
      } else {
        // New preset saved: keep selectedPreset='__new__' so the user can
        // continue saving (Ctrl+S works for __new__ regardless of presetDirty).
        state.set('selectedPreset', '__new__');
      }
      // Preview images may have changed — drop the cached ones before re-scan
      // so the next render reloads them (ids are also compacted on delete).
      if (window.PresetSelector && typeof window.PresetSelector.invalidateCache === 'function') {
        window.PresetSelector.invalidateCache();
      }
      // Re-scan
      const scanResult = await api.scanPresets(sk);
      if (scanResult.success) {
        state.setMultiple({
          presets: scanResult.data.presets,
          groups: scanResult.data.groups,
          rootGroupIds: scanResult.data.rootGroupIds,
        });
      }
    } else {
      Toast.error(i18n.t('preset.saveFailed', { msg: result.error || i18n.t('app.unknownError') }));
      return false;
    }
    return true;
  }

  async function doDelete() {
    const sk = skinName();
    const pid = presetId();
    if (!sk || !pid || pid === '__new__') return;

    const editName = editData.meta.name || i18n.t('preset.fallbackName', { id: pid });
    const confirmed = await api.showConfirm(i18n.t('preset.deletePresetConfirm', { name: editName }));
    if (!confirmed.success || !confirmed.data) return;

    const result = await api.deletePreset(sk, pid);
    if (result.success) {
      Toast.success(i18n.t('preset.deletedToast'));
      state.set('selectedPreset', null);
      // Drop cached previews BEFORE re-scan: ids get compacted on delete, so
      // stale id→image entries would otherwise map to the wrong preset.
      if (window.PresetSelector && typeof window.PresetSelector.invalidateCache === 'function') {
        window.PresetSelector.invalidateCache();
      }
      const scanResult = await api.scanPresets(sk);
      if (scanResult.success) {
        state.setMultiple({
          presets: scanResult.data.presets,
          groups: scanResult.data.groups,
          rootGroupIds: scanResult.data.rootGroupIds,
        });
      }
    } else {
      Toast.error(i18n.t('preset.deleteFailed', { msg: result.error || i18n.t('app.unknownError') }));
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Load preset data when selection changes
  state.on('selectedPreset', async (preset, prev) => {
    const sk = skinName();
    if (!preset || preset === '__new__') {
      if (prev === '__new__') {
        // Re-asserted '__new__' from doSave() — keep form data, don't reset
        return;
      }
      // Switching to new-preset mode from elsewhere — reset the form
      resetNew();
      return;
    }
    if (!sk) return;

    const result = await api.loadPreset(sk, preset);
    if (result.success && result.data) {
      editData = {
        meta: result.data.meta || { name: i18n.t('preset.fallbackName', { id: preset }), description: '' },
        actions: result.data.actions || { skinIni: [], fileCopies: [], fileDeletes: [] },
        _previewPath: result.data.meta?.previewPath || null,
        _isNew: false,
      };
      state.set('presetDirty', false);
      IniEditor.init(getSkinIniActions, setSkinIniActions, async () => {
        const sn = skinName();
        if (!sn) return null;
        const r = await api.getSkinPath(sn);
        return r.success ? r.data : null;
      });
      FileCopyEditor.init(getFileCopies, setFileCopies, getFileDeletes, setFileDeletes, skinName, () => state.get('selectedPreset'), async () => {
        const sn = skinName();
        if (!sn) return null;
        const r = await api.getSkinPath(sn);
        return r.success ? r.data : null;
      });
      PreviewUpload.init(getPresetMeta, setPreviewDataUrl, skinName, () => state.get('selectedPreset'));
      render();
    }
  });

  // Reload preset from disk when re-entering edit mode
  state.on('appMode', async (mode) => {
    if (mode !== 'edit') return;
    const preset = state.get('selectedPreset');
    if (!preset || preset === '__new__') return;
    const sk = skinName();
    if (!sk) return;
    const result = await api.loadPreset(sk, preset);
    if (result.success && result.data) {
      editData = {
        meta: result.data.meta || { name: i18n.t('preset.fallbackName', { id: preset }), description: '' },
        actions: result.data.actions || { skinIni: [], fileCopies: [], fileDeletes: [] },
        _previewPath: result.data.meta?.previewPath || null,
        _isNew: false,
      };
      state.set('presetDirty', false);
      IniEditor.init(getSkinIniActions, setSkinIniActions, async () => {
        const sn = skinName();
        if (!sn) return null;
        const r = await api.getSkinPath(sn);
        return r.success ? r.data : null;
      });
      FileCopyEditor.init(getFileCopies, setFileCopies, getFileDeletes, setFileDeletes, skinName, () => state.get('selectedPreset'), async () => {
        const sn = skinName();
        if (!sn) return null;
        const r = await api.getSkinPath(sn);
        return r.success ? r.data : null;
      });
      PreviewUpload.init(getPresetMeta, setPreviewDataUrl, skinName, () => state.get('selectedPreset'));
      render();
    }
  });

  function getCurrentEditData() {
    return editData;
  }

  // Reset the form to a fresh "new preset" state (used when the user re-clicks New Preset).
  function resetNew() {
    editData = {
      meta: { name: '', description: '' },
      actions: { skinIni: [], fileCopies: [], fileDeletes: [] },
      _previewPath: null,
      _isNew: true,
    };
    state.set('presetDirty', false);
    IniEditor.init(getSkinIniActions, setSkinIniActions, async () => {
      const sn = skinName();
      if (!sn) return null;
      const r = await api.getSkinPath(sn);
      return r.success ? r.data : null;
    });
    FileCopyEditor.init(getFileCopies, setFileCopies, getFileDeletes, setFileDeletes, skinName, () => state.get('selectedPreset'), async () => {
      const sn = skinName();
      if (!sn) return null;
      const r = await api.getSkinPath(sn);
      return r.success ? r.data : null;
    });
    PreviewUpload.init(getPresetMeta, setPreviewDataUrl, skinName, () => state.get('selectedPreset'));
    render();
  }

  window.PresetEditor = { render, getCurrentEditData, doSave, doDelete, resetNew };
})();
