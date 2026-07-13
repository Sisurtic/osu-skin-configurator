// Preset selector — use mode: displays preset tree with radio selection per group + hover preview
(function () {
  const viewEl = document.getElementById('view-selector');

  let hoverTimer = null;
  let resetTimer = null;
  let previewCache = {};   // previewPath → dataURL (loaded on skin select)
  let shortcutSelected = new Set();   // selection keys ("group:<id>" / "preset:<id>")
  let recorderActive = false;          // true while waiting for the next keypress to bind
  // Persisted divider flex — survives re-renders (selectedSkin, appMode, etc).
  let _dividerPanelFlex = null;

  // Shared empty-state markup for the preview panel. MUST be a function (not a
  // module-level const) so i18n.t() runs after the locale dictionaries are
  // loaded — a const would evaluate at IIFE load time, before i18n.load(),
  // and cache raw key names.
  function emptyPreviewHtml() {
    return `<div class="preset-preview-panel__empty">${i18n.t('selector.hoverHint')}<br>${i18n.t('selector.hoverHint2')}<br><br>${i18n.t('selector.clickSelect')}<br>${i18n.t('selector.rightClickShortcut')}<br>${i18n.t('selector.ctrlMulti')}</div>`;
  }

  let _suppressRender = false;
  let _justToggledGid = null;  // group id whose underline should animate this render
  let _animDepthBase = 0;     // depth of the toggled group (for relative delay)
  // Row keys (data-row-key) present on the PREVIOUS render. Rows that appear
  // this render but weren't here last render play the slide-in animation —
  // this covers both activating a checkbox group and expanding a child sub-
  // group (its nested rows are new).
  let _prevRowKeys = new Set();

  function render() {
    if (_suppressRender) return;
    const skin = state.get('selectedSkin');
    const presets = state.get('presets') || [];
    const groups = state.get('groups') || [];
    const rootChildren = state.get('rootChildren') || [];
    const activePresets = state.get('activePresets') || {};

    if (!skin) {
      // No skin selected: the welcome page (view-welcome) is shown on top via
      // switchView, so leave the selector empty — don't render a noSkin state
      // (it would flash when switching skins before the new data loads).
      viewEl.innerHTML = '';
      return;
    }

    if (presets.length === 0 && groups.length === 0) {
      viewEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">📄</div>
          <div class="empty-state__title">${i18n.t('selector.none')}</div>
          <div class="empty-state__desc">${i18n.t('selector.noneHint')}</div>
        </div>
      `;
      return;
    }

    const presetMap = new Map(presets.map(p => [p.id, p]));
    const groupMap = new Map(groups.map(g => [g.id, g]));

    // Drop any selection whose preset id no longer exists in this skin
    let cleaned = false;
    for (const k of Object.keys(activePresets)) {
      const arr = Array.isArray(activePresets[k]) ? activePresets[k] : [];
      const filtered = arr.filter(id => presetMap.has(id));
      if (filtered.length !== arr.length) {
        if (filtered.length > 0) activePresets[k] = filtered;
        else delete activePresets[k];
        cleaned = true;
      }
    }
    if (cleaned) state.set('activePresets', { ...activePresets });

    // Drop stale table expansion/selection state (ids no longer valid).
    const groupIds = new Set(groups.map(g => g.id));
    let tableCleaned = false;
    const atg = state.get('activeTableGroups') || {};
    for (const gid of Object.keys(atg)) {
      if (!groupIds.has(Number(gid))) { delete atg[gid]; tableCleaned = true; }
    }
    const expanded = state.get('tableExpandedChildren') || {};
    const rowSel = state.get('tableRowSelection') || {};
    for (const gid of Object.keys(expanded)) {
      if (!groupIds.has(Number(gid))) { delete expanded[gid]; delete rowSel[gid]; tableCleaned = true; continue; }
      // Ensure Set (config.osp deserializes to array; empty {} = no expansions).
      if (Array.isArray(expanded[gid])) expanded[gid] = new Set(expanded[gid]);
      else if (expanded[gid] && typeof expanded[gid] === 'object' && !(expanded[gid] instanceof Set)) {
        expanded[gid] = new Set(Array.isArray(expanded[gid]) ? expanded[gid] : []);
      }
      const set = expanded[gid];
      const live = new Set([...set].filter(id => groupIds.has(id)));
      if (live.size !== set.size) { expanded[gid] = live; tableCleaned = true; }
    }
    for (const gid of Object.keys(rowSel)) {
      const sel = rowSel[gid];
      const live = {};
      for (const [k, v] of Object.entries(sel)) {
        // Keep preset ids that still exist, and group-selection markers ('group:<id>').
        if (typeof v === 'string' || presetMap.has(v)) live[k] = v;
        else tableCleaned = true;
      }
      if (Object.keys(live).length !== Object.keys(sel).length) rowSel[gid] = live;
    }
    if (tableCleaned) {
      state.set('tableExpandedChildren', { ...expanded });
      state.set('tableRowSelection', { ...rowSel });
      state.set('activeTableGroups', { ...atg });
    }

    // Collect all selected ids (arrays → flattened)
    const selectedIds = [].concat(...Object.values(activePresets).filter(a => Array.isArray(a)));
    const hasSelection = selectedIds.length > 0;

    let html = '<div class="preset-selector"><div class="preset-selector__header">';
    html += `<h3>${i18n.t('selector.heading')}</h3><span style="font-size:12px;color:var(--text-muted)">${i18n.t('selector.headingHint')}</span>`;
    html += '</div>';
    html += '<div class="preset-selector__body"><div class="preset-selector__list">';

    // Unified root: presets + groups interleaved per rootChildren order.
    const seenPreset = new Set();
    const seenGroup = new Set();
    for (const c of rootChildren) {
      if (c.type === 'preset') {
        const p = presetMap.get(c.id);
        if (p) { html += renderPresetRow(p, activePresets, '__root__'); seenPreset.add(c.id); }
      } else if (c.type === 'group') {
        const g = groupMap.get(c.id);
        if (!g) continue;
        seenGroup.add(c.id);
        if (g.type === 'table') {
          html += renderTableGroup(g, groups, presetMap, activePresets, 0);
        } else {
          html += renderGroupTree(g, groups, presetMap, activePresets, 0);
        }
      }
    }
    // Orphan presets not in any group and not in rootChildren.
    const presetsInTree = new Set();
    function collectPresets(children) {
      if (!children) return;
      for (const c of children) {
        if (c.type === 'preset') presetsInTree.add(c.id);
        else if (c.type === 'group') {
          const g = groupMap.get(c.id);
          if (g) collectPresets(g.children);
        }
      }
    }
    for (const g of groups) collectPresets(g.children);
    for (const p of presets) {
      if (!presetsInTree.has(p.id) && !seenPreset.has(p.id)) {
        html += renderPresetRow(p, activePresets, '__root__');
      }
    }
    // Orphan root groups not in rootChildren and not a child of another group.
    for (const g of groups) {
      if (seenGroup.has(g.id)) continue;
      let isChild = false;
      for (const pg of groups) {
        if (pg.children && pg.children.some(c => c.type === 'group' && c.id === g.id)) { isChild = true; break; }
      }
      if (!isChild) html += renderGroupTree(g, groups, presetMap, activePresets, 0);
    }

    html += '</div>';

    // Draggable divider + preview panel
    html += '<div class="preset-selector__divider" id="preset-divider"></div>';
    html += `
      <div class="preset-preview-panel" id="preset-preview-panel">
        ${emptyPreviewHtml()}
      </div>
    `;

    html += '</div></div>';

    // Warm the preview-image cache for this skin (fire-and-forget)
    preloadPreviews(presets);

    // Preserve list scroll position across re-renders
    const prevList = viewEl.querySelector('.preset-selector__list');
    const savedScroll = prevList ? prevList.scrollTop : 0;
    const prevPreview = viewEl.querySelector('#preset-preview-panel');
    const savedPreviewHtml = prevPreview ? prevPreview.innerHTML : null;
    // Save divider flex from DOM into module var (survives full rebuild).
    if (prevPreview && prevPreview.style.flex) {
      _dividerPanelFlex = prevPreview.style.flex;
    }

    viewEl.innerHTML = html;
    if (savedPreviewHtml) {
      const newPreview = viewEl.querySelector('#preset-preview-panel');
      if (newPreview) newPreview.innerHTML = savedPreviewHtml;
    }
    // Restore the divider-dragged flex from module var.
    if (_dividerPanelFlex) {
      const newPanel = viewEl.querySelector('#preset-preview-panel');
      const newList = viewEl.querySelector('.preset-selector__list');
      if (newPanel) newPanel.style.flex = _dividerPanelFlex;
      if (newList) newList.style.flex = '1';
    }
    afterRebuild();
    return;

    function afterRebuild() {
    // Suppress the hover flash: after a DOM rebuild the element under the
    // cursor instantly matches :hover, and ANY transition (item background,
    // label color, etc.) plays = visible flash. Disable transitions on every
    // element for one frame so the :hover state applies instantly.
    viewEl.querySelectorAll('*').forEach(el => {
      el.style.transition = 'none';
    });
    requestAnimationFrame(() => {
      viewEl.querySelectorAll('*').forEach(el => {
        el.style.transition = '';
      });
    });

    // After rebuild, mark ONLY newly-selected rows (not in the previous render's
    // selection set) so their gradient animation plays. Already-selected rows
    // that were carried over don't replay.
    const prevSel = window._lastShortcutSel || new Set();
    const currSel = new Set(shortcutSelected);
    viewEl.querySelectorAll('.preset-group__item--shortcut-sel').forEach(el => {
      const eid = parseInt(el.dataset.id, 10);
      const key = Number.isNaN(eid) ? null : (el.dataset.tableToggle ? 'group:' : 'preset:') + eid;
      if (key && !prevSel.has(key)) {
        el.classList.add('preset-group__item--shortcut-anim');
      }
    });
    window._lastShortcutSel = currSel;

    const newList = viewEl.querySelector('.preset-selector__list');
    if (newList && savedScroll) newList.scrollTop = savedScroll;

    // Bind collapse toggle: single-click the header = toggle this group;
    // Shift+click the header = toggle recursively. The arrow is visual only.
    viewEl.querySelectorAll('.preset-group__header').forEach(header => {
      header.addEventListener('click', (e) => {
        // Table group headers have their own click handler (activate/deactivate);
        // skip here so toggleCollapse doesn't also flip `collapsed`.
        if (header.dataset.tableToggle) return;
        const groupId = header.dataset.groupId;
        if (!groupId) return;
        if (e.shiftKey) toggleCollapseRecursive(groupId);
        else toggleCollapse(groupId);
      });
      // Hover a group → show its basic info (name/description/preview) in the
      // right preview panel, mirroring how preset rows behave.
      header.addEventListener('mouseenter', () => {
        const gid = parseInt(header.dataset.groupId, 10);
        if (Number.isNaN(gid)) return;
        clearTimeout(resetTimer);
        const groups = state.get('groups') || [];
        const g = groups.find(x => x.id === gid);
        if (!g) return;
        showPreview(
          g.name || '',
          g.description || '',
          g.previewPath || null,
          g.previewKind || 'image',
          g.previewFrames || null,
          g.previewFps || 12,
          'group:' + gid
        );
      });
      header.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimer);
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => resetPreview(), 3000);
      });
    });

    // Table group header click → toggle expand/collapse.
    viewEl.querySelectorAll('.preset-group__header[data-table-toggle]').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        const gid = parseInt(hdr.dataset.tableToggle, 10);
        const groups = state.get('groups') || [];
        const g = groups.find(gr => gr.id === gid);
        if (!g) return;
        const current = { ...(state.get('activePresets') || {}) };
        const atg = { ...(state.get('activeTableGroups') || {}) };
        const wasActive = !!atg[gid] || (current[gid] && current[gid].length > 0);
        const expanded = { ...(state.get('tableExpandedChildren') || {}) };
        const allSel = { ...(state.get('tableRowSelection') || {}) };

        // Restore expanded + seed defaults: every row must have a selection.
        // 1. Seed unselected rows with their leftmost option.
        // 2. Expand rows that selected a child table group.
        // Loop until stable.
        const restoreExpanded = () => {
          let changed = true;
          while (changed) {
            changed = false;
            const rows = collectTableRows(g, groups, expanded, 0, null);
            for (const row of rows) {
              // Seed unselected OR stale-selected row → leftmost option. A
              // persisted selection may reference a preset/child-group that no
              // longer exists in this row (deleted, restructured) — re-seed it.
              const cur = allSel[gid][row.rowKey];
              const validKeys = new Set([
                ...row.options.filter(o => o.kind === 'preset').map(o => o.id),
                ...row.options.filter(o => o.kind === 'group').map(o => 'group:' + o.id),
              ]);
              if (cur == null || !validKeys.has(cur)) {
                const first = row.options[0];
                if (first) {
                  allSel[gid][row.rowKey] = first.kind === 'group' ? 'group:' + first.id : first.id;
                  changed = true;
                }
              }
              // Expand child table groups that are selected.
              const val = allSel[gid][row.rowKey];
              if (typeof val === 'string' && val.startsWith('group:')) {
                const childId = parseInt(val.slice(6), 10);
                const owner = parseOwnerGid(row.rowKey, groups, gid);
                if (!expanded[owner]) expanded[owner] = new Set();
                if (!expanded[owner].has(childId)) {
                  expanded[owner].add(childId);
                  changed = true;
                }
              }
            }
          }
        };

        // Derive activePresets[gid] from current rows + selection.
        const deriveActivePresets = () => {
          const rows = collectTableRows(g, groups, expanded, 0, null);
          const sel = allSel[gid] || {};
          const ids = [];
          for (const row of rows) {
            const chosen = sel[row.rowKey];
            const presetOpts = row.options.filter(o => o.kind === 'preset').map(o => o.id);
            if (typeof chosen === 'number' && presetOpts.includes(chosen)) ids.push(chosen);
            else if (typeof chosen !== 'string' && presetOpts.length > 0) ids.push(presetOpts[0]);
          }
          if (ids.length > 0) current[gid] = ids; else delete current[gid];
        };

        const activate = () => {
          if (!expanded[gid] || !(expanded[gid] instanceof Set)) expanded[gid] = new Set();
          if (!allSel[gid]) allSel[gid] = {};
          restoreExpanded();
          deriveActivePresets();
          atg[gid] = true;
        };

        const deactivate = () => {
          delete current[gid];
          delete atg[gid];
          // Clear ALL expanded state for this table group + its nested sub-tables.
          // allSel (row selections) is PRESERVED (persisted).
          const clearExp = (grp) => {
            delete expanded[grp.id];
            for (const c of (grp.children || [])) {
              if (c.type === 'group') {
                const sub = groups.find(x => x.id === c.id);
                if (sub && sub.type === 'table') clearExp(sub);
              }
            }
          };
          clearExp(g);
        };

        if (e.ctrlKey || e.metaKey) {
          if (wasActive) deactivate();
          else activate();
        } else {
          const activeGids = new Set([...Object.keys(current), ...Object.keys(atg)].map(Number));
          const soleActive = wasActive && activeGids.size === 1 && activeGids.has(gid);
          if (soleActive) {
            deactivate();
          } else {
            for (const k of Object.keys(current)) delete current[k];
            for (const k of Object.keys(atg)) delete atg[k];
            activate();
          }
        }
        state.setMultiple({
          tableExpandedChildren: expanded,
          tableRowSelection: allSel,
          activePresets: current,
          activeTableGroups: atg,
        });
      });
    });

    // Bind row clicks
    viewEl.querySelectorAll('.preset-group__item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (item.dataset.tableToggle) return; // table header has its own handler
        const groupId = item.dataset.groupId;
        const presetId = parseInt(item.dataset.id, 10);
        const current = state.get('activePresets') || {};
        const atg = state.get('activeTableGroups') || {};
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+click: toggle this preset within the group (multi-select)
          const arr = Array.isArray(current[groupId]) ? current[groupId].slice() : [];
          const idx = arr.indexOf(presetId);
          if (idx >= 0) arr.splice(idx, 1);
          else arr.push(presetId);
          if (arr.length > 0) current[groupId] = arr;
          else delete current[groupId];
        } else {
          // Plain click: global single-select (clears other presets AND table
          // groups), or deselect if clicking the sole selection.
          const sole = Object.keys(current).length === 0
            && Object.keys(atg).length === 0;
          const isOnlyThis = sole === false
            && Object.keys(current).length === 1
            && Array.isArray(current[groupId])
            && current[groupId].length === 1
            && current[groupId][0] === presetId
            && Object.keys(atg).length === 0;
          if (isOnlyThis) {
            delete current[groupId];
          } else {
            for (const k of Object.keys(current)) delete current[k];
            for (const k of Object.keys(atg)) delete atg[k];
            current[groupId] = [presetId];
          }
        }
        state.set('activePresets', { ...current });
        state.set('activeTableGroups', { ...atg });
        const panel = document.getElementById('preset-preview-panel');
        const savedWidth = panel ? panel.style.width : null;
        render();
        if (savedWidth) {
          const newPanel = document.getElementById('preset-preview-panel');
          const newList = document.querySelector('.preset-selector__list');
          if (newPanel) newPanel.style.width = savedWidth;
          if (newList && savedWidth) newList.style.width = `calc(100% - ${parseInt(savedWidth) + 4}px)`;
        }
      });

      // Hover preview
      item.addEventListener('mouseenter', () => {
        // Table-group headers have their own hover handler (showPreview of the
        // group). Skip here so this preset-row handler doesn't look up a preset
        // by the group's id (ids can overlap) and show the wrong preview.
        if (item.dataset.tableToggle) return;
        clearTimeout(resetTimer);
        const presetId = parseInt(item.dataset.id, 10);
        const preset = presets.find(p => p.id === presetId);
        const desc = (preset?.meta?.description || '').trim();
        const presetName = preset?.meta?.name || i18n.t('preset.fallbackName', { id: presetId });
        const previewPath = preset?.meta?.previewPath || null;
        const previewKind = preset?.meta?.previewKind || 'image';
        const previewFrames = preset?.meta?.previewFrames || null;
        const previewFps = preset?.meta?.previewFps || 12;
        showPreview(presetName, desc, previewPath, previewKind, previewFrames, previewFps, presetId);
      });

      item.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimer);
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => resetPreview(), 3000);
      });

      // Right-click → bind global shortcut
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const id = parseInt(item.dataset.id, 10);
        const isGroup = !!item.dataset.tableToggle;
        // Key by type+id so a preset and a group sharing the same numeric id
        // don't get selected together.
        const key = (isGroup ? 'group:' : 'preset:') + id;
        if (e.ctrlKey || e.metaKey) {
          if (shortcutSelected.has(key)) shortcutSelected.delete(key);
          else shortcutSelected.add(key);
        } else {
          if (shortcutSelected.size === 1 && shortcutSelected.has(key)) {
            shortcutSelected = new Set();
          } else {
            shortcutSelected = new Set([key]);
          }
        }
        // Helper: compute an element's selection key from its dataset.
        const elKey = (el) => {
          const eid = parseInt(el.dataset.id, 10);
          if (Number.isNaN(eid)) return null;
          return (el.dataset.tableToggle ? 'group:' : 'preset:') + eid;
        };
        if (shortcutSelected.size === 0) {
          // Selection emptied: remove --shortcut-sel in-place, close recorder
          // WITHOUT render (avoids hover flash from DOM rebuild).
          viewEl.querySelectorAll('.preset-group__item--shortcut-sel').forEach(el => {
            el.classList.remove('preset-group__item--shortcut-sel', 'preset-group__item--shortcut-anim');
          });
          recorderActive = false;
          shortcutSelected = new Set();
          hideShortcutRecorder();
        } else {
          startRecording();
          // Toggle the --shortcut-sel class in-place (no re-render) so the CSS
          // animation only plays on the newly selected row, not on already-
          // selected rows that would be re-created by render().
          viewEl.querySelectorAll('.preset-group__item--shortcut-sel').forEach(el => {
            if (!shortcutSelected.has(elKey(el))) {
              el.classList.remove('preset-group__item--shortcut-sel', 'preset-group__item--shortcut-anim');
            }
          });
          viewEl.querySelectorAll('.preset-group__item').forEach(el => {
            if (shortcutSelected.has(elKey(el)) && !el.classList.contains('preset-group__item--shortcut-sel')) {
              el.classList.add('preset-group__item--shortcut-sel', 'preset-group__item--shortcut-anim');
            }
          });
        }
      });
    });

    // (Removed) Global keyup that started recording on Ctrl release — recording now
    // starts immediately on right-click / Ctrl+right-click.

    // Keep the current preview while the cursor is over the preview panel
    const previewPanel = document.getElementById('preset-preview-panel');
    if (previewPanel) {
      previewPanel.addEventListener('mouseenter', () => {
        clearTimeout(resetTimer);
      });
      previewPanel.addEventListener('mouseleave', () => {
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => resetPreview(), 3000);
      });
    }

    // ── Table group radio: switching a row's preset updates activePresets ──
    // Two option kinds: 'preset' (select for this row) and 'group' (toggle a
    // nested table group's expansion into a row).
    viewEl.querySelectorAll('.preset-group__table-option[data-table-row]').forEach(opt => {
      opt.addEventListener('click', () => {
        const gid = parseInt(opt.dataset.tableRow, 10);
        const kind = opt.dataset.kind;
        const rowKey = opt.dataset.rowKey;
        const groups = state.get('groups') || [];
        const g = groups.find(x => x.id === gid);
        if (!g) return;
        const ownerGid = parseOwnerGid(rowKey, groups, gid);
        const expanded = { ...(state.get('tableExpandedChildren') || {}) };
        const allSel = { ...(state.get('tableRowSelection') || {}) };
        const current = { ...(state.get('activePresets') || {}) };
        if (!allSel[gid]) allSel[gid] = {};
        const sel = allSel[gid];
        if (!expanded[ownerGid]) expanded[ownerGid] = new Set();

        if (kind === 'preset') {
          const pid = parseInt(opt.dataset.presetId, 10);
          // Mutex: collapse any group tags in this row.
          const row = collectTableRows(g, groups, expanded, 0, null).find(r => r.rowKey === rowKey);
          if (row) {
            for (const o of row.options) {
              if (o.kind === 'group' && expanded[ownerGid].has(o.id)) {
                expanded[ownerGid].delete(o.id);
              }
            }
          }
          sel[rowKey] = pid;
        } else if (kind === 'group') {
          const childGid = parseInt(opt.dataset.childGroupId, 10);
          const groupKey = 'group:' + childGid;
          if (sel[rowKey] === groupKey) return; // already selected
          // Mutex: collapse other group tags in this row.
          const row = collectTableRows(g, groups, expanded, 0, null).find(r => r.rowKey === rowKey);
          if (row) {
            for (const o of row.options) {
              if (o.kind === 'group' && o.id !== childGid && expanded[ownerGid].has(o.id)) {
                expanded[ownerGid].delete(o.id);
              }
            }
          }
          sel[rowKey] = groupKey;
          if (!expanded[ownerGid].has(childGid)) expanded[ownerGid].add(childGid);
        }

        // Restore expanded + seed defaults for newly appeared rows.
        let changed = true;
        while (changed) {
          changed = false;
          const rows = collectTableRows(g, groups, expanded, 0, null);
          for (const row of rows) {
            // Seed unselected row → leftmost option.
            if (sel[row.rowKey] == null) {
              const first = row.options[0];
              if (first) {
                sel[row.rowKey] = first.kind === 'group' ? 'group:' + first.id : first.id;
                changed = true;
              }
            }
            // Expand child table groups that are selected.
            const val = sel[row.rowKey];
            if (typeof val === 'string' && val.startsWith('group:')) {
              const childId = parseInt(val.slice(6), 10);
              const rowOwner = parseOwnerGid(row.rowKey, groups, gid);
              if (!expanded[rowOwner]) expanded[rowOwner] = new Set();
              if (!expanded[rowOwner].has(childId)) {
                expanded[rowOwner].add(childId);
                changed = true;
              }
            }
          }
        }

        // Derive activePresets.
        const deriveRows = collectTableRows(g, groups, expanded, 0, null);
        const ids = [];
        for (const row of deriveRows) {
          const chosen = sel[row.rowKey];
          const presetOpts = row.options.filter(o => o.kind === 'preset').map(o => o.id);
          if (typeof chosen === 'number' && presetOpts.includes(chosen)) ids.push(chosen);
          else if (typeof chosen !== 'string' && presetOpts.length > 0) ids.push(presetOpts[0]);
        }
        if (ids.length > 0) current[gid] = ids; else delete current[gid];

        state.setMultiple({
          tableExpandedChildren: expanded,
          tableRowSelection: allSel,
          activePresets: current,
        });
      });

      // Hover an option → show its preview (preset option → that preset's
      // preview; group tag → that child table group's preview).
      opt.addEventListener('mouseenter', () => {
        clearTimeout(resetTimer);
        const presets = state.get('presets') || [];
        const groups = state.get('groups') || [];
        if (opt.dataset.kind === 'preset') {
          const pid = parseInt(opt.dataset.presetId, 10);
          const p = presets.find(x => x.id === pid);
          if (!p) return;
          const name = p.meta?.name || i18n.t('preset.fallbackName', { id: pid });
          showPreview(name, p.meta?.description || '', p.meta?.previewPath || null,
            p.meta?.previewKind || 'image', p.meta?.previewFrames || null, p.meta?.previewFps || 12, pid);
        } else if (opt.dataset.kind === 'group') {
          const childGid = parseInt(opt.dataset.childGroupId, 10);
          const g = groups.find(x => x.id === childGid);
          if (!g) return;
          showPreview(g.name || '', g.description || '', g.previewPath || null,
            g.previewKind || 'image', g.previewFrames || null, g.previewFps || 12, 'group:' + childGid);
        }
      });
      opt.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimer);
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => resetPreview(), 3000);
      });
    });

    initDividerDrag();

    // Truncated-label tooltips: only row labels that actually overflow their
    // clipped width get a native title with the full name (set via JS so we
    // can detect overflow, rather than unconditionally on every row).
    viewEl.querySelectorAll('.preset-group__table-label[data-full-label]').forEach(el => {
      if (el.scrollWidth > el.clientWidth) {
        el.title = el.dataset.fullLabel;
      } else {
        el.removeAttribute('title');
      }
    });

    // Slide-in animation for newly-appeared rows/items (any element with
    // data-row-key). Plays when a checkbox group is activated, a child sub-group
    // is expanded, OR a plain group is expanded — its child preset rows + sub-
    // group headers are new. Two-phase per element:
    //   1. synchronously add --enter-init → born hidden (opacity 0, shifted left);
    //   2. next rAF swap to --enter → runs the left→right slide+fade.
    const newRowEls = [];
    const currRowKeys = new Set();
    viewEl.querySelectorAll('[data-row-key]').forEach(row => {
      const rk = row.dataset.rowKey;
      currRowKeys.add(rk);
      if (!_prevRowKeys.has(rk)) {
        newRowEls.push(row);
      }
    });
    _prevRowKeys = currRowKeys;
    if (newRowEls.length) {
      newRowEls.forEach((row, i) => {
        row.classList.add('preset-group__enter-init');
        row.style.animationDelay = (i * 40) + 'ms';
      });
      requestAnimationFrame(() => {
        newRowEls.forEach(row => {
          row.classList.remove('preset-group__enter-init');
          row.classList.add('preset-group__enter');
        });
      });
    }

    // Clear after all synchronous renders settle (multiple 'groups' listeners
    // may trigger render in sequence; only clear after the last one).
    setTimeout(() => { _justToggledGid = null; _animDepthBase = 0; }, 0);
    } // end afterRebuild
  }

  // ── Recursive group rendering ──

  function countAllPresets(group, allGroups) {
    let n = 0;
    if (!group.children) return 0;
    for (const c of group.children) {
      if (c.type === 'preset') {
        n++;
      } else if (c.type === 'group') {
        const sub = allGroups.find(g => g.id === c.id);
        if (!sub) continue;
        if (sub.type === 'table') {
          // Multi-select group counts itself (1) + its children recursively.
          n += 1 + countAllPresets(sub, allGroups);
        } else {
          n += countAllPresets(sub, allGroups);
        }
      }
    }
    return n;
  }

  // Table group: header uses the SAME normal group header style; expanded
  // content is a table (rows = sub-groups, click to select preset per row).

  // Collect the flat list of rows for a table group, expansion-aware.
  // Each row: { rowKey, label, depth, options: [{kind:'preset',id} | {kind:'group',id,name}] }
  // When a row has an expanded child-table-group option, that child's rows are
  // spliced in right after (depth+1).
  function collectTableRows(group, allGroups, expandedChildren, depth, pathPrefix) {
    const gid = group.id;
    const prefix = pathPrefix || (gid + ':');
    const expanded = expandedChildren[gid] || new Set();
    const rows = [];
    // Collect direct presets + nested table groups into ONE __direct__ row at the
    // TOP, then emit labeled rows for plain sub-groups (in original order).
    const allDirectOpts = [];
    for (const c of (group.children || [])) {
      if (c.type === 'preset') {
        allDirectOpts.push({ kind: 'preset', id: c.id });
      } else if (c.type === 'group') {
        const g = allGroups.find(x => x.id === c.id);
        if (g && g.type === 'table') {
          allDirectOpts.push({ kind: 'group', id: g.id, name: g.name || '' });
        }
      }
    }
    if (allDirectOpts.length > 0) {
      rows.push({ rowKey: prefix + '__direct__', label: '', depth, options: allDirectOpts });
    }
    // Plain sub-groups → one labeled row each.
    for (const c of (group.children || [])) {
      if (c.type !== 'group') continue;
      const g = allGroups.find(x => x.id === c.id);
      if (!g || g.type === 'table') continue;
      const subOpts = [];
      for (const sc of (g.children || [])) {
        if (sc.type === 'preset') subOpts.push({ kind: 'preset', id: sc.id });
        else if (sc.type === 'group') {
          const sg = allGroups.find(x => x.id === sc.id);
          if (sg && sg.type === 'table') subOpts.push({ kind: 'group', id: sg.id, name: sg.name || '' });
        }
      }
      if (subOpts.length > 0) {
        rows.push({ rowKey: prefix + c.id, label: g.name || '', labelId: c.id, depth, options: subOpts });
      }
    }
    const out = [];
    for (const row of rows) {
      out.push(row);
      for (const opt of row.options) {
        if (opt.kind === 'group' && expanded.has(opt.id)) {
          const childGroup = allGroups.find(g => g.id === opt.id);
          if (childGroup) {
            const childRows = collectTableRows(childGroup, allGroups, expandedChildren, depth + 1, prefix + opt.id + ':');
            for (const cr of childRows) out.push(cr);
          }
        }
      }
    }
    return out;
  }

  // Parse owner table group id from a rowKey path.
  function parseOwnerGid(rowKey, allGroups, defaultGid) {
    const parts = rowKey.split(':');
    for (let i = parts.length - 2; i >= 0; i--) {
      if (parts[i] !== '__direct__' && /^\d+$/.test(parts[i])) {
        const candidate = parseInt(parts[i], 10);
        const cg = allGroups.find(x => x.id === candidate);
        if (cg && cg.type === 'table') return candidate;
      }
    }
    return defaultGid;
  }

  function renderTableGroup(group, allGroups, presetMap, activePresets, depth) {
    const gid = group.id;
    const atg = state.get('activeTableGroups') || {};
    const isActive = !!atg[gid] || (activePresets[gid] && activePresets[gid].length > 0);
    // Selected = expanded, deselected = collapsed.
    const isCollapsed = !isActive;
    const shortcut = group.shortcut || '';
    const inSelect = shortcutSelected.has('group:' + gid);
    const count = countAllPresets(group, allGroups) + 1; // +1 for the group itself
    let html = `<div class="preset-group preset-group--table" style="--depth:${depth}">`;
    html += `<div class="preset-group__header preset-group__item ${isCollapsed ? 'preset-group__header--collapsed' : ''} ${depth > 0 ? 'preset-group__header--nested' : ''} ${isActive ? 'preset-group__item--editing' : ''} ${shortcut ? 'preset-group__item--has-shortcut' : ''} ${inSelect ? 'preset-group__item--shortcut-sel' : ''}"
             data-group-id="${gid}" data-table-toggle="${gid}" data-id="${gid}" data-sel-key="group:${gid}" data-row-key="g:${gid}">
      <span class="preset-radio ${isActive ? 'preset-radio--selected' : ''}" data-group-id="${gid}"></span>
      <span class="preset-group__label">${escapeHtml(group.name)}</span>
      ${count > 0 ? `<span class="preset-group__count">[${count}]</span>` : ''}
      ${shortcut ? `<span class="preset-group__shortcut">${escapeHtml(shortcut)}</span>` : ''}
    </div>`;

    if (!isCollapsed) {
      // Build the flat, expansion-aware row list for this table group.
      const expanded = state.get('tableExpandedChildren') || {};
      const allRowSel = state.get('tableRowSelection') || {};
      const rowSel = { ...(allRowSel[gid] || {}) };
      const rows = collectTableRows(group, allGroups, expanded, 0, null);
      // An empty table group (no presets, no rows) draws no table body.
      if (rows.length === 0) { html += '</div>'; return html; }
      html += '<div class="preset-group__children">';
      html += '<div class="preset-group__table-rows">';
      for (const row of rows) {
        html += `<div class="preset-group__table-row" data-row-key="${escapeHtml(row.rowKey)}" style="margin-left:0">
          <span class="preset-group__table-label"${row.label ? ` data-full-label="${escapeHtml(row.label)}"` : ''}>${escapeHtml(row.label)}</span>
          <div class="preset-group__table-options">`;
        for (const opt of row.options) {
          if (opt.kind === 'preset') {
            const p = presetMap.get(opt.id);
            if (!p) continue;
            const name = p.meta?.name || i18n.t('preset.fallbackName', { id: opt.id });
            const isSelected = rowSel[row.rowKey] === opt.id;
            html += `<span class="preset-group__table-option${isSelected ? ' preset-group__table-option--selected' : ''}"
              data-table-row="${gid}" data-row-key="${escapeHtml(row.rowKey)}" data-kind="preset" data-preset-id="${opt.id}">${escapeHtml(name)}</span>`;
          } else {
            // group-tag option: a nested table group.
            const groupKey = 'group:' + opt.id;
            const ownerGid2 = parseOwnerGid(row.rowKey, allGroups, gid);
            const isExpanded = (expanded[ownerGid2] || new Set()).has(opt.id);
            const isRowSelected = rowSel[row.rowKey] === groupKey;
            html += `<span class="preset-group__table-option preset-group__table-option--group-tag${(isExpanded && isRowSelected) ? ' preset-group__table-option--group-tag--expanded' : ''}"
              data-table-row="${gid}" data-row-key="${escapeHtml(row.rowKey)}" data-kind="group" data-child-group-id="${opt.id}">${escapeHtml(opt.name)}</span>`;
          }
        }
        html += `</div></div>`;
      }
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderGroupTree(group, allGroups, presetMap, activePresets, depth, inAnimSubtree) {
    const isToggled = _justToggledGid === group.id;
    const isAnim = isToggled || !!inAnimSubtree;
    if (isToggled) _animDepthBase = depth;  // record depth when we hit the toggled group
    const isCollapsed = group.collapsed === true;
    const count = countAllPresets(group, allGroups);
    let html = `<div class="preset-group" style="--depth:${depth}">`;
    html += `<div class="preset-group__header ${isCollapsed ? 'preset-group__header--collapsed' : ''} ${depth > 0 ? 'preset-group__header--nested' : ''}" data-group-id="${group.id}" data-row-key="g:${group.id}">
      ${(!isCollapsed) ? `<div class="preset-group__header-underline${isAnim ? ' preset-group__header-underline--anim' : ''}" style="${isAnim ? `animation-delay:${(depth - _animDepthBase) * 80}ms;` : ''}background:linear-gradient(90deg, hsl(${140 + depth * 25}deg,60%,65%), hsl(${160 + depth * 25}deg,60%,45%))"></div>` : ''}
      <span class="preset-tree__collapse-icon">${isCollapsed ? '▶' : '▼'}</span>
      <span class="preset-group__label">${escapeHtml(group.name)}</span>
      ${count > 0 ? `<span class="preset-group__count">[${count}]</span>` : ''}
    </div>`;

    if (!isCollapsed && group.children && group.children.length > 0) {
      html += '<div class="preset-group__children">';
      // Direct presets first
      for (const child of group.children) {
        if (child.type === 'preset') {
          const preset = presetMap.get(child.id);
          if (preset) {
            html += renderPresetRow(preset, activePresets, group.id);
          }
        }
      }
      // Sub-groups after direct presets — pass isAnim as inAnimSubtree so
      // descendants of the toggled group also animate (staggered by depth).
      for (const child of group.children) {
        if (child.type === 'group') {
          const subGroup = allGroups.find(g => g.id === child.id);
          if (subGroup) {
            if (subGroup.type === 'table') {
              html += renderTableGroup(subGroup, allGroups, presetMap, activePresets, depth + 1);
            } else {
              html += renderGroupTree(subGroup, allGroups, presetMap, activePresets, depth + 1, isAnim);
            }
          }
        }
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderPresetRow(preset, activePresets, groupId) {
    const activeArr = Array.isArray(activePresets[groupId]) ? activePresets[groupId] : [];
    const isActive = activeArr.includes(preset.id);
    const name = preset.meta?.name || i18n.t('preset.fallbackName', { id: preset.id });
    const shortcut = preset.meta?.shortcut || '';
    const inSelect = shortcutSelected.has('preset:' + preset.id);
    return `
      <div class="preset-group__item preset-group__item--plain-row ${isActive ? 'preset-group__item--editing' : ''} ${shortcut ? 'preset-group__item--has-shortcut' : ''} ${inSelect ? 'preset-group__item--shortcut-sel' : ''}"
           data-id="${preset.id}"
           data-sel-key="preset:${preset.id}"
           data-group-id="${groupId}"
           data-row-key="p:${groupId}:${preset.id}">
        <span class="preset-radio ${isActive ? 'preset-radio--selected' : ''}"
              data-group-id="${groupId}" data-id="${preset.id}"></span>
        <span class="preset-group__name">${escapeHtml(name)}</span>
        ${shortcut ? `<span class="preset-group__shortcut">${escapeHtml(shortcut)}</span>` : ''}
      </div>
    `;
  }

  // ── Preview panel ──

  // ── Global-shortcut recorder (right-click to collect, release Ctrl to record) ──

  // Keys that must not be bound as a standalone global shortcut (no modifier).
  const FORBIDDEN_BARE_KEYS = new Set(['Escape', ' ', 'Tab', 'Backspace', 'Delete', 'Enter']);
  // Letters, digits, punctuation — too disruptive if bound WITHOUT a modifier
  // (would block them system-wide). Allowed WITH Ctrl/Alt/Shift.
  const COMMON_KEYS = /^[a-zA-Z0-9`~!@#$%^&*()\-_=+\[\]{}\\|;:'",<.>\/?]$/;

  function keyToAccelerator(e) {
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return null;
    const hasModifier = e.ctrlKey || e.altKey;
    if (!hasModifier && FORBIDDEN_BARE_KEYS.has(e.key)) return null;
    // Block bare letters/digits/punctuation (no modifier) — they'd be swallowed system-wide.
    if (!hasModifier && COMMON_KEYS.test(e.key)) return null;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let k = e.key;
    if (e.code && e.code.startsWith('Numpad')) {
      const np = e.code.slice(6);
      k = /^\d$/.test(np) ? 'num' + np : 'num' + np.toLowerCase();
    } else if (k === ' ') k = 'Space';
    else if (k.length === 1) k = k.toUpperCase();
    parts.push(k);
    return parts.join('+');
  }

  function showShortcutRecorder() {
    let rec = document.getElementById('shortcut-recorder');
    if (!rec) {
      rec = document.createElement('div');
      rec.id = 'shortcut-recorder';
      rec.className = 'shortcut-recorder';
      document.body.appendChild(rec);
    }
    const count = shortcutSelected.size;
    const singleKey = count === 1 ? [...shortcutSelected][0] : null;
    const presets = state.get('presets') || [];
    const groups = state.get('groups') || [];
    let existing = '';
    if (singleKey != null) {
      const [type, idStr] = singleKey.split(':');
      const id = parseInt(idStr, 10);
      if (type === 'group') {
        const g = groups.find(g => g.id === id);
        if (g) existing = g.shortcut || '';
      } else {
        const p = presets.find(p => p.id === id);
        if (p) existing = p.meta?.shortcut || '';
      }
    }
    rec.innerHTML = `
      <div class="shortcut-recorder__title">${i18n.t('selector.selectedCount', { count })}</div>
      <div class="shortcut-recorder__hint">${recorderActive ? i18n.t('selector.recordHint') : i18n.t('selector.recordTitle')}</div>
      ${existing ? `<div class="shortcut-recorder__current">${i18n.t('selector.current', { acc: escapeHtml(existing) })}</div>` : ''}
      <div class="shortcut-recorder__actions">
        ${count >= 1 ? `<button class="btn btn--danger btn--sm" id="shortcut-clear">${i18n.t('selector.clearShortcut')}</button>` : ''}
        <button class="btn btn--secondary btn--sm" id="shortcut-cancel">${i18n.t('dialog.cancel')}</button>
      </div>
    `;
    rec.style.display = 'flex';
    const cancelBtn = rec.querySelector('#shortcut-cancel');
    if (cancelBtn) cancelBtn.onclick = () => cancelRecording();
    const clearBtn = rec.querySelector('#shortcut-clear');
    if (clearBtn) clearBtn.onclick = () => clearShortcuts();
  }

  function hideShortcutRecorder() {
    const rec = document.getElementById('shortcut-recorder');
    if (rec) rec.style.display = 'none';
  }

  function startRecording() {
    recorderActive = true;
    // Temporarily unregister Tauri global shortcuts so the recorded combo
    // isn't swallowed at the OS layer before the frontend keydown sees it.
    // (Program shortcuts are suppressed separately, in app.js, while the
    // recorder DOM element is visible.)
    try { api.reloadGlobalShortcuts(null); } catch (e) { /* best-effort */ }
    showShortcutRecorder();
  }

  function cancelRecording() {
    recorderActive = false;
    // Re-register Tauri global shortcuts for the current skin.
    const skin = state.get('selectedSkin');
    if (skin) { try { api.reloadGlobalShortcuts(skin); } catch (e) { /* best-effort */ } }
    shortcutSelected = new Set();
    hideShortcutRecorder();
    render();
  }

  async function bindShortcut(accelerator) {
    const skin = state.get('selectedSkin');
    if (!skin) { cancelRecording(); return; }
    const ids = [...shortcutSelected];
    // Pre-check: conflict with custom program shortcuts → don't bind, just warn.
    const appShortcuts = (window.Shortcuts && window.Shortcuts.getAll) ? window.Shortcuts.getAll() : [];
    const appKeys = new Set(appShortcuts.map(s => s.key).filter(Boolean));
    if (appKeys.has(accelerator)) {
      // Conflict with a program shortcut: warn but KEEP recording so the user
      // can try a different combo. Do NOT cancelRecording (that would close
      // the recorder and re-enable program shortcuts mid-press).
      Toast.warning(i18n.t('selector.shortcutConflict'));
      return;
    }
    recorderActive = false;
    // Suppress render so the fadeout animation isn't interrupted by a DOM rebuild.
    _suppressRender = true;
    // Locate the target rows by selection key (type+id) so a preset and a
    // group sharing the same numeric id don't both match.
    const selEls = ids.map(k => viewEl.querySelector(`.preset-group__item[data-sel-key="${CSS.escape(k)}"]`)).filter(Boolean);
    // Hide the recorder + add badge + start the gradient fadeout IMMEDIATELY, in
    // sync with the animation — don't wait for the async bind IPC to complete.
    hideShortcutRecorder();
    selEls.forEach(el => {
      el.classList.add('preset-group__item--gradient-out', 'preset-group__item--has-shortcut');
      // Remove any stale badge text first, then (re)create it with the new accel.
      const old = el.querySelector('.preset-group__shortcut');
      if (old) old.remove();
      const badge = document.createElement('span');
      badge.className = 'preset-group__shortcut';
      badge.textContent = accelerator;
      el.appendChild(badge);
    });
    // Run the bind + persistence + reload in the background.
    const presetIds = ids.filter(k => k.startsWith('preset:')).map(k => parseInt(k.split(':')[1], 10));
    const groupIds = ids.filter(k => k.startsWith('group:')).map(k => parseInt(k.split(':')[1], 10));
    (async () => {
      try {
        if (presetIds.length > 0) {
          const bindResult = await api.bindGlobalShortcut(skin, presetIds, accelerator);
          if (!bindResult.success) { Toast.error(bindResult.error || i18n.t('selector.bindFailed')); }
        }
        if (groupIds.length > 0) {
          for (const gid of groupIds) {
            await window.__TAURI__.core.invoke('groups_set_shortcut', { skinName: skin, groupId: gid, shortcut: accelerator });
          }
        }
        Toast.success(i18n.t('selector.bound', { acc: accelerator, count: ids.length }));
        const scan = await api.scanPresets(skin);
        if (scan.success) {
          state.set('presets', scan.data.presets);
          state.set('groups', scan.data.groups);
        }
        await api.reloadGlobalShortcuts(skin);
      } catch (e) {
        Toast.error(e.message || i18n.t('selector.bindFailed'));
      }
    })();
    // Let the fadeout animation finish, then re-enable render and clean up.
    setTimeout(() => { _suppressRender = false; cancelRecording(); }, 400);
  }

  async function clearShortcuts() {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const ids = [...shortcutSelected];
    // Suppress render during fadeout so DOM isn't replaced mid-animation.
    _suppressRender = true;
    // Hide the recorder immediately, in sync with the fadeout below.
    hideShortcutRecorder();
    // Visually fade out badge + bar immediately (before the async IPC + render).
    ids.forEach(pid => {
      const el = viewEl.querySelector(`.preset-group__item[data-sel-key="${CSS.escape(pid)}"]`);
      if (el) {
        el.classList.add('preset-group__item--shortcut-fadeout');
        const badge = el.querySelector('.preset-group__shortcut');
        if (badge) badge.style.transition = 'opacity 0.4s ease';
      }
    });
    try {
      const presetIds = ids.filter(k => k.startsWith('preset:')).map(k => parseInt(k.split(':')[1], 10));
      const groupIds = ids.filter(k => k.startsWith('group:')).map(k => parseInt(k.split(':')[1], 10));
      if (presetIds.length > 0) await api.unbindGlobalShortcut(skin, presetIds);
      for (const gid of groupIds) {
        await window.__TAURI__.core.invoke('groups_set_shortcut', { skinName: skin, groupId: gid, shortcut: '' });
      }
      Toast.success(i18n.t('selector.cleared'));
      const scan = await api.scanPresets(skin);
      if (scan.success) {
          state.set('presets', scan.data.presets);
          state.set('groups', scan.data.groups);
        }
      await api.reloadGlobalShortcuts(skin);
    } catch (e) {
      Toast.error(e.message || i18n.t('selector.clearFailed'));
    }
    // Clear: fade out gradient + bar + badge, then re-render.
    setTimeout(() => { _suppressRender = false; cancelRecording(); }, 400);
  }

  // Fade out the gradient on selected items before re-render removes them.
  function fadeOutAndCancel() {
    const items = document.querySelectorAll('.preset-group__item--shortcut-sel:not(.preset-group__item--shortcut-fadeout)');
    if (items.length > 0) {
      items.forEach(el => el.classList.add('preset-group__item--shortcut-fadeout'));
      setTimeout(() => { _suppressRender = false; cancelRecording(); }, 400);
    } else {
      cancelRecording();
    }
  }

  // Global keydown: capture the combo while recording; Esc cancels; Tab/Space/Enter pass through for buttons
  if (!window._shortcutRecordBound) {
    window._shortcutRecordBound = true;
    document.addEventListener('keydown', (e) => {
      if (!recorderActive) return;
      // Tab: trap inside the recorder; if focus isn't in yet, enter at the first button (Clear)
      if (e.key === 'Tab') {
        const rec = document.getElementById('shortcut-recorder');
        const btns = rec ? [...rec.querySelectorAll('button')] : [];
        if (btns.length === 0) return;
        if (!rec.contains(document.activeElement)) {
          e.preventDefault();
          btns[0].focus();   // first = Clear (leftmost)
          return;
        }
        e.preventDefault();
        const idx = btns.indexOf(document.activeElement);
        const next = e.shiftKey ? (idx <= 0 ? btns.length - 1 : idx - 1) : (idx >= btns.length - 1 ? 0 : idx + 1);
        btns[next].focus();
        return;
      }
      // Space / Enter: let buttons activate natively
      if (e.key === ' ' || e.key === 'Enter') return;
      if (e.key === 'Escape') { e.preventDefault(); cancelRecording(); return; }
      const acc = keyToAccelerator(e);
      if (acc) {
        e.preventDefault();
        bindShortcut(acc);
      } else {
        // Bare modifier / forbidden key — swallow silently (Ctrl/Shift/Alt
        // alone are used to multi-select while the recorder is open).
        e.preventDefault();
      }
    });
  }

  // Click outside the recorder while recording → only right-click is handled
  // (for multi-select). Left-click outside does NOT cancel — use Esc or Cancel.
  if (!window._shortcutOutsideBound) {
    window._shortcutOutsideBound = true;
  }

  // Preload all preset preview images into the cache (fire-and-forget).
  // Subsequent hovers render instantly from the cache instead of awaiting IPC.
  function preloadPreviews(presets) {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    // Invalidate cache when skin changes
    if (previewCache.__skin !== skin) {
      previewCache = { __skin: skin };
      lastPreviewId = null;
    }
    // Resolve skin path once for resolving relative preview paths.
    api.getSkinPath(skin).then(spResult => {
      const skPath = spResult.success ? spResult.data.replace(/\\/g, '/') : '';
      const loadRel = (relPath) => {
        if (relPath && previewCache[relPath] === undefined) {
          previewCache[relPath] = null; // mark as loading
          const absPath = skPath ? skPath + '/' + relPath : relPath;
          api.getPreviewDataUrl(absPath).then(result => {
            previewCache[relPath] = result?.success ? result.data : false;
          });
        }
      };
      for (const p of presets) {
        const relPath = p.meta?.previewPath;
        // Key by relPath (not p.id): ids get compacted on delete, but the
        // preview path travels with the preset, so the cache stays correct.
        loadRel(relPath);
      }
      // Also preload group previews (table/normal groups can have previewPath).
      for (const g of (state.get('groups') || [])) {
        loadRel(g.previewPath);
      }
    });
  }

  function renderPreviewContent(presetName, description, mediaHtml) {
    const panel = document.getElementById('preset-preview-panel');
    if (!panel) return;
    panel.innerHTML = `
      <div class="preset-preview-panel__name">${escapeHtml(presetName)}</div>
      ${description ? `<div class="preset-preview-panel__desc">${escapeHtml(description)}</div>` : ''}
      <div class="preset-preview-panel__image-wrap">
        ${mediaHtml || `<div class="preset-preview-panel__no-image">${i18n.t('selector.noPreview')}</div>`}
      </div>
    `;
    panel.classList.remove('preset-preview-panel--fade');
    void panel.offsetWidth;
    panel.classList.add('preset-preview-panel--fade');
  }

  // Sequence frame-loop timer for the hover panel.
  let panelSeqTimer = null;
  // Token to abort stale async loads when the hovered preset changes.
  let hoverToken = 0;
  function stopPanelSequence() {
    if (panelSeqTimer) { clearInterval(panelSeqTimer); panelSeqTimer = null; }
  }

  let lastPreviewId = null;
  function showPreview(presetName, description, previewPath, previewKind, previewFrames, previewFps, presetId) {
    // Skip if the same target is already shown — avoids replaying the fade-in
    // when a re-render re-triggers mouseenter on the still-hovered element.
    if (lastPreviewId === presetId) return;
    lastPreviewId = presetId;
    stopPanelSequence();
    const myToken = ++hoverToken;
    const kind = previewKind || 'image';

    if (!previewPath) {
      renderPreviewContent(presetName, description, null);
      return;
    }

    // Image sequence: cycle frames.
    if (kind === 'sequence' && Array.isArray(previewFrames) && previewFrames.length) {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(async () => {
        const skin = state.get('selectedSkin');
        const sp = skin ? await api.getSkinPath(skin) : null;
        const skPath = sp && sp.success ? sp.data.replace(/\\/g, '/') : '';
        const ck = (f) => 'seq:' + f;
        const load1 = (f) => {
          if (previewCache[ck(f)]) return Promise.resolve(previewCache[ck(f)]);
          const abs = skPath ? skPath + '/' + f : f;
          return api.getPreviewDataUrl(abs).then(r => {
            if (r?.success && r.data) { previewCache[ck(f)] = r.data; return r.data; }
            return null;
          });
        };
        // Show the first frame ASAP (feels instant), then load the rest.
        const first = await load1(previewFrames[0]);
        if (myToken !== hoverToken) return;
        if (!first) { renderPreviewContent(presetName, description, null); return; }
        renderPreviewContent(presetName, description,
          `<img src="${first}" class="preset-preview-panel__image" alt="${i18n.t('selector.noPreview')}">`);
        // Load remaining frames in the background; start cycling once ready.
        Promise.all(previewFrames.slice(1).map(load1)).then(rest => {
          if (myToken !== hoverToken) return;
          const urls = [first, ...rest].filter(Boolean);
          if (urls.length < 2) return;
          let idx = 0;
          const fps = +previewFps || 12;
          const interval = fps === -1 ? 1000 / urls.length : 1000 / Math.max(1, fps);
          panelSeqTimer = setInterval(() => {
            idx = (idx + 1) % urls.length;
            const img = document.querySelector('.preset-preview-panel__image');
            if (img && img.tagName === 'IMG') img.src = urls[idx];
            else stopPanelSequence();
          }, interval);
        });
      }, 100);
      return;
    }

    // Single image / animated image (cached by path). previewCache[path]===false
    // means we already tried and the file is missing.
    const missingHtml = `<div class="preset-preview-panel__no-image">${i18n.t('selector.previewMissing')}</div>`;
    const cached = previewCache[previewPath];
    if (cached) { renderPreviewContent(presetName, description, `<img src="${cached}" class="preset-preview-panel__image" alt="${i18n.t('selector.noPreview')}">`); return; }
    if (cached === false) { renderPreviewContent(presetName, description, missingHtml); return; }
    renderPreviewContent(presetName, description, null);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(async () => {
      if (myToken !== hoverToken) return;   // superseded by a newer hover
      const skin = state.get('selectedSkin');
      const spResult = skin ? await api.getSkinPath(skin) : null;
      const skPath = spResult && spResult.success ? spResult.data.replace(/\\/g, '/') : '';
      const absPath = skPath ? skPath + '/' + previewPath : previewPath;
      const result = await api.getPreviewDataUrl(absPath);
      if (myToken !== hoverToken) return;   // check again after the await
      if (result?.success && result.data) {
        previewCache[previewPath] = result.data;
        if (!document.getElementById('preset-preview-panel')) return;
        renderPreviewContent(presetName, description, `<img src="${result.data}" class="preset-preview-panel__image" alt="${i18n.t('selector.noPreview')}">`);
      } else {
        // File missing — cache as false and show the missing message.
        previewCache[previewPath] = false;
        if (document.getElementById('preset-preview-panel')) {
          renderPreviewContent(presetName, description, missingHtml);
        }
      }
    }, 200);
  }

  function resetPreview() {
    stopPanelSequence();
    lastPreviewId = null;
    const panel = document.getElementById('preset-preview-panel');
    if (panel) {
      panel.innerHTML = emptyPreviewHtml();
      panel.classList.remove('preset-preview-panel--fade');
      void panel.offsetWidth;
      panel.classList.add('preset-preview-panel--fade');
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ── Divider drag ──

  function initDividerDrag() {
    const divider = document.getElementById('preset-divider');
    const body = document.querySelector('.preset-selector__body');
    const panel = document.getElementById('preset-preview-panel');
    const list = document.querySelector('.preset-selector__list');
    if (!divider || !body || !panel || !list) return;

    let dragging = false;

    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      divider.classList.add('preset-selector__divider--active');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const bodyRect = body.getBoundingClientRect();
      const bodyW = bodyRect.width || 1;
      // Preview panel = fraction of body width (clamped 20%–70%).
      const frac = (bodyRect.right - e.clientX) / bodyW;
      const clamped = Math.max(0.2, Math.min(0.7, frac));
      panel.style.flex = `0 0 ${(clamped * 100).toFixed(1)}%`;
      list.style.flex = '1';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      divider.classList.remove('preset-selector__divider--active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // ── State listeners ──

  // presets/groups/rootChildren are usually set together (setMultiple), so
  // collapse their renders into ONE microtask to avoid 3× rebuilds (which can
  // re-trigger row enter animations / empty-state flashes).
  let _dataRenderQueued = false;
  const queueDataRender = () => {
    if (_dataRenderQueued) return;
    _dataRenderQueued = true;
    queueMicrotask(() => { _dataRenderQueued = false; render(); });
  };
  state.on('presets', queueDataRender);
  state.on('groups', queueDataRender);
  state.on('rootChildren', queueDataRender);
  // On skin change, just reset the row-animation diff state; the actual
  // render happens when the new presets/groups arrive (queueDataRender). This
  // avoids a flash of empty/wrong content rendered with the OLD skin's data
  // before the new scan completes.
  state.on('selectedSkin', () => { _prevRowKeys = new Set(); });
  state.on('appMode', (mode) => { if (mode === 'use') render(); });
  state.on('activePresets', () => render());

  // Persist table UI state to config.osp (debounced).
  let _tableStateSaveTimer = null;
  function saveTableState() {
    if (_tableStateSaveTimer) clearTimeout(_tableStateSaveTimer);
    _tableStateSaveTimer = setTimeout(() => {
      const skin = state.get('selectedSkin');
      if (!skin) return;
      const expanded = state.get('tableExpandedChildren') || {};
      const expandedPlain = {};
      for (const [k, v] of Object.entries(expanded)) {
        if (v instanceof Set) expandedPlain[k] = [...v];
        else if (Array.isArray(v)) expandedPlain[k] = v;
        else expandedPlain[k] = [];
      }
      const rowSel = state.get('tableRowSelection') || {};
      api.setTableState(skin, expandedPlain, rowSel).catch(() => {});
    }, 500);
  }
  state.on('tableExpandedChildren', saveTableState);
  state.on('tableRowSelection', saveTableState);
  // tableExpandedChildren / tableRowSelection changes are always followed by an
  // explicit render() (or an activePresets change which re-renders), so they
  // don't need their own listeners — that would only multiply renders.
  // NOTE: 'groups' already has its render listener above; do NOT add a second
  // one — a duplicate causes two renders per groups change, and the second
  // rebuild discards the first render's just-added animation elements before
  // their rAF animation class is applied (no animation ever plays).

  async function toggleCollapse(groupId) {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const numericId = parseInt(groupId, 10);
    const groups = state.get('groups') || [];
    const group = groups.find(g => g.id === numericId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    await api.setGroupCollapsed(skin, numericId, group.collapsed);
    _justToggledGid = numericId;
    _animDepthBase = 0;  // top-level toggle; children will animate by their depth
    state.set('groups', [...groups]);
  }

  // Shift+click: toggle this group AND every descendant group to the same state.
  async function toggleCollapseRecursive(groupId) {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const groups = state.get('groups') || [];
    const byId = new Map(groups.map(g => [g.id, g]));
    const root = byId.get(parseInt(groupId, 10));
    if (!root) return;
    const target = !root.collapsed;
    // Collect ids of the root + all descendant groups.
    const ids = [];
    const collect = (g) => {
      ids.push(g.id);
      if (!g.children) return;
      for (const c of g.children) {
        if (c.type === 'group') {
          const sub = byId.get(c.id);
          if (sub) collect(sub);
        }
      }
    };
    collect(root);
    const idSet = new Set(ids);
    // Update local state first so the UI re-renders immediately, then persist
    // in one batched call (avoiding per-group IPC + file read/write stalls).
    for (const g of groups) if (idSet.has(g.id)) g.collapsed = target;
    _justToggledGid = root.id;
    _animDepthBase = 0;
    state.set('groups', [...groups]);
    await api.setGroupsCollapsedBatch(skin, ids, target);
  }

  // Collect apply units for a checkbox (table) group, mirroring the backend
  // apply_group recursion: the group itself (1) + each visible row's selected
  // item — a preset id (1) or a child table group (recurse). Uses the SAME
  // collectTableRows as the renderer so rowKeys match tableRowSelection exactly.
  // Returns { presetIds: Set, groupIds: Set }.
  function collectApplyUnits(rootGid) {
    const groups = state.get('groups') || [];
    const byId = new Map(groups.map(g => [g.id, g]));
    const expanded = state.get('tableExpandedChildren') || {};
    const allSel = state.get('tableRowSelection') || {};
    const presetIds = new Set();
    const groupIds = new Set();
    const rec = (gid) => {
      if (groupIds.has(gid)) return; // cycle guard
      groupIds.add(gid);
      const g = byId.get(gid);
      if (!g) return;
      const sel = allSel[gid] || {};
      const rows = collectTableRows(g, groups, expanded, 0, null);
      for (const row of rows) {
        const chosen = sel[row.rowKey];
        if (typeof chosen === 'number') presetIds.add(chosen);
        else if (typeof chosen === 'string' && chosen.startsWith('group:')) rec(parseInt(chosen.slice(6), 10));
      }
    };
    rec(rootGid);
    return { presetIds, groupIds };
  }

  window.PresetSelector = { render, invalidateCache: () => { previewCache = {}; }, collectApplyUnits };
})();
