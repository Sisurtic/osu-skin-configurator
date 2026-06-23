// Preset list sidebar — tree view for edit mode with nesting, collapse, drag-drop
(function () {
  const listEl = document.getElementById('preset-list');
  const countEl = document.getElementById('preset-count');
  const sectionEl = document.getElementById('preset-section');

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
    const rootGroupIds = state.get('rootGroupIds') || [];
    countEl.textContent = presets.length > 0 ? presets.length : '';
    countEl.style.display = presets.length > 0 ? '' : 'none';

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
    const presetsInTree = new Set();
    function collectPresets(children) {
      if (!children) return;
      for (const c of children) {
        if (c.type === 'preset') {
          presetsInTree.add(c.id);
        } else if (c.type === 'group') {
          const subGroup = groupMap.get(c.id);
          if (subGroup) collectPresets(subGroup.children);
        }
      }
    }
    for (const g of groups) collectPresets(g.children);
    const orphanPresets = presets.filter(p => !presetsInTree.has(p.id));

    // Build root children HTML
    let html = '';

    // Render orphan presets at root level (before groups)
    if (orphanPresets.length > 0) {
      html += '<div class="preset-tree-root">';
      for (const p of orphanPresets) {
        html += renderPresetNode(p, selectedPreset, 0);
      }
      html += '</div>';
    }

    // Render root groups (in rootGroupIds order)
    for (const childId of rootGroupIds) {
      const group = groupMap.get(childId);
      if (!group) continue;
      html += renderGroupNode(group, groups, presetMap, selectedPreset, 0);
    }

    // Render any groups not in rootGroupIds (shouldn't happen, but be safe)
    const inRoot = new Set(rootGroupIds);
    for (const g of groups) {
      if (!inRoot.has(g.id)) {
        let isChild = false;
        for (const pg of groups) {
          if (pg.children && pg.children.some(c => c.type === 'group' && c.id === g.id)) {
            isChild = true;
            break;
          }
        }
        if (!isChild) {
          html += renderGroupNode(g, groups, presetMap, selectedPreset, 0);
        }
      }
    }

    listEl.innerHTML = `<div class="preset-tree">${html}</div>`;

    // Horizontal scroll should stop exactly when the deepest row pins flush-left,
    // i.e. at scrollLeft == deepest row's margin-left (maxIndent). Make the tree
    // wide enough to scroll and CLAMP scrollLeft to maxIndent.
    const treeEl = listEl.querySelector('.preset-tree');
    let maxIndent = 0;
    listEl.querySelectorAll('.preset-tree__group-header, .preset-tree__item').forEach(el => {
      const ml = parseInt(el.style.marginLeft, 10) || 0;
      if (ml > maxIndent) maxIndent = ml;
    });
    if (treeEl) {
      treeEl.style.width = (listEl.clientWidth + maxIndent) + 'px';
    }
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

    // ── Bind: group name double-click → rename ──
    listEl.querySelectorAll('.preset-tree__group-name').forEach(nameEl => {
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const header = nameEl.closest('.preset-tree__group-header');
        const groupId = parseInt(header.dataset.groupId, 10);
        const group = groupMap.get(groupId);
        if (group) startGroupRename(header, group);
      });
    });

    // ── Bind: preset drag & drop ──
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
    });

    // ── Bind: group drop targets for presets ──
    listEl.querySelectorAll('.preset-tree__group').forEach(groupEl => {
      groupEl.addEventListener('dragover', (e) => {
        if (!dragPresetIds || dragPresetIds.length === 0) return;
        e.stopPropagation();
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.querySelectorAll('.preset-tree__group--drop-target').forEach(el => {
          el.style.removeProperty('--drop-indent');
          el.classList.remove('preset-tree__group--drop-target');
        });
        const hdr = groupEl.querySelector(':scope > .preset-tree__group-header');
        groupEl.style.setProperty('--drop-indent', hdr ? hdr.style.marginLeft : '0px');
        groupEl.classList.add('preset-tree__group--drop-target');
      });

      groupEl.addEventListener('drop', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        groupEl.style.removeProperty('--drop-indent');
        groupEl.classList.remove('preset-tree__group--drop-target');
        if (!dragPresetIds || dragPresetIds.length === 0) return;
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
        if (dragPresetIds) { e.preventDefault(); return; }
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
      });
    });

    // ── Bind: group drop targets for group reorder/nest ──
    listEl.querySelectorAll('.preset-tree__group').forEach(groupEl => {
      groupEl.addEventListener('dragover', (e) => {
        if (!dragGroupId) return;
        e.stopPropagation();
        // Block dropping parent group onto its own descendant
        const targetGroupId = parseInt(groupEl.dataset.groupId, 10);
        const groups = state.get('groups') || [];
        if (isDescendantOfGroup(groups, dragGroupId, targetGroupId)) {
          e.dataTransfer.dropEffect = 'none';
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.querySelectorAll('.preset-tree__group--drop-target').forEach(el => {
          el.style.removeProperty('--drop-indent');
          el.classList.remove('preset-tree__group--drop-target');
        });
        const hdr = groupEl.querySelector(':scope > .preset-tree__group-header');
        groupEl.style.setProperty('--drop-indent', hdr ? hdr.style.marginLeft : '0px');
        groupEl.classList.add('preset-tree__group--drop-target');
      });

      groupEl.addEventListener('drop', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        groupEl.style.removeProperty('--drop-indent');
        groupEl.classList.remove('preset-tree__group--drop-target');
        if (!dragGroupId) return;
        const targetGroupId = parseInt(groupEl.dataset.groupId, 10);
        if (dragGroupId === targetGroupId) return;
        // Block dropping parent group onto its own descendant
        const groups = state.get('groups') || [];
        if (isDescendantOfGroup(groups, dragGroupId, targetGroupId)) {
          Toast.error(i18n.t('group.cannotMoveIntoChild'));
          return;
        }
        const skin = state.get('selectedSkin');
        if (!skin) return;
        const moveResult = await api.moveGroup(skin, dragGroupId, targetGroupId);
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
            // Check against pre-compaction deleted IDs to avoid false matches
            if (state.get('selectedPreset') !== null && d.deletedPresetIds.includes(state.get('selectedPreset'))) {
              state.set('selectedPreset', null);
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
          for (const pid of dragPresetIds) {
            await api.movePresetGroup(skin, pid, null);
          }
          await refreshSkinData(skin);
          multiSelected.clear();
          updateMultiSelectHighlights();
          Toast.info(i18n.t('group.movedOut', { count: dragPresetIds.length }));
        } else if (dragGroupId) {
          await api.moveGroup(skin, dragGroupId, null);
          await refreshSkinData(skin);
          Toast.info(i18n.t('group.movedToRoot'));
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
  }

  // ── Recursive rendering ──

  function renderGroupNode(group, allGroups, presetMap, selectedPreset, depth) {
    const isCollapsed = group.collapsed === true;
    const indent = depth * 20; // 20px per nesting level (base 0)
    let html = `<div class="preset-tree__group" data-group-id="${group.id}">`;
    const totalPresetCount = countAllPresetsRecursive(group, allGroups);
    html += `<div class="preset-tree__group-header" data-group-id="${group.id}" style="margin-left:${indent}px">
      <span class="preset-tree__collapse-icon">${isCollapsed ? '▶' : '▼'}</span>
      <span class="preset-tree__group-name">${escapeHtml(group.name)}</span>
      ${totalPresetCount > 0 ? `<span class="preset-tree__group-count">${totalPresetCount}</span>` : ''}
    </div>`;

    if (!isCollapsed && group.children && group.children.length > 0) {
      html += '<div class="preset-tree__group-children">';
      // Render direct presets first (at top of group, above sub-groups)
      for (const child of group.children) {
        if (child.type === 'preset') {
          const preset = presetMap.get(child.id);
          if (preset) {
            html += renderPresetNode(preset, selectedPreset, depth + 1);
          }
        }
      }
      // Render sub-groups after direct presets
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
    const desc = preset.meta?.description || '';
    return `
      <div class="preset-tree__item ${isEditing ? 'preset-tree__item--editing' : ''}"
           data-id="${preset.id}" style="margin-left:${indent}px">
        <span class="preset-tree__item-icon">📄</span>
        <span class="preset-tree__item-name" title="${escapeHtml(desc || name)}">${escapeHtml(name)}</span>
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
    updateMultiSelectHighlights();
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
        rootGroupIds: scanResult.data.rootGroupIds,
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
    // Update local state immediately for responsive UI
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
    const toToggle = [];
    const collect = (g) => {
      toToggle.push(g);
      if (!g.children) return;
      for (const c of g.children) {
        if (c.type === 'group') {
          const sub = byId.get(c.id);
          if (sub) collect(sub);
        }
      }
    };
    collect(root);
    for (const g of toToggle) {
      await api.setGroupCollapsed(skin, g.id, target);
      g.collapsed = target;
    }
    state.set('groups', [...groups]);
  }

  // ── Group rename ──

  function startGroupRename(headerEl, group) {
    const nameEl = headerEl.querySelector('.preset-tree__group-name');
    if (!nameEl) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input';
    input.value = group.name;
    input.style.cssText = 'font-size:11px;padding:1px 4px;width:120px';

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      const newName = input.value.trim();
      if (!newName || newName === group.name) {
        input.replaceWith(nameEl);
        return;
      }
      input.disabled = true;
      input.replaceWith(nameEl);
      try {
        const skin = state.get('selectedSkin');
        const result = await api.renameGroup(skin, group.id, newName);
        if (result.success) {
          Toast.success(i18n.t('group.renamed', { name: newName }));
          await refreshSkinData(skin);
        } else {
          Toast.error(i18n.t('group.renameFailed', { msg: (result.error || i18n.t('app.unknownError')) }));
        }
      } catch (err) {
        Toast.error(i18n.t('group.renameFailed', { msg: (err.message || i18n.t('app.unknownError')) }));
      }
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = group.name; input.blur(); }
    });
  }

  // ── Bottom actions ──

  function buildBottomActions() {
    const bottomActions = document.getElementById('preset-bottom-actions');
    if (bottomActions) {
      bottomActions.style.display = 'block';
      bottomActions.innerHTML = `
        <div style="padding:8px 16px">
          <button class="btn btn--secondary btn--sm" id="btn-new-preset-sidebar" style="width:100%">
            ${i18n.t('group.newPreset')}
          </button>
        </div>
        <div style="padding:4px 16px 8px">
          <button class="btn btn--secondary btn--sm" id="btn-new-empty-group" style="width:100%">
            ${i18n.t('group.newGroup')}
          </button>
        </div>
        <div style="padding:4px 16px 8px">
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
        <div style="padding:8px 16px">
          <button class="btn btn--secondary btn--sm" id="btn-new-preset-sidebar" style="width:100%">
            ${i18n.t('group.newPreset')}
          </button>
        </div>
        <div style="padding:4px 16px 8px">
          <button class="btn btn--secondary btn--sm" id="btn-new-empty-group" style="width:100%">
            ${i18n.t('group.newGroup')}
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
        const newName = await promptNewGroupName();
        if (!newName) return;
        const skin = state.get('selectedSkin');
        if (!skin) return;
        const result = await api.addGroup(skin, newName, null); // null = root level
        if (result.success) {
          Toast.success(i18n.t('group.created', { name: newName }));
          await refreshSkinData(skin);
        } else {
          Toast.error(i18n.t('group.createFailed', { msg: (result.error || i18n.t('app.unknownError')) }));
        }
      });
    }

    const btnSaveSidebar = document.getElementById('btn-save-preset-sidebar');
    if (btnSaveSidebar) {
      btnSaveSidebar.addEventListener('click', () => {
        if (window.PresetEditor && typeof window.PresetEditor.doSave === 'function') {
          window.PresetEditor.doSave();
        }
      });
      updateSidebarSaveButton(btnSaveSidebar);
    }
  }

  // ── Prompt new group name ──

  function promptNewGroupName() {
    return new Promise((resolve) => {
      if (document.querySelector('.modal-overlay')) return resolve(null);
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="min-width:320px">
          <div class="modal__title">${i18n.t('group.createTitle')}</div>
          <div class="modal__body">
            <input type="text" class="form-input" id="new-group-name-input"
                   placeholder="${i18n.t('group.namePlaceholder')}" style="width:100%">
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
    const choice = await ApplyDialog.showConfirmDialog(
      i18n.t('dialog.unsavedSwitch'),
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
        if (sub) count += countAllPresetsRecursive(sub, allGroups);
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

  async function createGroupWithSelected() {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const newName = await promptNewGroupName();
    if (!newName) return;

    // Determine the appropriate parent group for the new group
    let parentGroupId = null;
    if (multiSelected.size > 0) {
      const groups = state.get('groups') || [];
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

    const result = await api.addGroup(skin, newName, parentGroupId);
    if (!result.success) {
      Toast.error(i18n.t('group.createFailed', { msg: (result.error || i18n.t('app.unknownError')) }));
      return;
    }
    const newGroupId = result.data;

    if (multiSelected.size > 0) {
      for (const pid of multiSelected) {
        await api.movePresetGroup(skin, pid, newGroupId);
      }
      Toast.success(i18n.t('group.createdWithPresets', { name: newName, count: multiSelected.size }));
      multiSelected.clear();
      lastClickedId = null;
    } else {
      Toast.success(i18n.t('group.createdEmpty', { name: newName }));
    }
    await refreshSkinData(skin);
  }

  function updateSidebarSaveButton(btn) {
    const mode = state.get('appMode');
    const dirty = state.get('presetDirty');
    const isNew = state.get('selectedPreset') === '__new__';
    // New presets can always be saved (continuous save), even when not dirty.
    btn.disabled = (mode !== 'edit' || (!dirty && !isNew));
  }

  // ── State listeners ──

  state.on('presets', (presets) => render(presets, state.get('selectedPreset'), state.get('selectedSkin')));
  state.on('groups', () => render(state.get('presets'), state.get('selectedPreset'), state.get('selectedSkin')));
  state.on('rootGroupIds', () => render(state.get('presets'), state.get('selectedPreset'), state.get('selectedSkin')));
  state.on('selectedSkin', (skinName) => render(state.get('presets'), null, skinName));
  state.on('selectedPreset', (presetId) => render(state.get('presets'), presetId, state.get('selectedSkin')));
  state.on('appMode', () => render(state.get('presets'), state.get('selectedPreset'), state.get('selectedSkin')));

  state.on('presetDirty', () => {
    const btn = document.getElementById('btn-save-preset-sidebar');
    if (btn) updateSidebarSaveButton(btn);
  });

  window.PresetList = { render, createGroupWithSelected, deleteSelected, copySelected, clearSelection, confirmSwitchIfDirty };
})();
