// Preset selector — use mode: displays preset tree with radio selection per group + hover preview
(function () {
  const viewEl = document.getElementById('view-selector');

  let hoverTimer = null;
  let resetTimer = null;
  let previewCache = {};   // presetId → dataURL (loaded on skin select)
  let shortcutSelected = new Set();   // preset ids collected via right-click / Ctrl+right-click
  let recorderActive = false;          // true while waiting for the next keypress to bind

  // Shared empty-state markup for the preview panel (used on initial render and on reset).
  const EMPTY_PREVIEW_HTML = `<div class="preset-preview-panel__empty">👆 将鼠标悬停在预设上<br>查看详情和预览图<br><br>🖱️左键单击选择预设<br>右键单击创建全局快捷键<br>ctrl单击以多选</div>`;

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
          <div class="empty-state__title">未选择皮肤</div>
          <div class="empty-state__desc">请从左侧选择一个皮肤</div>
        </div>
      `;
      return;
    }

    if (presets.length === 0 && groups.length === 0) {
      viewEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">📄</div>
          <div class="empty-state__title">暂无预设</div>
          <div class="empty-state__desc">点击顶部「✏️ 编辑模式」按钮来创建预设</div>
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
    html += '<h3>📄 预设选择</h3><span style="font-size:12px;color:var(--text-muted)">选择要应用的预设组合</span>';
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
        ${EMPTY_PREVIEW_HTML}
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

    // Bind collapse toggle: double-click the header, or single-click the arrow
    viewEl.querySelectorAll('.preset-group__header').forEach(header => {
      header.addEventListener('dblclick', (e) => {
        const groupId = header.dataset.groupId;
        if (!groupId) return;
        toggleCollapse(groupId);
      });
      const arrow = header.querySelector('.preset-tree__collapse-icon');
      if (arrow) {
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          const groupId = header.dataset.groupId;
          if (!groupId) return;
          if (e.shiftKey) {
            toggleCollapseRecursive(groupId);
          } else {
            toggleCollapse(groupId);
          }
        });
      }
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
        const presetName = preset?.meta?.name || ('预设 ' + presetId);
        const previewPath = preset?.meta?.previewPath || null;
        showPreview(presetName, desc, previewPath, presetId);
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
    let html = `<div class="preset-group">`;
    html += `<div class="preset-group__header ${isCollapsed ? 'preset-group__header--collapsed' : ''} ${depth > 0 ? 'preset-group__header--nested' : ''}" data-group-id="${group.id}" style="--depth:${depth}">
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
    const name = preset.meta?.name || ('预设 ' + preset.id);
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
      <div class="shortcut-recorder__title">已选 ${count} 个预设</div>
      <div class="shortcut-recorder__hint">${recorderActive ? '按下快捷键组合（Ctrl/Alt+键）· Esc 或点击外部取消 · Tab 聚焦按钮 · Ctrl+右键继续多选' : '右键选择预设'}</div>
      ${existing ? `<div class="shortcut-recorder__current">当前：${escapeHtml(existing)}</div>` : ''}
      <div class="shortcut-recorder__actions">
        ${count >= 1 ? `<button class="btn btn--danger btn--sm" id="shortcut-clear">清除快捷键</button>` : ''}
        <button class="btn btn--secondary btn--sm" id="shortcut-cancel">取消</button>
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
        Toast.success(`已绑定快捷键 ${accelerator} 到 ${ids.length} 个预设`);
        // Refresh presets so badges update
        const scan = await api.scanPresets(skin);
        if (scan.success) state.set('presets', scan.data.presets);
        await api.reloadGlobalShortcuts(skin);
      } else {
        Toast.error(r.error || '绑定失败');
      }
    } catch (e) {
      Toast.error(e.message || '绑定失败');
    }
    cancelRecording();
  }

  async function clearShortcuts() {
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const ids = [...shortcutSelected];
    try {
      await api.unbindGlobalShortcut(skin, ids);
      Toast.success('已清除快捷键');
      const scan = await api.scanPresets(skin);
      if (scan.success) state.set('presets', scan.data.presets);
      await api.reloadGlobalShortcuts(skin);
    } catch (e) {
      Toast.error(e.message || '清除失败');
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

  // Click outside the recorder while recording → cancel (same as 取消)
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
    for (const p of presets) {
      const path = p.meta?.previewPath;
      if (path && previewCache[p.id] === undefined) {
        previewCache[p.id] = null; // mark as loading
        api.getPreviewDataUrl(path).then(result => {
          previewCache[p.id] = result?.success ? result.data : false;
        });
      }
    }
  }

  function renderPreviewContent(presetName, description, imgSrc) {
    const panel = document.getElementById('preset-preview-panel');
    if (!panel) return;
    panel.innerHTML = `
      <div class="preset-preview-panel__name">${escapeHtml(presetName)}</div>
      ${description ? `<div class="preset-preview-panel__desc">${escapeHtml(description)}</div>` : ''}
      <div class="preset-preview-panel__image-wrap">
        ${imgSrc ? `<img src="${imgSrc}" class="preset-preview-panel__image" alt="预览图">`
                 : `<div class="preset-preview-panel__no-image">暂无预览图</div>`}
      </div>
    `;
    // Restart the fade-up animation
    panel.classList.remove('preset-preview-panel--fade');
    void panel.offsetWidth;
    panel.classList.add('preset-preview-panel--fade');
  }

  function showPreview(presetName, description, previewPath, presetId) {
    const cached = presetId != null ? previewCache[presetId] : undefined;
    // Cached & ready → render immediately
    if (cached) {
      renderPreviewContent(presetName, description, cached);
      return;
    }
    // Cached but known-empty → show "no preview" immediately
    if (cached === false) {
      renderPreviewContent(presetName, description, null);
      return;
    }

    // Not yet cached (or null/loading) → show text now, lazy-load image
    renderPreviewContent(presetName, description, null);
    if (!previewPath) return;

    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(async () => {
      const result = await api.getPreviewDataUrl(previewPath);
      if (result?.success && result.data) {
        previewCache[presetId] = result.data;
        const curPanel = document.getElementById('preset-preview-panel');
        if (!curPanel) return;
        // Only swap if the user is still on the same preset (name unchanged)
        renderPreviewContent(presetName, description, result.data);
      }
    }, 200);
  }

  function resetPreview() {
    const panel = document.getElementById('preset-preview-panel');
    if (panel) {
      panel.innerHTML = EMPTY_PREVIEW_HTML;
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
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const bodyRect = body.getBoundingClientRect();
      const panelWidth = bodyRect.right - e.clientX;
      const clamped = Math.max(200, Math.min(700, panelWidth));
      panel.style.width = clamped + 'px';
      list.style.width = `calc(100% - ${clamped + 4}px)`;
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
      g.collapsed = target;
      await api.setGroupCollapsed(skin, g.id, target);
    }
    state.set('groups', [...groups]);
  }

  window.PresetSelector = { render, invalidateCache: () => { previewCache = {}; } };
})();
