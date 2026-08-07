// Preset editor — tab container + save/apply/delete toolbar
(function () {
  const viewEl = document.getElementById('view-editor');

  // Mark presetDirty on the FIRST actual edit (input/change) of any field —
  // not on focus. Event delegation covers all current + future sub-editor
  // inputs. Checkboxes/toggles are excluded (their own change handlers mark
  // dirty via the set* callbacks).
  viewEl.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('input:not([type="checkbox"]):not([disabled]), textarea:not([disabled])')) return;
    if (state.get('multiSelectActive')) return;
    if (!state.get('presetDirty')) state.set('presetDirty', true);
  });

  // Editor state for the currently editing target (preset OR group).
  // kind: 'preset' | 'group'. Group reuses meta.name/description + _preview*;
  // actions stay empty (group has no ini/files/tint). _groupId/_originalName
  // are group-only (rename detection).
  let editData = {
    kind: 'preset',
    meta: { name: '', description: '' },
    actions: { skinIni: [], fileCopies: [], fileDeletes: [], fileTints: [], fileLayers: [] },
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
  // Activation-binding selection state (module-level so app.js's layered Esc can
  // query/clear it). Refreshed each time renderActivationSlot runs.
  let _bindingSelectedTargets = null;
  let _bindingRenderList = null;
  window.ActivationBinding = {
    hasSelection: () => !!(_bindingSelectedTargets && _bindingSelectedTargets.size),
    clearSelection: () => { if (_bindingSelectedTargets) { _bindingSelectedTargets.clear(); if (_bindingRenderList) _bindingRenderList(); } },
  };

  // Fill in default fields for a tint op loaded from config.osp (compact storage
  // omits defaults). darkenEnabled is derived (not stored).
  function normalizeTint(t) {
    return {
      source: t.source || '', color: t.color || '255,255,255,255', mode: (t.mode === 'lightness' ? 'hue' : (t.mode || 'replace')),
      destination: t.destination || '',
      tintEnabled: !!t.tintEnabled,
      cropEnabled: !!t.cropEnabled,
      cropA: +t.cropA || 0, cropB: +t.cropB || 0, cropC: +t.cropC || 32768, cropD: +t.cropD || 0,
      cropTile: !!t.cropTile, cropTileDir: t.cropTileDir === 'up' ? 'up' : 'down',
      darkenEnabled: !!t.cropEnabled && (+t.darkenOpacity || 0) > 0,
      darkenD: +t.darkenD || 0, darkenOpacity: +t.darkenOpacity || 0,
      hueShift: +t.hueShift || 0, satShift: +t.satShift || 0, lightShift: +t.lightShift || 0,
    };
  }
  // Fill in default fields for a layer-stack op loaded from config.osp.
  // canvasMode: 'bottom' = use the bottom layer's size; 'max' = max width and
  // max height across all layers (each axis independently). Each layer keeps
  // only offset positioning (9-grid is a UI shortcut that writes offset).
  function normalizeLayerStack(s) {
    const layers = Array.isArray(s && s.layers) ? s.layers : [];
    return {
      destination: s.destination || '',
      canvasMode: s.canvasMode === 'max' ? 'max' : 'bottom',
      layers: layers.map(l => ({
        source: l.source || '',
        exact: !!l.exact,
        blendMode: l.blendMode || 'normal',
        opacity: +l.opacity || 100,
        offsetX: +l.offsetX || 0,
        offsetY: +l.offsetY || 0,
        // Per-layer tint (Stage-1). Mirrors normalizeTint's tint fields; crop/
        // darken are NOT part of layers.
        tintEnabled: !!l.tintEnabled,
        color: l.color || '255,255,255,255',
        mode: l.mode || 'normal',
        hueShift: +l.hueShift || 0,
        satShift: +l.satShift || 0,
        lightShift: +l.lightShift || 0,
      })),
    };
  }
  // Serialize a layer-stack op for save: keep destination/canvasMode/layers,
  // drop default-valued layer fields (offset 0) and any _-prefixed runtime keys.
  function serializeLayerStack(s) {
    const out = { destination: s.destination || '' };
    if (s.canvasMode === 'max') out.canvasMode = 'max'; // 'bottom' is the default → omit
    out.layers = (s.layers || []).map(l => {
      const lo = { source: l.source || '', blendMode: l.blendMode || 'normal', opacity: +l.opacity || 100 };
      if (l.exact) lo.exact = true;
      const ox = +l.offsetX || 0, oy = +l.offsetY || 0;
      if (ox) lo.offsetX = ox;
      if (oy) lo.offsetY = oy;
      // Per-layer tint: persist only when enabled (omit-defaults). Within tint,
      // hue-shift persists its 3 offsets; solid modes persist only the color.
      if (l.tintEnabled) {
        lo.tintEnabled = true;
        lo.mode = l.mode || 'normal';
        if (lo.mode === 'hue-shift') {
          lo.color = l.color || '255,255,255,255';
          lo.hueShift = +l.hueShift || 0;
          lo.satShift = +l.satShift || 0;
          lo.lightShift = +l.lightShift || 0;
        } else {
          lo.color = l.color || '255,255,255,255';
        }
      }
      return lo;
    });
    return out;
  }
  function normalizeActions(actions) {
    const a = actions || {};
    return {
      skinIni: a.skinIni || [],
      fileCopies: a.fileCopies || [],
      fileDeletes: a.fileDeletes || [],
      fileTints: (a.fileTints || []).map(normalizeTint),
      fileLayers: (a.fileLayers || []).map(normalizeLayerStack),
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
  function getFileLayers() { return editData.actions.fileLayers || []; }
  function setFileLayers(v) { if (_suppressSubEditorWrites) return; editData.actions.fileLayers = v; state.set('presetDirty', true); }
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
  if (window.LayerEditor) LayerEditor.init(getFileLayers, setFileLayers, skinName, () => state.get('selectedPreset'), async () => {
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
        <div class="tab" data-tab="layer" tabindex="0">${i18n.t('preset.tabLayer')}</div>
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
        <div class="tab" data-tab="layer" tabindex="0">${i18n.t('preset.tabLayer')}</div>
        <div class="tabs__indicator" id="tabs-indicator"></div>
      </div>

      <div class="tab-content tab-content--active" id="tab-basic"></div>
      <div class="tab-content" id="tab-ini"></div>
      <div class="tab-content" id="tab-files"></div>
      <div class="tab-content" id="tab-tint"></div>
      <div class="tab-content" id="tab-layer"></div>
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
    if (window.LayerEditor) LayerEditor.render(document.getElementById('tab-layer'));
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
    const tabsEl = viewEl.querySelector('.tabs');
    const tabs = () => Array.from(viewEl.querySelectorAll('.tab'));

    // Core: activate one tab. Shared by click, wheel, and keyboard.
    function activateTab(tab) {
      if (!tab) return;
      if (state.get('multiSelectActive')) return;
      // Plain groups can only use the basic tab.
      if (tabsEl.classList.contains('tabs--disabled') && tab.dataset.tab !== 'basic') return;
      // Switching tabs invalidates any open color picker (it belongs to the
      // previous tab's editor).
      if (window.ColorPicker) window.ColorPicker.closeAll();
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
      // Move the sliding underline to the activated tab.
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
      } else if (tab.dataset.tab === 'layer' && window.LayerEditor && window.LayerEditor.layoutColumns) {
        window.LayerEditor.layoutColumns(targetEl);
      }
      // Re-trigger scroll event on next frame so edge-fade overlays
      // re-calculate position (getBoundingClientRect needs visible layout).
      requestAnimationFrame(() => {
        const scroll = targetEl.querySelector('.ini-table-body-scroll, .files-table-body-scroll');
        if (scroll) scroll.dispatchEvent(new Event('scroll'));
      });
    }

    tabs().forEach(tab => {
      tab.addEventListener('click', () => activateTab(tab));

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

    // Shift + wheel over the tab bar cycles tabs (plain wheel scrolls the page).
    // Skips disabled (plain-group) and empty states where tab cycling is
    // meaningless. Only while the bar is interactive.
    if (tabsEl) {
      tabsEl.addEventListener('wheel', (e) => {
        if (!e.shiftKey) return;             // plain wheel → native scroll
        if (tabsEl.classList.contains('tabs--empty')) return;
        const list = tabs().filter(t => !t.classList.contains('tab--disabled') || t.classList.contains('tab--active'));
        if (list.length < 2) return;
        const curIdx = list.findIndex(t => t.classList.contains('tab--active'));
        const dir = e.deltaY > 0 ? 1 : -1;
        const nextIdx = curIdx + dir;
        if (nextIdx < 0 || nextIdx >= list.length) return; // edge: stop, don't wrap
        e.preventDefault();
        activateTab(list[nextIdx]);
      }, { passive: false });
    }
  }

  function renderBasicTab() {
    const meta = editData.meta;
    const isGroup = editingGroup();
    // Labels/placeholders differ between preset and group; field shape is identical.
    const nameLabel = isGroup ? i18n.t('group.nameLabel') : i18n.t('preset.nameLabel');
    const namePlaceholder = isGroup ? i18n.t('group.namePlaceholder') : i18n.t('preset.namePlaceholder');
    const descLabel = isGroup ? i18n.t('group.descLabel') : i18n.t('preset.descLabel');
    const descPlaceholder = isGroup ? i18n.t('group.descPlaceholder') : i18n.t('preset.descPlaceholder');
    // Show the preset/group id next to the name label for debugging.
    const itemId = isGroup ? editData._groupId : state.get('selectedPreset');
    const idTag = (itemId != null && itemId !== '__new__') ? ` <span style="font-weight:400;color:var(--text-muted);font-size:11px">[#${itemId}]</span>` : '';
    const tab = document.getElementById('tab-basic');
    tab.innerHTML = `
      <div class="form-group">
        <label class="form-label" style="font-weight:600">${nameLabel}${idTag}</label>
        <input type="text" class="form-input" id="preset-name" value="${escapeHtml(meta.name)}" placeholder="${namePlaceholder}" autocomplete="off" spellcheck="false">
      </div>
      <div class="form-group">
        <label class="form-label" style="font-weight:600">${descLabel}</label>
        <textarea class="form-input" id="preset-desc" placeholder="${descPlaceholder}">${escapeHtml(meta.description || '')}</textarea>
      </div>
      <div id="preview-slot"></div>
      ${findOptionContext() ? '<div id="activation-slot"></div>' : ''}
    `;

    // Name/desc: write to editData on change (Enter/blur). Dirty is marked on
    // the first input via the viewEl 'input' delegate above.
    ['name', 'desc'].forEach(field => {
      const el = document.getElementById(`preset-${field}`);
      if (!el) return;
      el.addEventListener('change', () => {
        if (field === 'desc') editData.meta.description = el.value;
        else editData.meta[field] = el.value;
      });
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
    const optCtx = findOptionContext();
    if (optCtx) {
      try { renderActivationSlot(document.getElementById('activation-slot'), optCtx); } catch (_) { /* ignore */ }
    }
  }

  // ── Row-activation binding UI (per option: preset or sub-table-group) ──
  // The currently-edited option is the SOURCE. Dragging another option into the
  // drop zone binds it as a TARGET ("when source is selected, force target").
  // Storage: state.tableActivations[srcGid][srcOptionKey] = [{dstRowKey, dstOption}].
  // Source is keyed by option id only (a preset appears in exactly one table
  // group). See docs/row-activation-design.md.

  // Resolve the currently-edited option's activation context, or null if it's
  // not an activatable option. The scope is always the OUTERMOST table group
  // (the one expanded in use mode) that contains this option — bindings live
  // entirely within one outermost table group. A top-level table group itself,
  // a plain group, or an orphan preset returns null (no binding UI).
  // Returns { srcGid, srcOptionKey, rows } where rows = the outermost table
  // group's FULL subtree (all nested table groups force-expanded) so the user
  // can target any option even if its sub-group isn't currently expanded.
  function findOptionContext() {
    const groups = state.get('groups') || [];
    // A table group is a "scope" (not itself an activatable option) when no
    // OTHER table group contains it as a row option. A table group nested inside
    // another table's row IS an option. This holds whether the table sits at the
    // root or inside a plain group — only the table-group ancestry matters.
    const isScopeTable = (gid) => {
      for (const g of groups) {
        if (g.type !== 'table' || g.id === gid) continue;
        const rows = window.PresetSelector.collectAllRowsFor(g.id);
        if (rows.some(r => r.options.some(o => o.kind === 'group' && o.id === gid))) return false;
      }
      return true;
    };
    // The scope that owns an option = the nearest ancestor table group whose
    // subtree contains it. Try every table group as a candidate scope.
    const allTables = groups.filter(g => g.type === 'table');

    if (editData.kind === 'preset') {
      const pid = state.get('selectedPreset');
      if (pid == null || pid === '__new__') return null;
      for (const g of allTables) {
        const rows = window.PresetSelector.collectAllRowsFor(g.id);
        if (rows.some(r => r.options.some(o => o.kind === 'preset' && o.id === pid))) {
          return { srcGid: g.id, srcOptionKey: pid, rows };
        }
      }
      return null;
    }
    if (editData.kind === 'group' && editData._isTableGroup) {
      const gid = editData._groupId;
      if (isScopeTable(gid)) return null; // a scope itself, not an option
      for (const g of allTables) {
        if (g.id === gid) continue;
        const rows = window.PresetSelector.collectAllRowsFor(g.id);
        if (rows.some(r => r.options.some(o => o.kind === 'group' && o.id === gid))) {
          return { srcGid: g.id, srcOptionKey: 'group:' + gid, rows };
        }
      }
      return null;
    }
    return null;
  }

  // Is option `optKey` a descendant of group `rootGid` (or rootGid itself if
  // optKey is a group)? Used to allow a source's own descendants as targets.
  function isDescendantOf(groups, rootGid, optKey) {
    const isGroup = typeof optKey === 'string' && optKey.startsWith('group:');
    const oid = isGroup ? Number(optKey.slice(6)) : Number(optKey);
    if (isGroup && oid === rootGid) return true;
    const walk = (gid, seen) => {
      if (seen.has(gid)) return false;
      seen.add(gid);
      const g = groups.find(x => x.id === gid);
      if (!g) return false;
      for (const c of (g.children || [])) {
        if (c.type === 'preset' && !isGroup && c.id === oid) return true;
        if (c.type === 'group') {
          if (isGroup && c.id === oid) return true;
          const sub = groups.find(x => x.id === c.id);
          if (sub) {
            if (walk(c.id, seen)) return true;
          }
        }
      }
      return false;
    };
    return walk(rootGid, new Set());
  }

  // Which top-level ROW of the outermost table group (srcGid) contains option
  // `optKey`? A "top-level row" is either a plain sub-group of the table (its
  // id) or '__direct__' (options directly in the table's children). We first
  // find the option's nearest ancestor that is a DIRECT child option of the
  // table group (the "top option", e.g. A or B), then return which row that
  // top option sits in. Returns null if not found.
  function topRowOf(groups, srcGid, optKey) {
    const tg = groups.find(g => g.id === srcGid);
    if (!tg) return null;
    const isGroup = typeof optKey === 'string' && optKey.startsWith('group:');
    const oid = isGroup ? Number(optKey.slice(6)) : Number(optKey);

    // Is optKey itself a direct child option of the table group (in __direct__
    // or in one of its plain sub-groups = rows)? If so, return that row.
    const rowOfDirectChild = (children, directOnly) => {
      for (const c of (children || [])) {
        const match = (c.type === 'preset' && !isGroup && c.id === oid)
          || (c.type === 'group' && isGroup && c.id === oid);
        if (match) return directOnly;
      }
      return null;
    };
    // __direct__ row
    let r = rowOfDirectChild(tg.children, '__direct__');
    if (r) return r;
    // plain sub-group rows
    for (const c of (tg.children || [])) {
      if (c.type !== 'group') continue;
      const pg = groups.find(g => g.id === c.id);
      if (pg && pg.type !== 'table') {
        r = rowOfDirectChild(pg.children, c.id);
        if (r) return r;
      }
    }

    // optKey is deeper (inside a sub-table-group). Find its nearest ancestor
    // that IS a direct child option of the table group, then return that
    // ancestor's row.
    const byId = new Map(groups.map(g => [g.id, g]));
    // parentOf[gid] = the group that has gid as a child option, or null.
    function parentOf(gid) {
      for (const g of groups) {
        for (const c of (g.children || [])) {
          if (c.type === 'group' && c.id === gid) return g.id;
        }
      }
      return null;
    }
    // Walk up from optKey's owning group until we reach a group whose parent is srcGid.
    let cur = parentOf(isGroup ? oid : oid); // gid of group containing the option
    // For a preset option, find the group containing that preset.
    if (!isGroup) {
      for (const g of groups) {
        if ((g.children || []).some(c => c.type === 'preset' && c.id === oid)) { cur = g.id; break; }
      }
    }
    const seen = new Set();
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      // Is `cur` a direct child of the table group?
      if ((tg.children || []).some(c => c.type === 'group' && c.id === cur)) {
        // cur is a top option; find which row it's in.
        if ((tg.children || []).some(c => c.type === 'group' && c.id === cur)) return '__direct__';
      }
      // Is `cur` inside a plain sub-group row of the table?
      for (const c of (tg.children || [])) {
        if (c.type !== 'group') continue;
        const pg = byId.get(c.id);
        if (pg && pg.type !== 'table' && (pg.children || []).some(sc => sc.type === 'group' && sc.id === cur)) {
          return c.id; // c is the row containing cur
        }
      }
      cur = parentOf(cur);
    }
    return null;
  }

  // Allowed target ⇔ source and target are in DIFFERENT top-level rows, OR the
  // target is the source's own descendant. Same row + not a descendant is
  // forbidden (siblings, ancestors, the whole subtree of every top option in
  // that row).
  function isAllowedTarget(groups, srcGid, srcOptionKey, dstOption) {
    if (String(srcOptionKey) === String(dstOption)) return false; // never self
    const srcRow = topRowOf(groups, srcGid, srcOptionKey);
    const dstRow = topRowOf(groups, srcGid, dstOption);
    if (srcRow == null || dstRow == null) return false; // unknown → forbid
    if (srcRow !== dstRow) return true;                 // different top row → allow
    // Same row: allowed only if dst is a descendant of the source.
    const isSrcGroup = typeof srcOptionKey === 'string' && srcOptionKey.startsWith('group:');
    if (isSrcGroup) {
      const srcGid2 = Number(srcOptionKey.slice(6));
      if (isDescendantOf(groups, srcGid2, dstOption)) return true;
    }
    return false;
  }

  function renderActivationSlot(slotEl, ctx) {
    if (!slotEl) return;
    const { srcGid, srcOptionKey, rows } = ctx;
    const groups = state.get('groups') || [];
    const presets = state.get('presets') || [];
    const presetMap = new Map(presets.map(p => [p.id, p]));

    // Full ancestry path label for a target: walks the dstRowKey's gid segments
    // (each is a sub-table-group on the path down) and joins each level's row
    // label, then the option name. Uses a fresh row snapshot (post-move safe).
    const fullPathLabel = (rowKey, optKey) => {
      const liveRows = (window.PresetSelector && window.PresetSelector.collectAllRowsFor)
        ? window.PresetSelector.collectAllRowsFor(srcGid) : rows;
      const rowByKey = new Map(liveRows.map(r => [r.rowKey, r]));
      const parts = [];
      const segs = rowKey.split(':');
      // First segment is the outermost table group — use its name.
      const topG = groups.find(g => g.id === srcGid);
      if (topG && topG.name) parts.push(topG.name);
      // acc accumulates the FULL rowKey prefix (starting at segs[0]) so rowByKey
      // lookups match; but we skip i=0 for label-pushing since segs[0] is the
      // outermost table group already pushed above (re-pushing would duplicate
      // the first path segment).
      let acc = '';
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        acc = acc ? acc + ':' + seg : seg;
        if (i === 0) continue; // outermost table group — already pushed via topG.name
        if (seg === '__direct__') continue; // synthetic aggregate row, no label
        const rr = rowByKey.get(acc);
        if (rr && rr.label) { parts.push(rr.label); continue; }
        // No row at this prefix → the segment is a sub-table-group OPTION's gid
        // (an expanded group on the path). Look up its name from the groups tree.
        if (/^\d+$/.test(seg)) {
          const gg = groups.find(g => g.id === Number(seg));
          if (gg && gg.name) parts.push(gg.name);
        }
      }
      const r = rowByKey.get(rowKey);
      const o = r && r.options.find(x => String(x.kind === 'group' ? 'group:' + x.id : x.id) === String(optKey));
      const name = o ? (o.kind === 'group' ? (o.name || '') : (presetMap.get(o.id)?.meta?.name || ('#' + o.id))) : String(optKey);
      parts.push(name);
      return parts.filter(Boolean).join(' / ');
    };

    // Resolve a dragged payload to { dstRowKey, dstOption } within the source's
    // visible rows, or null if it's not a visible option here.
    const resolveTarget = (raw) => {
      if (raw.startsWith('preset:')) {
        const pid = Number(raw.slice(7).split(',')[0]);
        const host = rows.find(r => r.options.some(o => o.kind === 'preset' && o.id === pid));
        if (!host) return null;
        return { dstRowKey: host.rowKey, dstOption: pid };
      }
      if (raw.startsWith('group:')) {
        const childGid = Number(raw.slice(6));
        const host = rows.find(r => r.options.some(o => o.kind === 'group' && o.id === childGid));
        if (!host) return null;
        return { dstRowKey: host.rowKey, dstOption: 'group:' + childGid };
      }
      return null;
    };

    const readTargets = () => {
      const all = state.get('tableActivations') || {};
      const bySrc = all[srcGid] || {};
      return bySrc[srcOptionKey] || [];
    };

    slotEl.innerHTML = `
      <div class="form-group" style="margin-top:14px">
        <label class="form-label" style="font-weight:600">${i18n.t('preset.activation.title')}</label>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">${i18n.t('preset.activation.hint')}</div>
        <div id="act-drop" class="act-drop">${i18n.t('preset.activation.dropHere')}</div>
        <div id="act-delete-zone" class="act-drop act-delete-zone">${i18n.t('preset.activation.deleteZone')}</div>
        <div id="act-list" style="margin-top:8px"></div>
      </div>
    `;

    const listEl = slotEl.querySelector('#act-list');
    const drop = slotEl.querySelector('#act-drop');
    const deleteZone = slotEl.querySelector('#act-delete-zone');
    const selectedTargets = new Set(); // indices selected for multi-drag-delete
    let anchor = -1; // selection anchor for Shift-range (persists across re-renders)
    const renderList = () => {
      const targets = readTargets();
      // Drop any selected indices that no longer exist.
      for (const i of [...selectedTargets]) if (i >= targets.length) selectedTargets.delete(i);
      if (!targets.length) { listEl.innerHTML = `<div style="font-size:11px;color:var(--text-muted)">${i18n.t('preset.activation.empty')}</div>`; return; }
      listEl.innerHTML = targets.map((t, ti) => {
        const isDisable = (t.effect || 'select') === 'disable';
        const badge = isDisable
          ? `<span class="act-target__tag act-target__tag--disable">${i18n.t('preset.activation.disableTag')}</span>`
          : `<span class="act-target__tag act-target__tag--select">${i18n.t('preset.activation.selectTag')}</span>`;
        const sel = selectedTargets.has(ti) ? ' act-target--selected' : '';
        return `
        <div class="act-target${sel}" draggable="true" data-idx="${ti}">
          <span class="act-target__label">${escapeHtml(fullPathLabel(t.dstRowKey, t.dstOption))}</span>
          ${badge}
        </div>`;
      }).join('');
      // Selection model: plain click = single-select (clears others); Ctrl-click
      // = toggle one; Shift-click = range from last anchor. Dragging carries the
      // selection (or just the dragged row if it isn't selected).
      listEl.querySelectorAll('.act-target[data-idx]').forEach(el => {
        el.addEventListener('click', (ev) => {
          const idx = Number(el.dataset.idx);
          if (ev.ctrlKey || ev.metaKey) {
            if (selectedTargets.has(idx)) selectedTargets.delete(idx); else selectedTargets.add(idx);
            anchor = idx;
          } else if (ev.shiftKey && anchor >= 0) {
            const lo = Math.min(anchor, idx), hi = Math.max(anchor, idx);
            for (let i = lo; i <= hi; i++) selectedTargets.add(i);
          } else {
            selectedTargets.clear();
            selectedTargets.add(idx);
            anchor = idx;
          }
          renderList();
        });
        el.addEventListener('dragstart', (e) => {
          const idx = Number(el.dataset.idx);
          // Dragging an unselected row selects it first (single) so the dragged
          // row is visually part of the selection. Update only this element's
          // class — a full renderList() would rebuild the DOM mid-drag.
          if (!selectedTargets.has(idx)) {
            listEl.querySelectorAll('.act-target--selected').forEach(n => n.classList.remove('act-target--selected'));
            el.classList.add('act-target--selected');
            selectedTargets.clear();
            selectedTargets.add(idx);
            anchor = idx;
          }
          const dragSet = [...selectedTargets];
          e.dataTransfer.effectAllowed = 'move';
          // Custom MIME (NOT text/plain) so the bind-drop zone's text/plain-only
          // dragover check rejects binding rows — only the delete zone accepts it.
          e.dataTransfer.setData('application/x-activation-binding', 'actrm:' + dragSet.join(','));
        });
      });
    };
    renderList();

    // Drop a target option. Highlight on dragenter/over — green for select,
    // yellow when Shift is held (disable).
    const setHl = (on, shift) => {
      drop.classList.toggle('act-drop--over', on && !shift);
      drop.classList.toggle('act-drop--over-disable', on && shift);
    };
    // Only accept NEW-option drops (text/plain = preset:/group:). Binding rows
    // use a custom mime, so they won't pass this check → no highlight, no drop.
    const isNewOptionDrag = (e) => (e.dataTransfer.types || []).includes('text/plain');
    drop.addEventListener('dragenter', (e) => {
      if (!isNewOptionDrag(e)) return;
      e.preventDefault(); e.stopPropagation(); setHl(true, e.shiftKey);
    });
    drop.addEventListener('dragover', (e) => {
      if (!isNewOptionDrag(e)) return;
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setHl(true, e.shiftKey);
    });
    drop.addEventListener('dragleave', () => { setHl(false, false); });
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); setHl(false, false);
      const raw = e.dataTransfer.getData('text/plain') || '';
      const tgt = resolveTarget(raw);
      // Allowed: different top-level row, or source's own descendant. Else forbid.
      // Unresolvable target (not visible in this table group) is treated the
      // same as a forbidden one — single failure message.
      if (!tgt || !isAllowedTarget(groups, srcGid, srcOptionKey, tgt.dstOption)) {
        Toast.error(i18n.t('preset.activation.bindFailed')); return;
      }
      // Shift-drop = DISABLE the target (grey it out, unselectable); plain drop
      // = SELECT it (the normal activation lock). Stored as target.effect.
      const effect = e.shiftKey ? 'disable' : 'select';
      const _all0 = state.get('tableActivations') || {};
      const _existing = ((_all0[srcGid] || {})[srcOptionKey]) || [];
      // Mutex: a row can't mix select and disable targets under the same source.
      const _rowHasOther = _existing.some(t =>
        t.dstRowKey === tgt.dstRowKey && (t.effect || 'select') !== effect);
      if (_rowHasOther) { Toast.error(i18n.t('preset.activation.rowMutexFailed')); return; }
      const all = { ..._all0 };
      const bySrc = { ...(all[srcGid] || {}) };
      const targets = (bySrc[srcOptionKey] || []).slice();
      if (!targets.some(t => t.dstRowKey === tgt.dstRowKey && String(t.dstOption) === String(tgt.dstOption) && (t.effect || 'select') === effect)) {
        targets.push({ dstRowKey: tgt.dstRowKey, dstOption: tgt.dstOption, effect });
      }
      bySrc[srcOptionKey] = targets;
      all[srcGid] = bySrc;
      state.set('tableActivations', all);
      state.set('presetDirty', true);
    });

    // Drag-to-delete: accepts binding rows (custom mime) OR a preset/group
    // (text/plain) to delete matching bindings.
    const isDroppable = (e) => {
      const types = e.dataTransfer.types || [];
      return types.includes('application/x-activation-binding') || types.includes('text/plain');
    };
    const dzHl = (on) => deleteZone.classList.toggle('act-delete-zone--over', on);
    deleteZone.addEventListener('dragenter', (e) => { if (isDroppable(e)) { e.preventDefault(); dzHl(true); } });
    deleteZone.addEventListener('dragover', (e) => { if (isDroppable(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    deleteZone.addEventListener('dragleave', () => dzHl(false));
    deleteZone.addEventListener('drop', (e) => {
      e.preventDefault(); dzHl(false);
      const bindRaw = e.dataTransfer.getData('application/x-activation-binding') || '';
      const raw = bindRaw || (e.dataTransfer.getData('text/plain') || '');
      const all = { ...(state.get('tableActivations') || {}) };
      const bySrc = { ...(all[srcGid] || {}) };
      let targets = (bySrc[srcOptionKey] || []).slice();
      if (raw.startsWith('actrm:')) {
        // Remove the dragged binding row(s) by index.
        const rmSet = new Set(raw.slice(6).split(',').map(s => Number(s)).filter(n => !Number.isNaN(n)));
        if (!rmSet.size) return;
        targets = targets.filter((_, i) => !rmSet.has(i));
      } else if (raw.startsWith('preset:') || raw.startsWith('group:')) {
        // Remove bindings whose target option matches the dragged option.
        const dragOptKey = raw.startsWith('group:') ? ('group:' + raw.slice(6)) : Number(raw.slice(7).split(',')[0]);
        targets = targets.filter(t => String(t.dstOption) !== String(dragOptKey));
      } else {
        return;
      }
      if (targets.length) bySrc[srcOptionKey] = targets; else delete bySrc[srcOptionKey];
      all[srcGid] = bySrc;
      selectedTargets.clear();
      state.set('tableActivations', all);
      state.set('presetDirty', true);
    });

    // Binding selection state is module-level so app.js's layered Esc handler
    // can query/clear it via window.ActivationBinding (innermost-first, same as
    // ini/file/tint operation selections) — no separate capture listener.
    _bindingSelectedTargets = selectedTargets;
    _bindingRenderList = renderList;
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
      skinIni: (editData.actions.skinIni || []).map(e => ({
        section: e.section, maniaKeys: e.maniaKeys, key: e.key, value: e.value,
        ...(e._cn ? { _cn: e._cn } : {}),
        ...(e._delete ? { _delete: true } : {}),
      })),
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
          o.mode = t.mode || 'replace';
          // Persist only the fields the active mode reads, so switching modes
          // can't leave the other mode's dead values in the file.
          if (o.mode === 'hue-shift') {
            // alpha rides in color's 4th component; rgb is unused → neutral 255.
            const a = (t.color || '').split(',').map(n => parseInt(n.trim(), 10));
            o.color = `255,255,255,${a[3] != null ? a[3] : 255}`;
            o.hueShift = +t.hueShift || 0;
            o.satShift = +t.satShift || 0;
            o.lightShift = +t.lightShift || 0;
          } else {
            o.color = t.color || '255,255,255,255';
          }
        }
        if (t.cropEnabled) {
          o.cropEnabled = true;
          o.cropA = +t.cropA || 0;
          o.cropB = +t.cropB || 0;
          o.cropC = +t.cropC || 32768;
          o.cropD = +t.cropD || 0;
          o.cropTile = !!t.cropTile;
          o.cropTileDir = t.cropTileDir === 'up' ? 'up' : 'down';
          o.darkenD = +t.darkenD || 0;
          o.darkenOpacity = +t.darkenOpacity || 0;
        }
        return o;
      }),
      fileLayers: (editData.actions.fileLayers || []).map(serializeLayerStack),
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
    // Flush any focused input/textarea/select into editData before saving —
    // blurring fires its change event so the sub-editor commits the in-flight
    // value. Without this, saving while a field is focused stores the OLD value.
    const ae = document.activeElement;
    if (ae && ae.matches && ae.matches('input, textarea, select') && typeof ae.blur === 'function') {
      ae.blur();
    }
    // Close any open color picker popover so its text input commits + the
    // popover doesn't linger across the post-save re-render (which would
    // detach its trigger and leave it orphaned).
    if (window.ColorPicker && typeof window.ColorPicker.closeAll === 'function') {
      window.ColorPicker.closeAll();
    }
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
        skinIni: (editData.actions.skinIni || []).map(e => ({
        section: e.section, maniaKeys: e.maniaKeys, key: e.key, value: e.value,
        ...(e._cn ? { _cn: e._cn } : {}),
        ...(e._delete ? { _delete: true } : {}),
      })),
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
            o.mode = t.mode || 'replace';
            if (o.mode === 'hue-shift') {
              const a = (t.color || '').split(',').map(n => parseInt(n.trim(), 10));
              o.color = `255,255,255,${a[3] != null ? a[3] : 255}`;
              o.hueShift = +t.hueShift || 0;
              o.satShift = +t.satShift || 0;
              o.lightShift = +t.lightShift || 0;
            } else {
              o.color = t.color || '255,255,255,255';
            }
          }
          if (t.cropEnabled) {
            o.cropEnabled = true;
            o.cropA = +t.cropA || 0;
            o.cropB = +t.cropB || 0;
            o.cropC = +t.cropC || 32768;
            o.cropD = +t.cropD || 0;
            o.cropTile = !!t.cropTile;
            o.cropTileDir = t.cropTileDir === 'up' ? 'up' : 'down';
            o.darkenD = +t.darkenD || 0;
            o.darkenOpacity = +t.darkenOpacity || 0;
          }
          return o;
        }),
        fileLayers: (editData.actions.fileLayers || []).map(serializeLayerStack),
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
      Toast.success(i18n.t('preset.saved'));
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
      // New-preset flow kept A highlighted during editing; now that the new
      // preset exists, clear that stale selection THEN select the new preset
      // like a manual click (Selection.setSingle puts it in the selection set
      // so Shift-range / Ctrl-multi / delete all see it; selectedPreset loads
      // it in the editor). clearSelection sets selectedPreset=null first, so
      // order matters.
      if (currentId === '__new__' && window.PresetList && typeof window.PresetList.clearSelection === 'function') {
        window.PresetList.clearSelection();
      }
      if (currentId === '__new__' && window.Selection && typeof window.Selection.setSingle === 'function') {
        window.Selection.setSingle('preset', result.data);
      }
      // Only fire selectedPreset when the id actually changed (new preset got its
      // real id). For an existing preset the id is unchanged: re-asserting it
      // would trigger the listener → reload from disk → re-render the editor and
      // wipe the in-editor operation-row selection the user just had.
      if (result.data !== currentId) {
        state.set('selectedPreset', result.data);
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
          rootChildren: scanResult.data.rootChildren || [],
        });
      }
      // New preset saved under a group: expand the ancestor chain so the new
      // preset is visible (mirrors createGroupWithSelected's auto-expand).
      if (currentId === '__new__') {
        const freshGroups = state.get('groups') || [];
        // Find the group that directly contains the new preset.
        const parent = freshGroups.find(g => g.children && g.children.some(c => c.type === 'preset' && c.id === result.data));
        if (parent) {
          const toExpand = [];
          let curParent = parent.id;
          const guard = new Set();
          while (curParent != null && !guard.has(curParent)) {
            guard.add(curParent);
            const g = freshGroups.find(x => x.id === curParent);
            if (!g) break;
            if (g.collapsed) toExpand.push(curParent);
            const ancestor = freshGroups.find(x => x.children && x.children.some(c => c.type === 'group' && c.id === curParent));
            curParent = ancestor ? ancestor.id : null;
          }
          if (toExpand.length) {
            await api.setGroupsCollapsedBatch(sk, toExpand, false);
            const rescan = await api.scanPresets(sk);
            if (rescan.success) {
              state.setMultiple({
                presets: rescan.data.presets,
                groups: rescan.data.groups,
                rootChildren: rescan.data.rootChildren || [],
              });
            }
          }
        }
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
      // The edited preset is gone: clear the dirty flag so the save button
      // doesn't stay lit for unsaved edits to a preset that no longer exists.
      state.setMultiple({ selectedPreset: null, presetDirty: false });
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
      // Re-register global shortcuts: compact_ids re-numbered every id, so the
      // old bindings (keyed by id) would point at the wrong preset without this.
      try { api.reloadGlobalShortcuts(sk); } catch (e) { /* best-effort */ }
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
    if (window.LayerEditor) LayerEditor.init(getFileLayers, setFileLayers, skinName, idFn, pathFn);
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

    if (await loadPresetIntoEditor(preset)) playEditorEnter();
  });
  // Reload the currently selected preset/group into the editor from its saved
  // state on disk — used by confirmApplyIfDirty's "don't save" branch so the
  // editor discards unsaved edits (apply reads the SAVED state).
  async function reloadCurrent() {
    const preset = state.get('selectedPreset');
    const group = state.get('selectedGroup');
    if (group != null) { loadGroupIntoEditor(group); return true; }
    if (preset && preset !== '__new__') return loadPresetIntoEditor(preset);
    return false;
  }
  // Fetch the preset from disk and populate editData + sub-editors. Returns
  // true on success. Shared by the selectedPreset/appMode listeners + reloadCurrent.
  async function loadPresetIntoEditor(preset) {
    const sk = skinName();
    if (!sk) return false;
    const result = await api.loadPreset(sk, preset);
    if (!result.success || !result.data) return false;
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
    if (window.LayerEditor) LayerEditor.init(getFileLayers, setFileLayers, skinName, () => state.get('selectedPreset'), async () => {
      const sn = skinName();
      if (!sn) return null;
      const r = await api.getSkinPath(sn);
      return r.success ? r.data : null;
    });
    render();
    return true;
  }
  state.on('appMode', async (mode) => {
    if (mode !== 'edit') return;
    const preset = state.get('selectedPreset');
    if (!preset || preset === '__new__') return;
    await loadPresetIntoEditor(preset);
  });

  // Multi-select (groups or presets, >1) locks the editor: tabs disabled + the
  // body is non-interactive so nothing can be edited mid-selection.
  state.on('multiSelectActive', (active) => {
    // Don't remove tabs--disabled if the editor is showing a plain group —
    // the plain-group render sets it and multiSelectActive clearing would
    // wrongly re-enable the tabs.
    if (!active && editData.kind === 'group' && !editData._isTableGroup) return;
    const tabs = viewEl.querySelector('.tabs');
    if (tabs) tabs.classList.toggle('tabs--disabled', !!active);
    viewEl.classList.toggle('editor--locked', !!active);
  });

  // Re-render just the activation-binding slot when edges change (add/remove
  // from within the slot itself). Local re-render only — a full editor rebuild
  // would blur the basic-tab inputs the user may be typing in.
  state.on('tableActivations', () => {
    const ctx = findOptionContext();
    if (ctx) {
      const slot = document.getElementById('activation-slot');
      if (slot) renderActivationSlot(slot, ctx);
    }
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
    const cb = { skinIni: [], fileCopies: [], fileDeletes: [], fileTints: [], fileLayers: [] };
    if (activeTab === 'ini' && window.IniEditor && window.IniEditor.getSelectedActions) {
      cb.skinIni = window.IniEditor.getSelectedActions();
    } else if (activeTab === 'files' && window.FileCopyEditor && window.FileCopyEditor.getSelectedActions) {
      const r = window.FileCopyEditor.getSelectedActions();
      cb.fileCopies = r.fileCopies || [];
      cb.fileDeletes = r.fileDeletes || [];
    } else if (activeTab === 'tint' && window.TintEditor && window.TintEditor.getSelectedActions) {
      cb.fileTints = window.TintEditor.getSelectedActions();
    } else if (activeTab === 'layer' && window.LayerEditor && window.LayerEditor.getSelectedActions) {
      cb.fileLayers = window.LayerEditor.getSelectedActions();
    } else {
      return false;
    }
    const total = cb.skinIni.length + cb.fileCopies.length + cb.fileDeletes.length + cb.fileTints.length + cb.fileLayers.length;
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
  // A layer stack's dedup key: its destination (each output is unique), falling
  // back to the sorted source list when destination is empty.
  const _layerKey = (e) => (e && e.destination) || ((e && e.layers || []).map(l => l.source || '').sort().join('◆'));

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
      { name: 'fileLayers', key: _layerKey, label: i18n.t('paste.catLayer'), allowAppend: true },
    ];

    const result = { skinIni: [...editData.actions.skinIni], fileCopies: [...editData.actions.fileCopies], fileDeletes: [...editData.actions.fileDeletes], fileTints: [...editData.actions.fileTints], fileLayers: [...editData.actions.fileLayers] };
    let added = 0;
    // Per-category INDICES (within that category's own array) touched by this
    // paste — fresh-append tail + overwrite in-place + conflict-append tail.
    // Passed to the editor's selectAdded so it selects EXACTLY the pasted rows
    // by position, not by key (key-matching would also hit the source rows when
    // an appended row shares a key with an existing one).
    const touchedIdx = { skinIni: [], fileCopies: [], fileDeletes: [], fileTints: [], fileLayers: [] };

    for (const cat of categories) {
      const target = result[cat.name];
      const targetKeys = new Set(target.map(cat.key));
      const cbEntries = cb[cat.name] || [];
      const fresh = cbEntries.filter(e => !targetKeys.has(cat.key(e)));
      const conflicts = cbEntries.filter(e => targetKeys.has(cat.key(e)));

      // Always append non-conflicting entries.
      for (const e of fresh) { target.push(e); added++; touchedIdx[cat.name].push(target.length - 1); }

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
      // Esc / dialog dismissed → cancel the WHOLE paste (including the already-
      // staged non-conflicting entries). Return without committing.
      if (!choice) return;
      if (choice === 'overwrite') {
        // Replace target entries whose key matches a clipboard entry, then add
        // the clipboard's version. Preserve target order for surviving entries.
        const cbByKey = new Map(conflicts.map(e => [cat.key(e), e]));
        for (let i = 0; i < target.length; i++) {
          const k = cat.key(target[i]);
          if (cbByKey.has(k)) { target[i] = cbByKey.get(k); touchedIdx[cat.name].push(i); }
        }
        added += conflicts.length;
      } else if (choice === 'append') {
        for (const e of conflicts) { target.push(e); added++; touchedIdx[cat.name].push(target.length - 1); }
      }
      // 'skip' or dialog dismissed → drop conflicting clipboard entries.
    }

    setSkinIniActions(result.skinIni);
    setFileCopies(result.fileCopies);
    setFileDeletes(result.fileDeletes);
    setFileTints(result.fileTints);
    setFileLayers(result.fileLayers);
    state.set('presetDirty', true);
    render();
    // Select every row touched by this paste (appended AND overwrite-replaced)
    // by POSITION, not key — the editor maps each category's indices to its own
    // flat row layout. Position-based selection can't accidentally include the
    // source row an appended copy shares a key with.
    const activeTab = viewEl.querySelector('.tab--active')?.dataset.tab;
    if (activeTab === 'files' && window.FileCopyEditor && typeof window.FileCopyEditor.selectAdded === 'function') {
      window.FileCopyEditor.selectAdded({
        copyIdx: touchedIdx.fileCopies, deleteIdx: touchedIdx.fileDeletes,
      });
    } else if (activeTab === 'tint' && window.TintEditor && typeof window.TintEditor.selectAdded === 'function') {
      window.TintEditor.selectAdded({ idx: touchedIdx.fileTints });
    } else if (activeTab === 'layer' && window.LayerEditor && typeof window.LayerEditor.selectAdded === 'function') {
      window.LayerEditor.selectAdded({ idx: touchedIdx.fileLayers });
    } else if (activeTab === 'ini' && window.IniEditor && typeof window.IniEditor.selectAdded === 'function') {
      window.IniEditor.selectAdded({ idx: touchedIdx.skinIni });
    }
    Toast.success(i18n.t('preset.actionsPasted', { count: added }));
  }

  // Reset the form to a fresh "new preset" state (used when the user re-clicks New Preset).
  function resetNew() {
    editData = {
      kind: 'preset',
      meta: { name: '', description: '' },
      actions: { skinIni: [], fileCopies: [], fileDeletes: [], fileTints: [], fileLayers: [] },
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
    if (window.LayerEditor) LayerEditor.init(getFileLayers, setFileLayers, skinName, () => state.get('selectedPreset'), async () => {
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

  window.PresetEditor = { render, getCurrentEditData, doSave, doSaveGroup, doDelete, resetNew, reloadCurrent, moveTabIndicator, copyActions, pasteActions, set newPresetTargetParent(v) { _newPresetTargetParent = v; } };
})();
