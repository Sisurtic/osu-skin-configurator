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
        <div class="tab tab--active" data-tab="basic" tabindex="0">基本信息</div>
        <div class="tab" data-tab="ini" tabindex="0">INI 编辑</div>
        <div class="tab" data-tab="files" tabindex="0">文件操作</div>
        <div class="tab" data-tab="preview" tabindex="0">预览图片</div>
      </div>

      <div class="tab-content tab-content--active" id="tab-basic"></div>
      <div class="tab-content" id="tab-ini"></div>
      <div class="tab-content" id="tab-files"></div>
      <div class="tab-content" id="tab-preview"></div>
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
    PreviewUpload.render(document.getElementById('tab-preview'));
  }

  function renderBasicTab() {
    const meta = editData.meta;
    const tab = document.getElementById('tab-basic');
    tab.innerHTML = `
      <div class="form-group">
        <label class="form-label">预设名称 *</label>
        <input type="text" class="form-input" id="preset-name" value="${escapeHtml(meta.name)}" placeholder="如：Instant Fade">
      </div>
      <div class="form-group">
        <label class="form-label">描述</label>
        <textarea class="form-input" id="preset-desc" placeholder="说明文本...">${escapeHtml(meta.description || '')}</textarea>
      </div>
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

    // Tab cycling: preset-name → preset-desc → preset-name
    if (!tab._tabBound) {
      tab._tabBound = true;
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const focusable = [...tab.querySelectorAll('#preset-name, #preset-desc')]
          .filter(el => el && el.offsetParent !== null);
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
  }

  async function doSave() {
    const sk = skinName();
    if (!sk) { Toast.error('请先选择皮肤'); return; }

    const name = editData.meta.name.trim();
    if (!name) { Toast.error('预设名称不能为空'); return; }

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
      // result.data is the assigned id (number)
      if (currentId !== '__new__') {
        state.set('selectedPreset', result.data);
      } else {
        // Re-assert '__new__' so listeners receive prev='__new__'
        // and know to preserve form data
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
      Toast.error('保存失败: ' + (result.error || '未知错误'));
    }
  }

  async function doDelete() {
    const sk = skinName();
    const pid = presetId();
    if (!sk || !pid || pid === '__new__') return;

    const editName = editData.meta.name || ('预设 ' + pid);
    const confirmed = await api.showConfirm(`确定要删除预设 "${editName}" 吗？此操作不可恢复。`);
    if (!confirmed.success || !confirmed.data) return;

    const result = await api.deletePreset(sk, pid);
    if (result.success) {
      Toast.success('预设已删除');
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
      Toast.error('删除失败: ' + (result.error || '未知错误'));
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
        meta: result.data.meta || { name: '预设 ' + preset, description: '' },
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
        meta: result.data.meta || { name: '预设 ' + preset, description: '' },
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
      render();
    }
  });

  function getCurrentEditData() {
    return editData;
  }

  // Reset the form to a fresh "new preset" state (used when the user re-clicks 新建预设).
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
