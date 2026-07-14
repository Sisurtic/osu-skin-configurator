// Preset editor — tab container + save/apply/delete toolbar
(function () {
  const viewEl = document.getElementById('view-editor');

  // Editor state for the currently editing target (preset OR group).
  // kind: 'preset' | 'group'. Group reuses meta.name/description + _preview*;
  // actions stay empty (group has no ini/files/tint). _groupId/_originalName
  // are group-only (rename detection).
  let editData = {
    kind: 'preset',
    meta: { name: '', description: '' },
    actions: { skinIni: [], fileCopies: [], fileDeletes: [], fileTints: [] },
    _previewPath: null,
    _previewKind: 'image',
    _previewFrames: null,
    _previewFps: 12,
    _groupId: null,
    _isTableGroup: false,
    _originalName: '',
  };
  // When true, sub-editor set* callbacks (setFileTints, etc.) are suppressed —
  // prevents stale blur/change events from old inputs marking the editor dirty
  // right after a save (the old DOM is destroyed by render, firing blur on the
  // old inputs which write to the freshly-reloaded clean editData).
  let _suppressSubEditorWrites = false;

  // Fill in default fields for a tint op loaded from config.osp (compact storage
  // omits defaults). darkenEnabled is derived (not stored).
  function normalizeTint(t) {
    return {
      source: t.source || '', color: t.color || '255,255,255,255', mode: t.mode || 'multiply',
      destination: t.destination || '',
      tintEnabled: !!t.tintEnabled,
      cropEnabled: !!t.cropEnabled,
      cropA: +t.cropA || 0, cropB: +t.cropB || 0, cropC: +t.cropC || 32768,
      cropTile: !!t.cropTile, cropTileDir: t.cropTileDir === 'up' ? 'up' : 'down',
      darkenEnabled: !!t.cropEnabled && (+t.darkenOpacity || 0) > 0,
      darkenD: +t.darkenD || 0, darkenOpacity: +t.darkenOpacity || 0,
    };
  }
  function normalizeActions(actions) {
    const a = actions || {};
    return {
      skinIni: a.skinIni || [],
      fileCopies: a.fileCopies || [],
      fileDeletes: a.fileDeletes || [],
      fileTints: (a.fileTints || []).map(normalizeTint),
    };
  }

  function getSkinIniActions() { return editData.actions.skinIni; }
  function setSkinIniActions(v) { if (_suppressSubEditorWrites) return; editData.actions.skinIni = v; state.set('presetDirty', true); }
  function getFileCopies() { return editData.actions.fileCopies; }
  function setFileCopies(v) { if (_suppressSubEditorWrites) return; editData.actions.fileCopies = v; state.set('presetDirty', true); }
  function getFileDeletes() { return editData.actions.fileDeletes || []; }
  function setFileDeletes(v) { if (_suppressSubEditorWrites) return; editData.actions.fileDeletes = v; state.set('presetDirty', true); }
  function getFileTints() { return editData.actions.fileTints || []; }
  function setFileTints(v) { if (_suppressSubEditorWrites) return; editData.actions.fileTints = v; state.set('presetDirty', true); }
  function getPreviewDataUrl() { return editData._previewPath; }
  function setPreviewDataUrl(v) { editData._previewPath = v; state.set('presetDirty', true); }
  // Full preview meta getter/setter (kind/frames/fps). preview-upload writes via this.
  // Single source: editData holds preview for both preset and group modes.
  function editingGroup() { return editData.kind === 'group'; }
  function getPreviewMeta() {
    return {
      path: editData._previewPath,
      kind: editData._previewKind || 'image',
      frames: editData._previewFrames || [],
      fps: editData._previewFps || 12,
    };
  }
  function setPreviewMeta(m) {
    editData._previewPath = m?.path ?? null;
    editData._previewKind = m?.kind || 'image';
    // Frames are only meaningful for sequences. Clear them for other kinds so a
    // stale sequence's frames don't leak through when the user switches back to
    // an image (which previously caused "saved as sequence" / leftover previews).
    editData._previewFrames = editData._previewKind === 'sequence' && Array.isArray(m?.frames) && m.frames.length ? m.frames : null;
    // FPS: -1 means "play all frames in 1 second" (like osu!'s AnimationFramerate);
    // otherwise a positive integer. 0 (and NaN/empty) falls back to the default.
    const fps = +m?.fps;
    editData._previewFps = (fps === -1 || fps > 0) ? fps : 12;
    state.set('presetDirty', true);
  }
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
  PreviewUpload.init(getPreviewMeta, setPreviewMeta, skinName, () => editData._groupId ?? state.get('selectedPreset'));
  TintEditor.init(getFileTints, setFileTints, skinName, () => state.get('selectedPreset'), async () => {
    const sn = skinName();
    if (!sn) return null;
    const r = await api.getSkinPath(sn);
    return r.success ? r.data : null;
  });

  // True when nothing is selected (no preset, no group, no multi-select) → the
  // editor shows the empty/hint state instead of a form.
  function isEmptyState() {
    return state.get('selectedPreset') == null
      && state.get('selectedGroup') == null
      && !state.get('multiSelectActive');
  }

  function renderEmpty() {
    viewEl.innerHTML = `
      <div class="tabs tabs--empty">
        <div class="tab tab--active" data-tab="basic" tabindex="0">${i18n.t('preset.tabBasic')}</div>
        <div class="tab" data-tab="ini" tabindex="0">${i18n.t('preset.tabIni')}</div>
        <div class="tab" data-tab="files" tabindex="0">${i18n.t('preset.tabFiles')}</div>
        <div class="tab" data-tab="tint" tabindex="0">${i18n.t('preset.tabTint')}</div>
        <div class="tabs__indicator" id="tabs-indicator"></div>
      </div>
      <div class="tab-content tab-content--active editor-empty">
        <p class="editor-empty__hint">${i18n.t('editor.emptyHint')}</p>
      </div>`;
    viewEl.classList.remove('editor--group-mode', 'editor--locked');
  }

  function render() {
    if (isEmptyState()) { renderEmpty(); return; }
    const editingGroup = editData.kind === 'group';
    const prevActiveTab = viewEl.querySelector('.tab--active');
    const savedTabName = prevActiveTab ? prevActiveTab.dataset.tab : 'basic';

    viewEl.innerHTML = `
      <div class="tabs">
        <div class="tab tab--active" data-tab="basic" tabindex="0">${i18n.t('preset.tabBasic')}</div>
        <div class="tab" data-tab="ini" tabindex="0">${i18n.t('preset.tabIni')}</div>
        <div class="tab" data-tab="files" tabindex="0">${i18n.t('preset.tabFiles')}</div>
        <div class="tab" data-tab="tint" tabindex="0">${i18n.t('preset.tabTint')}</div>
        <div class="tabs__indicator" id="tabs-indicator"></div>
      </div>

      <div class="tab-content tab-content--active" id="tab-basic"></div>
      <div class="tab-content" id="tab-ini"></div>
      <div class="tab-content" id="tab-files"></div>
      <div class="tab-content" id="tab-tint"></div>
    `;

    // A NON-table group has no actions — disable ini/files/tint tabs (basic only).
    // A table group (or preset) uses the full 4-tab editor.
    const isPlainGroup = editingGroup && !editData._isTableGroup;
    viewEl.classList.toggle('editor--group-mode', isPlainGroup);
    viewEl.querySelector('.tabs').classList.toggle('tabs--disabled', isPlainGroup);
    if (isPlainGroup) {
      bindTabs();
      renderBasicTab();
      requestAnimationFrame(() => moveTabIndicator(viewEl.querySelector('.tab--active')));
      return;
    }

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

    bindTabs();
    renderBasicTab();
    IniEditor.render(document.getElementById('tab-ini'));
    FileCopyEditor.render(document.getElementById('tab-files'));
    if (window.TintEditor) TintEditor.render(document.getElementById('tab-tint'));
    // Position the sliding underline under the active tab (next frame, once
    // layout is measurable).
    requestAnimationFrame(() => moveTabIndicator(viewEl.querySelector('.tab--active')));
  }

  // Move the sliding underline indicator to a tab (animated via CSS transition).
  function moveTabIndicator(tab) {
    if (!tab) return;
    const indicator = document.getElementById('tabs-indicator');
    if (!indicator) return;
    indicator.style.width = tab.offsetWidth + 'px';
    indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
  }
  // Scale-fade the active tab-content IN (after the new content is rendered).
  function playEditorEnter() {
    const content = viewEl.querySelector('.tab-content--active');
    if (!content) return;
    content.classList.remove('main-content--enter');
    void content.offsetWidth;
    content.classList.add('main-content--enter');
    content.addEventListener('animationend', () => content.classList.remove('main-content--enter'), { once: true });
  }
  function bindTabs() {
    viewEl.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        // No tab switching while a multi-select is active (editor is locked).
        if (state.get('multiSelectActive')) return;
        viewEl.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
        viewEl.querySelectorAll('.tab-content').forEach(c => c.classList.remove('tab-content--active'));
        tab.classList.add('tab--active');
        const targetId = `tab-${tab.dataset.tab}`;
        const targetEl = document.getElementById(targetId);
        targetEl.classList.add('tab-content--active');
        // Scale-fade the newly shown content in (same feel as the preset selector).
        targetEl.classList.remove('main-content--enter');
        void targetEl.offsetWidth;
        targetEl.classList.add('main-content--enter');
        targetEl.addEventListener('animationend', () => targetEl.classList.remove('main-content--enter'), { once: true });
        // Move the sliding underline to the clicked tab.
        moveTabIndicator(tab);
        // Switching to the ini/files tab makes it visible (clientWidth > 0);
        // apply column widths + re-trigger edge-fade now that the container
        // has a real size.
        if (tab.dataset.tab === 'ini' && window.IniEditor && window.IniEditor.layoutColumns) {
          window.IniEditor.layoutColumns(targetEl);
        } else if (tab.dataset.tab === 'files' && window.FileCopyEditor && window.FileCopyEditor.layoutColumns) {
          window.FileCopyEditor.layoutColumns(targetEl);
        } else if (tab.dataset.tab === 'tint' && window.TintEditor && window.TintEditor.layoutColumns) {
          window.TintEditor.layoutColumns(targetEl);
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
  }

  function renderBasicTab() {
    const meta = editData.meta;
    const isGroup = editingGroup();
    // Labels/placeholders differ between preset and group; field shape is identical.
    const nameLabel = isGroup ? i18n.t('group.nameLabel') : i18n.t('preset.nameLabel');
    const namePlaceholder = isGroup ? i18n.t('group.namePlaceholder') : i18n.t('preset.namePlaceholder');
    const descLabel = isGroup ? i18n.t('group.descLabel') : i18n.t('preset.descLabel');
    const descPlaceholder = isGroup ? i18n.t('group.descPlaceholder') : i18n.t('preset.descPlaceholder');
    const tab = document.getElementById('tab-basic');
    tab.innerHTML = `
      <div class="form-group">
        <label class="form-label" style="font-weight:600">${nameLabel}</label>
        <input type="text" class="form-input" id="preset-name" value="${escapeHtml(meta.name)}" placeholder="${namePlaceholder}" autocomplete="off" spellcheck="false">
      </div>
      <div class="form-group">
        <label class="form-label" style="font-weight:600">${descLabel}</label>
        <textarea class="form-input" id="preset-desc" placeholder="${descPlaceholder}">${escapeHtml(meta.description || '')}</textarea>
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
        // Collect preview controls in DOM order (change/edit-fps/remove). The
        // edit-fps button only exists for sequence previews, so a dynamic query
        // keeps it in the cycle only when present.
        const focusable = [...tab.querySelectorAll('#preset-name, #preset-desc, #upload-zone, #btn-change-preview, #btn-edit-fps, #btn-remove-preview')]
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

  // ── Group loading (writes into the shared editData with kind:'group') ──
  function loadGroupIntoEditor(groupId) {
    const groups = state.get('groups') || [];
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    editData = {
      kind: 'group',
      _isTableGroup: g.type === 'table',
      meta: { name: g.name || '', description: g.description || '' },
      actions: normalizeActions(g.type === 'table' ? g.actions : null),
      _previewPath: g.previewPath || null,
      _previewKind: g.previewKind || 'image',
      _previewFrames: Array.isArray(g.previewFrames) ? g.previewFrames : null,
      _previewFps: g.previewFps || 12,
      _groupId: groupId,
      _originalName: g.name || '',
    };
    state.set('presetDirty', false);
  }

  async function doSaveGroup() {
    const sk = skinName();
    if (!sk) { Toast.error(i18n.t('toast.selectSkinFirst')); return false; }
    const gid = editData._groupId;
    if (gid == null || editData.kind !== 'group') return false;
    const name = (editData.meta.name || '').trim();
    if (!name) { Toast.error(i18n.t('group.nameRequired')); return false; }
    // Rename only if the name actually changed.
    if (name !== editData._originalName) {
      const r = await api.renameGroup(sk, gid, name);
      if (!r.success) { Toast.error(i18n.t('group.saveFailed', { msg: r.error || '' })); return false; }
      editData._originalName = name;
    }
    // Description.
    const r2 = await api.setGroupDescription(sk, gid, editData.meta.description || '');
    if (!r2.success) { Toast.error(i18n.t('group.saveFailed', { msg: r2.error || '' })); return false; }
    // Preview media (path/kind/frames/fps).
    const r3 = await api.setGroupPreview(sk, gid, {
      path: editData._previewPath || '',
      kind: editData._previewKind || 'image',
      frames: editData._previewKind === 'sequence' ? (editData._previewFrames || []) : [],
      fps: editData._previewFps || 12,
    });
    if (!r3.success) { Toast.error(i18n.t('group.saveFailed', { msg: r3.error || '' })); return false; }
    // Own actions (INI/file/tint) — table groups only; plain groups have none.
    if (editData._isTableGroup) {
    const actionsToSave = {
      skinIni: [...editData.actions.skinIni],
      fileCopies: (editData.actions.fileCopies || []).map(c => ({
        source: c.source, destination: c.destination || '', exact: !!c.exact,
      })),
      fileDeletes: (editData.actions.fileDeletes || []).map(d => ({
        path: d.path, exact: !!d.exact,
      })),
      fileTints: (editData.actions.fileTints || []).map(t => {
        const o = { source: t.source, destination: t.destination || '' };
        if (t.tintEnabled) {
          o.tintEnabled = true;
          o.color = t.color || '255,255,255,255';
          o.mode = t.mode || 'multiply';
        }
        if (t.cropEnabled) {
          o.cropEnabled = true;
          o.cropA = +t.cropA || 0;
          o.cropB = +t.cropB || 0;
          o.cropC = +t.cropC || 32768;
          o.cropTile = !!t.cropTile;
          o.cropTileDir = t.cropTileDir === 'up' ? 'up' : 'down';
          o.darkenD = +t.darkenD || 0;
          o.darkenOpacity = +t.darkenOpacity || 0;
        }
        return o;
      }),
    };
    const r4 = await api.setGroupActions(sk, gid, actionsToSave);
    if (!r4.success) { Toast.error(i18n.t('group.saveFailed', { msg: r4.error || '' })); return false; }
    } // end if (editData._isTableGroup)
    Toast.success(i18n.t('group.saved'));
    state.set('presetDirty', false);
    // Refresh groups in state so the tree + use mode reflect the new name/desc/preview.
    if (window.PresetList && typeof window.PresetList.refreshSkinData === 'function') {
      await window.PresetList.refreshSkinData(sk);
    }
    // Drop cached previews (preview media may have changed) — mirrors the
    // preset-save path.
    if (window.PresetSelector && typeof window.PresetSelector.invalidateCache === 'function') {
      window.PresetSelector.invalidateCache();
    }
    // Reload the group into the editor so editData reflects the freshly-saved
    // state (same pattern as preset save setting selectedPreset). set() always
    // fires listeners, so re-setting the same id re-triggers loadGroupIntoEditor.
    state.set('selectedGroup', gid);
    return true;
  }


  async function doSave() {
    const sk = skinName();
    if (!sk) { Toast.error(i18n.t('toast.selectSkinFirst')); return false; }
    // Unified entry: dispatch to the group save path when a group is loaded.
    if (editData.kind === 'group') return doSaveGroup();

    const name = editData.meta.name.trim();
    if (!name) { Toast.error(i18n.t('preset.nameRequired')); return false; }

    const currentId = presetId();
    const idToSend = (currentId === '__new__') ? null : currentId;

    // Build save data
    const meta = { ...editData.meta, previewPath: editData._previewPath || '' };
    // Persist preview kind/frames/fps only when meaningful (sequence/video).
    // For image kind, EXPLICITLY remove any stale sequence fields carried over
    // from the loaded meta spread above.
    if (editData._previewKind && editData._previewKind !== 'image') {
      meta.previewKind = editData._previewKind;
    } else {
      delete meta.previewKind;
      delete meta.previewFrames;
      delete meta.previewFps;
    }
    if (editData._previewKind === 'sequence' && Array.isArray(editData._previewFrames) && editData._previewFrames.length) {
      meta.previewFrames = editData._previewFrames;
      meta.previewFps = editData._previewFps || 12;
    }
    const dataToSave = {
      meta,
      actions: {
        skinIni: [...editData.actions.skinIni],
        fileCopies: (editData.actions.fileCopies || []).map(c => ({
          source: c.source, destination: c.destination || '', exact: !!c.exact,
        })),
        fileDeletes: (editData.actions.fileDeletes || []).map(d => ({
          path: d.path, exact: !!d.exact,
        })),
        fileTints: (editData.actions.fileTints || []).map(t => {
          // Persist the FULL param set of each ENABLED stage (including default
          // values); a disabled stage's params are dropped entirely. darkenEnabled
          // is never stored (derived on apply).
          const o = { source: t.source, destination: t.destination || '' };
          if (t.tintEnabled) {
            o.tintEnabled = true;
            o.color = t.color || '255,255,255,255';
            o.mode = t.mode || 'multiply';
          }
          if (t.cropEnabled) {
            o.cropEnabled = true;
            o.cropA = +t.cropA || 0;
            o.cropB = +t.cropB || 0;
            o.cropC = +t.cropC || 32768;
            o.cropTile = !!t.cropTile;
            o.cropTileDir = t.cropTileDir === 'up' ? 'up' : 'down';
            o.darkenD = +t.darkenD || 0;
            o.darkenOpacity = +t.darkenOpacity || 0;
          }
          return o;
        }),
      },
    };

    let result;
    try {
      // Close any open color picker popover before saving (it's on document.body,
      // survives the render rebuild, and would stay open over stale DOM).
      document.querySelectorAll('.cp-popover').forEach(el => el.remove());
      result = await api.savePreset(sk, idToSend, dataToSave);
    } catch (err) {
      // IPC-level failure (command not registered, arg serialization, backend
      // panic). Without this catch the rejected promise surfaces as "no reaction,
      // no toast", which is impossible to debug.
      Toast.error(i18n.t('preset.saveFailed', { msg: (err && (err.message || String(err))) || i18n.t('app.unknownError') }));
      return false;
    }
    if (result && result.success) {
      state.set('presetDirty', false);
      // Suppress sub-editor writes during the post-save re-render: the old
      // input DOM is destroyed by render(), firing blur/change events that
      // would write stale values into the freshly-reloaded editData and
      // re-mark it dirty. Restore after the render settles.
      _suppressSubEditorWrites = true;
      if (currentId === '__new__') {
        // New preset saved: move it into the requested parent (if any), then
        // SELECT it — subsequent Ctrl+S edits this preset instead of creating
        // more. (Previously it stayed '__new__' for continuous creation.)
        if (_newPresetTargetParent !== undefined) {
          const sk0 = skinName();
          if (sk0) await api.movePresetGroup(sk0, result.data, _newPresetTargetParent);
          _newPresetTargetParent = undefined;
        }
      }
      state.set('selectedPreset', result.data);
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
          rootChildren: scanResult.data.rootChildren || [],
        });
      }
      // Re-enable sub-editor writes after the render + re-scan settle.
      requestAnimationFrame(() => { _suppressSubEditorWrites = false; });
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
          rootChildren: scanResult.data.rootChildren || [],
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
  // Selecting a group switches the editor to the group basic-info panel.
  // When deselected (back to a preset), the selectedPreset listener re-renders.
  state.on('selectedGroup', async (groupId) => {
    if (groupId == null) return;
    loadGroupIntoEditor(groupId);
    // Re-init sub-editors so their getter closures capture the freshly-rebuilt
    // editData, and the id closure keys on the group id (cache isolation from
    // any same-id preset).
    const idFn = () => editData._groupId ?? state.get('selectedPreset');
    const pathFn = async () => {
      const sn = skinName();
      if (!sn) return null;
      const r = await api.getSkinPath(sn);
      return r.success ? r.data : null;
    };
    IniEditor.init(getSkinIniActions, setSkinIniActions, pathFn);
    FileCopyEditor.init(getFileCopies, setFileCopies, getFileDeletes, setFileDeletes, skinName, idFn, pathFn);
    PreviewUpload.init(getPreviewMeta, setPreviewMeta, skinName, idFn);
    TintEditor.init(getFileTints, setFileTints, skinName, idFn, pathFn);
    render();
    playEditorEnter();
  });

  state.on('selectedPreset', async (preset, prev) => {
    const sk = skinName();
    if (preset == null) {
      // Only show the empty/hint state when truly nothing is selected. During
      // multi-select selectedPreset is nulled too, but the editor should stay
      // locked (editor--locked) — not flip to the hint.
      if (isEmptyState()) {
        renderEmpty();
        playEditorEnter();
      }
      return;
    }
    if (preset === '__new__') {
      if (prev === '__new__') {
        // Re-asserted '__new__' from doSave() — keep form data, don't reset
        return;
      }
      // User explicitly chose "New Preset" — reset the form
      resetNew();
      playEditorEnter();
      return;
    }
    if (!sk) return;

    const result = await api.loadPreset(sk, preset);
    if (result.success && result.data) {
      editData = {
        kind: 'preset',
        meta: result.data.meta || { name: i18n.t('preset.fallbackName', { id: preset }), description: '' },
        actions: normalizeActions(result.data.actions),
        _previewPath: result.data.meta?.previewPath || null,
        _previewKind: result.data.meta?.previewKind || 'image',
        _previewFrames: result.data.meta?.previewFrames || null,
        _previewFps: result.data.meta?.previewFps || 12,
        _groupId: null,
    _isTableGroup: false,
        _originalName: '',
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
      PreviewUpload.init(getPreviewMeta, setPreviewMeta, skinName, () => editData._groupId ?? state.get('selectedPreset'));
      TintEditor.init(getFileTints, setFileTints, skinName, () => state.get('selectedPreset'), async () => {
        const sn = skinName();
        if (!sn) return null;
        const r = await api.getSkinPath(sn);
        return r.success ? r.data : null;
      });
      render();
      playEditorEnter();
    }
  });
  state.on('appMode', async (mode) => {
    if (mode !== 'edit') return;
    const preset = state.get('selectedPreset');
    if (!preset || preset === '__new__') return;
    const sk = skinName();
    if (!sk) return;
    const result = await api.loadPreset(sk, preset);
    if (result.success && result.data) {
      editData = {
        kind: 'preset',
        meta: result.data.meta || { name: i18n.t('preset.fallbackName', { id: preset }), description: '' },
        actions: normalizeActions(result.data.actions),
        _previewPath: result.data.meta?.previewPath || null,
        _previewKind: result.data.meta?.previewKind || 'image',
        _previewFrames: result.data.meta?.previewFrames || null,
        _previewFps: result.data.meta?.previewFps || 12,
        _groupId: null,
    _isTableGroup: false,
        _originalName: '',
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
      PreviewUpload.init(getPreviewMeta, setPreviewMeta, skinName, () => editData._groupId ?? state.get('selectedPreset'));
      TintEditor.init(getFileTints, setFileTints, skinName, () => state.get('selectedPreset'), async () => {
        const sn = skinName();
        if (!sn) return null;
        const r = await api.getSkinPath(sn);
        return r.success ? r.data : null;
      });
      render();
    }
  });

  // Multi-select (groups or presets, >1) locks the editor: tabs disabled + the
  // body is non-interactive so nothing can be edited mid-selection.
  state.on('multiSelectActive', (active) => {
    const tabs = viewEl.querySelector('.tabs');
    if (tabs) tabs.classList.toggle('tabs--disabled', !!active);
    viewEl.classList.toggle('editor--locked', !!active);
  });

  function getCurrentEditData() {
    return editData;
  }

  // ── Actions copy/paste (Ctrl+C / Ctrl+V in edit mode) ──
  // In-memory clipboard of a normalized actions object. Copied from the
  // currently-editing item (preset or checkbox-group); pasted into another.
  let _actionsClipboard = null;
  // When set, a newly-created preset (__new__ → save) is moved into this parent
  // group id (null = root) right after save. Set by the "New Preset" action
  // when a group is selected, so the new preset becomes a SIBLING of it.
  let _newPresetTargetParent = undefined;

  // Returns true when actions were actually copied (rows selected), false
  // otherwise (no selection / plain group / basic tab). Callers use the return
  // value to decide whether to preventDefault the keypress — when nothing is
  // copied we leave the browser default untouched.
  function copyActions() {
    if (isEmptyState()) return false;
    // Plain (non-table) groups have no actions; nothing to copy.
    if (editData.kind === 'group' && !editData._isTableGroup) return false;
    // Tab-scoped: copy only the selected rows of the ACTIVE tab's editor.
    const activeTab = viewEl.querySelector('.tab--active')?.dataset.tab;
    const cb = { skinIni: [], fileCopies: [], fileDeletes: [], fileTints: [] };
    if (activeTab === 'ini' && window.IniEditor && window.IniEditor.getSelectedActions) {
      cb.skinIni = window.IniEditor.getSelectedActions();
    } else if (activeTab === 'files' && window.FileCopyEditor && window.FileCopyEditor.getSelectedActions) {
      const r = window.FileCopyEditor.getSelectedActions();
      cb.fileCopies = r.fileCopies || [];
      cb.fileDeletes = r.fileDeletes || [];
    } else if (activeTab === 'tint' && window.TintEditor && window.TintEditor.getSelectedActions) {
      cb.fileTints = window.TintEditor.getSelectedActions();
    } else {
      return false;
    }
    const total = cb.skinIni.length + cb.fileCopies.length + cb.fileDeletes.length + cb.fileTints.length;
    // Only copy when rows are actually selected — otherwise leave the clipboard
    // untouched and let the caller skip preventDefault.
    if (total === 0) return false;
    // Clear the old clipboard then commit a fresh deep clone (no residue).
    _actionsClipboard = null;
    _actionsClipboard = JSON.parse(JSON.stringify(cb));
    Toast.success(i18n.t('preset.actionsCopied', { count: total }));
    return true;
  }

  // Dedup keys per category (mirror backend apply_group INI dedup).
  const _iniKey = (e) => `${e.section || ''}◆${e.maniaKeys == null ? '' : e.maniaKeys}◆${e.key || ''}`;
  const _copyKey = (e) => e.source || '';
  const _deleteKey = (e) => e.path || '';
  const _tintKey = (e) => e.source || '';

  async function pasteActions() {
    if (isEmptyState()) return;
    // Plain groups can't receive actions.
    if (editData.kind === 'group' && !editData._isTableGroup) {
      Toast.warning(i18n.t('preset.cannotPasteHere'));
      return;
    }
    if (!_actionsClipboard) {
      Toast.warning(i18n.t('preset.noActionsClipboard'));
      return;
    }
    const cb = JSON.parse(JSON.stringify(_actionsClipboard));
    // Normalize clipboard tints so keys/fields are well-formed.
    cb.skinIni = cb.skinIni || [];
    cb.fileCopies = cb.fileCopies || [];
    cb.fileDeletes = cb.fileDeletes || [];
    cb.fileTints = (cb.fileTints || []).map(normalizeTint);

    // For each category, split clipboard entries into conflicting vs not.
    // Non-conflicting entries always append; conflicting entries follow the
    // user's per-category choice (Skip / Overwrite[/ Append]).
    const categories = [
      { name: 'skinIni',   key: _iniKey,    label: i18n.t('paste.catIni'),    allowAppend: false },
      { name: 'fileCopies', key: _copyKey,  label: i18n.t('paste.catCopy'),   allowAppend: true },
      { name: 'fileDeletes', key: _deleteKey, label: i18n.t('paste.catDelete'), allowAppend: true },
      { name: 'fileTints', key: _tintKey,   label: i18n.t('paste.catTint'),   allowAppend: true },
    ];

    const result = { skinIni: [...editData.actions.skinIni], fileCopies: [...editData.actions.fileCopies], fileDeletes: [...editData.actions.fileDeletes], fileTints: [...editData.actions.fileTints] };
    let added = 0;

    for (const cat of categories) {
      const target = result[cat.name];
      const targetKeys = new Set(target.map(cat.key));
      const cbEntries = cb[cat.name] || [];
      const fresh = cbEntries.filter(e => !targetKeys.has(cat.key(e)));
      const conflicts = cbEntries.filter(e => targetKeys.has(cat.key(e)));

      // Always append non-conflicting entries.
      for (const e of fresh) { target.push(e); added++; }

      if (conflicts.length === 0) continue;

      // Conflict: ask the user how to resolve this category.
      // Button order (right-aligned by .modal__actions): append - overwrite - skip.
      // Skip = red (danger), append = yellow (warning), overwrite = primary.
      const opts = [];
      if (cat.allowAppend) {
        opts.push({ label: i18n.t('paste.append'), cls: 'btn--warning', value: 'append' });
      }
      opts.push({ label: i18n.t('paste.overwrite'), cls: 'btn--primary', value: 'overwrite' });
      opts.push({ label: i18n.t('paste.skip'), cls: 'btn--danger', value: 'skip' });
      const choice = await ApplyDialog.showConfirmDialog(
        i18n.t('paste.conflictTitle', { category: cat.label, count: conflicts.length }),
        opts
      );
      if (choice === 'overwrite') {
        // Replace target entries whose key matches a clipboard entry, then add
        // the clipboard's version. Preserve target order for surviving entries.
        const cbByKey = new Map(conflicts.map(e => [cat.key(e), e]));
        for (let i = 0; i < target.length; i++) {
          const k = cat.key(target[i]);
          if (cbByKey.has(k)) target[i] = cbByKey.get(k);
        }
        added += conflicts.length;
      } else if (choice === 'append') {
        for (const e of conflicts) { target.push(e); added++; }
      }
      // 'skip' or dialog dismissed → drop conflicting clipboard entries.
    }

    setSkinIniActions(result.skinIni);
    setFileCopies(result.fileCopies);
    setFileDeletes(result.fileDeletes);
    setFileTints(result.fileTints);
    state.set('presetDirty', true);
    render();
    Toast.success(i18n.t('preset.actionsPasted', { count: added }));
  }

  // Reset the form to a fresh "new preset" state (used when the user re-clicks New Preset).
  function resetNew() {
    editData = {
      kind: 'preset',
      meta: { name: '', description: '' },
      actions: { skinIni: [], fileCopies: [], fileDeletes: [], fileTints: [] },
      _previewPath: null,
      _previewKind: 'image',
      _previewFrames: null,
      _previewFps: 12,
      _groupId: null,
    _isTableGroup: false,
      _originalName: '',
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
    PreviewUpload.init(getPreviewMeta, setPreviewMeta, skinName, () => editData._groupId ?? state.get('selectedPreset'));
    TintEditor.init(getFileTints, setFileTints, skinName, () => state.get('selectedPreset'), async () => {
      const sn = skinName();
      if (!sn) return null;
      const r = await api.getSkinPath(sn);
      return r.success ? r.data : null;
    });
    render();
    // Auto-focus the name input when creating a new preset.
    requestAnimationFrame(() => {
      const nameInput = document.getElementById('preset-name');
      if (nameInput) nameInput.focus();
    });
  }

  window.PresetEditor = { render, getCurrentEditData, doSave, doSaveGroup, doDelete, resetNew, moveTabIndicator, copyActions, pasteActions, set newPresetTargetParent(v) { _newPresetTargetParent = v; } };
})();
