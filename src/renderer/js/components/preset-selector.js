// Preset selector — use mode: displays preset tree with radio selection per group + hover preview
(function () {
  const viewEl = document.getElementById('view-selector');

  let hoverTimer = null;
  let resetTimer = null;
  let previewCache = {};   // previewPath → dataURL (loaded on skin select)
  let shortcutSelected = new Set();   // preset ids collected via right-click / Ctrl+right-click
  let recorderActive = false;          // true while waiting for the next keypress to bind

  // Shared empty-state markup for the preview panel. MUST be a function (not a
  // module-level const) so i18n.t() runs after the locale dictionaries are
  // loaded — a const would evaluate at IIFE load time, before i18n.load(),
  // and cache raw key names.
  function emptyPreviewHtml() {
    return `<div class="preset-preview-panel__empty">${i18n.t('selector.hoverHint')}<br>${i18n.t('selector.hoverHint2')}<br><br>${i18n.t('selector.clickSelect')}<br>${i18n.t('selector.rightClickShortcut')}<br>${i18n.t('selector.ctrlMulti')}</div>`;
  }

  function render() {
    const skin = state.get('selectedSkin');
    const presets = state.get('presets') || [];
    const groups = state.get('groups') || [];
    const rootGroupIds = state.get('rootGroupIds') || [];
    const activePresets = state.get('activePresets') || {};

    if (!skin) {
      viewEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">📁</div>
          <div class="empty-state__title">${i18n.t('selector.noSkin')}</div>
          <div class="empty-state__desc">${i18n.t('selector.noSkinHint')}</div>
        </div>
      `;
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

    // Collect all selected ids (arrays → flattened)
    const selectedIds = [].concat(...Object.values(activePresets).filter(a => Array.isArray(a)));
    const hasSelection = selectedIds.length > 0;

    let html = '<div class="preset-selector"><div class="preset-selector__header">';
    html += `<h3>${i18n.t('selector.heading')}</h3><span style="font-size:12px;color:var(--text-muted)">${i18n.t('selector.headingHint')}</span>`;
    html += '</div>';
    html += '<div class="preset-selector__body"><div class="preset-selector__list">';

    // Find orphan presets (not in any group)
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
    const orphanPresets = presets.filter(p => !presetsInTree.has(p.id));

    if (orphanPresets.length > 0) {
      for (const p of orphanPresets) {
        html += renderPresetRow(p, activePresets, '__root__');
      }
      // Separator between orphan presets and grouped presets
      if (groups.length > 0) {
        html += '<div class="preset-selector__sep"></div>';
      }
    }

    // Render root groups
    for (const childId of rootGroupIds) {
      const group = groupMap.get(childId);
      if (!group) continue;
      html += renderGroupTree(group, groups, presetMap, activePresets, 0);
    }

    // Any groups not in rootGroupIds
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
          html += renderGroupTree(g, groups, presetMap, activePresets, 0);
        }
      }
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

    viewEl.innerHTML = html;

    const newList = viewEl.querySelector('.preset-selector__list');
    if (newList && savedScroll) newList.scrollTop = savedScroll;

    // Bind collapse toggle: single-click the header = toggle this group;
    // Shift+click the header = toggle recursively. The arrow is visual only.
    viewEl.querySelectorAll('.preset-group__header').forEach(header => {
      header.addEventListener('click', (e) => {
        const groupId = header.dataset.groupId;
        if (!groupId) return;
        if (e.shiftKey) toggleCollapseRecursive(groupId);
        else toggleCollapse(groupId);
      });
    });

    // Bind row clicks
    viewEl.querySelectorAll('.preset-group__item').forEach(item => {
      item.addEventListener('click', (e) => {
        const groupId = item.dataset.groupId;
        const presetId = parseInt(item.dataset.id, 10);
        const current = state.get('activePresets') || {};
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+click: toggle this preset within the group (multi-select)
          const arr = Array.isArray(current[groupId]) ? current[groupId].slice() : [];
          const idx = arr.indexOf(presetId);
          if (idx >= 0) arr.splice(idx, 1);
          else arr.push(presetId);
          if (arr.length > 0) current[groupId] = arr;
          else delete current[groupId];
        } else {
          // Plain click: global single-select, or deselect if clicking the sole selection
          const sole = Object.keys(current).length === 1
            && Array.isArray(current[groupId])
            && current[groupId].length === 1
            && current[groupId][0] === presetId;
          if (sole) {
            delete current[groupId];
          } else {
            for (const k of Object.keys(current)) delete current[k];
            current[groupId] = [presetId];
          }
        }
        state.set('activePresets', { ...current });
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
        const presetId = parseInt(item.dataset.id, 10);
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+right-click: add to (or remove from) multi-select, start recording now
          if (shortcutSelected.has(presetId)) shortcutSelected.delete(presetId);
          else shortcutSelected.add(presetId);
        } else {
          // Plain right-click: single-select this preset, or deselect if it's the sole selection
          if (shortcutSelected.size === 1 && shortcutSelected.has(presetId)) {
            shortcutSelected = new Set();
          } else {
            shortcutSelected = new Set([presetId]);
          }
        }
        if (shortcutSelected.size === 0) {
          cancelRecording();   // selection emptied → close recorder (also re-renders)
        } else {
          startRecording();
          render();            // refresh row highlight for the new selection
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

    initDividerDrag();
  }

  // ── Recursive group rendering ──

  function countAllPresets(group, allGroups) {
    let n = 0;
    if (!group.children) return 0;
    for (const c of group.children) {
      if (c.type === 'preset') n++;
      else if (c.type === 'group') {
        const sub = allGroups.find(g => g.id === c.id);
        if (sub) n += countAllPresets(sub, allGroups);
      }
    }
    return n;
  }

  function renderGroupTree(group, allGroups, presetMap, activePresets, depth) {
    const isCollapsed = group.collapsed === true;
    const count = countAllPresets(group, allGroups);
    let html = `<div class="preset-group" style="--depth:${depth}">`;
    html += `<div class="preset-group__header ${isCollapsed ? 'preset-group__header--collapsed' : ''} ${depth > 0 ? 'preset-group__header--nested' : ''}" data-group-id="${group.id}">
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
      // Sub-groups after direct presets
      for (const child of group.children) {
        if (child.type === 'group') {
          const subGroup = allGroups.find(g => g.id === child.id);
          if (subGroup) {
            html += renderGroupTree(subGroup, allGroups, presetMap, activePresets, depth + 1);
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
    const inSelect = shortcutSelected.has(preset.id);
    return `
      <div class="preset-group__item ${isActive ? 'preset-group__item--editing' : ''} ${shortcut ? 'preset-group__item--has-shortcut' : ''} ${inSelect ? 'preset-group__item--shortcut-sel' : ''}"
           data-id="${preset.id}"
           data-group-id="${groupId}">
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

  function keyToAccelerator(e) {
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return null;
    const hasModifier = e.ctrlKey || e.altKey;
    // Block bare common keys (Esc/Space/Tab/etc.) — combos with Ctrl/Alt are allowed
    if (!hasModifier && FORBIDDEN_BARE_KEYS.has(e.key)) return null;
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
    const single = count === 1 ? [...shortcutSelected][0] : null;
    const presets = state.get('presets') || [];
    const existing = single ? (presets.find(p => p.id === single)?.meta?.shortcut || '') : '';
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
    showShortcutRecorder();
  }

  function cancelRecording() {
    recorderActive = false;
    shortcutSelected = new Set();
    hideShortcutRecorder();
    render();
  }

  async function bindShortcut(accelerator) {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const ids = [...shortcutSelected];
    try {
      const r = await api.bindGlobalShortcut(skin, ids, accelerator);
      if (r.success) {
        Toast.success(i18n.t('selector.bound', { acc: accelerator, count: ids.length }));
        // Refresh presets so badges update
        const scan = await api.scanPresets(skin);
        if (scan.success) state.set('presets', scan.data.presets);
        await api.reloadGlobalShortcuts(skin);
      } else {
        Toast.error(r.error || i18n.t('selector.bindFailed'));
      }
    } catch (e) {
      Toast.error(e.message || i18n.t('selector.bindFailed'));
    }
    cancelRecording();
  }

  async function clearShortcuts() {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const ids = [...shortcutSelected];
    try {
      await api.unbindGlobalShortcut(skin, ids);
      Toast.success(i18n.t('selector.cleared'));
      const scan = await api.scanPresets(skin);
      if (scan.success) state.set('presets', scan.data.presets);
      await api.reloadGlobalShortcuts(skin);
    } catch (e) {
      Toast.error(e.message || i18n.t('selector.clearFailed'));
    }
    cancelRecording();
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
        // Bare modifier / forbidden key — swallow so it doesn't reach the page
        e.preventDefault();
      }
    });
  }

  // Click outside the recorder while recording → cancel (same as clicking Cancel)
  if (!window._shortcutOutsideBound) {
    window._shortcutOutsideBound = true;
    document.addEventListener('mousedown', (e) => {
      if (!recorderActive) return;
      if (e.button === 2) return;   // right-click — let contextmenu handle it (add to selection)
      const rec = document.getElementById('shortcut-recorder');
      if (rec && !rec.contains(e.target)) cancelRecording();
    }, true);
  }

  // Preload all preset preview images into the cache (fire-and-forget).
  // Subsequent hovers render instantly from the cache instead of awaiting IPC.
  function preloadPreviews(presets) {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    // Invalidate cache when skin changes
    if (previewCache.__skin !== skin) {
      previewCache = { __skin: skin };
    }
    // Resolve skin path once for resolving relative preview paths.
    api.getSkinPath(skin).then(spResult => {
      const skPath = spResult.success ? spResult.data.replace(/\\/g, '/') : '';
      for (const p of presets) {
        const relPath = p.meta?.previewPath;
        // Key by relPath (not p.id): ids get compacted on delete, but the
        // preview path travels with the preset, so the cache stays correct.
        if (relPath && previewCache[relPath] === undefined) {
          previewCache[relPath] = null; // mark as loading
          const absPath = skPath ? skPath + '/' + relPath : relPath;
          api.getPreviewDataUrl(absPath).then(result => {
            previewCache[relPath] = result?.success ? result.data : false;
          });
        }
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

  function showPreview(presetName, description, previewPath, previewKind, previewFrames, previewFps, presetId) {
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
      const skin = state.get('selectedSkin');
      const spResult = skin ? await api.getSkinPath(skin) : null;
      const skPath = spResult && spResult.success ? spResult.data.replace(/\\/g, '/') : '';
      const absPath = skPath ? skPath + '/' + previewPath : previewPath;
      const result = await api.getPreviewDataUrl(absPath);
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

  state.on('presets', () => render());
  state.on('groups', () => render());
  state.on('rootGroupIds', () => render());
  state.on('selectedSkin', () => render());
  state.on('appMode', (mode) => { if (mode === 'use') render(); });
  state.on('activePresets', () => render());
  state.on('groups', () => { if (state.get('appMode') === 'use') render(); });

  async function toggleCollapse(groupId) {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const numericId = parseInt(groupId, 10);
    const groups = state.get('groups') || [];
    const group = groups.find(g => g.id === numericId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    await api.setGroupCollapsed(skin, numericId, group.collapsed);
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
    state.set('groups', [...groups]);
    await api.setGroupsCollapsedBatch(skin, ids, target);
  }

  window.PresetSelector = { render, invalidateCache: () => { previewCache = {}; } };
})();
