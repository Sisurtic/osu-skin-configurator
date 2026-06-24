// skin.ini key-value table editor — type-aware inputs driven by INI_FIELD_DEFS
// Supports multiple [Mania] sections (per key-count) and per-column field expansion.
(function () {
  let getActions, setActions, skinPathFn;
  let selectedIndices = new Set();
  let lastClickedIndex = null;

  // Column sort state for the operation table. Default = by action type
  // (modify/delete grouped), ascending. There is always an active sort.
  let sortState = { col: 'action', dir: 'asc' };
  // Last actions array reference rendered — used to detect real data changes
  // vs. re-renders (sort/delete) so selection isn't wiped every render.
  let lastActionsRef = null;

  function init(getter, setter, skPathFn) {
    getActions = getter;
    setActions = setter;
    skinPathFn = typeof skPathFn === 'function' ? skPathFn : () => null;
  }

  function render(container) {
    const actions = getActions ? getActions() : [];
    const iniEdits = actions || [];

    // Save expanded group state before rebuilding DOM
    const expandedGroups = new Set();
    if (container.querySelector) {
      container.querySelectorAll('.ini-collapsed-row--expanded').forEach(r => {
        if (r.dataset.group) expandedGroups.add(r.dataset.group);
      });
    }

    // Reset selection only when the underlying data actually changed (different
    // array reference), not on every re-render (sort toggle, delete) — otherwise
    // re-rendering wipes the user's selection.
    if (lastActionsRef !== actions) {
      selectedIndices = new Set();
      lastClickedIndex = null;
      lastActionsRef = actions;
    }

    container.innerHTML = `
      <div class="editor-sticky-header">
        <div style="padding-bottom:10px;border-bottom:1px solid var(--border)">
          <div style="margin-bottom:8px">
            <h3 style="margin-bottom:4px">${i18n.t('ini.heading')}</h3>
            <p style="font-size:12px;color:var(--text-muted)">${i18n.t('ini.desc')}</p>
          </div>

          <div style="display:flex;margin-bottom:8px;gap:8px;align-items:center">
            <!-- Section列 -->
            <select class="form-input" id="ini-section-select" style="flex-shrink:0;min-width:100px">
              <option value="">${i18n.t('ini.selectSection')}</option>
              ${INI_SECTIONS.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
            <!-- Keys 输入：Section 与 Key 之间，带间距 -->
            <div id="ini-mania-keys-row" style="display:none;white-space:nowrap;flex-shrink:0">
              <span style="font-size:12px;color:var(--text-muted);margin-right:4px">Keys:</span>
              <input type="number" class="form-input" id="ini-mania-keys-custom" placeholder="${i18n.t('ini.keysPlaceholder')}" min="1" max="18" style="width:70px">
            </div>
            <!-- Key列 flex -->
            <div style="flex:1;min-width:0;display:flex;gap:4px;align-items:center">
              <div class="ini-combo" style="flex:1;min-width:0">
                <input type="text" class="form-input" id="ini-key-input"
                       placeholder="${i18n.t('ini.keySearchPlaceholder')}" autocomplete="off" disabled>
                <div class="ini-combo__dropdown" id="ini-key-dropdown"></div>
              </div>
            </div>
            <!-- 按钮紧挨键名右侧 -->
            <div style="flex-shrink:0;display:flex;gap:8px;margin-left:8px">
              <button class="btn btn--primary btn--sm" id="btn-add-ini" style="font-size:11px;padding:4px 6px">${i18n.t('ini.add')}</button>
              <button class="btn btn--danger btn--sm" id="btn-delete-ini" style="font-size:11px;padding:4px 6px" title="${i18n.t('ini.deleteKeyTitle')}">${i18n.t('ini.deleteBtn')}</button>
            </div>
          </div>

          <!-- Delete drop zone -->
          <div class="editor-delete-zone" id="ini-delete-zone"
               style="padding:8px;border:2px dashed var(--danger);border-radius:var(--radius);text-align:center;color:var(--danger);font-size:12px;opacity:0.5;transition:all 0.2s">
            ${i18n.t('ini.deleteZone')}
          </div>
        </div>

        ${iniEdits.length > 0 ? `
        <!-- Fixed header table (thead only, matching colgroup with body) -->
        <div class="ini-header-table" style="margin-top:12px">
          <div class="table-wrap">
            <table class="table ini-table">
              <colgroup>
                <col style="width:72px">
                <col style="width:120px">
                <col style="width:240px">
                <col>
              </colgroup>
              <thead><tr>
                <th class="th--sortable" data-col="action">${i18n.t('ini.colAction')}${sortIndicatorHtml('action')}</th>
                <th class="th--sortable" data-col="section">${i18n.t('ini.colSection')}${sortIndicatorHtml('section')}</th>
                <th class="th--sortable" data-col="key">${i18n.t('ini.colKey')}${sortIndicatorHtml('key')}</th>
                <th class="th--sortable" data-col="value">${i18n.t('ini.colValue')}${sortIndicatorHtml('value')}</th>
              </tr></thead>
            </table>
          </div>
        </div>
        ` : ''}
      </div>

      <div class="ini-table-body-scroll" id="ini-table-body-scroll">
        ${renderIniTableBody(iniEdits)}
      </div>
    `;

    // Section dropdown change → filter keys; show Mania keys selector if Mania
    const secSelect = container.querySelector('#ini-section-select');
    const keyInput = container.querySelector('#ini-key-input');
    const keyDropdown = container.querySelector('#ini-key-dropdown');
    const maniaKeysRow = container.querySelector('#ini-mania-keys-row');

    let currentFields = [];    // { key, cn }[] for current section
    let keyActiveIndex = -1;   // highlighted option index, -1 = none

    function updateKeyDropdown() {
      const sec = secSelect.value;
      let fields = FIELDS_BY_SECTION[sec] || [];
      // Hide Keys field — managed by osu! automatically, not for preset config
      fields = fields.filter(f => f.key !== 'Keys');
      currentFields = fields.map(f => ({ key: f.key, label: INI_FIELD_LABELS.fieldLabel(f) }));
      keyInput.value = '';
      keyInput.disabled = currentFields.length === 0;
      keyInput.placeholder = currentFields.length > 0 ? i18n.t('ini.searchKeyPlaceholder') : i18n.t('ini.keySearchPlaceholder');
      keyActiveIndex = -1;
      closeDropdown();
    }

    function filterFields(query) {
      if (!query) return currentFields;
      const q = query.toLowerCase();
      return currentFields.filter(f => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q));
    }

    function renderDropdown(filtered) {
      if (filtered.length === 0) {
        keyDropdown.innerHTML = `<div class="ini-combo__empty">${i18n.t('ini.noMatch')}</div>`;
      } else {
        keyDropdown.innerHTML = filtered.map((f, i) =>
          `<div class="ini-combo__option${i === keyActiveIndex ? ' ini-combo__option--active' : ''}" data-key="${escapeHtml(f.key)}" data-idx="${i}">
            <span class="ini-combo__option-key">${escapeHtml(f.key)}</span>
            <span class="ini-combo__option-cn">${escapeHtml(f.label)}</span>
          </div>`
        ).join('');
      }
      // Bind click handlers
      keyDropdown.querySelectorAll('.ini-combo__option').forEach(opt => {
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault(); // prevent blur on input
          keyInput.value = opt.dataset.key;
          keyActiveIndex = -1;
          closeDropdown();
        });
      });
      // Scroll active option into view
      const active = keyDropdown.querySelector('.ini-combo__option--active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function openDropdown() {
      const filtered = filterFields(keyInput.value);
      keyActiveIndex = -1;
      renderDropdown(filtered);
      keyDropdown.classList.add('ini-combo__dropdown--open');
    }

    function closeDropdown() {
      keyDropdown.classList.remove('ini-combo__dropdown--open');
    }

    secSelect.addEventListener('change', () => {
      const sec = secSelect.value;
      if (sec === 'Mania') {
        maniaKeysRow.style.display = '';
      } else {
        maniaKeysRow.style.display = 'none';
      }
      updateKeyDropdown();
    });

    // Input: filter & show dropdown
    keyInput.addEventListener('input', () => {
      const filtered = filterFields(keyInput.value);
      keyActiveIndex = -1;
      renderDropdown(filtered);
      keyDropdown.classList.add('ini-combo__dropdown--open');
    });

    keyInput.addEventListener('focus', () => {
      if (currentFields.length > 0) openDropdown();
    });

    keyInput.addEventListener('blur', () => {
      // Delay to allow click on dropdown option
      setTimeout(() => closeDropdown(), 150);
    });

    // Keyboard: Arrow Up/Down, Enter, Tab, Escape
    keyInput.addEventListener('keydown', (e) => {
      const isOpen = keyDropdown.classList.contains('ini-combo__dropdown--open');
      const filtered = isOpen ? filterFields(keyInput.value) : [];
      if (e.key === 'ArrowDown') {
        if (!isOpen) { openDropdown(); return; }
        e.preventDefault();
        keyActiveIndex = Math.min(keyActiveIndex + 1, filtered.length - 1);
        renderDropdown(filtered);
      } else if (e.key === 'ArrowUp') {
        if (!isOpen) { openDropdown(); return; }
        e.preventDefault();
        keyActiveIndex = Math.max(keyActiveIndex - 1, -1);
        renderDropdown(filtered);
      } else if (e.key === 'Enter' && isOpen) {
        e.preventDefault();
        if (keyActiveIndex >= 0 && keyActiveIndex < filtered.length) {
          keyInput.value = filtered[keyActiveIndex].key;
        } else if (filtered.length === 1) {
          keyInput.value = filtered[0].key;
        }
        keyActiveIndex = -1;
        closeDropdown();
      } else if (e.key === 'Tab' && keyInput.value && isOpen) {
        e.preventDefault();
        if (keyActiveIndex >= 0 && keyActiveIndex < filtered.length) {
          keyInput.value = filtered[keyActiveIndex].key;
        } else if (filtered.length > 0) {
          keyInput.value = filtered[0].key;
        }
        keyActiveIndex = -1;
        closeDropdown();
      } else if (e.key === 'Tab' && keyInput.value && !isOpen) {
        // Tab with text typed but dropdown closed: autocomplete first match
        const all = filterFields(keyInput.value);
        if (all.length > 0) {
          e.preventDefault();
          keyInput.value = all[0].key;
        }
      } else if (e.key === 'Escape' && isOpen) {
        keyActiveIndex = -1;
        closeDropdown();
      }
    });

    // Wheel: cycle through filtered key names and set the value directly
    keyInput.addEventListener('wheel', (e) => {
      if (!keyDropdown.classList.contains('ini-combo__dropdown--open')) {
        openDropdown();
      }
      e.preventDefault();
      // Use ALL keys for cycling (not filtered by current text, since we're
      // replacing the text with the selected key).
      const all = currentFields;
      if (all.length === 0) return;
      // Find current key in the list; start from -1 if not found.
      let curIdx = all.findIndex(f => f.key === keyInput.value.trim());
      if (e.deltaY > 0) {
        curIdx = (curIdx + 1) % all.length;
      } else {
        curIdx = curIdx <= 0 ? all.length - 1 : curIdx - 1;
      }
      keyInput.value = all[curIdx].key;
      keyActiveIndex = curIdx;
      renderDropdown(filterFields(keyInput.value));
    }, { passive: false });

    // Add button
    container.querySelector('#btn-add-ini').addEventListener('click', () => {
      // Save selection state before render() destroys it
      const secSelect = container.querySelector('#ini-section-select');
      const keyInput = container.querySelector('#ini-key-input');
      const savedSection = secSelect.value;
      const savedKey = keyInput.value;
      const savedManiaKeys = container.querySelector('#ini-mania-keys-custom')?.value || '';

      const section = secSelect.value;
      const key = keyInput.value.trim();
      if (!section || !key) { Toast.warning(i18n.t('ini.selectSectionKey')); return; }
      if (!currentFields.find(f => f.key === key)) { Toast.warning(i18n.t('ini.invalidKey', { key })); return; }

      const keysInput = container.querySelector('#ini-mania-keys-custom');
      const maniaKeyVal = parseInt(keysInput?.value);
      if (section === 'Mania' && (!maniaKeyVal || maniaKeyVal < 1 || maniaKeyVal > 18)) {
        Toast.warning(i18n.t('ini.enterManiaKeys'));
        return;
      }

      const field = INI_FIELD_DEFS.find(f => f.section === section && f.key === key);
      const value = field?.default || '';
      const maniaKeys = section === 'Mania' ? maniaKeyVal : undefined;

      let newEntries;
      if (field && field.perColumn && maniaKeys != null) {
        // Expand per-column fields: Colour# → Colour0, Colour1, ..., ColourN-1
        newEntries = [];
        for (let col = 0; col < maniaKeys; col++) {
          const actualKey = field.key.replace('#', String(col));
          newEntries.push({
            section,
            maniaKeys,
            key: actualKey,
            value,
            _cn: INI_FIELD_LABELS.fieldLabel(field) + ' ' + i18n.t('ini.columnSuffix', { n: col }),
          });
        }
      } else {
        newEntries = [{
          section,
          maniaKeys,
          key,
          value,
          _cn: INI_FIELD_LABELS.fieldLabel(field || { key }),
        }];
      }

      // Check for duplicates before adding
      const filtered = newEntries.filter(entry => {
        const dup = iniEdits.find(e =>
          e.section === entry.section &&
          e.key === entry.key &&
          (e.maniaKeys ?? null) === (entry.maniaKeys ?? null) &&
          (e._delete || false) === (entry._delete || false)
        );
        return !dup;
      });
      if (filtered.length === 0) {
        Toast.warning(i18n.t('ini.opExists'));
        return;
      }
      if (filtered.length < newEntries.length) {
        Toast.info(i18n.t('ini.skippedDup', { n: newEntries.length - filtered.length }));
      }
      const updated = [...iniEdits, ...filtered];
      setActions(updated);
      render(container);
      restoreSelection(container, savedSection, savedKey, savedManiaKeys);
    });

    // Delete selected button — add a "delete this key" operation entry
    container.querySelector('#btn-delete-ini').addEventListener('click', () => {
      // Save selection state before render() destroys it
      const secSelect = container.querySelector('#ini-section-select');
      const keyInput = container.querySelector('#ini-key-input');
      const savedSection = secSelect.value;
      const savedKey = keyInput.value;
      const savedManiaKeys = container.querySelector('#ini-mania-keys-custom')?.value || '';

      const section = secSelect.value;
      const key = keyInput.value.trim();
      if (!section || !key) { Toast.warning(i18n.t('ini.selectDeleteTarget')); return; }
      if (!currentFields.find(f => f.key === key)) { Toast.warning(i18n.t('ini.invalidKey', { key })); return; }

      const keysInput = container.querySelector('#ini-mania-keys-custom');
      const maniaKeyVal = parseInt(keysInput?.value);
      if (section === 'Mania' && (!maniaKeyVal || maniaKeyVal < 1 || maniaKeyVal > 18)) {
        Toast.warning(i18n.t('ini.enterManiaKeys'));
        return;
      }

      const field = INI_FIELD_DEFS.find(f => f.section === section && f.key === key);
      const maniaKeys = section === 'Mania' ? maniaKeyVal : undefined;

      let newEntries;
      if (field && field.perColumn && maniaKeys != null) {
        newEntries = [];
        for (let col = 0; col < maniaKeys; col++) {
          const actualKey = field.key.replace('#', String(col));
          newEntries.push({
            section, maniaKeys, key: actualKey, value: '',
            _cn: INI_FIELD_LABELS.fieldLabel(field) + ' ' + i18n.t('ini.columnSuffix', { n: col }), _delete: true,
          });
        }
      } else {
        newEntries = [{
          section, maniaKeys, key, value: '',
          _cn: INI_FIELD_LABELS.fieldLabel(field || { key }), _delete: true,
        }];
      }

      // Check for duplicates before adding
      const delFiltered = newEntries.filter(entry => {
        const dup = iniEdits.find(e =>
          e.section === entry.section &&
          e.key === entry.key &&
          (e.maniaKeys ?? null) === (entry.maniaKeys ?? null) &&
          (e._delete || false) === (entry._delete || false)
        );
        return !dup;
      });
      if (delFiltered.length === 0) {
        Toast.warning(i18n.t('ini.delOpExists'));
        return;
      }
      if (delFiltered.length < newEntries.length) {
        Toast.info(i18n.t('ini.skippedDup', { n: newEntries.length - delFiltered.length }));
      }
      const updated = [...iniEdits, ...delFiltered];
      setActions(updated);
      render(container);
      restoreSelection(container, savedSection, savedKey, savedManiaKeys);
    });
    container.querySelectorAll('.ini-edit-row').forEach(row => {
      row.addEventListener('click', (e) => {
        // Don't intercept clicks on interactive elements
        if (e.target.closest('input, select, button, label, .toggle')) return;

        const groupIndicesRaw = row.dataset.groupIndices;
        const isGroupMain = !!groupIndicesRaw && !row.dataset.groupParent;
        const groupIdxList = isGroupMain ? JSON.parse(groupIndicesRaw) : null;

        // For range selection, the "effective index" of a group main row is
        // its last sub-row index (so ranges work across collapsed groups).
        const idx = isGroupMain
          ? groupIdxList[groupIdxList.length - 1]
          : parseInt(row.dataset.idx);
        if (isNaN(idx)) return;

        if (e.shiftKey && lastClickedIndex !== null) {
          // Shift+click range select.
          // - If the clicked row IS a group header (endpoint on group) → select
          //   the whole group's sub-rows.
          // - Range crosses a group header in the middle → SKIP the group
          //   (don't expand), only select regular rows in range.
          e.preventDefault();
          if (!e.ctrlKey && !e.metaKey) selectedIndices.clear();
          const start = Math.min(lastClickedIndex, idx);
          const end = Math.max(lastClickedIndex, idx);
          // Was the shift-click endpoint ON a group header?
          const endpointOnGroup = isGroupMain;
          container.querySelectorAll('.ini-edit-row').forEach(r => {
            const gRaw = r.dataset.groupIndices;
            const isMain = !!gRaw && !r.dataset.groupParent;
            const rIdx = isMain
              ? JSON.parse(gRaw)[0]
              : parseInt(r.dataset.idx);
            if (isNaN(rIdx)) return;
            if (isMain) {
              // Only expand a group if this group header IS the clicked endpoint.
              // Groups in the middle of the range are skipped.
              if (endpointOnGroup && r === row) {
                const subIdxs = JSON.parse(gRaw);
                for (const i of subIdxs) selectedIndices.add(i);
              }
              // else: skip — don't add the group header or its sub-rows.
            } else {
              if (rIdx < start || rIdx > end) return;
              // Skip sub-rows of collapsed groups (they're hidden, their group
              // header is visible but was skipped above).
              if (r.style.display === 'none') return;
              selectedIndices.add(rIdx);
            }
          });
          updateRowHighlights(container);
          return;
        }

        if (isGroupMain) {
          if (e.ctrlKey || e.metaKey) {
            const allSelected = groupIdxList.every(i => selectedIndices.has(i));
            if (allSelected) {
              for (const i of groupIdxList) selectedIndices.delete(i);
            } else {
              for (const i of groupIdxList) selectedIndices.add(i);
            }
          } else {
            selectedIndices.clear();
            for (const i of groupIdxList) selectedIndices.add(i);
          }
          lastClickedIndex = groupIdxList[groupIdxList.length - 1];
          updateRowHighlights(container);
          return;
        }

        if (e.ctrlKey || e.metaKey) {
          if (selectedIndices.has(idx)) {
            selectedIndices.delete(idx);
          } else {
            selectedIndices.add(idx);
          }
          lastClickedIndex = idx;
        } else {
          // Plain click: single select
          selectedIndices.clear();
          selectedIndices.add(idx);
          lastClickedIndex = idx;
        }
        updateRowHighlights(container);
      });

      // ── Drag to delete (only when not editing, group-aware) ──
      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', (e) => {
        // Block drag while actively editing a value input in this row
        const activeEl = document.activeElement;
        if (activeEl && row.contains(activeEl) && activeEl.closest('input, select, textarea, button')) {
          e.preventDefault();
          return;
        }

        // If dragging a group main row, ensure all sub-row indices are selected
        const groupIndicesRaw = row.dataset.groupIndices;
        if (groupIndicesRaw && !row.dataset.groupParent) {
          const groupIdxList = JSON.parse(groupIndicesRaw);
          const allSelected = groupIdxList.every(i => selectedIndices.has(i));
          if (!allSelected) {
            selectedIndices.clear();
            for (const i of groupIdxList) selectedIndices.add(i);
            lastClickedIndex = groupIdxList[groupIdxList.length - 1];
            updateRowHighlights(container);
          }
        } else {
          const idx = parseInt(row.dataset.idx);
          if (!isNaN(idx) && !selectedIndices.has(idx)) {
            selectedIndices.clear();
            selectedIndices.add(idx);
            lastClickedIndex = idx;
            updateRowHighlights(container);
          }
        }
        // Store selected indices for delete-zone drop
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/ini-indices', JSON.stringify([...selectedIndices]));
        // Add dragging class to selected rows
        container.querySelectorAll('.ini-edit-row').forEach(r => {
          const ri = parseInt(r.dataset.idx);
          if (!isNaN(ri) && selectedIndices.has(ri)) r.classList.add('row--dragging');
          // Also highlight group main row if all sub-rows are selected
          const grpRaw = r.dataset.groupIndices;
          if (grpRaw && !r.dataset.groupParent) {
            const grpIdx = JSON.parse(grpRaw);
            if (grpIdx.every(i => selectedIndices.has(i))) r.classList.add('row--dragging');
          }
        });
      });

      row.addEventListener('dragend', () => {
        container.querySelectorAll('.ini-edit-row').forEach(r => r.classList.remove('row--dragging'));
      });
    });

    // ── Delete zone drop handler ──
    const deleteZone = container.querySelector('#ini-delete-zone');
    if (deleteZone) {
      deleteZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        deleteZone.style.opacity = '1';
        deleteZone.style.background = 'rgba(224,85,85,0.1)';
      });
      deleteZone.addEventListener('dragleave', () => {
        deleteZone.style.opacity = '0.5';
        deleteZone.style.background = '';
      });
      deleteZone.addEventListener('drop', (e) => {
        e.preventDefault();
        deleteZone.style.opacity = '0.5';
        deleteZone.style.background = '';
        const raw = e.dataTransfer.getData('application/ini-indices');
        if (!raw) return;
        const indices = JSON.parse(raw).sort((a, b) => b - a); // descending for splice
        const updated = [...iniEdits];
        for (const i of indices) {
          updated.splice(i, 1);
        }
        setActions(updated);
        Toast.info(i18n.t('ini.deleted', { n: indices.length }));
        render(container);
      });
    }

    // ── Column header sort (click toggles: same col flips asc/desc, new col = asc) ──
    container.querySelectorAll('.ini-header-table th.th--sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortState.col === col) {
          sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
          sortState.col = col;
          sortState.dir = 'asc';
        }
        rerenderTable(container);
      });
    });

    // ── Tab cycling: scope to the region of the focused element ──
    // Top controls (section/key/add/delete) and the operation table rows each
    // cycle independently — Tab never crosses between them.
    if (!container._ctrlABound) {
      container._ctrlABound = true;
      container.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || !container.contains(document.activeElement)) return;
        const active = document.activeElement;
        const inBody = active.closest && active.closest('.ini-body-table');
        const regionRoot = inBody
          ? container.querySelector('.ini-body-table')
          : container.querySelector('.editor-sticky-header');
        if (!regionRoot) return;
        const focusable = regionRoot.querySelectorAll(
          'input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const visible = Array.from(focusable).filter(el => el.offsetParent !== null);
        if (visible.length === 0) return;
        e.preventDefault();
        const cur = visible.indexOf(active);
        const next = e.shiftKey
          ? (cur <= 0 ? visible.length - 1 : cur - 1)
          : (cur >= visible.length - 1 ? 0 : cur + 1);
        visible[next].focus();
      });
    }

    // Value change handlers (color inputs are handled separately below)
    container.querySelectorAll('.ini-value-input').forEach(input => {
      if (input.classList.contains('ini-color-value')) return;
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        iniEdits[idx].value = input.value;
        setActions([...iniEdits]);
      });
    });
    // Live color value box: commit per keystroke, update swatch, forward to open popover.
    // Accepts any format ColorPicker.parseColor understands (hex, rgb(), hsl(), named, R,G,B[,A])
    // and normalizes the stored INI value back to "r,g,b[,a]".
    const isBlackLiteral = v => /^(0,0,0(,0)?|#0{3,8}|black|rgba?\(\s*0\s*,\s*0\s*,\s*0\b|hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*0%\b)/i.test(v || '');
    container.querySelectorAll('.ini-color-value').forEach(input => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.dataset.idx);
        const type = input.dataset.type;
        const raw = input.value;
        const parsed = window.ColorPicker && window.ColorPicker.parseColor
          ? window.ColorPicker.parseColor(raw)
          : (() => { const p = raw.split(',').map(Number); return { r: p[0]||0, g: p[1]||0, b: p[2]||0, a: p[3] !== undefined ? p[3] : 255 }; })();
        // parseColor falls back to {0,0,0} for incomplete tokens (e.g. "128," or "#ff").
        // Treat that as "still typing": leave iniEdits/swatch/popover alone until it's valid.
        if (raw.trim() && parsed.r === 0 && parsed.g === 0 && parsed.b === 0 && !isBlackLiteral(raw)) return;
        // Normalize to the canonical r,g,b[,a] the INI stores (osu! format).
        const normalized = type === 'rgba'
          ? `${parsed.r},${parsed.g},${parsed.b},${parsed.a}`
          : `${parsed.r},${parsed.g},${parsed.b}`;
        iniEdits[idx].value = normalized;
        setActions([...iniEdits]);
        const swatch = input.parentElement.querySelector('.ini-color-swatch');
        if (swatch) swatch.style.background = type === 'rgba'
          ? `rgba(${parsed.r},${parsed.g},${parsed.b},${parsed.a/255})`
          : `rgb(${parsed.r},${parsed.g},${parsed.b})`;
        // Forward the parsed value into the popover bound to this swatch, if it's open.
        if (swatch && window.ColorPicker && typeof window.ColorPicker.forwardInput === 'function') {
          window.ColorPicker.forwardInput(swatch, normalized);
        }
      });
      // On blur/Enter: normalize the box's displayed text to canonical "r,g,b[,a]".
      // (Done on commit, not per keystroke, so typing isn't interrupted by cursor resets.)
      input.addEventListener('change', () => {
        const type = input.dataset.type;
        const raw = input.value;
        const parsed = window.ColorPicker && window.ColorPicker.parseColor
          ? window.ColorPicker.parseColor(raw)
          : { r: 0, g: 0, b: 0, a: 255 };
        const normalized = type === 'rgba'
          ? `${parsed.r},${parsed.g},${parsed.b},${parsed.a}`
          : `${parsed.r},${parsed.g},${parsed.b}`;
        if (normalized !== raw) input.value = normalized;
      });
    });
    container.querySelectorAll('.ini-value-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.idx);
        iniEdits[idx].value = cb.checked ? '1' : '0';
        setActions([...iniEdits]);
      });
    });
    container.querySelectorAll('.ini-value-section').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.dataset.idx);
        iniEdits[idx].value = sel.value;
        setActions([...iniEdits]);
      });
    });
    // Color picker binding
    container.querySelectorAll('.ini-color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const idx = parseInt(swatch.dataset.idx);
        const type = swatch.dataset.type;
        ColorPicker.attach(swatch, {
          type,
          value: iniEdits[idx].value,
          onChange(newValue) {
            iniEdits[idx].value = newValue;
            setActions([...iniEdits]);
            const parsed = newValue.split(',').map(Number);
            const r = parsed[0]||0, g = parsed[1]||0, b = parsed[2]||0, a = parsed[3] !== undefined ? parsed[3] : 255;
            swatch.style.background = type === 'rgba'
              ? `rgba(${r},${g},${b},${a/255})`
              : `rgb(${r},${g},${b})`;
            const input = swatch.parentElement.querySelector('.ini-color-value');
            if (input) input.value = newValue;
          }
        });
      });
    });
    // Fill-all buttons for Mania per-column fields (collapsed group)
    container.querySelectorAll('.ini-fill-btn[data-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        const groupId = btn.dataset.group;
        // Find all sub-rows belonging to this group
        const subRows = container.querySelectorAll(`.ini-sub-row[data-group-parent="${CSS.escape(groupId)}"]`);
        if (subRows.length === 0) return;
        // Get the first sub-row's value
        const firstSubIdx = parseInt(subRows[0].dataset.idx);
        const firstValue = iniEdits[firstSubIdx]?.value || '';
        // Set all sub-rows' values
        for (const sr of subRows) {
          const si = parseInt(sr.dataset.idx);
          if (iniEdits[si]) iniEdits[si].value = firstValue;
        }
        setActions([...iniEdits]);
        render(container);
      });
    });
    // Expand/collapse a perColumn group. Triggered by double-clicking the row
    // OR single-clicking the group tag (the "分组" badge in the Action column).
    function toggleGroupExpansion(row) {
      const groupId = row.dataset.group;
      const subRows = container.querySelectorAll(`.ini-sub-row[data-group-parent="${CSS.escape(groupId)}"]`);
      if (subRows.length === 0) return;
      const isExpanded = subRows[0].style.display !== 'none';
      for (const sr of subRows) {
        sr.style.display = isExpanded ? 'none' : '';
      }
      row.classList.toggle('ini-collapsed-row--expanded', !isExpanded);
    }
    container.querySelectorAll('.ini-collapsed-row').forEach(row => {
      row.addEventListener('dblclick', (e) => {
        if (e.target.closest('button, input, select')) return;
        toggleGroupExpansion(row);
      });
      // Single-click the group tag to toggle (without selecting/interfering).
      const tag = row.querySelector('.ini-group-toggle');
      if (tag) {
        tag.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleGroupExpansion(row);
        });
      }
    });

    // Fill-all buttons for list-type fields (ColumnSpacing etc.)
    container.querySelectorAll('.ini-list-fill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const edit = iniEdits[idx];
        if (!edit || edit.section !== 'Mania' || edit.maniaKeys == null || edit.maniaKeys <= 1) return;
        const field = findFieldByTemplate(edit.section, edit.key);
        let count = edit.maniaKeys;
        if (field && field.fillCount === 'keys-1') count = edit.maniaKeys - 1;
        else if (field && field.fillCount === 'keys+1') count = edit.maniaKeys + 1;
        const parts = (edit.value || '').split(',').map(s => s.trim()).filter(Boolean);
        const firstVal = parts.length > 0 ? parts[0] : '0';
        edit.value = Array(count).fill(firstVal).join(',');
        setActions([...iniEdits]);
        const input = container.querySelector(`.ini-value-input[data-idx="${idx}"]`);
        if (input) input.value = edit.value;
      });
    });

    // Path picker buttons
    container.querySelectorAll('.ini-path-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        const skPath = skinPathFn ? await skinPathFn() : '';
        const result = await api.selectFile([
          { name: i18n.t('ini.imageFilter'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }
        ], skPath || undefined);
        if (!result.success || !result.data || !result.data.length) return;
        const selectedPath = result.data[0];
        const edit = iniEdits[idx];
        const field = findFieldByTemplate(edit.section, edit.key);
        const converted = convertToSkinIniPath(selectedPath, skPath, edit, field);
        iniEdits[idx].value = converted;
        setActions([...iniEdits]);
        const input = container.querySelector(`.ini-value-input[data-idx="${idx}"]`);
        if (input) input.value = converted;
      });
    });

    // Restore expanded group state
    for (const groupId of expandedGroups) {
      const row = container.querySelector(`.ini-collapsed-row[data-group="${CSS.escape(groupId)}"]`);
      if (row) {
        const subRows = container.querySelectorAll(`.ini-sub-row[data-group-parent="${CSS.escape(groupId)}"]`);
        for (const sr of subRows) sr.style.display = '';
        row.classList.add('ini-collapsed-row--expanded');
      }
    }

    // Measure + apply column widths. If the tab is active but layoutColumns
    // skipped (container width not settled yet this frame), retry next frame.
    autosizeColumns(container);
    layoutColumns(container);
    if (container.classList.contains('tab-content--active')) {
      requestAnimationFrame(() => layoutColumns(container));
    }
    adjustFillButtons();

    // Edge-fade overlays: added to the scroll element's PARENT (container)
    // so they stay fixed at the scroll viewport edges regardless of scroll
    // position. Position is computed via getBoundingClientRect.
    const scrollEl = container.querySelector('.ini-table-body-scroll');
    if (scrollEl && !scrollEl._fadeBound) {
      scrollEl._fadeBound = true;
      container.style.position = 'relative';
      const topFade = document.createElement('div');
      topFade.className = 'scroll-edge-fade scroll-edge-fade--top';
      const botFade = document.createElement('div');
      botFade.className = 'scroll-edge-fade scroll-edge-fade--bottom';
      container.appendChild(topFade);
      container.appendChild(botFade);
      const updateFade = () => {
        const r = scrollEl.getBoundingClientRect();
        const cr = container.getBoundingClientRect();
        if (r.height === 0) return;
        topFade.style.top = (r.top - cr.top) + 'px';
        botFade.style.bottom = (cr.bottom - r.bottom) + 'px';
        topFade.style.opacity = scrollEl.scrollTop > 2 ? '1' : '0';
        botFade.style.opacity = (scrollEl.scrollTop + scrollEl.clientHeight < scrollEl.scrollHeight - 2) ? '1' : '0';
      };
      scrollEl.addEventListener('scroll', updateFade, { passive: true });
      // Re-check on resize and after layout settles.
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(updateFade).observe(scrollEl);
      }
      requestAnimationFrame(updateFade);
      setTimeout(updateFade, 300);
    }
  }

  function convertToSkinIniPath(fullPath, skinPath, edit, field) {
    let rel = fullPath;
    // Convert to skin-relative path
    if (skinPath && fullPath.toLowerCase().startsWith(skinPath.toLowerCase())) {
      rel = fullPath.slice(skinPath.length).replace(/^[/\\]/, '');
    }
    // Separate directory and filename
    const lastSep = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'));
    const dir = lastSep >= 0 ? rel.substring(0, lastSep) : '';
    let basename = lastSep >= 0 ? rel.substring(lastSep + 1) : rel;

    // Strip file extension
    basename = basename.replace(/\.[^.]+$/, '');
    // Strip @2x high-res suffix
    basename = basename.replace(/@2x$/i, '');
    // Strip animation frame number (-0, -1, -2, ...)
    basename = basename.replace(/-\d+$/, '');
    // Strip format suffixes (-x, -dot, -comma, -percent) for all path fields
    basename = basename.replace(/-(x|dot|comma|percent)$/i, '');

    return dir ? dir.replace(/\\/g, '/') + '/' + basename : basename;
  }

  function updateRowHighlights(container) {
    container.querySelectorAll('.ini-edit-row').forEach(row => {
      // Group main rows use string data-idx; highlight if all sub-rows are selected
      const groupIndicesRaw = row.dataset.groupIndices;
      if (groupIndicesRaw && !row.dataset.groupParent) {
        const indices = JSON.parse(groupIndicesRaw);
        const allSelected = indices.length > 0 && indices.every(i => selectedIndices.has(i));
        row.classList.toggle('row--selected', allSelected);
        return;
      }
      const idx = parseInt(row.dataset.idx);
      if (!isNaN(idx)) {
        row.classList.toggle('row--selected', selectedIndices.has(idx));
      }
    });
  }

  function sectionLabel(edit) {
    if (edit.section === 'Mania' && edit.maniaKeys != null) {
      return `Mania (${edit.maniaKeys}K)`;
    }
    return edit.section;
  }

  // Restore selection state after render() rebuilds the DOM
  function restoreSelection(container, section, key, maniaKeys) {
    const newSec = container.querySelector('#ini-section-select');
    const newKey = container.querySelector('#ini-key-input');
    const newManiaKeys = container.querySelector('#ini-mania-keys-custom');
    if (newSec && section) {
      newSec.value = section;
      newSec.dispatchEvent(new Event('change'));
    }
    if (newKey && key) {
      newKey.value = key;
      newKey.disabled = false;
    }
    if (newManiaKeys && maniaKeys) {
      newManiaKeys.value = maniaKeys;
    }
  }

  // Find field definition by section + key, with perColumn template matching
  function findFieldByTemplate(section, key) {
    let field = INI_FIELD_DEFS.find(f => f.section === section && f.key === key);
    if (field) return field;
    return INI_FIELD_DEFS.find(f => {
      if (!f.perColumn || f.section !== section) return false;
      // field.key uses '#' as a column-number placeholder (e.g. 'Colour#',
      // 'KeyFlipWhenUpsideDown#D', 'NoteImage#H'). The actual key has a digit
      // there (Colour0, KeyFlipWhenUpsideDown0D). Build a regex from the
      // template: escape regex specials, then turn '#' into a digit capture.
      const escaped = f.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('^' + escaped.replace('#', '(\\d+)') + '$');
      return re.test(key);
    }) || null;
  }

  // Get base key for grouping; uses field definition template for perColumn fields
  function getBaseKey(key, field) {
    if (field && field.perColumn) {
      return field.key.replace('#', '');
    }
    return key;
  }

  // A stable sort key that keeps perColumn (Mania #) entries of the same
  // group ADJACENT — base key (with the #N suffix stripped) + mania key count.
  // Without this, sorting by value/key would interleave columns of one group
  // with another group's rows and split the collapsed group.
  function groupSortKey(edit) {
    const field = findFieldByTemplate(edit.section, edit.key);
    const base = (field && field.perColumn) ? getBaseKey(edit.key, field) : edit.key;
    const mk = edit.maniaKeys != null ? edit.maniaKeys : 0;
    return base + '@' + mk;
  }

  function cmpStr(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  // Action-type rank for the "操作" sort: modify (green) < delete (red).
  // (perColumn groups are formed AFTER sorting by collapsing adjacent equal
  // base keys, so individual edits sort by modify/delete; the blue group header
  // is a derived row, not sorted here.)
  function actionRank(edit) { return edit._delete ? 1 : 0; }

  // The per-header sort-key chain. Each header sorts by a specific sequence of
  // fields so that, e.g., sorting by 操作 groups all modifies then deletes and
  // within each by section→key→value. Reverse (desc) inverts the whole compare
  // but keeps the field PRIORITY order.
  // Sort key for the section column: section name (string) then maniaKeys
  // (numeric) so "Mania (4K)" < "Mania (7K)" < "Mania (18K)" numerically,
  // not lexicographically.
  function sectionSortKey(edit) {
    if (edit.section === 'Mania' && edit.maniaKeys != null) {
      return edit.section + '\0' + String(edit.maniaKeys).padStart(3, '0');
    }
    return edit.section;
  }

  function editSortKeys(edit, col) {
    const sec = sectionSortKey(edit);
    const key = groupSortKey(edit);
    const val = edit.value || '';
    const act = actionRank(edit);
    if (col === 'action')  return [act, sec, key, val];
    if (col === 'section') return [sec, key, val, act];
    if (col === 'key')     return [key, val, sec, act];
    /* value */           return [val, sec, key, act];
  }

  function compareEdit(a, b, col) {
    const ka = editSortKeys(a, col), kb = editSortKeys(b, col);
    for (let i = 0; i < ka.length; i++) {
      const c = cmpStr(ka[i], kb[i]);
      if (c !== 0) return c;
    }
    return 0;
  }

  // Auto-size the operation table's first three columns to fit their content
  // (headers + cells) in the current language, then lock to fixed layout so
  // adding/removing rows never shifts them. The 4th (Value) column takes the
  // remaining width.
  // ── Column widths: ONE unified pipeline ──
  //
  // measureColumns(): probe-based; caches the three text columns' content
  //   widths per locale (independent of the live table layout, so resizing
  //   never corrupts the measurement). Called from render() and on locale
  //   change — cheap when cached.
  //
  // layoutColumns(): the ONLY function that computes & applies colgroup widths.
  //   Driven by a single ResizeObserver on the tab container, so it runs
  //   whenever the container becomes visible (0 → >0) or the window resizes.
  //   No render-time applying, no second observer — one source of truth.
  //   Silently skips when tables/container width aren't ready (the observer
  //   fires again once they are).
  let lastMeasureLocale = null;
  let measured = null;            // [wAction, wSection, wKey] content widths (px)
  const COL_PAD = 24;
  const VALUE_MIN = 200;
  const KEY_MIN = 60;
  const BASE_W = 578; // table content width at the minimum window (900 - 280 sidebar - 40 padding - 2 border)

  function measureColumns(container) {
    const loc = (window.i18n && window.i18n.locale()) || '';
    if (measured && loc === lastMeasureLocale) return; // cached
    const headerTable = container.querySelector('.ini-header-table .table');
    const bodyTable = container.querySelector('.ini-body-table .table');
    if (!headerTable || !bodyTable) { measured = null; return; } // no tables yet
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:13px;';
    document.body.appendChild(probe);
    const textW = (html) => { probe.innerHTML = html || ''; return probe.offsetWidth; };
    const widths = [0, 0, 0, 0];
    headerTable.querySelectorAll('thead th').forEach((th, i) => { if (i < 4) widths[i] = Math.max(widths[i], textW(th.innerHTML)); });
    bodyTable.querySelectorAll('tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      for (let i = 0; i < 4 && i < cells.length; i++) widths[i] = Math.max(widths[i], textW(cells[i].innerHTML));
    });
    document.body.removeChild(probe);
    measured = widths.map(w => Math.ceil(w + COL_PAD));
    lastMeasureLocale = loc;
  }

  function layoutColumns(container) {
    measureColumns(container); // ensure measured (no-op if cached)
    if (!measured) return;                       // tables not ready yet
    // Always compute column widths based on the MINIMUM window (BASE_W), never
    // the current width. The table is width:100% + fixed layout, so the browser
    // scales these base widths proportionally to fill the actual table width.
    // This keeps proportions identical regardless of window size or refresh.
    const [wAction, wSection] = measured;
    let valueW = VALUE_MIN;
    let keyW = BASE_W - wAction - wSection - valueW;
    if (keyW < KEY_MIN) { keyW = KEY_MIN; valueW = BASE_W - wAction - wSection - keyW; }
    container.querySelectorAll('.ini-header-table .table, .ini-body-table .table').forEach(t => {
      const cg = t.querySelector('colgroup');
      if (!cg) return;
      const c = cg.children;
      if (c[0]) c[0].style.width = wAction + 'px';
      if (c[1]) c[1].style.width = wSection + 'px';
      if (c[2]) c[2].style.width = keyW + 'px';
      if (c[3]) c[3].style.width = valueW + 'px';
    });
    adjustFillButtons();
  }

  // Called from render(): only ensures a measurement. layoutColumns is driven
  // by the ResizeObserver below — render never applies widths itself.
  function autosizeColumns(container) { measureColumns(container); }


  // Toggle fill-button labels between the full text and a compact '#' based on
  // available width in the value cell. Called after render + on window resize.
  function adjustFillButtons() {
    document.querySelectorAll('.ini-list-fill-btn, .ini-fill-btn').forEach(btn => {
      const full = btn.dataset.full || '#';
      // The button's sibling span (the value input area) is the space budget.
      const cell = btn.parentElement;
      if (!cell) return;
      // Measure: does the full label fit alongside the input at current width?
      // Heuristic: if the cell's scrollWidth exceeds its clientWidth, it's tight.
      btn.textContent = (cell.scrollWidth > cell.clientWidth + 2) ? '#' : full;
    });
  }


  // Re-render the editor after a sort change (preserves expanded-group state,
  // which render() already saves/restores).
  function rerenderTable(container) {
    render(container);
  }

  // Render the up/down sort arrows for a column header.
  function sortIndicatorHtml(col) {
    if (sortState.col !== col) return '';
    const ascActive = sortState.dir === 'asc';
    const upCls = ascActive ? 'ini-sort-arrow ini-sort-arrow--active' : 'ini-sort-arrow';
    const downCls = !ascActive ? 'ini-sort-arrow ini-sort-arrow--active' : 'ini-sort-arrow';
    return `<span class="ini-sort-indicator"><span class="${upCls}">▲</span><span class="${downCls}">▼</span></span>`;
  }

  function renderIniTableBody(iniEdits) {
    if (iniEdits.length === 0) {
      return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">${i18n.t('ini.empty')}</div>`;
    }

    // Apply the active column sort — DISPLAY ONLY (sort in place, do NOT
    // setActions — that would mark dirty and race save/reload). There is
    // always an active sort (default = action).
    const dirMul = sortState.dir === 'desc' ? -1 : 1;
    iniEdits.sort((a, b) => dirMul * compareEdit(a, b, sortState.col));

    // Pre-scan: group consecutive same-base-key perColumn entries for collapsing
    const rowPlan = [];
    let i = 0;
    while (i < iniEdits.length) {
      const edit = iniEdits[i];
      const field = findFieldByTemplate(edit.section, edit.key);
      const isPerColumn = field && field.perColumn && edit.section === 'Mania' && edit.maniaKeys != null && edit.maniaKeys > 1;

      if (isPerColumn) {
        // Merge consecutive perColumn entries (modify, delete, or mixed) with same base key
        const baseKey = getBaseKey(edit.key, field);
        const groupIndices = [i];
        let j = i + 1;
        while (j < iniEdits.length) {
          const e2 = iniEdits[j];
          const e2Field = findFieldByTemplate(e2.section, e2.key);
          const e2IsPerColumn = e2Field && e2Field.perColumn && e2.section === 'Mania' && e2.maniaKeys != null && e2.maniaKeys > 1;
          if (e2IsPerColumn && e2.section === edit.section && e2.maniaKeys === edit.maniaKeys
            && getBaseKey(e2.key, e2Field) === baseKey) {
            groupIndices.push(j);
            j++;
          } else {
            break;
          }
        }
        if (groupIndices.length > 1) {
          rowPlan.push({ kind: 'collapsed-group', indices: groupIndices, baseKey, field, maniaKeys: edit.maniaKeys });
          i = j;
        } else {
          rowPlan.push({ kind: 'single', index: i, field, edit });
          i++;
        }
      } else {
        rowPlan.push({ kind: 'single', index: i, field, edit });
        i++;
      }
    }

    return `
      <div class="ini-body-table">
        <div class="table-wrap">
          <table class="table ini-table">
            <colgroup>
              <col style="width:72px">
              <col style="width:120px">
              <col style="width:240px">
              <col>
            </colgroup>
            <tbody>
            ${rowPlan.map(plan => {
              if (plan.kind === 'single') {
                const edit = plan.edit || iniEdits[plan.index];
                const idx = plan.index;
                const field = plan.field;
                const type = field?.type || 'string';
                const cnLabel = edit._cn || INI_FIELD_LABELS.fieldLabel(field || { key: edit.key });
                const rowTitle = field ? `title="${escapeHtml(INI_FIELD_LABELS.fieldLabel(field) + ' (' + field.key + ')')}"` : '';
                if (edit._delete) {
                  return `<tr class="ini-edit-row ini-delete-row" data-idx="${idx}" ${rowTitle}>
                    <td><span class="tag tag--danger">${i18n.t('ini.tagDelete')}</span></td>
                    <td><span class="tag">${sectionLabel(edit)}</span></td>
                    <td><span class="ini-key-name">${escapeHtml(edit.key)}</span> <span style="color:var(--text-muted);font-size:11px">${escapeHtml(cnLabel)}</span></td>
                    <td style="color:var(--danger);font-size:12px">${i18n.t('ini.removeLabel')}</td>
                  </tr>`;
                }
                const isListMania = field && field.type === 'list' && edit.section === 'Mania' && edit.maniaKeys != null && edit.maniaKeys > 1;
                const listFillBtn = isListMania
                  ? `<button type="button" class="btn btn--secondary btn--sm ini-list-fill-btn" data-idx="${idx}" title="${i18n.t('ini.fillAllTitle')}" data-full="${escapeHtml(i18n.t('ini.fillAll'))}" style="padding:4px 6px;flex:0 0 auto;white-space:nowrap">${i18n.t('ini.fillAll')}</button>`
                  : '';
                const valueCell = isListMania
                  ? `<td style="display:flex;align-items:center;gap:8px;padding-right:12px"><span style="flex:1;min-width:0">${renderValueInput(type, edit, idx, field)}</span>${listFillBtn}</td>`
                  : `<td>${renderValueInput(type, edit, idx, field)}</td>`;
                return `<tr class="ini-edit-row" data-idx="${idx}" ${rowTitle}>
                  <td><span class="tag tag--accent">${i18n.t('ini.tagModify')}</span></td>
                  <td><span class="tag">${sectionLabel(edit)}</span></td>
                  <td><span class="ini-key-name">${escapeHtml(edit.key)}</span> <span style="color:var(--text-muted);font-size:11px">${escapeHtml(cnLabel)}</span></td>
                  ${valueCell}
                </tr>`;
              }

              // Collapsed perColumn group (modify, delete, or mixed)
              const firstEdit = iniEdits[plan.indices[0]];
              const firstField = findFieldByTemplate(firstEdit.section, firstEdit.key);
              const firstType = firstField?.type || 'string';
              const groupId = `${plan.baseKey}-${plan.maniaKeys}`;
              const templateKey = plan.field.key;
              const fieldCn = INI_FIELD_LABELS.fieldLabel(plan.field);
              const rowTitle = `title="${escapeHtml(INI_FIELD_LABELS.fieldLabel(plan.field) + ' (' + templateKey + ')')}"`;

              // Determine group composition (modify, delete, or mixed)
              const hasModify = plan.indices.some(i => !iniEdits[i]._delete);
              const hasDelete = plan.indices.some(i => iniEdits[i]._delete);
              // Use string-based data-idx to avoid collision with sub-row indices
              const groupDataIdx = `G-${groupId}`;

              let html = `<tr class="ini-edit-row ini-collapsed-row" data-group="${escapeHtml(groupId)}" data-group-indices="${escapeHtml(JSON.stringify(plan.indices))}" data-idx="${escapeHtml(groupDataIdx)}" ${rowTitle}>
                <td><span class="tag ini-group-toggle" style="background:rgba(102,153,255,0.15);color:#69f;cursor:pointer">${i18n.t('ini.tagGroup')}</span></td>
                <td><span class="tag">${sectionLabel(firstEdit)}</span></td>
                <td><span class="ini-key-name">${escapeHtml(templateKey)}</span> <span style="color:var(--text-muted);font-size:11px">${escapeHtml(fieldCn)}</span></td>
                <td style="display:flex;align-items:center;gap:8px;padding-right:12px">
                  <span style="flex:1;min-width:0">${hasModify ? renderValueInput(firstType, firstEdit, plan.indices[0], firstField) : `<span style="color:var(--danger);font-size:12px">${i18n.t('ini.removeLabel')}</span>`}</span>
                  ${hasModify ? `<button type="button" class="btn btn--secondary btn--sm ini-fill-btn" data-group="${escapeHtml(groupId)}" title="${i18n.t('ini.fillAllTitle')}" data-full="${escapeHtml(i18n.t('ini.fillAll'))}" style="padding:4px 6px;flex:0 0 auto;white-space:nowrap">${i18n.t('ini.fillAll')}</button>` : ''}
                </td>
              </tr>`;

              // Sub-rows — hidden initially; per-row _delete determines appearance
              for (const subIdx of plan.indices) {
                const subEdit = iniEdits[subIdx];
                const subField = findFieldByTemplate(subEdit.section, subEdit.key);
                const subType = subField?.type || 'string';
                const subTitle = subField ? `title="${escapeHtml(INI_FIELD_LABELS.fieldLabel(subField) + ' (' + subField.key + ')')}"` : '';
                if (subEdit._delete) {
                  html += `<tr class="ini-edit-row ini-sub-row ini-delete-row" data-idx="${subIdx}" data-group-parent="${escapeHtml(groupId)}" style="display:none" ${subTitle}>
                    <td><span class="tag tag--danger">${i18n.t('ini.tagDelete')}</span></td>
                    <td><span class="tag">${sectionLabel(subEdit)}</span></td>
                    <td><span class="ini-key-name">${escapeHtml(subEdit.key)}</span> <span style="color:var(--text-muted);font-size:11px">${escapeHtml(subEdit._cn || subEdit.key)}</span></td>
                    <td style="color:var(--danger);font-size:12px">${i18n.t('ini.removeLabel')}</td>
                  </tr>`;
                } else {
                  html += `<tr class="ini-edit-row ini-sub-row" data-idx="${subIdx}" data-group-parent="${escapeHtml(groupId)}" style="display:none" ${subTitle}>
                    <td><span class="tag tag--accent">${i18n.t('ini.tagModify')}</span></td>
                    <td><span class="tag">${sectionLabel(subEdit)}</span></td>
                    <td><span class="ini-key-name">${escapeHtml(subEdit.key)}</span> <span style="color:var(--text-muted);font-size:11px">${escapeHtml(subEdit._cn || subEdit.key)}</span></td>
                    <td>${renderValueInput(subType, subEdit, subIdx, subField)}</td>
                  </tr>`;
                }
              }
              return html;
            }).join('')}
          </tbody>
        </table>
      </div>
      </div>
    `;
  }

  function renderValueInput(type, edit, i, field) {
    switch (type) {
      case 'bool':
        return `<label class="toggle">
          <input type="checkbox" class="ini-value-toggle" data-idx="${i}" ${edit.value === '1' ? 'checked' : ''}>
          <span class="toggle__slider"></span>
        </label>`;
      case 'section': {
        const opts = field?.options || [];
        return `<select class="form-input ini-value-section" data-idx="${i}" style="width:100%;max-width:200px">
          ${opts.map(o => `<option value="${o.value}" ${edit.value === o.value ? 'selected' : ''}>${INI_FIELD_LABELS.optionLabel(field, o)}</option>`).join('')}
        </select>`;
      }
      case 'rgb':
      case 'rgba': {
        const isRgba = type === 'rgba';
        const val = edit.value || (isRgba ? '0,0,0,255' : '0,0,0');
        const parts = val.split(',').map(Number);
        const r = parts[0]||0, g = parts[1]||0, b = parts[2]||0, a = parts[3] !== undefined ? parts[3] : 255;
        return `<div class="color-row" style="display:flex;align-items:center;gap:6px">
          <button type="button" class="color-swatch ini-color-swatch" data-idx="${i}" data-type="${type}" tabindex="0" style="flex:0 0 auto;background:${isRgba ? `rgba(${r},${g},${b},${a/255})` : `rgb(${r},${g},${b})`}"></button>
          <input type="text" class="form-input ini-value-input ini-color-value" data-idx="${i}" data-type="${type}" value="${escapeHtml(val)}" style="flex:1;min-width:0">
        </div>`;
      }
      case 'path':
        return `<div class="path-input-row" style="display:flex;gap:8px;align-items:center">
          <input type="text" class="form-input ini-value-input" data-idx="${i}" value="${escapeHtml(edit.value)}" style="flex:1;min-width:0">
          <button type="button" class="btn btn--secondary btn--sm ini-path-btn" data-idx="${i}" title="${i18n.t('ini.pickFileTitle')}" style="flex:0 0 auto">📂</button>
        </div>`;
      case 'integer':
      case 'number': {
        const step = type === 'integer' ? '1' : '0.1';
        const minAttr = field && field.min != null ? ` min="${field.min}"` : '';
        const maxAttr = field && field.max != null ? ` max="${field.max}"` : '';
        const forbiddenAttr = field && Array.isArray(field.forbidden) ? ` data-forbidden="${field.forbidden.join(',')}"` : '';
        return `<input type="number" class="form-input ini-value-input" data-idx="${i}" value="${escapeHtml(edit.value)}" step="${step}"${minAttr}${maxAttr}${forbiddenAttr} style="width:100%">`;
      }
      default:
        return `<input type="text" class="form-input ini-value-input" data-idx="${i}" value="${escapeHtml(edit.value)}" style="width:100%">`;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ── Del key: delete selected INI rows with confirmation ──
  async function deleteSelected() {
    if (selectedIndices.size === 0) return;
    const actions = getActions ? getActions() : [];
    const sorted = [...selectedIndices].sort((a, b) => b - a);
    const confirmed = await ApplyDialog.showConfirmDialog(
      i18n.t('ini.deleteRowsConfirm', { n: sorted.length }),
      [
        { label: `${i18n.t('ini.deleteBtn').replace(/^- ?/, '')} (${sorted.length})`, cls: 'btn--danger', value: 'delete' },
        { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
      ]
    );
    if (!confirmed || confirmed !== 'delete') return;

    // Build a map from the (sorted) view-model index back to the underlying
    // action, since selectedIndices reference DISPLAY positions.
    const updated = [...actions];
    for (const i of sorted) updated.splice(i, 1);
    setActions(updated);
    // Keep remaining selection valid: drop deleted indices, reindex the rest.
    const kept = new Set();
    for (const idx of selectedIndices) {
      if (sorted.includes(idx)) continue;
      // how many deleted indices were before this one → shift down
      let shift = 0;
      for (const d of sorted) if (d < idx) shift++;
      kept.add(idx - shift);
    }
    selectedIndices = kept;
    lastClickedIndex = null;
    Toast.info(i18n.t('ini.deleted', { n: sorted.length }));
    // Re-render current container
    const container = document.getElementById('tab-ini');
    if (container && container.classList.contains('tab-content--active')) {
      render(container);
    }
  }

  // Single ResizeObserver: the ONLY driver of layoutColumns. Covers the tab
  // becoming visible (width 0 → >0) and window resizing.
  const iniContainer = document.getElementById('tab-ini');
  if (iniContainer && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => layoutColumns(iniContainer)).observe(iniContainer);
  } else if (iniContainer) {
    window.addEventListener('resize', () => layoutColumns(iniContainer));
  }

  window.IniEditor = { init, render, deleteSelected, layoutColumns };
})();
