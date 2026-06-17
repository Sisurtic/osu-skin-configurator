// skin.ini key-value table editor — type-aware inputs driven by INI_FIELD_DEFS
// Supports multiple [Mania] sections (per key-count) and per-column field expansion.
(function () {
  let getActions, setActions, skinPathFn;
  let selectedIndices = new Set();
  let lastClickedIndex = null;

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

    // Reset selection when data changes
    selectedIndices = new Set();
    lastClickedIndex = null;

    container.innerHTML = `
      <div class="editor-sticky-header">
        <div style="padding-bottom:10px;border-bottom:1px solid var(--border)">
          <div style="margin-bottom:8px">
            <h3 style="margin-bottom:4px">skin.ini 修改</h3>
            <p style="font-size:12px;color:var(--text-muted)">选择并编辑需要修改的 skin.ini 字段。Mania 字段需先指定键数。</p>
          </div>

          <div style="display:flex;margin-bottom:8px;gap:8px;align-items:center">
            <!-- Section列 -->
            <select class="form-input" id="ini-section-select" style="width:120px;flex-shrink:0">
              <option value="">选择分组</option>
              ${INI_SECTIONS.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
            <!-- Keys 输入：Section 与 Key 之间，带间距 -->
            <div id="ini-mania-keys-row" style="display:none;white-space:nowrap;flex-shrink:0">
              <span style="font-size:12px;color:var(--text-muted);margin-right:4px">Keys:</span>
              <input type="number" class="form-input" id="ini-mania-keys-custom" placeholder="键数" min="1" max="18" style="width:70px">
            </div>
            <!-- Key列 flex -->
            <div style="flex:1;min-width:0;display:flex;gap:4px;align-items:center">
              <div class="ini-combo" style="flex:1;min-width:0">
                <input type="text" class="form-input" id="ini-key-input"
                       placeholder="请先选择分组" autocomplete="off" disabled>
                <div class="ini-combo__dropdown" id="ini-key-dropdown"></div>
              </div>
            </div>
            <!-- 值列 flex spacer -->
            <div style="flex:1;min-width:0"></div>
            <!-- 按钮在右侧 -->
            <div style="flex-shrink:0;display:flex;gap:4px;margin-left:8px">
              <button class="btn btn--primary btn--sm" id="btn-add-ini" style="font-size:11px;padding:4px 6px">+ 添加</button>
              <button class="btn btn--danger btn--sm" id="btn-delete-ini" style="font-size:11px;padding:4px 6px" title="删除选中的 INI 键">- 删除</button>
            </div>
          </div>

          <!-- Delete drop zone -->
          <div class="editor-delete-zone" id="ini-delete-zone"
               style="padding:8px;border:2px dashed var(--danger);border-radius:var(--radius);text-align:center;color:var(--danger);font-size:12px;opacity:0.5;transition:all 0.2s">
            拖拽操作到此处删除
          </div>
        </div>

        ${iniEdits.length > 0 ? `
        <!-- Fixed header table (thead only, matching colgroup with body) -->
        <div class="ini-header-table" style="margin-top:12px">
          <div class="table-wrap">
            <table class="table">
              <colgroup>
                <col style="width:68px">
                <col style="width:110px">
                <col style="min-width:160px">
                <col style="min-width:200px">
              </colgroup>
              <thead><tr><th>操作</th><th>Section</th><th>Key</th><th>值</th></tr></thead>
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
      currentFields = fields.map(f => ({ key: f.key, cn: f.cn }));
      keyInput.value = '';
      keyInput.disabled = currentFields.length === 0;
      keyInput.placeholder = currentFields.length > 0 ? '输入搜索键名...' : '请先选择分组';
      keyActiveIndex = -1;
      closeDropdown();
    }

    function filterFields(query) {
      if (!query) return currentFields;
      const q = query.toLowerCase();
      return currentFields.filter(f => f.key.toLowerCase().includes(q) || f.cn.includes(q));
    }

    function renderDropdown(filtered) {
      if (filtered.length === 0) {
        keyDropdown.innerHTML = `<div class="ini-combo__empty">无匹配键名</div>`;
      } else {
        keyDropdown.innerHTML = filtered.map((f, i) =>
          `<div class="ini-combo__option${i === keyActiveIndex ? ' ini-combo__option--active' : ''}" data-key="${escapeHtml(f.key)}" data-idx="${i}">
            <span class="ini-combo__option-key">${escapeHtml(f.key)}</span>
            <span class="ini-combo__option-cn">${escapeHtml(f.cn)}</span>
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
      if (!section || !key) { Toast.warning('请选择 Section 和 Key'); return; }
      if (!currentFields.find(f => f.key === key)) { Toast.warning(`"${key}" 不是有效的键名`); return; }

      const keysInput = container.querySelector('#ini-mania-keys-custom');
      const maniaKeyVal = parseInt(keysInput?.value);
      if (section === 'Mania' && (!maniaKeyVal || maniaKeyVal < 1 || maniaKeyVal > 18)) {
        Toast.warning('请先输入 Mania 键数（如 4、7）');
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
            _cn: `${field.cn} (列${col})`,
          });
        }
      } else {
        newEntries = [{
          section,
          maniaKeys,
          key,
          value,
          _cn: field?.cn || key,
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
        Toast.warning('操作已存在，不能重复添加');
        return;
      }
      if (filtered.length < newEntries.length) {
        Toast.info(`已跳过 ${newEntries.length - filtered.length} 个重复项`);
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
      if (!section || !key) { Toast.warning('请选择要删除的 Section 和 Key'); return; }
      if (!currentFields.find(f => f.key === key)) { Toast.warning(`"${key}" 不是有效的键名`); return; }

      const keysInput = container.querySelector('#ini-mania-keys-custom');
      const maniaKeyVal = parseInt(keysInput?.value);
      if (section === 'Mania' && (!maniaKeyVal || maniaKeyVal < 1 || maniaKeyVal > 18)) {
        Toast.warning('请先输入 Mania 键数（如 4、7）');
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
            _cn: `${field.cn} (列${col})`, _delete: true,
          });
        }
      } else {
        newEntries = [{
          section, maniaKeys, key, value: '',
          _cn: field?.cn || key, _delete: true,
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
        Toast.warning('删除操作已存在，不能重复添加');
        return;
      }
      if (delFiltered.length < newEntries.length) {
        Toast.info(`已跳过 ${newEntries.length - delFiltered.length} 个重复项`);
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

        // Group main rows have string-based data-idx (e.g. "G-Colour-4")
        const groupIndicesRaw = row.dataset.groupIndices;
        const isGroupMain = !!groupIndicesRaw && !row.dataset.groupParent;
        if (isGroupMain) {
          const groupIdxList = JSON.parse(groupIndicesRaw);
          if (e.ctrlKey || e.metaKey) {
            const allSelected = groupIdxList.every(i => selectedIndices.has(i));
            if (allSelected) {
              for (const i of groupIdxList) selectedIndices.delete(i);
            } else {
              for (const i of groupIdxList) selectedIndices.add(i);
            }
            lastClickedIndex = groupIdxList[groupIdxList.length - 1];
          } else {
            selectedIndices.clear();
            for (const i of groupIdxList) selectedIndices.add(i);
            lastClickedIndex = groupIdxList[groupIdxList.length - 1];
          }
          updateRowHighlights(container);
          return;
        }

        const idx = parseInt(row.dataset.idx);
        if (isNaN(idx)) return;

        const groupIdxList = [idx];

        if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd+click: toggle
          if (isGroupMain) {
            const allSelected = groupIdxList.every(i => selectedIndices.has(i));
            if (allSelected) {
              for (const i of groupIdxList) selectedIndices.delete(i);
            } else {
              for (const i of groupIdxList) selectedIndices.add(i);
            }
          } else {
            if (selectedIndices.has(idx)) {
              selectedIndices.delete(idx);
            } else {
              selectedIndices.add(idx);
            }
          }
          lastClickedIndex = idx;
        } else if (e.shiftKey && lastClickedIndex !== null) {
          // Shift+click: range select
          const start = Math.min(lastClickedIndex, idx);
          const end = Math.max(lastClickedIndex, idx);
          if (!e.ctrlKey && !e.metaKey) selectedIndices.clear();
          for (let i = start; i <= end; i++) {
            selectedIndices.add(i);
          }
        } else {
          // Plain click: single select (select whole group if main row)
          selectedIndices.clear();
          for (const i of groupIdxList) selectedIndices.add(i);
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
        Toast.info(`已删除 ${indices.length} 个 INI 操作`);
        render(container);
      });
    }

    // ── Tab cycling + container keyboard handling ──
    if (!container._ctrlABound) {
      container._ctrlABound = true;
      container.addEventListener('keydown', (e) => {
        // Tab: cycle focus among all focusable elements within the tab content
        if (e.key === 'Tab' && container.contains(document.activeElement)) {
          const focusable = container.querySelectorAll(
            'input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          const visible = Array.from(focusable).filter(el => el.offsetParent !== null);
          if (visible.length === 0) return;
          e.preventDefault();
          const cur = visible.indexOf(document.activeElement);
          const next = e.shiftKey
            ? (cur <= 0 ? visible.length - 1 : cur - 1)
            : (cur >= visible.length - 1 ? 0 : cur + 1);
          visible[next].focus();
        }
      });
    }

    // Value change handlers
    container.querySelectorAll('.ini-value-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        iniEdits[idx].value = input.value;
        setActions([...iniEdits]);
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
    // Double-click collapsed group main row to expand/collapse sub-rows
    container.querySelectorAll('.ini-collapsed-row').forEach(row => {
      row.addEventListener('dblclick', (e) => {
        if (e.target.closest('button, input, select')) return;
        const groupId = row.dataset.group;
        const subRows = container.querySelectorAll(`.ini-sub-row[data-group-parent="${CSS.escape(groupId)}"]`);
        if (subRows.length === 0) return;
        const isExpanded = subRows[0].style.display !== 'none';
        for (const sr of subRows) {
          sr.style.display = isExpanded ? 'none' : '';
        }
        row.classList.toggle('ini-collapsed-row--expanded', !isExpanded);
      });
    });

    // Fill-all buttons for list-type fields (ColumnSpacing etc.)
    container.querySelectorAll('.ini-list-fill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const edit = iniEdits[idx];
        if (!edit || edit.section !== 'Mania' || edit.maniaKeys == null || edit.maniaKeys <= 1) return;
        const parts = (edit.value || '').split(',').map(s => s.trim()).filter(Boolean);
        const firstVal = parts.length > 0 ? parts[0] : '0';
        edit.value = Array(edit.maniaKeys).fill(firstVal).join(',');
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
          { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }
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
      const base = f.key.replace(/#$/, '');
      return key.startsWith(base) && key.length > base.length;
    }) || null;
  }

  // Get base key for grouping; uses field definition template for perColumn fields
  function getBaseKey(key, field) {
    if (field && field.perColumn) {
      return field.key.replace(/#$/, '');
    }
    return key;
  }

  function renderIniTableBody(iniEdits) {
    if (iniEdits.length === 0) {
      return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">暂无修改项，请从上方添加</div>`;
    }

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
          <table class="table">
            <colgroup>
              <col style="width:68px">
              <col style="width:110px">
              <col style="min-width:160px">
              <col style="min-width:200px">
            </colgroup>
            <tbody>
            ${rowPlan.map(plan => {
              if (plan.kind === 'single') {
                const edit = plan.edit || iniEdits[plan.index];
                const idx = plan.index;
                const field = plan.field;
                const type = field?.type || 'string';
                const cnLabel = edit._cn || field?.cn || edit.key;
                const rowTitle = field ? `title="${escapeHtml(field.cn + ' (' + field.key + ')' + (field.en ? ' — ' + field.en : ''))}"` : '';
                if (edit._delete) {
                  return `<tr class="ini-edit-row ini-delete-row" data-idx="${idx}" ${rowTitle}>
                    <td><span class="tag tag--danger">删除</span></td>
                    <td><span class="tag">${sectionLabel(edit)}</span></td>
                    <td>${cnLabel} <span style="color:var(--text-muted);font-size:11px">${edit.key}</span></td>
                    <td style="color:var(--danger);font-size:12px">— 移除 —</td>
                  </tr>`;
                }
                const isListMania = field && field.type === 'list' && edit.section === 'Mania' && edit.maniaKeys != null && edit.maniaKeys > 1;
                const listFillBtn = isListMania
                  ? `<button type="button" class="btn btn--secondary btn--sm ini-list-fill-btn" data-idx="${idx}" title="填充到全部列"># 填充</button>`
                  : '';
                const valueCell = isListMania
                  ? `<td style="display:flex;align-items:center;gap:4px"><span style="flex:1;min-width:0">${renderValueInput(type, edit, idx, field)}</span>${listFillBtn}</td>`
                  : `<td>${renderValueInput(type, edit, idx, field)}</td>`;
                return `<tr class="ini-edit-row" data-idx="${idx}" ${rowTitle}>
                  <td><span class="tag tag--accent">修改</span></td>
                  <td><span class="tag">${sectionLabel(edit)}</span></td>
                  <td>${cnLabel} <span style="color:var(--text-muted);font-size:11px">${edit.key}</span></td>
                  ${valueCell}
                </tr>`;
              }

              // Collapsed perColumn group (modify, delete, or mixed)
              const firstEdit = iniEdits[plan.indices[0]];
              const firstField = findFieldByTemplate(firstEdit.section, firstEdit.key);
              const firstType = firstField?.type || 'string';
              const groupId = `${plan.baseKey}-${plan.maniaKeys}`;
              const templateKey = plan.baseKey + '#';
              const fieldCn = plan.field.cn;
              const rowTitle = `title="${escapeHtml(plan.field.cn + ' (' + templateKey + ')' + (plan.field.en ? ' — ' + plan.field.en : ''))}"`;

              // Determine group composition (modify, delete, or mixed)
              const hasModify = plan.indices.some(i => !iniEdits[i]._delete);
              const hasDelete = plan.indices.some(i => iniEdits[i]._delete);
              // Use string-based data-idx to avoid collision with sub-row indices
              const groupDataIdx = `G-${groupId}`;

              let html = `<tr class="ini-edit-row ini-collapsed-row" data-group="${escapeHtml(groupId)}" data-group-indices="${escapeHtml(JSON.stringify(plan.indices))}" data-idx="${escapeHtml(groupDataIdx)}" ${rowTitle}>
                <td><span class="tag" style="background:rgba(102,153,255,0.15);color:#69f">分组</span></td>
                <td><span class="tag">${sectionLabel(firstEdit)}</span></td>
                <td>${escapeHtml(fieldCn)} <span style="color:var(--text-muted);font-size:11px">${escapeHtml(templateKey)}</span></td>
                <td style="display:flex;align-items:center;gap:4px">
                  <span style="flex:1;min-width:0">${hasModify ? renderValueInput(firstType, firstEdit, plan.indices[0], firstField) : `<span style="color:var(--danger);font-size:12px">— 移除 —</span>`}</span>
                  ${hasModify ? `<button type="button" class="btn btn--secondary btn--sm ini-fill-btn" data-group="${escapeHtml(groupId)}" title="填充到全部列"># 填充</button>` : ''}
                </td>
              </tr>`;

              // Sub-rows — hidden initially; per-row _delete determines appearance
              for (const subIdx of plan.indices) {
                const subEdit = iniEdits[subIdx];
                const subField = findFieldByTemplate(subEdit.section, subEdit.key);
                const subType = subField?.type || 'string';
                const subTitle = subField ? `title="${escapeHtml(subField.cn + ' (' + subField.key + ')' + (subField.en ? ' — ' + subField.en : ''))}"` : '';
                if (subEdit._delete) {
                  html += `<tr class="ini-edit-row ini-sub-row ini-delete-row" data-idx="${subIdx}" data-group-parent="${escapeHtml(groupId)}" style="display:none" ${subTitle}>
                    <td><span class="tag tag--danger">删除</span></td>
                    <td><span class="tag">${sectionLabel(subEdit)}</span></td>
                    <td>${escapeHtml(subEdit._cn || subEdit.key)} <span style="color:var(--text-muted);font-size:11px">${escapeHtml(subEdit.key)}</span></td>
                    <td style="color:var(--danger);font-size:12px">— 移除 —</td>
                  </tr>`;
                } else {
                  html += `<tr class="ini-edit-row ini-sub-row" data-idx="${subIdx}" data-group-parent="${escapeHtml(groupId)}" style="display:none" ${subTitle}>
                    <td><span class="tag tag--accent">修改</span></td>
                    <td><span class="tag">${sectionLabel(subEdit)}</span></td>
                    <td>${escapeHtml(subEdit._cn || subEdit.key)} <span style="color:var(--text-muted);font-size:11px">${escapeHtml(subEdit.key)}</span></td>
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
        return `<select class="form-input ini-value-section" data-idx="${i}" style="width:120px">
          ${opts.map(o => `<option value="${o.value}" ${edit.value === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>`;
      }
      case 'rgb':
      case 'rgba': {
        const isRgba = type === 'rgba';
        const val = edit.value || (isRgba ? '0,0,0,255' : '0,0,0');
        const parts = val.split(',').map(Number);
        const r = parts[0]||0, g = parts[1]||0, b = parts[2]||0, a = parts[3] !== undefined ? parts[3] : 255;
        return `<div class="color-row">
          <span class="color-swatch ini-color-swatch" data-idx="${i}" data-type="${type}"
                style="background:${isRgba ? `rgba(${r},${g},${b},${a/255})` : `rgb(${r},${g},${b})`}"></span>
          <input type="text" class="form-input ini-value-input ini-color-value" data-idx="${i}" value="${escapeHtml(val)}" style="width:120px">
        </div>`;
      }
      case 'path':
        return `<div class="path-input-row" style="display:flex;gap:4px;align-items:center">
          <input type="text" class="form-input ini-value-input" data-idx="${i}" value="${escapeHtml(edit.value)}" style="flex:1;min-width:0">
          <button type="button" class="btn btn--secondary btn--sm ini-path-btn" data-idx="${i}" title="选择文件">📂</button>
        </div>`;
      case 'integer':
        return `<input type="number" class="form-input ini-value-input" data-idx="${i}" value="${escapeHtml(edit.value)}" step="1" style="width:100px">`;
      case 'number':
        return `<input type="number" class="form-input ini-value-input" data-idx="${i}" value="${escapeHtml(edit.value)}" step="0.1" style="width:100px">`;
      default:
        return `<input type="text" class="form-input ini-value-input" data-idx="${i}" value="${escapeHtml(edit.value)}" style="width:200px">`;
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
      `确定要删除选中的 ${sorted.length} 个 INI 操作吗？`,
      [
        { label: `删除 (${sorted.length})`, cls: 'btn--danger', value: 'delete' },
        { label: '取消', cls: 'btn--secondary', value: 'cancel' },
      ]
    );
    if (!confirmed || confirmed !== 'delete') return;

    const updated = [...actions];
    for (const i of sorted) updated.splice(i, 1);
    setActions(updated);
    selectedIndices.clear();
    lastClickedIndex = null;
    Toast.info(`已删除 ${sorted.length} 个 INI 操作`);
    // Re-render current container
    const container = document.getElementById('tab-ini');
    if (container && container.classList.contains('tab-content--active')) {
      render(container);
    }
  }

  window.IniEditor = { init, render, deleteSelected };
})();
