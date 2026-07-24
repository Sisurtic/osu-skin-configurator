// Preset list sidebar — tree view for edit mode with nesting, collapse, drag-drop
(function () {
  const listEl = document.getElementById('preset-list');
  const countEl = document.getElementById('preset-count');
  const sectionEl = document.getElementById('preset-section');


  // Drag state
  let dragPresetIds = null;     // number[] — preset ids being dragged
  let dragGroupId = null;       // number — primary group id being dragged (for payload/guards)
  let dragSourceGroupId = null; // number — source group for preset drag

  // Multi-select state lives in window.Selection (selection.js).
  // This module reads it via Selection.presetIds()/groupIds() and mutates via
  // Selection.toggle()/setSingle()/setRangeFromAnchor()/clear().

  function render(presets, selectedPreset, selectedSkin) {
    const appMode = state.get('appMode');

    if (appMode === 'use') {
      sectionEl.style.display = 'none';
      return;
    }

    if (!selectedSkin) {
      sectionEl.style.display = 'none';
      return;
    }
    sectionEl.style.display = 'flex';

    presets = presets || [];
    const groups = state.get('groups') || [];
    const rootChildren = state.get('rootChildren') || [];
    // Count presets + table-type groups (same algorithm as skin_scanner.rs).
    const tableGroupCount = groups.filter(g => g.type === 'table').length;
    const totalCount = presets.length + tableGroupCount;
    countEl.textContent = totalCount > 0 ? totalCount : '';
    countEl.style.display = totalCount > 0 ? '' : 'none';
    // cntGroupMap still used by render logic below (collectPresets, renderGroupNode).
    const cntGroupMap = new Map(groups.map(g => [g.id, g]));

    if (presets.length === 0 && groups.length === 0) {
      const isCreatingNew = selectedPreset === '__new__';
      if (isCreatingNew) {
        listEl.innerHTML = '';
        buildBottomActions();
        return;
      }
      listEl.innerHTML = `
        <div class="empty-state" style="padding:16px">
          <div class="empty-state__desc" style="font-size:12px">${i18n.t('preset.none')}</div>
        </div>
      `;
      buildBottomActions();
      return;
    }

    // Build a flat lookup map for presets and groups
    const presetMap = new Map(presets.map(p => [p.id, p]));
    const groupMap = new Map(groups.map(g => [g.id, g]));

    // Collect presets recursively from all groups (including nested sub-groups)
    const treePresets = new Set();
    function collectPresets(children) {
      if (!children) return;
      for (const c of children) {
        if (c.type === 'preset') {
          treePresets.add(c.id);
        } else if (c.type === 'group') {
          const subGroup = cntGroupMap.get(c.id);
          if (subGroup) collectPresets(subGroup.children);
        }
      }
    }
    for (const g of groups) collectPresets(g.children);
    const orphanPresets = presets.filter(p => !treePresets.has(p.id));

    // Unified root: render presets + groups interleaved per rootChildren order.
    // Orphans (presets/groups at root but missing from rootChildren) are appended.
    const seenPreset = new Set();
    const seenGroup = new Set();
    let html = '';
    for (const c of rootChildren) {
      if (c.type === 'preset') {
        const p = presetMap.get(c.id);
        if (p) { html += renderPresetNode(p, selectedPreset, 0); seenPreset.add(c.id); }
      } else if (c.type === 'group') {
        const g = cntGroupMap.get(c.id);
        if (g) { html += renderGroupNode(g, groups, presetMap, selectedPreset, 0); seenGroup.add(c.id); }
      }
    }
    // Orphan presets not referenced anywhere (not in a group, not in rootChildren).
    for (const p of orphanPresets) {
      if (!seenPreset.has(p.id)) html += renderPresetNode(p, selectedPreset, 0);
    }
    // Orphan root groups not in rootChildren and not a child of another group.
    for (const g of groups) {
      if (seenGroup.has(g.id)) continue;
      let isChild = false;
      for (const pg of groups) {
        if (pg.children && pg.children.some(c => c.type === 'group' && c.id === g.id)) { isChild = true; break; }
      }
      if (!isChild) html += renderGroupNode(g, groups, presetMap, selectedPreset, 0);
    }

    const savedScrollLeft = listEl.scrollLeft;
    listEl.innerHTML = `<div class="preset-tree">${html}</div>`;

    // Suppress hover flash: after a DOM rebuild the element under the cursor
    // instantly matches :hover, and any transition (label color, background)
    // plays = visible flash. Disable transitions on every element for two frames
    // so the :hover state applies without animating.
    listEl.querySelectorAll('*').forEach(el => { el.style.transition = 'none'; });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      listEl.querySelectorAll('*').forEach(el => { el.style.transition = ''; });
    }));

    // Horizontal scroll: compute maxIndent first, set tree width, THEN clamp
    // scrollLeft (order matters — width change can alter scrollLeft).
    const treeEl = listEl.querySelector('.preset-tree');
    let maxIndent = 0;
    listEl.querySelectorAll('.preset-tree__group-header, .preset-tree__item').forEach(el => {
      const ml = parseInt(el.style.marginLeft, 10) || 0;
      if (ml > maxIndent) maxIndent = ml;
    });
    if (treeEl) {
      treeEl.style.width = (listEl.clientWidth + maxIndent) + 'px';
    }
    // Restore scrollLeft AFTER width is set (width change may reset scrollLeft).
    // Clamp to the new maxIndent in case the tree is narrower than before.
    listEl.scrollLeft = Math.min(savedScrollLeft, maxIndent);
    if (listEl._ospClamp) listEl.removeEventListener('scroll', listEl._ospClamp);
    listEl._ospClamp = () => {
      if (listEl.scrollLeft > maxIndent) listEl.scrollLeft = maxIndent;
    };
    listEl.addEventListener('scroll', listEl._ospClamp, { passive: true });

    // Build bottom actions
    buildBottomActions();

    // ── Bind: preset click (select, multi-select) ──
    listEl.querySelectorAll('.preset-tree__item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(item.dataset.id, 10);
        // Entering or extending a multi-select (Ctrl/Shift) may discard unsaved
        // edits to the currently-edited item — prompt first; cancel aborts.
        if ((e.ctrlKey || e.metaKey || e.shiftKey) && !await confirmSwitchIfDirty()) return;
        if (e.ctrlKey || e.metaKey) {
          if (state.get('selectedGroup') != null) state.set('selectedGroup', null);
          Selection.toggle('preset', id);
        } else if (e.shiftKey && Selection.anchorKey() != null) {
          if (state.get('selectedGroup') != null) state.set('selectedGroup', null);
          Selection.setRangeFromAnchor('preset', id, e.ctrlKey || e.metaKey);
        } else {
          if (!await confirmSwitchIfDirty()) return;
          // Plain click → single-select this preset (open editor).
          Selection.setSingle('preset', id);
          state.setMultiple({ selectedPreset: id, selectedGroup: null, multiSelectActive: false });
          return;
        }
        refreshAllHighlights();
      });
    });

    updateMultiSelectHighlights();
    updateMultiSelectedGroupHighlights();
    updateGroupSelectionHighlights();

    // Truncation-aware tooltip: only show a title tooltip on a name span when
    // the name is actually clipped (scrollWidth > clientWidth). Applies to both
    // preset rows and group headers.
    listEl.querySelectorAll('.preset-tree__item-name, .preset-tree__group-name').forEach(el => {
      el.addEventListener('mouseenter', () => {
        el.title = el.scrollWidth > el.clientWidth ? el.textContent : '';
      });
    });

    // ── Bind: collapse icon click → toggle collapse ──
    listEl.querySelectorAll('.preset-tree__collapse-icon').forEach(icon => {
      icon.addEventListener('click', (e) => {
        e.stopPropagation();
        const header = icon.closest('.preset-tree__group-header');
        const groupId = parseInt(header.dataset.groupId, 10);
        if (e.shiftKey) {
          toggleGroupCollapseRecursive(groupId);
        } else {
          toggleGroupCollapse(groupId);
        }
      });
    });

    // ── Bind: group header background click → select group ──
    // The whole header row is the selection target (covers full background like
    // preset rows). The collapse-icon has its own handler with stopPropagation,
    // so clicking the arrow toggles collapse without selecting.
    listEl.querySelectorAll('.preset-tree__group-header').forEach(header => {
      header.addEventListener('click', async (e) => {
        const groupId = parseInt(header.dataset.groupId, 10);
        // Dirty guard: entering ANY new selection may discard unsaved edits.
        if (!await confirmSwitchIfDirty()) return;
        if (e.ctrlKey || e.metaKey) {
          Selection.toggle('group', groupId);
        } else if (e.shiftKey && Selection.anchorKey() != null) {
          Selection.setRangeFromAnchor('group', groupId, e.ctrlKey || e.metaKey);
        } else {
          // Plain click → single-select this group.
          Selection.setSingle('group', groupId);
        }
        refreshAllHighlights();
        // If exactly one item is selected overall, open it in the editor.
        // Else (multi) keep selectedGroup null so the editor disables tabs.
        if (!Selection.isActive() && Selection.groupIds().length === 1) {
          const only = Selection.groupIds()[0];
          state.setMultiple({ selectedPreset: null, selectedGroup: only, presetDirty: false, multiSelectActive: false });
        } else {
          state.setMultiple({ selectedPreset: null, selectedGroup: null, multiSelectActive: Selection.isActive() });
        }
        updateGroupSelectionHighlights();
      });
    });

    // ── Bind: unified drag & drop ──
    // One delegated system for BOTH preset and group drag. Uses reorderChildren
    // (atomic full-order API) for reorder moves, sidestepping all same-parent
    // index-adjustment bugs. Zone model: upper 40% = before, lower 40% = after,
    // middle 20% = nest (group headers only).


    // Per-item dragstart/dragend (set drag state + dragging class)
    listEl.querySelectorAll('.preset-tree__item').forEach(item => {
      item.setAttribute('draggable', 'true');
      item.addEventListener('dragstart', (e) => {
        const id = parseInt(item.dataset.id, 10);
        const parentGroup = item.closest('.preset-tree__group');
        dragSourceGroupId = parentGroup ? parseInt(parentGroup.dataset.groupId, 10) : null;
        dragPresetIds = Selection.beginDragPresetIds(id);
        listEl.querySelectorAll('.preset-tree__item').forEach(el => {
          if (dragPresetIds.includes(parseInt(el.dataset.id, 10))) el.classList.add('preset-tree__item--dragging');
        });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'preset:' + dragPresetIds.join(','));
      });
      item.addEventListener('dragend', () => {
        listEl.querySelectorAll('.preset-tree__item--dragging').forEach(el => el.classList.remove('preset-tree__item--dragging'));
        dragPresetIds = null;
        dragSourceGroupId = null;
        clearDropLineClasses();
        clearNestHighlights();
      });
    });

    // Per-header dragstart/dragend
    listEl.querySelectorAll('.preset-tree__group-header').forEach(header => {
      header.setAttribute('draggable', 'true');
      header.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'INPUT' || header.querySelector('input')) { e.preventDefault(); return; }
        if (dragPresetIds) { e.preventDefault(); return; }
        dragGroupId = parseInt(header.dataset.groupId, 10);
        header.classList.add('preset-tree__group-header--dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'group:' + dragGroupId);
      });
      header.addEventListener('dragend', () => {
        header.classList.remove('preset-tree__group-header--dragging');
        dragGroupId = null;
        clearDropLineClasses();
        clearNestHighlights();
      });
    });

    function clearNestHighlights() {
      if (_curNestGroup) {
        _curNestGroup.style.removeProperty('--drop-indent');
        _curNestGroup.style.removeProperty('--drop-right');
        _curNestGroup.classList.remove('preset-tree__group--drop-target');
        _curNestGroup = null;
      }
    }

    // On horizontal scroll, update the nest highlight's --drop-indent so the
    // left edge stays locked at the viewport left (like the header's sticky).
    if (!listEl._nestScrollBound) {
      listEl._nestScrollBound = true;
      listEl.addEventListener('scroll', () => {
        if (!_curNestGroup) return;
        const hdr = _curNestGroup.querySelector(':scope > .preset-tree__group-header');
        if (!hdr) return;
        const containerRect = _curNestGroup.getBoundingClientRect();
        const headerRect = hdr.getBoundingClientRect();
        _curNestGroup.style.setProperty('--drop-indent', (headerRect.left - containerRect.left) + 'px');
        _curNestGroup.style.setProperty('--drop-right', (containerRect.right - headerRect.right) + 'px');
      }, { passive: true });
    }

    // Resolve the SIBLING list (parent's children) for a given row element.
    // For a preset item: its parent group (or root).
    // For a group header: go UP one more level (past the group's own .preset-tree__group
    //   container to find the GRANDPARENT that holds the group as a child).
    function getParentChildren(el) {
      // For group headers, skip past their own .preset-tree__group wrapper.
      let groupEl = el.closest('.preset-tree__group');
      if (el.classList.contains('preset-tree__group-header') && groupEl) {
        // groupEl is the group's own container; go to its parent group (or root).
        groupEl = groupEl.parentElement.closest('.preset-tree__group');
      }
      if (groupEl) {
        const gid = parseInt(groupEl.dataset.groupId, 10);
        const groups = state.get('groups') || [];
        const g = groups.find(x => x.id === gid);
        return { parentId: gid, children: (g && g.children) ? [...g.children] : [] };
      }
      return { parentId: null, children: [...(state.get('rootChildren') || [])] };
    }

    // Find the closest droppable row element (preset item or group header).
    function getDropRow(target) {
      return target.closest('.preset-tree__item, .preset-tree__group-header');
    }

    // Track the current drop target to avoid redundant DOM writes each frame.
    let _curNestGroup = null;
    let _curDropRow = null;

    function clearDropLineClasses() {
      if (_curDropRow) {
        _curDropRow.classList.remove('preset-tree__drop-before', 'preset-tree__drop-after');
        _curDropRow = null;
      }
    }

    // Delegated dragover/drop on listEl — bound ONCE (guarded) to avoid
    // accumulating duplicate listeners across re-renders.
    if (!listEl._dragDelegated) {
      listEl._dragDelegated = true;

    listEl.addEventListener('dragover', (e) => {
      if (!dragPresetIds && !dragGroupId) return;
      const row = getDropRow(e.target);

      // Clear previous nest highlight if moving to a different target
      if (_curNestGroup && (!row || !row.closest('.preset-tree__group') || row.closest('.preset-tree__group') !== _curNestGroup)) {
        _curNestGroup.style.removeProperty('--drop-indent');
        _curNestGroup.classList.remove('preset-tree__group--drop-target');
        _curNestGroup = null;
      }

      if (!row) {
        clearDropLineClasses();
        return; // blank space → root drop handler takes over
      }

      const r = row.getBoundingClientRect();
      const y = e.clientY - r.top;
      const h = r.height;
      const isGroupHeader = row.classList.contains('preset-tree__group-header');

      // Zone: upper 25% = before, lower 25% = after, middle 50% = nest (groups only)
      const before = y < h * 0.25;
      const after = y > h * 0.75;
      const nest = !before && !after && isGroupHeader;

      // For group drag: block dropping onto self or descendant
      if (dragGroupId) {
        if (isGroupHeader) {
          const targetGid = parseInt(row.dataset.groupId, 10);
          const groups = state.get('groups') || [];
          if (targetGid === dragGroupId || isDescendantOfGroup(groups, dragGroupId, targetGid)) {
            if (!nest) { clearDropLineClasses(); return; }
          }
        }
      }

      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';

      // Auto-scroll near edges — widen the native trigger zone for sensitivity.
      const lr = listEl.getBoundingClientRect();
      const edgeZone = 50;
      const speed = 0.05;
      const relY = e.clientY - lr.top;
      if (relY < edgeZone) {
        listEl.scrollTop -= Math.max(2, (edgeZone - relY) * speed);
      } else if (relY > lr.height - edgeZone) {
        listEl.scrollTop += Math.max(2, (relY - (lr.height - edgeZone)) * speed);
      }

      if (nest) {
        // Show nest highlight on the group (hide drop line)
        clearDropLineClasses();
        const groupEl = row.closest('.preset-tree__group');
        if (groupEl && groupEl !== _curNestGroup) {
          // Set drop-indent to the header's actual left edge relative to the
          // group container, so the ::before highlight aligns exactly.
          const containerRect = groupEl.getBoundingClientRect();
          const headerRect = row.getBoundingClientRect();
          groupEl.style.setProperty('--drop-indent', (headerRect.left - containerRect.left) + 'px');
          groupEl.style.setProperty('--drop-right', (containerRect.right - headerRect.right) + 'px');
          groupEl.classList.add('preset-tree__group--drop-target');
          _curNestGroup = groupEl;
        }
        return;
      }

      // Show drop line as a class on the target row element (not a fixed
      // overlay). The CSS ::after draws a 2px accent line at the top/bottom
      // edge. This moves naturally with the row on scroll (no fixed positioning).
      if (_curDropRow && _curDropRow !== row) {
        _curDropRow.classList.remove('preset-tree__drop-before', 'preset-tree__drop-after');
      }
      _curDropRow = row;
      row.classList.toggle('preset-tree__drop-before', before);
      row.classList.toggle('preset-tree__drop-after', !before);
    });

    // Delegated drop on listEl
    listEl.addEventListener('drop', async (e) => {
      if (!dragPresetIds && !dragGroupId) return;
      const row = getDropRow(e.target);
      if (!row) return; // blank space → root drop handler

      // Skip if inside a group element but target is the delete zone
      if (e.target.closest('#preset-delete-zone')) return;

      const r = row.getBoundingClientRect();
      const y = e.clientY - r.top;
      const h = r.height;
      const isGroupHeader = row.classList.contains('preset-tree__group-header');
      const before = y < h * 0.25;
      const after = y > h * 0.75;
      const nest = !before && !after && isGroupHeader;

      e.preventDefault();
      e.stopPropagation();
      clearDropLineClasses();
      clearNestHighlights();

      const skin = state.get('selectedSkin');
      if (!skin) return;

      // Build the list of dragged ChildRefs (preset + group, in DOM order)
      const dragItems = [];
      if (dragPresetIds) for (const pid of dragPresetIds) dragItems.push({ type: 'preset', id: pid });
      if (dragGroupId) {
        const gids = Selection.getDragGroupIds(dragGroupId);
        for (const gid of gids) dragItems.push({ type: 'group', id: gid });
      }
      const dragKeys = new Set(dragItems.map(d => d.type + ':' + d.id));

      // No-op: dropped onto itself.
      if (dragGroupId && nest) {
        const targetGid = parseInt(row.dataset.groupId, 10);
        if (targetGid === dragGroupId) return;
      }

      if (nest) {
        // ── Nest into the target group ──
        const targetGroupId = parseInt(row.dataset.groupId, 10);
        const groups0 = state.get('groups') || [];

        // Does any dragged group need flattening before nesting under the target?
        // Single source of truth: needsFlattenBeforeNest.
        const targetGroup0 = groups0.find(x => x.id === targetGroupId) || {};
        const needsFlattenCheck = dragItems.some(d =>
          d.type === 'group' && needsFlattenBeforeNest(groups0, targetGroupId, d.id));

        if (needsFlattenCheck) {
          // Prompt to flatten — regardless of whether the dragged group has
          // nested sub-groups.
          const choice = await ApplyDialog.showConfirmDialog(
            i18n.t('group.flattenConfirm'),
            [
              { label: i18n.t('group.flattenForce'), cls: 'btn--primary', value: 'flatten' },
              { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
            ]
          );
          if (choice !== 'flatten') return;
          // Which plain groups need internal flattening (have nested sub-groups)?
          const plainGroupIds = dragItems
            .filter(d => d.type === 'group')
            .filter(d => {
              const g = groups0.find(x => x.id === d.id);
              return g && g.type !== 'table';
            })
            .map(d => d.id);
          if (targetGroup0.type === 'table') {
            // Dropping INTO a table group itself: the plain group becomes a row
            // of the table (legal as one level). Only flatten ITS nested plain
            // sub-groups (which would be the 2nd level); keep the group shell.
            for (const gid of plainGroupIds) {
              if (hasNestedSubGroups(groups0, gid)) await api.flattenGroupSubgroups(skin, gid);
              await api.moveGroup(skin, gid, targetGroupId);
            }
          } else {
            // Dropping into a plain row of a table: flatten internal sub-groups,
            // then hoist the group's presets into the target (group shell deleted).
            for (const gid of plainGroupIds) {
              // 1. Flatten internal sub-groups (hoist their presets into this group).
              await api.flattenGroupSubgroups(skin, gid);
              // 2. Move this group's presets directly into the target group.
              const refreshed = await api.scanPresets(skin);
              if (refreshed.success) { state.set('groups', refreshed.data.groups); }
              const g2 = (state.get('groups') || []).find(x => x.id === gid);
              if (g2 && g2.children) {
                for (const c of g2.children) {
                  if (c.type === 'preset') await api.movePresetGroup(skin, c.id, targetGroupId);
                  else if (c.type === 'group') await api.moveGroup(skin, c.id, targetGroupId);
                }
              }
              // 3. Delete the now-empty group shell.
              await api.removeGroup(skin, gid);
            }
          }
          await refreshSkinData(skin);
          return;
        }
        // Move presets
        for (const d of dragItems) {
          if (d.type === 'preset') await api.movePresetGroup(skin, d.id, targetGroupId);
          else {
            if (isDescendantOfGroup(state.get('groups') || [], d.id, targetGroupId)) continue;
            await api.moveGroup(skin, d.id, targetGroupId);
          }
        }
        await refreshSkinData(skin);
        return;
      }

      // ── Reorder: insert before/after the target row ──
      const { parentId, children } = getParentChildren(row);

      // Check if dragged items are already in this parent's children.
      // If NOT (cross-parent move), first move them here via movePresetGroup/
      // moveGroup (which removes from the old parent), THEN reorder.
      const alreadyHere = dragItems.every(d => children.some(c => c.type === d.type && c.id === d.id));
      if (!alreadyHere) {
        // Cross-parent move into a plain group that is a row of a table group:
        // prompt to flatten first (same as nest).
        // Flatten check (single source of truth): any dragged group that would
        // create a 2nd-level plain nesting under parentId must flatten first.
        {
          const groups0 = state.get('groups') || [];
          const needFlatten = dragItems
            .filter(d => d.type === 'group' && needsFlattenBeforeNest(groups0, parentId, d.id));
          if (needFlatten.length) {
            const choice = await ApplyDialog.showConfirmDialog(
              i18n.t('group.flattenConfirm'),
              [
                { label: i18n.t('group.flattenForce'), cls: 'btn--primary', value: 'flatten' },
                { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
              ]
            );
            if (choice !== 'flatten') return;
            for (const d of needFlatten) await api.flattenGroupSubgroups(skin, d.id);
          }
        }
        // Cross-parent: move each item to the target parent first (append).
        for (const d of dragItems) {
          if (d.type === 'preset') await api.movePresetGroup(skin, d.id, parentId);
          else await api.moveGroup(skin, d.id, parentId);
        }
        // Refresh state so the children array reflects the IPC moves.
        await refreshSkinData(skin);
        // Re-read the updated children array from the refreshed state.
        const groups2 = state.get('groups') || [];
        if (parentId === null) {
          children.length = 0;
          children.push(...(state.get('rootChildren') || []));
        } else {
          const g2 = groups2.find(x => x.id === parentId);
          children.length = 0;
          children.push(...((g2 && g2.children) || []));
        }
      }

      // Determine target item's ChildRef
      let targetRef;
      if (isGroupHeader) {
        const gid = parseInt(row.dataset.groupId, 10);
        targetRef = { type: 'group', id: gid };
      } else {
        const pid = parseInt(row.dataset.id, 10);
        targetRef = { type: 'preset', id: pid };
      }

      // Remove dragged items from the array
      const depleted = children.filter(c => !dragKeys.has(c.type + ':' + c.id));

      // Find target's position in the depleted array
      const targetIdxInDepleted = depleted.findIndex(c => c.type === targetRef.type && c.id === targetRef.id);
      if (targetIdxInDepleted < 0) return;

      // Compute insert index
      const insertIdx = before ? targetIdxInDepleted : targetIdxInDepleted + 1;

      // Insert dragged items (in DOM order)
      const newChildren = [...depleted.slice(0, insertIdx), ...dragItems, ...depleted.slice(insertIdx)];

      // Atomically set the new order
      await api.reorderChildren(skin, parentId, newChildren);
      await refreshSkinData(skin);
    });

    // listEl dragleave: clear everything when cursor leaves the list
    listEl.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && listEl.contains(e.relatedTarget)) return;
      clearDropLineClasses();
      clearNestHighlights();
    });

    } // end if (!listEl._dragDelegated)

    // ── Bind: root-level drop zone (blank space → move to root) ──
    if (!listEl._rootDropBound) {
      listEl._rootDropBound = true;
      listEl.addEventListener('dragover', (e) => {
        if (!dragPresetIds && !dragGroupId) return;
        // Only handle drops on blank space (not on items/groups)
        if (getDropRow(e.target)) return;
        if (e.target.closest('#preset-delete-zone')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.classList.add('preset-list--drop-root');
      });
      listEl.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && listEl.contains(e.relatedTarget)) return;
        listEl.classList.remove('preset-list--drop-root');
      });
      listEl.addEventListener('drop', async (e) => {
        if (e.defaultPrevented) return;
        if (!dragPresetIds && !dragGroupId) return;
        if (getDropRow(e.target)) return;
        if (e.target.closest('#preset-delete-zone')) return;
        e.preventDefault();
        listEl.classList.remove('preset-list--drop-root');
        clearDropLineClasses();

        const skin = state.get('selectedSkin');
        if (!skin) return;

        // Build drag items
        const dragItems = [];
        if (dragPresetIds) for (const pid of dragPresetIds) dragItems.push({ type: 'preset', id: pid });
        if (dragGroupId) {
          const gids = Selection.getDragGroupIds(dragGroupId);
          for (const gid of gids) dragItems.push({ type: 'group', id: gid });
        }

        // First move each item to root (removes from old parent), THEN reorder.
        // reorderChildren only sorts existing children — it doesn't remove from
        // other parents, so we must movePresetGroup/moveGroup first to avoid
        // the item existing in two places (= duplicate).
        for (const d of dragItems) {
          if (d.type === 'preset') await api.movePresetGroup(skin, d.id, null);
          else await api.moveGroup(skin, d.id, null);
        }
        // Refresh state to get the updated rootChildren after the moves.
        await refreshSkinData(skin);
        const rootChildren = [...(state.get('rootChildren') || [])];
        const dragKeys = new Set(dragItems.map(d => d.type + ':' + d.id));
        const depleted = rootChildren.filter(c => !dragKeys.has(c.type + ':' + c.id));
        const newRoot = [...depleted, ...dragItems];
        await api.reorderChildren(skin, null, newRoot);
        await refreshSkinData(skin);
      });
    }

    // ── Bind: delete zone ──
    const deleteZone = document.getElementById('preset-delete-zone');
    if (deleteZone) {
      deleteZone.addEventListener('dragover', (e) => {
        if (!dragGroupId && (!dragPresetIds || dragPresetIds.length === 0)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        deleteZone.style.opacity = '1';
        deleteZone.style.background = 'rgba(224,85,85,0.1)';
        deleteZone.classList.add('preset-drop-zone--active');
      });
      deleteZone.addEventListener('dragleave', () => {
        deleteZone.style.opacity = '0.5';
        deleteZone.style.background = '';
        deleteZone.classList.remove('preset-drop-zone--active');
      });
      deleteZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation(); // prevent root-drop double-fire
        deleteZone.style.opacity = '0.5';
        deleteZone.style.background = '';
        deleteZone.classList.remove('preset-drop-zone--active');
        const skin = state.get('selectedSkin');
        if (!skin) return;

        // Preset deletion
        if (dragPresetIds && dragPresetIds.length > 0) {
          const ids = [...dragPresetIds];
          const result = await api.deletePresets(skin, ids);
          if (result.success && ids.includes(state.get('selectedPreset'))) {
            state.set('selectedPreset', null);
          }
          // Mixed: also delete selected groups
          if (Selection.groupIds().length > 0) {
            const gids = Selection.outermostGroups(state.get('groups') || [], Selection.groupIds());
            for (const g of gids) await api.deleteGroupRecursive(skin, g);
          }
          await refreshSkinData(skin);
          Selection.clear();
          refreshAllHighlights();
          Toast.info(i18n.t('preset.deleted', { count: ids.length }));
        } else if (dragGroupId) {
          const gids = Selection.getDragGroupIds(dragGroupId);
          const allGids = Selection.outermostGroups(state.get('groups') || [], gids);
          let totalPresets = 0, totalGroups = 0;
          for (const g of allGids) {
            const result = await api.deleteGroupRecursive(skin, g);
            if (result.success) {
              totalPresets += result.data.deletedPresets || 0;
              totalGroups += result.data.deletedGroups || 0;
            }
          }
          // Mixed: also delete selected presets
          if (Selection.presetIds().length > 0) {
            const rp = await api.deletePresets(skin, Selection.presetIds());
            if (rp.success) totalPresets += Selection.presetIds().length;
          }
          state.set('selectedGroup', null);
          state.set('presetDirty', false);
          state.set('selectedPreset', null);
          if (window.PresetEditor && typeof window.PresetEditor.render === 'function') {
            window.PresetEditor.render();
          }
          await refreshSkinData(skin);
          Selection.clear();
          refreshAllHighlights();
          Toast.success(i18n.t('group.deletedRecursive', { presets: totalPresets, groups: totalGroups }));
        }
      });
    }

    // ── Count badge scroll-visibility ──
    const scrollContainer = listEl.closest('.sidebar__list');
    if (scrollContainer) {
      // Set up throttled scroll listener once
      if (!scrollContainer._countBadgeScrollBound) {
        scrollContainer._countBadgeScrollBound = true;
        let ticking = false;
        scrollContainer.addEventListener('scroll', () => {
          if (!ticking) {
            requestAnimationFrame(() => {
              ticking = false;
            });
            ticking = true;
          }
        });
      }
      // Update initial visibility after render
    }
    setupListEdgeFade();
  }

  // Vertical edge-fade overlays over the preset list viewport.
  // Fades are created once; opacity updates on scroll/resize (not on render).
  let _topFade = null, _botFade = null, _rightFade = null;
  function updateListFade() {
    if (!_topFade || !_botFade) return;
    const host = sectionEl;
    if (!host) return;
    const lr = listEl.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    // Fade must cover the scroll viewport's top/bottom edges exactly. Aligning
    // the fade box flush with the list's edges (no -1 fudge) avoids a 1px gap
    // where the host/background shows through between the header and the list.
    _topFade.style.top = (lr.top - hr.top) + 'px';
    _topFade.style.height = Math.min(30, lr.height) + 'px';
    _botFade.style.top = (lr.bottom - hr.top - 30) + 'px';
    _botFade.style.height = Math.min(30, lr.height) + 'px';
    _topFade.style.left = '0';
    _topFade.style.right = '0';
    _botFade.style.left = '0';
    _botFade.style.right = '0';
    const canScroll = listEl.scrollHeight > listEl.clientHeight + 2;
    _topFade.style.opacity = (canScroll && listEl.scrollTop > 2) ? '1' : '0';
    _botFade.style.opacity = (canScroll && listEl.scrollTop + listEl.clientHeight < listEl.scrollHeight - 2) ? '1' : '0';
    // Right-edge fade: shown when the tree can scroll horizontally and isn't
    // already flush against the right edge.
    if (_rightFade) {
      const canScrollX = listEl.scrollWidth > listEl.clientWidth + 2;
      _rightFade.style.opacity = (canScrollX && listEl.scrollLeft + listEl.clientWidth < listEl.scrollWidth - 2) ? '1' : '0';
    }
  }
  function setupListEdgeFade() {
    const host = sectionEl; // #preset-section
    if (!host) return;
    if (host._fadeInit) { requestAnimationFrame(updateListFade); return; }
    host._fadeInit = true;
    host.style.position = 'relative';
    _topFade = document.createElement('div');
    _topFade.className = 'preset-list-fade preset-list-fade--top';
    _botFade = document.createElement('div');
    _botFade.className = 'preset-list-fade preset-list-fade--bottom';
    _rightFade = document.createElement('div');
    _rightFade.className = 'preset-list-fade preset-list-fade--right';
    host.appendChild(_topFade);
    host.appendChild(_botFade);
    host.appendChild(_rightFade);
    listEl.addEventListener('scroll', updateListFade, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateListFade).observe(host);
    requestAnimationFrame(updateListFade);
    setTimeout(updateListFade, 300);
  }

  // ── Recursive rendering ──

  function renderGroupNode(group, allGroups, presetMap, selectedPreset, depth) {
    const isCollapsed = group.collapsed === true;
    const isTable = group.type === 'table';
    const indent = depth * 20; // 20px per nesting level (base 0)
    let html = `<div class="preset-tree__group${isTable ? ' preset-tree__group--table' : ''}" data-group-id="${group.id}">`;
    const totalPresetCount = isTable
      ? 1 + countAllPresetsRecursive(group, allGroups)
      : countAllPresetsRecursive(group, allGroups);
    html += `<div class="preset-tree__group-header" data-group-id="${group.id}" style="margin-left:${indent}px">
      <span class="preset-tree__collapse-icon">${isCollapsed ? '▶' : '▼'}</span>
      ${isTable ? '<span class="preset-tree__table-badge" title="' + escapeHtml(i18n.t('group.tableGroup')) + '">' + escapeHtml(i18n.t('group.tableGroup')) + '</span>' : ''}
      <span class="preset-tree__group-name">${escapeHtml(group.name)}</span>
      ${totalPresetCount > 0 ? `<span class="preset-tree__group-count">${totalPresetCount}</span>` : ''}
    </div>`;

    if (!isCollapsed && group.children && group.children.length > 0) {
      html += '<div class="preset-tree__group-children">';
      for (const child of group.children) {
        if (child.type === 'preset') {
          const preset = presetMap.get(child.id);
          if (preset) {
            html += renderPresetNode(preset, selectedPreset, depth + 1);
          }
        } else if (child.type === 'group') {
          const subGroup = allGroups.find(g => g.id === child.id);
          if (subGroup) {
            html += renderGroupNode(subGroup, allGroups, presetMap, selectedPreset, depth + 1);
          }
        }
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderPresetNode(preset, selectedPreset, depth) {
    const isEditing = preset.id === selectedPreset;
    const indent = depth * 20; // 20px per nesting level (base 0)
    const name = preset.meta?.name || i18n.t('preset.fallbackName', { id: preset.id });
    return `
      <div class="preset-tree__item ${isEditing ? 'preset-tree__item--editing' : ''}"
           data-id="${preset.id}" style="margin-left:${indent}px">
        <span class="preset-tree__item-icon">📄</span>
        <span class="preset-tree__item-name">${escapeHtml(name)}</span>
      </div>
    `;
  }

  // ── Helpers ──

  // ── Highlight updaters ──
  // Toggle multi-select CSS classes on preset items + group headers based on
  // the Selection module's sets, plus the single-edit --selected class.
  function updateMultiSelectHighlights() {
    const pSet = new Set(Selection.presetIds());
    listEl.querySelectorAll('.preset-tree__item').forEach(item => {
      const id = parseInt(item.dataset.id, 10);
      item.classList.toggle('preset-tree__item--multi-selected', pSet.has(id));
    });
  }

  function updateMultiSelectedGroupHighlights() {
    const gSet = new Set(Selection.groupIds());
    listEl.querySelectorAll('.preset-tree__group-header').forEach(h => {
      const id = parseInt(h.dataset.groupId, 10);
      h.classList.toggle('preset-tree__group-header--multi-selected', gSet.has(id));
    });
  }

  function updateGroupSelectionHighlights() {
    const sel = state.get('selectedGroup');
    listEl.querySelectorAll('.preset-tree__group-header').forEach(h => {
      const id = parseInt(h.dataset.groupId, 10);
      h.classList.toggle('preset-tree__group-header--selected', id === sel);
    });
  }

  // All three highlight updaters at once — called by Selection.refreshHighlights.
  function refreshAllHighlights() {
    updateMultiSelectHighlights();
    updateMultiSelectedGroupHighlights();
    updateGroupSelectionHighlights();
  }

  // Unified DOM-order list of every selectable item (presets + groups mixed),
  // for cross-type Shift-range selection. Each entry: { kind, id }.
  function getAllVisibleKeys() {
    const out = [];
    const walk = (container) => {
      for (const child of container.children) {
        if (child.classList.contains('preset-tree__item')) {
          out.push({ kind: 'preset', id: parseInt(child.dataset.id, 10) });
        } else if (child.classList.contains('preset-tree__group')) {
          const hdr = child.querySelector(':scope > .preset-tree__group-header');
          if (hdr) out.push({ kind: 'group', id: parseInt(hdr.dataset.groupId, 10) });
          const kids = child.querySelector(':scope > .preset-tree__group-children');
          if (kids) walk(kids);
        }
      }
    };
    const tree = listEl.querySelector(':scope > .preset-tree') || listEl;
    walk(tree);
    return out;
  }

  // Clear all selection state. Delegates to Selection.clear() which calls back
  // into refreshAllHighlights. Also clears the single-edit foci.
  function clearSelection() {
    Selection.clear();
    state.setMultiple({ selectedPreset: null, selectedGroup: null });
    updateGroupSelectionHighlights();
  }

  // Select a group for basic-info editing (mutually exclusive with selectedPreset).
  async function selectGroup(groupId) {
    if (!await confirmSwitchIfDirty()) return;
    Selection.setSingle('group', groupId);
    state.setMultiple({
      selectedPreset: null,
      selectedGroup: groupId,
      presetDirty: false,
    });
    updateGroupSelectionHighlights();
  }

  // Initialize the Selection module with DOM-touching callbacks.
  Selection.init({ refreshHighlights: refreshAllHighlights, getAllVisibleKeys });



  async function refreshSkinData(skin) {
    const scanResult = await api.scanPresets(skin);
    if (scanResult.success) {
      state.setMultiple({
        presets: scanResult.data.presets,
        groups: scanResult.data.groups,
        rootChildren: scanResult.data.rootChildren || [],
      });
    }
    // Re-register global shortcuts so deleted presets/groups don't keep their
    // hotkeys, and structural changes (id compaction) are reflected.
    try { api.reloadGlobalShortcuts(skin); } catch (e) { /* best-effort */ }
  }

  // ── Collapse toggle ──

  async function toggleGroupCollapse(groupId) {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const groups = state.get('groups') || [];
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    const newCollapsed = !group.collapsed;
    await api.setGroupCollapsed(skin, groupId, newCollapsed);
    group.collapsed = newCollapsed;
    state.set('groups', [...groups]);
  }

  // Shift+click: toggle this group and every descendant group to the same state.
  async function toggleGroupCollapseRecursive(groupId) {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const groups = state.get('groups') || [];
    const byId = new Map(groups.map(g => [g.id, g]));
    const root = byId.get(groupId);
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
    state.set('groups', [...groups]);
    await api.setGroupsCollapsedBatch(skin, ids, target);
  }

  // ── Bottom actions ──

  function buildBottomActions() {
    const bottomActions = document.getElementById('preset-bottom-actions');
    if (bottomActions) {
      bottomActions.style.display = 'block';
      bottomActions.innerHTML = `
        <div style="padding:4px 16px">
          <button class="btn btn--secondary btn--sm" id="btn-new-preset-sidebar" style="width:100%">
            ${i18n.t('group.newPreset')}
          </button>
        </div>
        <div style="padding:4px 16px">
          <button class="btn btn--secondary btn--sm" id="btn-new-empty-group" style="width:100%">
            ${i18n.t('group.newGroup')}
          </button>
        </div>
        <div style="padding:4px 16px">
          <button class="btn btn--secondary btn--sm" id="btn-new-table-group" style="width:100%">
            ${i18n.t('group.newTableGroup')}
          </button>
        </div>
        <div style="padding:4px 16px">
          <button class="btn btn--primary btn--sm" id="btn-save-preset-sidebar" style="width:100%" disabled>
            ${i18n.t('group.savePreset')}
          </button>
        </div>
        <div class="preset-delete-zone" id="preset-delete-zone"
             style="margin:4px 16px 12px;padding:12px;border:2px dashed var(--danger);border-radius:var(--radius);text-align:center;color:var(--danger);font-size:12px;opacity:0.5;transition:all 0.2s">
          ${i18n.t('group.deleteZone')}
        </div>
      `;
    } else {
      listEl.insertAdjacentHTML('beforeend', `
        <div style="padding:4px 16px">
          <button class="btn btn--secondary btn--sm" id="btn-new-preset-sidebar" style="width:100%">
            ${i18n.t('group.newPreset')}
          </button>
        </div>
        <div style="padding:4px 16px">
          <button class="btn btn--secondary btn--sm" id="btn-new-empty-group" style="width:100%">
            ${i18n.t('group.newGroup')}
          </button>
        </div>
        <div style="padding:4px 16px">
          <button class="btn btn--secondary btn--sm" id="btn-new-table-group" style="width:100%">
            ${i18n.t('group.newTableGroup')}
          </button>
        </div>
      `);
    }

    // ── Bind click handlers ──

    const btnNew = document.getElementById('btn-new-preset-sidebar');
    if (btnNew) {
      btnNew.addEventListener('click', async () => {
        if (!await confirmSwitchIfDirty()) return;
        // Decide where the new preset goes:
        // - a GROUP is selected → new preset becomes its CHILD (inside the group);
        // - a PRESET is selected  → new preset becomes its SIBLING (same parent);
        // - nothing selected      → root.
        const selGid = state.get('selectedGroup');
        const selPreset = state.get('selectedPreset');
        let targetParent = null;
        const groups0 = state.get('groups') || [];
        if (selGid != null) {
          targetParent = selGid;
        } else if (selPreset != null && selPreset !== '__new__') {
          const parent = groups0.find(g => g.children && g.children.some(c => c.type === 'preset' && c.id === selPreset));
          targetParent = parent ? parent.id : null;
        }
        if (window.PresetEditor) window.PresetEditor.newPresetTargetParent = targetParent;
        // Don't clearSelection() yet: keep A highlighted so the user can see
        // which item the new preset is being created under. Selection clears
        // when the new preset is saved (selectedPreset → new id).
        state.set('selectedPreset', '__new__');
        // Force a fresh form even when already in __new__ (re-clicking "New Preset")
        if (window.PresetEditor && typeof window.PresetEditor.resetNew === 'function') {
          window.PresetEditor.resetNew();
        }
      });
    }

    const btnNewGroup = document.getElementById('btn-new-empty-group');
    if (btnNewGroup) {
      btnNewGroup.addEventListener('click', async () => {
        // If presets OR groups are selected, create the group and move them in.
        const selGid = state.get('selectedGroup');
        if (Selection.presetIds().length > 0 || Selection.groupIds().length > 0 || selGid != null) {
          createGroupWithSelected();
          return;
        }
        const newName = await promptNewGroupName();
        if (!newName) return;
        const skin = state.get('selectedSkin');
        if (!skin) return;
        const result = await api.addGroup(skin, newName, null);
        if (result.success) {
          Toast.success(i18n.t('group.created', { name: newName }));
          await refreshSkinData(skin);
          Selection.setSingle('group', result.data);
          state.setMultiple({ selectedGroup: result.data, selectedPreset: null, presetDirty: false });
        } else {
          Toast.error(i18n.t('group.createFailed', { msg: (result.error || i18n.t('app.unknownError')) }));
        }
      });
    }

    const btnNewTableGroup = document.getElementById('btn-new-table-group');
    if (btnNewTableGroup) {
      btnNewTableGroup.addEventListener('click', async () => {
        // If presets OR groups are selected, create the table group and move them in.
        const selGid2 = state.get('selectedGroup');
        if (Selection.presetIds().length > 0 || Selection.groupIds().length > 0 || selGid2 != null) {
          createGroupWithSelected('table');
          return;
        }
        const newName = await promptNewGroupName(i18n.t('group.createTableTitle'));
        if (!newName) return;
        const skin = state.get('selectedSkin');
        if (!skin) return;
        const result = await api.addGroup(skin, newName, null, 'table');
        if (result.success) {
          Toast.success(i18n.t('group.createdTable', { name: newName }));
          await refreshSkinData(skin);
          Selection.setSingle('group', result.data);
          state.setMultiple({ selectedGroup: result.data, selectedPreset: null, presetDirty: false });
        } else {
          Toast.error(i18n.t('group.createFailed', { msg: (result.error || i18n.t('app.unknownError')) }));
        }
      });
    }

    // "+ new row" buttons inside table groups (creates a table sub-group).

    const btnSaveSidebar = document.getElementById('btn-save-preset-sidebar');
    if (btnSaveSidebar) {
      btnSaveSidebar.addEventListener('click', () => {
        // doSave() branches internally (group vs preset); no need to check here.
        if (window.PresetEditor && typeof window.PresetEditor.doSave === 'function') {
          window.PresetEditor.doSave();
        }
      });
      updateSidebarSaveButton(btnSaveSidebar);
    }
  }

  // ── Prompt new group name ──

  function promptNewGroupName(title) {
    return new Promise((resolve) => {
      if (document.querySelector('.modal-overlay')) return resolve(null);
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="min-width:320px">
          <div class="modal__title">${title || i18n.t('group.createTitle')}</div>
          <div class="modal__body">
            <input type="text" class="form-input" id="new-group-name-input"
                   placeholder="${i18n.t('group.namePlaceholder')}" autocomplete="off" spellcheck="false" style="width:100%">
          </div>
          <div class="modal__actions">
            <button class="btn btn--primary" id="new-group-confirm">${i18n.t('dialog.confirm')}</button>
            <button class="btn btn--secondary" id="new-group-cancel">${i18n.t('dialog.cancel')}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = document.getElementById('new-group-name-input');
      const confirmBtn = document.getElementById('new-group-confirm');
      const cancelBtn = document.getElementById('new-group-cancel');

      input.focus();

      const close = (value) => {
        overlay.remove();
        resolve(value);
      };

      confirmBtn.addEventListener('click', () => {
        const val = input.value.trim();
        close(val || null);
      });
      cancelBtn.addEventListener('click', () => close(null));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(null);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const val = input.value.trim(); close(val || null); }
        if (e.key === 'Escape') close(null);
      });
    });
  }

  // ── Confirm before switching away from unsaved preset ──

  async function confirmSwitchIfDirty() {
    if (!state.get('presetDirty')) return true;
    // A new (unsaved) preset has nothing on disk to lose — discard silently.
    if (state.get('selectedPreset') === '__new__') {
      state.set('presetDirty', false);
      return true;
    }
    const unsavedMsg = state.get('selectedGroup') != null
      ? i18n.t('dialog.unsavedSwitchGroup')
      : i18n.t('dialog.unsavedSwitch');
    const choice = await ApplyDialog.showConfirmDialog(
      unsavedMsg,
      [
        { label: i18n.t('dialog.saveAndSwitch'), cls: 'btn--primary', value: 'save' },
        { label: i18n.t('dialog.discard'), cls: 'btn--danger', value: 'discard' },
        { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
      ]
    );
    if (!choice || choice === 'cancel') return false;
    if (choice === 'save') {
      if (window.PresetEditor && typeof window.PresetEditor.doSave === 'function') {
        const ok = await window.PresetEditor.doSave();
        if (!ok) return false; // save failed — abort switch
      }
    } else if (choice === 'discard') {
      // Just clear the dirty flag — the upcoming selectedPreset change will
      // load the new preset's data from disk, overwriting the unsaved edits.
      // Don't call resetNew() here: it would rebuild the editor DOM and
      // interfere with the subsequent preset switch.
      state.set('presetDirty', false);
    }
    return true;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ── Duplicate selected item(s) ──
  // Presets: duplicates each selected preset in place (multiSelected).
  // Group/checkbox-group: deep-copies the selected group's entire subtree
  // (child groups, child checkbox-groups, presets, actions, meta/preview).

  async function duplicateSelected() {
    const skin = state.get('selectedSkin');
    if (!skin) return;

    // Mixed select: duplicate selected GROUPS (deep subtree copy) AND selected
    // PRESETS. Either or both may be present.
    const selGid = state.get('selectedGroup');
    const groupIdsToDup = Selection.groupIds().length > 0 ? Selection.groupIds()
      : (Selection.presetIds().length === 0 && selGid != null ? [selGid] : []);
    let groupOk = 0, presetCopied = 0;
    let lastNewId = null;
    // old→new id maps built as the subtree is duplicated, used afterward to
    // clone the source's table-state buckets (expanded/rowSelection/activations)
    // under the fresh group/preset ids. Only the group-subtree path populates
    // these; standalone-preset duplication owns no table state.
    const gidMap = {}; // { oldGroupId: newGroupId }
    const pidMap = {}; // { oldPresetId: newPresetId }
    const clonePairs = []; // [{ src, dst }] table-root groups to clone state for

    if (groupIdsToDup.length > 0) {
      const groups = state.get('groups') || [];
      const outerOnly = groupIdsToDup.filter(gid =>
        !groupIdsToDup.some(other => other !== gid && isDescendantOfGroup(groups, other, gid))
      );
      try {
        for (const gid of outerOnly) {
          const src = groups.find(g => g.id === gid);
          if (!src) continue;
          const parent = groups.find(g => g.children && g.children.some(c => c.type === "group" && c.id === gid));
          const parentId = parent ? parent.id : null;
          const newRootId = await duplicateSubtree(src, parentId, groups, skin, true, gidMap, pidMap);
          if (newRootId != null) {
            groupOk++; lastNewId = { kind: "group", id: newRootId };
            // A table-type root owns expanded/rowSelection/activations buckets —
            // clone them (translated) to the new root after the subtree is built.
            if (src.type === 'table') clonePairs.push({ src: gid, dst: newRootId });
          }
        }
      } catch (err) {
        Toast.error(i18n.t('group.duplicateFailed', { msg: (err && (err.message || String(err))) || i18n.t('app.unknownError') }));
      }
    }

    if (Selection.presetIds().length > 0) {
      for (const id of Selection.presetIds()) {
        const r = await api.loadPreset(skin, id);
        if (!r.success || !r.data) continue;
        const data = { ...r.data };
        if (!data.meta) data.meta = {};
        data.meta.name = (data.meta.name || i18n.t('preset.fallbackName', { id: r.data.id })) + i18n.t('preset.copySuffix');
        // A duplicated preset must NOT inherit the source's global hotkey.
        data.meta.shortcut = undefined;
        // Find the source preset's parent so the copy stays in the same group.
        const groups0 = state.get('groups') || [];
        let srcParent = null;
        for (const g of groups0) {
          if (g.children && g.children.some(c => c.type === 'preset' && c.id === id)) { srcParent = g.id; break; }
        }
        const saveResult = await api.savePreset(skin, null, data);
        if (saveResult.success) {
          if (srcParent !== null) await api.movePresetGroup(skin, saveResult.data, srcParent);
          presetCopied++; lastNewId = { kind: "preset", id: saveResult.data };
        }
      }
    }

    const hadWork = groupIdsToDup.length > 0 || Selection.presetIds().length > 0;
    Selection.clear();
    if (!hadWork) return;
    // Clone table-state for any duplicated table groups (reads/writes config.osp
    // directly, so do it BEFORE refreshSkinData reloads everything from disk).
    if (clonePairs.length > 0) {
      try {
        await api.cloneTableStateForGroups(
          skin,
          clonePairs.map(p => p.src),
          clonePairs.map(p => p.dst),
          gidMap,
          pidMap,
        );
      } catch { /* non-fatal: tables just won't carry over */ }
    }
    await refreshSkinData(skin);
    // Focus the last duplicated item.
    if (lastNewId) {
      if (lastNewId.kind === "group") {
        state.setMultiple({ selectedPreset: null, selectedGroup: lastNewId.id, presetDirty: false });
      } else {
        state.setMultiple({ selectedPreset: lastNewId.id, selectedGroup: null });
      }
      updateGroupSelectionHighlights();
    }

    // Toast: summarize combined result.
    if (groupOk > 0 && presetCopied === 0) {
      Toast.success(groupOk === 1
        ? i18n.t('group.duplicated', { name: (groups0(groupIdsToDup[0]) || {}).name || '' })
        : i18n.t('group.duplicatedMulti', { count: groupOk }));
    } else if (presetCopied > 0 && groupOk === 0) {
      Toast.success(i18n.t('preset.copied', { count: presetCopied }));
    } else if (groupOk > 0 && presetCopied > 0) {
      Toast.success(i18n.t('group.duplicatedMulti', { count: groupOk }) + ' / ' + i18n.t('preset.copied', { count: presetCopied }));
    }
  }
  // helper for the toast above (find a group by id from current state)
  function groups0(gid) { return (state.get('groups') || []).find(g => g.id === gid); }

  // Deep-copy a group subtree into destParentId. Returns the new group id, or
  // null on failure. `isRoot` controls whether the copy-suffix is appended to
  // the name (only the duplicated root gets it; descendants keep their names).
  async function duplicateSubtree(srcGroup, destParentId, allGroups, skin, isRoot, gidMap, pidMap) {
    const newName = (srcGroup.name || '') + (isRoot ? i18n.t('preset.copySuffix') : '');
    const addResult = await api.addGroup(skin, newName, destParentId, srcGroup.type || '');
    if (!addResult || !addResult.success) return null;
    const newGid = addResult.data;
    // Record old→new so table-state buckets can be remapped to the copy later.
    gidMap[srcGroup.id] = newGid;

    // Copy own properties (description, preview, actions).
    if (srcGroup.description) {
      await api.setGroupDescription(skin, newGid, srcGroup.description);
    }
    if (srcGroup.previewPath || srcGroup.previewKind || (srcGroup.previewFrames && srcGroup.previewFrames.length)) {
      await api.setGroupPreview(skin, newGid, {
        path: srcGroup.previewPath || '',
        kind: srcGroup.previewKind || 'image',
        frames: srcGroup.previewKind === 'sequence' ? (srcGroup.previewFrames || []) : [],
        fps: srcGroup.previewFps || 12,
      });
    }
    if (srcGroup.type === 'table' && srcGroup.actions) {
      await api.setGroupActions(skin, newGid, srcGroup.actions);
    }

    // Recurse into children in original order.
    for (const c of (srcGroup.children || [])) {
      if (c.type === 'preset') {
        await duplicatePresetIntoGroup(c.id, newGid, skin, pidMap);
      } else if (c.type === 'group') {
        const childSrc = allGroups.find(g => g.id === c.id);
        if (childSrc) await duplicateSubtree(childSrc, newGid, allGroups, skin, false, gidMap, pidMap);
      }
    }
    return newGid;
  }

  // Duplicate a preset and move the fresh copy into destGroupId.
  async function duplicatePresetIntoGroup(srcPresetId, destGroupId, skin, pidMap) {
    const r = await api.loadPreset(skin, srcPresetId);
    if (!r.success || !r.data) return;
    const data = { ...r.data };
    // A duplicated preset must NOT inherit the source's global hotkey.
    if (data.meta) data.meta = { ...data.meta, shortcut: undefined };
    // Children keep their original names (no copy suffix) for subtree copies.
    const saveResult = await api.savePreset(skin, null, data);
    if (saveResult && saveResult.success && saveResult.data != null) {
      // savePreset returns the new preset id directly (not an object).
      await api.movePresetGroup(skin, saveResult.data, destGroupId);
      // Record old→new so table-state preset-id values can be remapped.
      if (pidMap) pidMap[srcPresetId] = saveResult.data;
    }
  }


  // ── Tree helpers for smart group creation ──

  function findPresetParentGroupId(groups, presetId) {
    for (const g of groups) {
      if (g.children && g.children.some(c => c.type === 'preset' && c.id === presetId)) {
        return g.id;
      }
    }
    return null;
  }

  function getGroupAncestors(groups, groupId) {
    const groupMap = new Map(groups.map(g => [g.id, g]));
    function findPath(parentGroups, targetId, path) {
      for (const g of parentGroups) {
        const newPath = [...path, g.id];
        if (g.id === targetId) return newPath;
        if (g.children) {
          const subGroups = g.children
            .filter(c => c.type === 'group')
            .map(c => groupMap.get(c.id))
            .filter(Boolean);
          const found = findPath(subGroups, targetId, newPath);
          if (found) return found;
        }
      }
      return null;
    }
    return findPath(groups, groupId, []) || [];
  }

  function isDescendantOfGroup(groups, ancestorId, targetId) {
    const groupMap = new Map(groups.map(g => [g.id, g]));
    function check(groupId) {
      const group = groupMap.get(groupId);
      if (!group || !group.children) return false;
      for (const child of group.children) {
        if (child.type === 'group') {
          if (child.id === targetId) return true;
          if (check(child.id)) return true;
        }
      }
      return false;
    }
    return check(ancestorId);
  }

  function countAllPresetsRecursive(group, allGroups) {
    if (!group || !group.children) return 0;
    let count = 0;
    for (const child of group.children) {
      if (child.type === 'preset') {
        count++;
      } else if (child.type === 'group') {
        const sub = allGroups.find(g => g.id === child.id);
        if (!sub) continue;
        // Multi-select group (table type) counts as 1; caller's top-level
        // call adds the group's own 1. Nested ones are self-contained here.
        if (sub.type === 'table') {
          count += 1 + countAllPresetsRecursive(sub, allGroups);
        } else {
          count += countAllPresetsRecursive(sub, allGroups);
        }
      }
    }
    return count;
  }

  function findOutermostCommonAncestor(groups, groupIds) {
    if (groupIds.length === 0) return null;
    if (groupIds.length === 1) return groupIds[0]; // single group → itself
    const chains = groupIds.map(id => getGroupAncestors(groups, id));
    // If any group has an empty chain, no common ancestor → root
    if (chains.some(c => c.length === 0)) return null;
    // Outermost common ancestor = first (shallowest) element shared by all chains
    const firstId = chains[0][0];
    return chains.every(c => c[0] === firstId) ? firstId : null;
  }

  // ── Create group with selected presets moved into it ──

  async function createGroupWithSelected(kind = 'group') {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const isTable = kind === 'table';

    // Determine the appropriate parent group for the new group. Supports MIXED
    // selection (presets + groups together): collect every selected item's
    // parent, then new parent = lowest common ancestor (root if any is at root).
    let parentGroupId = null;
    const groups = state.get('groups') || [];
    const selGid = state.get('selectedGroup');
    const hasSel = selGid != null;
    const hasMultiGroups = Selection.groupIds().length > 0;
    const hasMultiPresets = Selection.presetIds().length > 0;
    if (hasSel || hasMultiGroups || hasMultiPresets) {
      // Special case: exactly ONE group is selected (no presets, no other
      // groups) — clicking a group selects it via BOTH selectedGroup and the
      // Selection set, so merge+dedupe to count unique selected groups. Create
      // the new group AS A CHILD of that group (nest inside), not wrapping it.
      const selGroupIds = new Set(Selection.groupIds());
      if (hasSel && selGid != null) selGroupIds.add(selGid);
      const singleGroupSelected = !hasMultiPresets && selGroupIds.size === 1;
      if (singleGroupSelected) {
        const target = [...selGroupIds][0];
        // Respect the row-nesting limit: a plain group can't be created inside
        // a table group's row (would be a 2nd-level plain nesting).
        if (!isTable && isPlainRowInTable(groups, target)) {
          Toast.warning(i18n.t('group.cannotNestInTableRow'));
          return;
        }
        parentGroupId = target;
      } else {
        // Block: creating a PLAIN group whose source includes a row (plain group
        // inside a table group) would create an invalid 2nd-level nesting.
        if (!isTable) {
          if (hasSel && isPlainRowInTable(groups, selGid)) {
            Toast.warning(i18n.t('group.cannotNestInTableRow'));
            return;
          }
          if (Selection.groupIds().some(gid => isPlainRowInTable(groups, gid))) {
            Toast.warning(i18n.t('group.cannotNestInTableRow'));
            return;
          }
        }
        // Collect the parent of every selected item (presets + groups + the
        // single selected group). null = at root.
        const parentIds = new Set();
        if (hasSel) {
          const parent = groups.find(g => g.children && g.children.some(c => c.type === 'group' && c.id === selGid));
          parentIds.add(parent ? parent.id : null);
        }
        for (const gid of Selection.groupIds()) {
          const p = groups.find(g => g.children && g.children.some(c => c.type === 'group' && c.id === gid));
          parentIds.add(p ? p.id : null);
        }
        for (const pid of Selection.presetIds()) {
          parentIds.add(findPresetParentGroupId(groups, pid));
        }
        const uniqueParents = [...parentIds].filter(id => id !== null);
        if (parentIds.has(null)) {
          parentGroupId = null;
        } else if (uniqueParents.length === 1) {
          parentGroupId = uniqueParents[0];
        } else {
          parentGroupId = findOutermostCommonAncestor(groups, uniqueParents);
        }
      }
    }

    // Block creating a plain group inside a table group's row (would be 2nd-level nesting).
    if (!isTable && parentGroupId != null && isPlainRowInTable(groups, parentGroupId)) {
      Toast.warning(i18n.t('group.cannotNestInTableRow'));
      return;
    }

    const newName = await promptNewGroupName(isTable ? i18n.t('group.createTableTitle') : i18n.t('group.createTitle'));
    if (!newName) return;
    const result = await api.addGroup(skin, newName, parentGroupId, isTable ? 'table' : '');
    if (!result.success) {
      Toast.error(i18n.t('group.createFailed', { msg: (result.error || i18n.t('app.unknownError')) }));
      return;
    }
    const newGroupId = result.data;

    // Collect ALL selected groups (the multi-set + the single selected group)
    // and ALL selected presets. Mixed selection moves everything into the new
    // group. Apply the per-source flatten check ONCE for all table-create cases.
    // EXCEPT the nest-under-selected case (parentGroupId === selGid): the
    // selected group stays put, nothing to move.
    // nest-under: the new group's parent IS the selected group → don't move
    // the selected group into the new group (it stays as the parent).
    const nestUnderSelected = parentGroupId != null
      && (parentGroupId === selGid || Selection.groupIds().includes(parentGroupId));
    const allSelGroups = new Set(Selection.groupIds());
    if (nestUnderSelected) allSelGroups.delete(parentGroupId);
    else if (selGid != null) allSelGroups.add(selGid);
    const movedAny = allSelGroups.size > 0 || Selection.presetIds().length > 0;

    if (movedAny) {
      // For a TABLE parent, a plain source group with nested plain sub-groups
      // must be flattened first. Prompt ONCE for all such sources.
      // newGroupId is a freshly-created table group (not yet in `groups`),
      // so the guard reduces to: plain source group with nested plain sub-groups.
      if (isTable) {
        const needFlatten = [...allSelGroups].filter(gid => {
          const src = groups.find(g => g.id === gid);
          return src && src.type !== 'table' && hasNestedSubGroups(groups, gid);
        });
        if (needFlatten.length > 0) {
          const choice = await ApplyDialog.showConfirmDialog(
            i18n.t('group.flattenConfirm'),
            [
              { label: i18n.t('group.flattenForce'), cls: 'btn--primary', value: 'flatten' },
              { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
            ]
          );
          if (choice !== 'flatten') {
            // Abort entirely: remove the just-created empty group and bail.
            await api.removeGroup(skin, newGroupId);
            await refreshSkinData(skin);
            return;
          }
          for (const gid of needFlatten) await api.flattenGroupSubgroups(skin, gid);
        }
      }
      // Move every selected group in (preserve selection order: multi first,
      // then the single selGid if not already in the set).
      for (const gid of allSelGroups) {
        await api.moveGroup(skin, gid, newGroupId);
      }
      // Move every selected preset in.
      for (const pid of Selection.presetIds()) {
        await api.movePresetGroup(skin, pid, newGroupId);
      }
      const totalMoved = allSelGroups.size + Selection.presetIds().length;
      Selection.clear();
      Toast.success(isTable
        ? i18n.t('group.createdTable', { name: newName })
        : (totalMoved > 1 ? i18n.t('group.createdWithPresets', { name: newName, count: totalMoved }) : i18n.t('group.createdEmpty', { name: newName })));
    } else {
      Selection.clear();
      Toast.success(isTable
        ? i18n.t('group.createdTable', { name: newName })
        : i18n.t('group.createdEmpty', { name: newName }));
    }
    // Refresh FIRST so the new group is in state.groups, THEN set selectedGroup
    // — the editor's selectedGroup listener reads state.groups to load the new
    // group; setting it before the refresh left the editor on stale data.
    await refreshSkinData(skin);
    // Select the new group the same way a click does (Selection.setSingle +
    // selectedGroup) so the highlight + editor load match a manual pick.
    Selection.setSingle('group', newGroupId);
    state.setMultiple({ selectedGroup: newGroupId, selectedPreset: null, presetDirty: false });

    // Expand the ancestor chain so the new group is visible (auto-expand-to-new),
    // then focus its name input. Applies to plain groups and table groups alike.
    {
      const freshGroups = state.get('groups') || [];
      const toExpand = [];
      let curParent = parentGroupId;
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
        await api.setGroupsCollapsedBatch(skin, toExpand, false);
        await refreshSkinData(skin);
      }
    }
  }

  function updateSidebarSaveButton(btn) {
    const mode = state.get('appMode');
    const dirty = state.get('presetDirty');
    const isNew = state.get('selectedPreset') === '__new__';
    const editingGroup = state.get('selectedGroup') != null;
    // No saving during multi-select (nothing single to save; editor is locked).
    if (state.get('multiSelectActive')) { btn.disabled = true; return; }
    // Group mode: the button reflects the group's dirty state only (a leftover
    // '__new__' selectedPreset must NOT keep the button enabled here).
    // Preset mode: new presets can always be saved (continuous save).
    if (editingGroup) {
      btn.disabled = (mode !== 'edit' || !dirty);
    } else {
      btn.disabled = (mode !== 'edit' || (!dirty && !isNew));
    }
  }

  // ── State listeners ──

  state.on('presets', (presets) => render(presets, state.get('selectedPreset'), state.get('selectedSkin')));
  state.on('groups', () => render(state.get('presets'), state.get('selectedPreset'), state.get('selectedSkin')));
  state.on('rootChildren', () => render(state.get('presets'), state.get('selectedPreset'), state.get('selectedSkin')));
  state.on('selectedSkin', (skinName) => render(state.get('presets'), null, skinName));
  state.on('selectedPreset', (presetId) => render(state.get('presets'), presetId, state.get('selectedSkin')));
  state.on('appMode', () => render(state.get('presets'), state.get('selectedPreset'), state.get('selectedSkin')));

  state.on('presetDirty', () => {
    const btn = document.getElementById('btn-save-preset-sidebar');
    if (btn) updateSidebarSaveButton(btn);
  });
  state.on('selectedGroup', () => {
    const btn = document.getElementById('btn-save-preset-sidebar');
    if (btn) updateSidebarSaveButton(btn);
  });
  state.on('multiSelectActive', () => {
    const btn = document.getElementById('btn-save-preset-sidebar');
    if (btn) updateSidebarSaveButton(btn);
  });

  // ── Table-nesting guards (single source of truth) ──
  // RULE: inside a table group's subtree, a plain group may not have its own
  // plain sub-groups (a table allows only ONE level of plain groups = its rows).
  // Table groups can nest freely; plain groups outside any table are unrestricted.
  //
  // All create/move/drop paths MUST go through these two predicates instead of
  // re-deriving the rule at each call site (which is what made it drift).

  // Is `groupId` a plain group living inside a table group (directly or as a
  // row)? Such a group is already the one allowed plain level — nesting another
  // plain group under it is forbidden.
  function isPlainRowInTable(allGroups, groupId) {
    if (groupId == null) return false;
    const g = allGroups.find(x => x.id === groupId);
    if (!g || g.type === 'table') return false;
    for (const pg of allGroups) {
      if (pg.children && pg.children.some(c => c.type === 'group' && c.id === groupId)) {
        return pg.type === 'table';
      }
    }
    return false;
  }

  // Does `groupId` have any DIRECT plain (non-table) sub-group?
  function hasNestedSubGroups(allGroups, groupId) {
    const g = allGroups.find(x => x.id === groupId);
    if (!g || !g.children) return false;
    return g.children.some(c => {
      if (c.type !== 'group') return false;
      const sub = allGroups.find(x => x.id === c.id);
      return sub && sub.type !== 'table';
    });
  }

  // Does `childId` (a plain group) need its own plain sub-groups flattened
  // BEFORE being placed under `parentId`? True when child has plain sub-groups
  // AND the destination is inside a table scope (parentId is a table, or a
  // plain row of a table). The child shell itself is kept (becomes a row).
  function needsFlattenBeforeNest(allGroups, parentId, childId) {
    const child = allGroups.find(x => x.id === childId);
    if (!child || child.type === 'table') return false;
    if (!hasNestedSubGroups(allGroups, childId)) return false;
    if (parentId == null) return false;
    const parent = allGroups.find(x => x.id === parentId);
    if (!parent) return false;
    // Destination is in table scope if parent is a table, or parent is a row.
    return parent.type === 'table' || isPlainRowInTable(allGroups, parentId);
  }

  window.PresetList = { render, createGroupWithSelected, duplicateSelected, clearSelection, confirmSwitchIfDirty, refreshSkinData };
})();
