// Preset list sidebar — tree view for edit mode with nesting, collapse, drag-drop
(function () {
  const listEl = document.getElementById('preset-list');
  const countEl = document.getElementById('preset-count');
  const sectionEl = document.getElementById('preset-section');

  // Drop line overlay for preset / group reorder. Simple model: dragover on a
  // valid target sets position; dragend/drop hides. No heartbeat/rAF — the
  // browser fires dragover continuously while the cursor is over the element,
  // so the line stays put without polling. When the cursor moves to an element
  // WITHOUT a dragover handler (e.g. blank area), no new position is set but
  // the line stays at the last position — which is fine (it only needs to
  // disappear on drop/dragend, or when another handler clears it).
  function getDropLine(id) {
    let line = document.getElementById(id);
    if (!line) {
      line = document.createElement('div');
      line.id = id;
      line.className = 'preset-drop-line-overlay';
      line.style.cssText = 'position:fixed;height:0;z-index:9999;pointer-events:none;border-top:2px solid var(--accent);display:none';
      document.body.appendChild(line);
    }
    return line;
  }
  function hideDropLine(id) {
    const l = document.getElementById(id);
    if (l) l.style.display = 'none';
  }
  function hideAllDropLines() {
    hideDropLine('__preset_drop_line');
    hideDropLine('__group_drop_line');
  }

  // Drag state
  let dragPresetIds = null;     // number[] — preset ids being dragged
  let dragGroupId = null;       // number — group id being dragged
  let dragSourceGroupId = null; // number — source group for preset drag

  // Multi-select state
  let multiSelected = new Set(); // Set<number> — preset ids
  let lastClickedId = null;      // number — last clicked preset id

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
        // Selecting any preset clears group selection (mutually exclusive),
        // regardless of click modifier (plain/Ctrl/Shift).
        if (state.get('selectedGroup') != null) state.set('selectedGroup', null);
        if (e.ctrlKey || e.metaKey) {
          if (multiSelected.has(id)) {
            multiSelected.delete(id);
          } else {
            multiSelected.add(id);
          }
          lastClickedId = id;
        } else if (e.shiftKey && lastClickedId !== null) {
          const allIds = getAllVisiblePresetIds();
          const start = allIds.indexOf(lastClickedId);
          const end = allIds.indexOf(id);
          if (start !== -1 && end !== -1) {
            const [lo, hi] = start < end ? [start, end] : [end, start];
            if (!e.ctrlKey && !e.metaKey) multiSelected.clear();
            for (let i = lo; i <= hi; i++) multiSelected.add(allIds[i]);
          }
        } else {
          if (!await confirmSwitchIfDirty()) return;
          multiSelected.clear();
          multiSelected.add(id);
          lastClickedId = id;
          state.set('selectedPreset', id);
        }
        updateMultiSelectHighlights();
      });
    });

    updateMultiSelectHighlights();
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
      header.addEventListener('click', (e) => {
        const groupId = parseInt(header.dataset.groupId, 10);
        selectGroup(groupId);
      });
    });

    // ── Bind: preset drag & drop ──
    // Capture-phase dragover on the list: clear the drop line every frame so
    // it never lingers when the cursor moves off an item onto a group header
    // or blank area. Each per-item dragover re-positions it as needed.
    listEl.addEventListener('dragover', () => {
    }, true);
    // When the drag leaves the list container (cursor moves outside), clear any
    // lingering drop-target highlight + drop line so the edge doesn't stay lit.
    listEl.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && listEl.contains(e.relatedTarget)) return;
      listEl.querySelectorAll('.preset-tree__group--drop-target').forEach(el => {
        el.style.removeProperty('--drop-indent');
        el.classList.remove('preset-tree__group--drop-target');
      });
      hideAllDropLines();
    });
    listEl.querySelectorAll('.preset-tree__item').forEach(item => {
      item.setAttribute('draggable', 'true');

      item.addEventListener('dragstart', (e) => {
        const id = parseInt(item.dataset.id, 10);
        // Find source group
        const parentGroup = item.closest('.preset-tree__group');
        dragSourceGroupId = parentGroup ? parseInt(parentGroup.dataset.groupId, 10) : null;
        if (multiSelected.size > 1 && multiSelected.has(id)) {
          dragPresetIds = [...multiSelected];
        } else {
          dragPresetIds = [id];
        }
        // Highlight dragged items
        listEl.querySelectorAll('.preset-tree__item').forEach(el => {
          if (dragPresetIds.includes(parseInt(el.dataset.id, 10))) {
            el.classList.add('preset-tree__item--dragging');
          }
        });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'preset:' + dragPresetIds.join(','));
      });

      item.addEventListener('dragend', () => {
        listEl.querySelectorAll('.preset-tree__item--dragging').forEach(el => {
          el.classList.remove('preset-tree__item--dragging');
        });
        listEl.querySelectorAll('.preset-tree__group--drop-target').forEach(el => {
          el.style.removeProperty('--drop-indent');
          el.classList.remove('preset-tree__group--drop-target');
        });
        dragPresetIds = null;
        dragSourceGroupId = null;
      });

      // ── Per-item drop target: insert before/after this preset (in-group
      // reorder + cross-group positioned move). stopPropagation so the group-
      // level drop handler (append-to-end) does NOT also fire.
      const clearDropLine = () => {
        const line = document.getElementById('__preset_drop_line');
        if (line) line.style.display = 'none';
      };
      item.addEventListener('dragover', (e) => {
        if (!dragPresetIds) return;
        const r = item.getBoundingClientRect();
        const y = e.clientY - r.top;
        if (y > r.height * 0.3 && y < r.height * 0.7) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const before = y < r.height / 2;
        const line = getDropLine('__preset_drop_line');
        const cr = listEl.getBoundingClientRect();
        const left = Math.max(r.left, cr.left);
        const right = Math.min(r.right, cr.right);
        line.style.display = '';
        line.style.left = left + 'px';
        line.style.width = Math.max(0, right - left) + 'px';
        line.style.top = (before ? r.top : r.bottom) + 'px';
        
        listEl.querySelectorAll('.preset-tree__group--drop-target').forEach(el => {
          el.style.removeProperty('--drop-indent');
          el.classList.remove('preset-tree__group--drop-target');
        });
      });
      item.addEventListener('drop', async (e) => {
        if (!dragPresetIds) return;
        const groupEl = item.closest('.preset-tree__group');
        const r = item.getBoundingClientRect();
        const y = e.clientY - r.top;
        if (y > r.height * 0.3 && y < r.height * 0.7) return;
        e.preventDefault();
        e.stopPropagation();
        hideAllDropLines();
        const targetId = parseInt(item.dataset.id, 10);
        const before = y < r.height / 2;
        const skin = state.get('selectedSkin');
        if (!skin) return;
        const srcGroupId = dragSourceGroupId; // snapshot before any await (dragend may null it)
        const movedCount = dragPresetIds ? dragPresetIds.length : 0;
        if (groupEl) {
          // In-group: index in the group's `children` array (presets + sub-
          // groups interleaved — NOT DOM order).
          const targetGroupId = parseInt(groupEl.dataset.groupId, 10);
          const groups = state.get('groups') || [];
          const targetGroup = groups.find(g => g.id === targetGroupId);
          const children = (targetGroup && targetGroup.children) || [];
          const childIdx = children.findIndex(c => c.type === 'preset' && c.id === targetId);
          if (childIdx < 0) return;
          let insertIdx = before ? childIdx : childIdx + 1;
          for (const pid of dragPresetIds) {
            if (dragSourceGroupId === targetGroupId) {
              const srcIdx = children.findIndex(c => c.type === 'preset' && c.id === pid);
              if (srcIdx >= 0 && srcIdx < insertIdx) insertIdx = Math.max(0, insertIdx - 1);
            }
            await api.movePresetGroup(skin, pid, targetGroupId, insertIdx);
            insertIdx++;
          }
        } else {
          // Root: index in the unified rootChildren (mixed presets + groups).
          const rootChildren = state.get('rootChildren') || [];
          const childIdx = rootChildren.findIndex(c => c.type === 'preset' && c.id === targetId);
          let insertIdx = before ? childIdx : childIdx + 1;
          for (const pid of dragPresetIds) {
            if (srcGroupId === null) {
              const srcIdx = rootChildren.findIndex(c => c.type === 'preset' && c.id === pid);
              if (srcIdx >= 0 && srcIdx < insertIdx) insertIdx = Math.max(0, insertIdx - 1);
            }
            await api.movePresetGroup(skin, pid, null, insertIdx);
            insertIdx++;
          }
          // "Moved out of group" toast when the source was a group (not root-to-root).
          if (srcGroupId !== null) {
            Toast.info(i18n.t('group.movedOut', { count: movedCount }));
          }
        }
        await refreshSkinData(skin);
      });
    });

    // ── Bind: group drop targets for presets ──
    // Nesting (drop preset INTO a group) is recognized ONLY on the group
    // header — the group body is left for child reorder, avoiding conflicts.
    listEl.querySelectorAll('.preset-tree__group').forEach(groupEl => {
      groupEl.addEventListener('dragover', (e) => {
        if (!dragPresetIds || dragPresetIds.length === 0) return;
        // Only the group header acts as a nest target.
        const hdr = groupEl.querySelector(':scope > .preset-tree__group-header');
        if (!hdr || !hdr.contains(e.target)) return;
        e.stopPropagation();
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.querySelectorAll('.preset-tree__group--drop-target').forEach(el => {
          el.style.removeProperty('--drop-indent');
          el.classList.remove('preset-tree__group--drop-target');
        });
        groupEl.style.setProperty('--drop-indent', hdr ? hdr.style.marginLeft : '0px');
        groupEl.classList.add('preset-tree__group--drop-target');
      });

      groupEl.addEventListener('drop', async (e) => {
        // Only handle PRESET drops here; group drops have their own handler below.
        if (!dragPresetIds || dragPresetIds.length === 0) return;
        e.stopPropagation();
        e.preventDefault();
        groupEl.style.removeProperty('--drop-indent');
        groupEl.classList.remove('preset-tree__group--drop-target');
        // Only the group header accepts the nest drop (matches dragover).
        const dropHdr = groupEl.querySelector(':scope > .preset-tree__group-header');
        if (!dropHdr || !dropHdr.contains(e.target)) return;
        const targetGroupId = parseInt(groupEl.dataset.groupId, 10);

        const skin = state.get('selectedSkin');
        if (!skin) return;
        for (const pid of dragPresetIds) {
          await api.movePresetGroup(skin, pid, targetGroupId);
        }
        await refreshSkinData(skin);
        multiSelected.clear();
        updateMultiSelectHighlights();
      });
    });

    // ── Bind: group header drag (reorder/nest groups) ──
    listEl.querySelectorAll('.preset-tree__group-header').forEach(header => {
      header.setAttribute('draggable', 'true');

      header.addEventListener('dragstart', (e) => {
        // Block drag while editing the group name (input is inside header).
        if (e.target.tagName === 'INPUT' || header.querySelector('input')) { e.preventDefault(); return; }
        if (dragPresetIds) { e.preventDefault(); return; }
        // Clear any preset selection so the dragged group is the sole focus.
        if (multiSelected.size > 0 || lastClickedId != null) {
          multiSelected.clear();
          lastClickedId = null;
          updateMultiSelectHighlights();
        }
        dragGroupId = parseInt(header.dataset.groupId, 10);
        header.classList.add('preset-tree__group-header--dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'group:' + dragGroupId);
      });

      header.addEventListener('dragend', () => {
        header.classList.remove('preset-tree__group-header--dragging');
        dragGroupId = null;
        listEl.querySelectorAll('.preset-tree__group--drop-target').forEach(el => {
          el.style.removeProperty('--drop-indent');
          el.classList.remove('preset-tree__group--drop-target');
        });
        const dl = document.getElementById('__group_drop_line');
      });

      // Per-header drop: reorder a group BEFORE/AFTER this group (same-level
      // position), as opposed to dropping on the group body (nest into it).
      const getGroupLine = () => {
        let line = document.getElementById('__group_drop_line');
        if (!line) {
          line = document.createElement('div');
          line.id = '__group_drop_line';
          line.className = 'preset-drop-line-overlay';
          document.body.appendChild(line);
        }
        return line;
      };
      header.addEventListener('dragover', (e) => {
        // Clear any preset drop line when passing over a group header.
        const pdl = document.getElementById('__preset_drop_line');
        if (pdl) pdl.style.display = 'none';
        if (!dragGroupId) return;
        // Block dropping onto own descendant or self
        const groups = state.get('groups') || [];
        if (isDescendantOfGroup(groups, dragGroupId, parseInt(header.dataset.groupId, 10))) return;
        const r = header.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        if (!before) {
          // Lower half → clear the reorder line, let the group-body nest handler take over.
          const gdl = document.getElementById('__group_drop_line');
          if (gdl) gdl.style.display = 'none';
          // Still preventDefault so the browser doesn't show the "no-drop" cursor —
          // the group dragover handler will set dropEffect = 'move'.
          e.preventDefault();
          return;
        }
        // Upper half = insert before this group (same-level reorder).
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const line = getGroupLine();
        const cr = listEl.getBoundingClientRect();
        const left = Math.max(r.left, cr.left);
        const right = Math.min(r.right, cr.right);
        line.style.display = '';
        line.style.left = left + 'px';
        line.style.width = Math.max(0, right - left) + 'px';
        line.style.top = (before ? r.top : r.bottom) + 'px';
      });
      header.addEventListener('dragleave', () => {
        const line = document.getElementById('__group_drop_line');
        if (line) line.style.display = 'none';
      });
      header.addEventListener('drop', async (e) => {
        if (!dragGroupId) return;
        const groups = state.get('groups') || [];
        if (isDescendantOfGroup(groups, dragGroupId, parseInt(header.dataset.groupId, 10))) return;
        const r = header.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        if (!before) return; // lower half → let group-body nest handler drop
        e.preventDefault();
        e.stopPropagation();
        const line = document.getElementById('__group_drop_line');
        if (line) line.style.display = 'none';
        const targetGroupId = parseInt(header.dataset.groupId, 10);
        if (dragGroupId === targetGroupId) return;
        // Find target group's parent and its index among siblings.
        const skin = state.get('selectedSkin');
        if (!skin) return;
        // Determine target's parent + child index.
        let targetParentId = null;
        let targetChildIdx = -1;
        for (const g of groups) {
          const idx = g.children.findIndex(c => c.type === 'group' && c.id === targetGroupId);
          if (idx >= 0) { targetParentId = g.id; targetChildIdx = idx; break; }
        }
        if (targetChildIdx < 0) {
          // Target is at root — find in the unified rootChildren (mixed).
          const rootChildren = state.get('rootChildren') || [];
          targetChildIdx = rootChildren.findIndex(c => c.type === 'group' && c.id === targetGroupId);
        }
        if (targetChildIdx < 0) return;
        // `before` already computed above (upper half only reaches here).
        let insertIdx = targetChildIdx;
        // Same-parent adjust: move_group removes source first.
        // Check if drag group is in the same parent and before the target.
        const checkSameParent = (parentId) => {
          if (parentId === null) {
            const rootChildren = state.get('rootChildren') || [];
            const srcIdx = rootChildren.findIndex(c => c.type === 'group' && c.id === dragGroupId);
            return srcIdx >= 0 && srcIdx < insertIdx;
          }
          const pg = groups.find(g => g.id === parentId);
          if (!pg) return false;
          const srcIdx = pg.children.findIndex(c => c.type === 'group' && c.id === dragGroupId);
          return srcIdx >= 0 && srcIdx < insertIdx;
        };
        if (checkSameParent(targetParentId)) insertIdx = Math.max(0, insertIdx - 1);
        await api.moveGroup(skin, dragGroupId, targetParentId, insertIdx);
        refreshSkinData(skin);
      });
    });

    // ── Bind: group drop targets for group reorder/nest ──
    listEl.querySelectorAll('.preset-tree__group').forEach(groupEl => {
      groupEl.addEventListener('dragover', (e) => {
        if (!dragGroupId) return;
        // Nesting recognized only on the group header (avoid conflict with
        // child reorder in the group body).
        const hdr = groupEl.querySelector(':scope > .preset-tree__group-header');
        if (!hdr || !hdr.contains(e.target)) return;
        // Block dropping parent group onto its own descendant
        const targetGroupId = parseInt(groupEl.dataset.groupId, 10);
        const groups = state.get('groups') || [];
        if (isDescendantOfGroup(groups, dragGroupId, targetGroupId)) {
          e.dataTransfer.dropEffect = 'none';
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.querySelectorAll('.preset-tree__group--drop-target').forEach(el => {
          el.style.removeProperty('--drop-indent');
          el.classList.remove('preset-tree__group--drop-target');
        });
        groupEl.style.setProperty('--drop-indent', hdr ? hdr.style.marginLeft : '0px');
        groupEl.classList.add('preset-tree__group--drop-target');
      });

      groupEl.addEventListener('drop', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        groupEl.style.removeProperty('--drop-indent');
        groupEl.classList.remove('preset-tree__group--drop-target');
        if (!dragGroupId) return;
        const dragGidSnapshot = dragGroupId;  // snapshot before any await (dragend may null it)
        // Only the group header accepts the nest drop (matches dragover).
        const dropHdr = groupEl.querySelector(':scope > .preset-tree__group-header');
        if (!dropHdr || !dropHdr.contains(e.target)) return;
        const targetGroupId = parseInt(groupEl.dataset.groupId, 10);
        if (dragGidSnapshot === targetGroupId) return;
        // Block dropping parent group onto its own descendant
        const groups = state.get('groups') || [];
        if (isDescendantOfGroup(groups, dragGidSnapshot, targetGroupId)) {
          Toast.error(i18n.t('group.cannotMoveIntoChild'));
          return;
        }
        const skin = state.get('selectedSkin');
        if (!skin) return;
        // Dropping a group into a table group:
        // - Into the table group itself: flatten only if it has nested plain sub-groups.
        // - Into a row inside the table group: always flatten (a group can't be a
        //   sub-row, so it must be collapsed regardless of its contents).
        const targetGroup = groups.find(g => g.id === targetGroupId);
        const dragGroup = groups.find(g => g.id === dragGidSnapshot);
        const dragIsTable = dragGroup && dragGroup.type === 'table';
        const targetIsTable = targetGroup && targetGroup.type === 'table';
        const targetIsRowInTable = targetGroup && isPlainRowInTable(groups, targetGroupId);
        // 2×2 matrix:
        //   普通A→表格a: check hasNestedSubGroups → flatten confirm
        //   普通A→行b:   always flatten confirm (rows can't have plain sub-groups)
        //   表格B→表格a: pass
        //   表格B→行b:   pass
        const needFlatten = !dragIsTable && (
          (targetIsTable && hasNestedSubGroups(groups, dragGidSnapshot)) || targetIsRowInTable
        );
        if (needFlatten) {
          const choice = await ApplyDialog.showConfirmDialog(
            i18n.t('group.flattenConfirm'),
            [
              { label: i18n.t('group.flattenForce'), cls: 'btn--primary', value: 'flatten' },
              { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
            ]
          );
          if (choice !== 'flatten') return;
          if (targetIsTable) {
            // 普通A→复选a: flatten A first (remove its plain sub-groups), then move.
            await api.flattenGroupSubgroups(skin, dragGidSnapshot);
            await api.moveGroup(skin, dragGidSnapshot, targetGroupId);
          } else {
            // 普通A→行b: move A into b first, then flatten b (merge A's content into b).
            await api.moveGroup(skin, dragGidSnapshot, targetGroupId);
            await api.flattenGroupSubgroups(skin, targetGroupId);
          }
          await refreshSkinData(skin);
          return;
        }
        const moveResult = await api.moveGroup(skin, dragGidSnapshot, targetGroupId);
        if (!moveResult || !moveResult.success) {
          Toast.error(i18n.t('group.moveFailed', { msg: ((moveResult && moveResult.error) || i18n.t('app.unknownError')) }));
          return;
        }
        await refreshSkinData(skin);
      });
    });

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
        deleteZone.style.opacity = '0.5';
        deleteZone.style.background = '';
        deleteZone.classList.remove('preset-drop-zone--active');
        const skin = state.get('selectedSkin');
        if (!skin) return;
        if (dragPresetIds && dragPresetIds.length > 0) {
          const ids = [...dragPresetIds];
          // Batch delete — one-by-one leaves stale ids after compact_ids.
          const result = await api.deletePresets(skin, ids);
          if (result.success && ids.includes(state.get('selectedPreset'))) {
            state.set('selectedPreset', null);
          }
          await refreshSkinData(skin);
          multiSelected.clear();
          lastClickedId = null;
          updateMultiSelectHighlights();
          Toast.info(i18n.t('preset.deleted', { count: ids.length }));
        } else if (dragGroupId) {
          const result = await api.deleteGroupRecursive(skin, dragGroupId);
          if (result.success) {
            const d = result.data;
            // The deleted group (and its presets) is gone — clear any selection
            // that pointed at it and switch the editor to a fresh new-preset form.
            state.set('selectedGroup', null);
            state.set('presetDirty', false);
            state.set('selectedPreset', '__new__');
            if (window.PresetEditor && typeof window.PresetEditor.resetNew === 'function') {
              window.PresetEditor.resetNew();
            }
            multiSelected.clear();
            lastClickedId = null;
            await refreshSkinData(skin);
            Toast.success(i18n.t('group.deletedRecursive', { presets: d.deletedPresets, groups: d.deletedGroups }));
          } else {
            Toast.error(i18n.t('group.deleteFailed', { msg: (result.error || i18n.t('app.unknownError')) }));
          }
        }
      });
    }

    // ── Bind: root-level drop zone (make presets/groups orphan/root-level) ──
    if (!listEl._rootDropBound) {
      listEl._rootDropBound = true;

      listEl.addEventListener('dragover', (e) => {
        if (!dragPresetIds && !dragGroupId) return;
        // Only handle drops on empty space, not on groups (groups handle themselves)
        if (!e.target.closest('.preset-tree__group')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          listEl.classList.add('preset-list--drop-root');
          // Dragged out of any group → clear stale group drop-target highlight.
          listEl.querySelectorAll('.preset-tree__group--drop-target').forEach(el => {
            el.style.removeProperty('--drop-indent');
            el.classList.remove('preset-tree__group--drop-target');
          });
        }
      });

      listEl.addEventListener('dragleave', (e) => {
        if (!listEl.contains(e.relatedTarget)) {
          listEl.classList.remove('preset-list--drop-root');
        }
      });

      listEl.addEventListener('drop', async (e) => {
        listEl.classList.remove('preset-list--drop-root');
        // Skip if dropped on a group element (group handler already processed it)
        if (e.target.closest('.preset-tree__group')) return;

        const skin = state.get('selectedSkin');
        if (!skin) return;

        if (dragPresetIds && dragPresetIds.length > 0) {
          const movedCount = dragPresetIds.length;
          const fromGroup = dragSourceGroupId !== null;
          for (const pid of dragPresetIds) {
            await api.movePresetGroup(skin, pid, null);
          }
          await refreshSkinData(skin);
          multiSelected.clear();
          updateMultiSelectHighlights();
          if (fromGroup) {
            Toast.info(i18n.t('group.movedOut', { count: movedCount }));
          }
        } else if (dragGroupId) {
          const rootChildren = state.get('rootChildren') || [];
          const alreadyRoot = rootChildren.some(c => c.type === 'group' && c.id === dragGroupId);
          await api.moveGroup(skin, dragGroupId, null);
          await refreshSkinData(skin);
          if (!alreadyRoot) {
            Toast.info(i18n.t('group.movedToRoot'));
          }
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
              updateCountBadgeVisibility(scrollContainer);
              ticking = false;
            });
            ticking = true;
          }
        });
      }
      // Update initial visibility after render
      updateCountBadgeVisibility(scrollContainer);
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
        }
      }
      for (const child of group.children) {
        if (child.type === 'group') {
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

  function getAllVisiblePresetIds() {
    const ids = [];
    listEl.querySelectorAll('.preset-tree__item').forEach(el => {
      ids.push(parseInt(el.dataset.id, 10));
    });
    return ids;
  }

  function updateMultiSelectHighlights() {
    listEl.querySelectorAll('.preset-tree__item').forEach(item => {
      const id = parseInt(item.dataset.id, 10);
      item.classList.toggle('preset-tree__item--multi-selected', multiSelected.has(id));
    });
  }

  // Clear all selection state (multi-select + last-clicked) and refresh the
  // tree highlights. Shared by the sidebar button and the new-preset shortcut.
  function clearSelection() {
    multiSelected.clear();
    lastClickedId = null;
    state.set('selectedGroup', null);
    updateMultiSelectHighlights();
    updateGroupSelectionHighlights();
  }

  // Select a group for basic-info editing (mutually exclusive with selectedPreset).
  // Selecting does NOT expand/collapse — use the collapse arrow for that.
  async function selectGroup(groupId) {
    if (!await confirmSwitchIfDirty()) return;
    // Set ALL three in one setMultiple so listeners fire after all three are set
    // (no intermediate state where selectedPreset is stale → save button flashes).
    state.setMultiple({
      selectedPreset: null,
      selectedGroup: groupId,
      presetDirty: false,
    });
    multiSelected.clear();
    lastClickedId = null;
    updateMultiSelectHighlights();
    updateGroupSelectionHighlights();
  }

  function updateGroupSelectionHighlights() {
    const sel = state.get('selectedGroup');
    listEl.querySelectorAll('.preset-tree__group-header').forEach(h => {
      const id = parseInt(h.dataset.groupId, 10);
      h.classList.toggle('preset-tree__group-header--selected', id === sel);
    });
  }

  function updateCountBadgeVisibility(_container) {
    // Badges live inside their header (flex child, margin-left:auto) and follow
    // it naturally — no JS positioning needed.
  }

  async function refreshSkinData(skin) {
    const scanResult = await api.scanPresets(skin);
    if (scanResult.success) {
      state.setMultiple({
        presets: scanResult.data.presets,
        groups: scanResult.data.groups,
        rootChildren: scanResult.data.rootChildren || [],
      });
    }
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

  // ── Group rename ──

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
        clearSelection();
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
        if (multiSelected.size > 0 || selGid != null) {
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
        if (multiSelected.size > 0 || selGid2 != null) {
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

  // ── Copy selected presets ──

  async function copySelected() {
    if (multiSelected.size === 0) return;
    const skin = state.get('selectedSkin');
    if (!skin) return;

    let copied = 0;
    for (const id of multiSelected) {
      const r = await api.loadPreset(skin, id);
      if (!r.success || !r.data) continue;

      const data = { ...r.data };
      if (!data.meta) data.meta = {};
      data.meta.name = (data.meta.name || i18n.t('preset.fallbackName', { id: r.data.id })) + i18n.t('preset.copySuffix');
      // Save with id: null — server assigns new id
      const saveResult = await api.savePreset(skin, null, data);
      if (saveResult.success) copied++;
    }

    multiSelected.clear();
    lastClickedId = null;
    await refreshSkinData(skin);
    if (copied > 0) Toast.success(i18n.t('preset.copied', { count: copied }));
  }

  // ── Delete selected presets ──

  async function deleteSelected() {
    const skin = state.get('selectedSkin');
    if (!skin || multiSelected.size === 0) return;
    const ids = [...multiSelected];
    const confirmed = await ApplyDialog.showConfirmDialog(
      i18n.t('preset.deleteConfirm', { count: ids.length }),
      [
        { label: i18n.t('preset.deleteCountBtn', { count: ids.length }), cls: 'btn--danger', value: 'delete' },
        { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
      ]
    );
    if (!confirmed || confirmed !== 'delete') return;

    // Batch delete in one pass — deletePresets compacts ids once, whereas
    // deleting one-by-one leaves the frontend holding stale ids (compact_ids
    // re-numbers every preset after each delete) and only removes ~half.
    const result = await api.deletePresets(skin, ids);
    if (result.success) {
      if (ids.includes(state.get('selectedPreset'))) {
        state.set('selectedPreset', null);
      }
      multiSelected.clear();
      lastClickedId = null;
      if (result.data > 0) Toast.success(i18n.t('preset.deleted', { count: result.data }));
    }
    await refreshSkinData(skin);
  }

  // ── Tree helpers for smart group creation ──

  function findPresetParentGroupId(groups, presetId) {
    // Return the IMMEDIATE parent group (direct child), not a top-level ancestor
    for (const g of groups) {
      if (g.children && g.children.some(c => c.type === 'preset' && c.id === presetId)) {
        return g.id;
      }
      if (g.children && g.children.some(c => c.type === 'preset' && c.id === presetId)) {
        return g.id;
      }
    }
    return null; // orphan (not in any group's direct children)
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
            .map(c => cntGroupMap.get(c.id))
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

    // Determine the appropriate parent group for the new group
    let parentGroupId = null;
    const groups = state.get('groups') || [];
    const selGid = state.get('selectedGroup');
    if (selGid != null) {
      const selGroup = groups.find(g => g.id === selGid);
      // Block: selected group is a row (plain group inside a table group).
      // Can't create a plain group inside it (2nd-level nesting).
      if (!isTable && isPlainRowInTable(groups, selGid)) {
        Toast.warning(i18n.t('group.cannotNestInTableRow'));
        return;
      }
      // A group is selected: new group goes in the SAME parent (sibling),
      // then the selected group is moved INTO the new group.
      const parent = groups.find(g => g.children && g.children.some(c => c.type === 'group' && c.id === selGid));
      parentGroupId = parent ? parent.id : null;
    } else if (multiSelected.size > 0) {
      const parentIds = new Set();
      for (const pid of multiSelected) {
        parentIds.add(findPresetParentGroupId(groups, pid));
      }
      const uniqueParents = [...parentIds].filter(id => id !== null);

      if (parentIds.has(null)) {
        // Some presets are orphaned — create at root level
        parentGroupId = null;
      } else if (uniqueParents.length === 1) {
        // All presets are in the same group — new group is child of that group
        parentGroupId = uniqueParents[0];
      } else {
        // Presets are in different groups — find lowest common ancestor
        parentGroupId = findOutermostCommonAncestor(groups, uniqueParents);
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

    if (multiSelected.size > 0) {
      for (const pid of multiSelected) {
        await api.movePresetGroup(skin, pid, newGroupId);
      }
      Toast.success(isTable
        ? i18n.t('group.createdTable', { name: newName })
        : i18n.t('group.createdWithPresets', { name: newName, count: multiSelected.size }));
      multiSelected.clear();
      lastClickedId = null;
    } else if (selGid != null) {
      // Moving the selected group INTO the new group. When creating a TABLE
      // (checkbox) group, a source group that contains nested plain sub-groups
      // can't live inside it (a table group only allows one level of plain
      // sub-groups as rows) — same merge check as the drag-into-table path.
      if (isTable && hasNestedSubGroups(groups, selGid)) {
        const choice = await ApplyDialog.showConfirmDialog(
          i18n.t('group.flattenConfirm'),
          [
            { label: i18n.t('group.flattenForce'), cls: 'btn--primary', value: 'flatten' },
            { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
          ]
        );
        if (choice !== 'flatten') {
          // Abort: remove the just-created empty table group so we don't leave
          // an orphan, then bail.
          await api.removeGroup(skin, newGroupId);
          await refreshSkinData(skin);
          return;
        }
        await api.flattenGroupSubgroups(skin, selGid);
      }
      // Move the selected group INTO the new group.
      await api.moveGroup(skin, selGid, newGroupId);
      state.set('selectedGroup', newGroupId);
      Toast.success(isTable
        ? i18n.t('group.createdTable', { name: newName })
        : i18n.t('group.createdEmpty', { name: newName }));
    } else {
      Toast.success(isTable
        ? i18n.t('group.createdTable', { name: newName })
        : i18n.t('group.createdEmpty', { name: newName }));
    }
    await refreshSkinData(skin);
  }

  function updateSidebarSaveButton(btn) {
    const mode = state.get('appMode');
    const dirty = state.get('presetDirty');
    const isNew = state.get('selectedPreset') === '__new__';
    const editingGroup = state.get('selectedGroup') != null;
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

  // Check: is the currently selected preset inside a table group or table row?
  // Check if a group is a plain sub-group inside a table group (i.e. it's a
  // "row" — creating another plain group inside it would be a 2nd-level nest).
  // Check if a group is a plain sub-group inside a table group (i.e. it's a
  // "row" — creating another plain group inside it would be a 2nd-level nest).
  function isPlainRowInTable(allGroups, groupId) {
    if (groupId == null) return false;
    const g = allGroups.find(x => x.id === groupId);
    if (!g || g.type === 'table') return false;
    // Find this group's parent.
    for (const pg of allGroups) {
      if (pg.children && pg.children.some(c => c.type === 'group' && c.id === groupId)) {
        return pg.type === 'table';
      }
    }
    return false;
  }

  // Check if a group has any DIRECT plain (non-table) sub-groups.
  function hasNestedSubGroups(allGroups, groupId) {
    const g = allGroups.find(x => x.id === groupId);
    if (!g || !g.children) return false;
    return g.children.some(c => {
      if (c.type !== 'group') return false;
      const sub = allGroups.find(x => x.id === c.id);
      return sub && sub.type !== 'table';
    });
  }

  window.PresetList = { render, createGroupWithSelected, deleteSelected, copySelected, clearSelection, confirmSwitchIfDirty, refreshSkinData };
})();
