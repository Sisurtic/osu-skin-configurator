// skin.ini key-value table editor — type-aware inputs driven by INI_FIELD_DEFS
// Supports multiple [Mania] sections (per key-count) and per-column field expansion.
// Selection + drag-to-delete is delegated to the shared OpTable module (`sel`).
(function () {
  let getActions, setActions, skinPathFn;
  // OpTable instance — created lazily on first render (needs the container).
  let sel = null;
  // Snapshot of FOLDED perColumn group-header VALUES (read off the live DOM
  // before rebuild), so a re-render preserves an in-flight header edit instead
  // of resetting it to the first member's value. Keyed by gid. All control
  // types (bool/section/rgb/string) render from edit.value, so one value fits.
  let _headerTempSnapshot = {};
  // Expanded perColumn groups (by STABLE per-instance gid). Default: collapsed.
  // gids live on the member iniEdits objects (_groupId); reorder preserves them.
  const expandedSeqGroups = new Set();

  // Last actions array reference rendered — handed to OpTable.maybeResetSelection
  // so selection is reset only on a real data change, not on sort/delete re-renders.
  let lastActionsRef = null;
  // Persist Section/Key/ManiaKeys selection across re-renders (add/delete/value
  // edit). Only empty on first app load.
  let lastSection = '';
  let lastKey = '';
  let lastManiaKeys = '';

  function init(getter, setter, skPathFn) {
    getActions = getter;
    setActions = setter;
    skinPathFn = typeof skPathFn === 'function' ? skPathFn : () => null;
  }

  function render(container) {
    const actions = getActions ? getActions() : [];
    const iniEdits = actions || [];

    // (Re)create the OpTable instance for this container on first render. The
    // adapter closes over iniEdits-free helpers (rowMembers/rowAnchor read the
    // row's own data-attrs), so it survives across renders.
    if (!sel) {
      sel = OpTable.create({
        container,
        rowSelector: '.ini-edit-row',
        interactiveSelector: 'input, select, button, label, .toggle, .ini-group-toggle',
        deleteMimeType: 'application/ini-indices',
        rowMembers: (row) => rowMemberIndices(row),
        rowAnchor: (row) => rowAnchorIndex(row),
        // Group header is TRANSPARENT in range (Shift) selection: report only its
        // first member so a connect-select into the group lands on the members
        // cleanly (header neither forces the whole group in nor skews the span).
        // Single-click on the header still selects the whole group via rowMembers.
        rowRangeMembers: (row) => rowRangeMemberIndices(row),
        applyDelete: (indicesDesc) => {
          const updated = [...(getActions ? getActions() : [])];
          for (const i of indicesDesc) updated.splice(i, 1);
          setActions(updated);
          Toast.info(i18n.t('ini.deleted', { n: indicesDesc.length }));
          render(document.getElementById('tab-ini'));
        },
        isGroupMemberRow: (row) => !!row.dataset.groupParent,
        reorder: (fromIndices, toIndex) => {
          const actions = getActions ? getActions() : [];
          const { arr, insertAt, count } = OpTable.reorderArray(actions, fromIndices, toIndex);
          setActions(arr);
          lastActionsRef = arr;
          render(document.getElementById('tab-ini'));
          // Select the moved block AFTER render so rows exist when setSelected
          // auto-highlights them.
          const ns = new Set();
          for (let i = 0; i < count; i++) ns.add(insertAt + i);
          sel.setSelected(ns, insertAt);
        },
      });
    } else {
      sel.setContainer(container);
    }

    // Reset selection only when the underlying data actually changed (different
    // array reference), not on every re-render (sort toggle, delete) — otherwise
    // re-rendering wipes the user's selection.
    if (lastActionsRef !== actions) {
      sel.maybeResetSelection(actions);
      lastActionsRef = actions;
    }

    // Snapshot FOLDED group-header values so rebuilds preserve an in-flight
    // header edit. Keyed by gid (stable across reorder/re-render). Expanded
    // groups mirror their first member's value live, so they are skipped.
    _headerTempSnapshot = {};
    if (container.querySelector) {
      container.querySelectorAll('.ini-collapsed-row').forEach(r => {
        if (r.classList.contains('ini-collapsed-row--expanded')) return;
        const gid = r.dataset.gid;
        if (!gid) return;
        const cb = r.querySelector('.ini-value-toggle[data-group-header="1"]');
        const sel = r.querySelector('.ini-value-section[data-group-header="1"]');
        const inp = r.querySelector('.ini-value-input[data-group-header="1"]');
        let v = null;
        if (cb) v = cb.checked ? '1' : '0';
        else if (sel) v = sel.value;
        else if (inp) v = inp.value;
        if (v != null) _headerTempSnapshot[gid] = v;
      });
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
                <th data-col="action">${i18n.t('ini.colAction')}</th>
                <th data-col="section">${i18n.t('ini.colSection')}</th>
                <th>${i18n.t('ini.colKey')}</th>
                <th>${i18n.t('ini.colValue')}</th>
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
          keyInput.value = opt.dataset.key; lastKey = keyInput.value;
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
      lastSection = sec;
      if (sec === 'Mania') {
        maniaKeysRow.style.display = '';
      } else {
        maniaKeysRow.style.display = 'none';
      }
      updateKeyDropdown();
    });

    // Persist Mania keys value.
    const maniaKeysInputEl = container.querySelector('#ini-mania-keys-custom');
    if (maniaKeysInputEl) {
      maniaKeysInputEl.addEventListener('input', () => { lastManiaKeys = maniaKeysInputEl.value; });
    }

    // Input: filter & show dropdown
    keyInput.addEventListener('input', () => {
      lastKey = keyInput.value;
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
          keyInput.value = filtered[keyActiveIndex].key; lastKey = keyInput.value;
        } else if (filtered.length === 1) {
          keyInput.value = filtered[0].key; lastKey = keyInput.value;
        }
        keyActiveIndex = -1;
        closeDropdown();
      } else if (e.key === 'Tab' && keyInput.value && isOpen) {
        e.preventDefault();
        if (keyActiveIndex >= 0 && keyActiveIndex < filtered.length) {
          keyInput.value = filtered[keyActiveIndex].key; lastKey = keyInput.value;
        } else if (filtered.length > 0) {
          keyInput.value = filtered[0].key; lastKey = keyInput.value;
        }
        keyActiveIndex = -1;
        closeDropdown();
      } else if (e.key === 'Tab' && keyInput.value && !isOpen) {
        // Tab with text typed but dropdown closed: autocomplete first match
        const all = filterFields(keyInput.value);
        if (all.length > 0) {
          e.preventDefault();
          keyInput.value = all[0].key; lastKey = keyInput.value;
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
      keyInput.value = all[curIdx].key; lastKey = keyInput.value;
      keyActiveIndex = curIdx;
      renderDropdown(filterFields(keyInput.value));
    }, { passive: false });

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
      // Select the newly added rows (render first so they exist when setSelected
      // auto-highlights them).
      if (sel) {
        const ns = new Set();
        for (let k = 0; k < filtered.length; k++) ns.add(updated.length - filtered.length + k);
        if (ns.size) sel.setSelected(ns, updated.length - filtered.length);
      }
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
      // Select the newly added delete rows.
      if (sel) {
        const ns = new Set();
        for (let k = 0; k < delFiltered.length; k++) ns.add(updated.length - delFiltered.length + k);
        if (ns.size) sel.setSelected(ns, updated.length - delFiltered.length);
      }
    });
    container.querySelectorAll('.ini-edit-row').forEach(row => {
      sel.bindRow(row);
    });

    sel.bindDeleteZone(container.querySelector('#ini-delete-zone'));



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

    // ── Multi-select sync helpers ──
    // Match siblings by CONTROL TYPE (field.type), not field identity — so two
    // single-instance fields of the same type sync (e.g. [Colours] Combo1 +
    // Combo2, both rgb; two [General] bool toggles; two text rows), regardless of
    // key or section. rgb and rgba share the color control (swatch + value box).
    // Mirrors file-copy's "sync all selected rows", but the type guard prevents
    // pushing a string into a numeric toggle etc. Reuses findFieldByTemplate.
    function editTypeKey(edit) {
      const field = findFieldByTemplate(edit.section, edit.key);
      const type = (field && field.type) || 'string';
      return (type === 'rgb' || type === 'rgba') ? 'color' : type;
    }
    // Sync a value edit to other selected rows of the same type (同类项). Updates
    // data + each sibling's DOM in-place (no render → preserves focus/selection).
    // `field` selects the DOM update: 'value'→.value (text/number/color box),
    // 'toggle'→.checked, 'section'→<select>.value. Optional `color` restyles a
    // sibling color swatch alongside its input box. Mirrors file-copy-editor's
    // syncField, scoped to same-type rows (ini is heterogeneous).
    // pickControl: a perColumn group HEADER also renders a control for its FIRST
    // member (data-idx = that member's index), so a member index can match BOTH
    // the header's control and the member's own sub-row control. When the group is
    // expanded we must update the sub-row control (not the header's), else the
    // first member appears "skipped". Prefer the control NOT inside the collapsed
    // header row; fall back to the header's control (collapsed group) if none.
    function pickControl(selector, i) {
      const all = container.querySelectorAll(`${selector}[data-idx="${i}"]`);
      for (const el of all) {
        if (!el.closest('.ini-collapsed-row')) return el;
      }
      return all[0] || null;
    }
    // If member index `i` belongs to a COLLAPSED perColumn group, return that
    // group's header element; otherwise null. (A collapsed header has the
    // ini-collapsed-row class but NOT the --expanded modifier.)
    function collapsedGroupHeaderFor(i) {
      const headers = container.querySelectorAll('.ini-collapsed-row');
      for (const h of headers) {
        if (h.classList.contains('ini-collapsed-row--expanded')) continue; // expanded
        let members = [];
        try { members = JSON.parse(h.dataset.groupIndices || '[]'); } catch (_) {}
        if (members.includes(i)) return h;
      }
      return null;
    }
    // The control-type key for a folded group header node: derived from its first
    // member's field (all members share type). Used so folded headers match data
    // rows / other headers of the same control type.
    function headerTypeKey(headerEl) {
      let members = [];
      try { members = JSON.parse(headerEl.dataset.groupIndices || '[]'); } catch (_) {}
      const first = iniEdits[members[0]];
      return first ? editTypeKey(first) : '';
    }
    // Multi-select sync: delegate the shared skeleton to OpTable.createGroupSync,
    // injecting ini-specific data/controls/type-matching via the adapter. Folded
    // group headers are virtual rows (source + target); expanded headers ignored.
    const { syncField } = OpTable.createGroupSync({
      getSelected: () => sel ? sel.getSelected() : new Set(),
      isHeaderControl: (el) => !!el.dataset.groupHeader,
      headerRowOf: (el) => el.closest('.ini-collapsed-row'),
      headerIdOf: (headerEl) => headerEl.dataset.group,
      foldedHeaderForIndex: (i) => collapsedGroupHeaderFor(i),
      // Type-match key: ini syncs by control type (field.type), so a toggle row
      // never receives a color value etc.
      sourceTypeKey: (isHeader, headerOrIdx) => isHeader ? headerTypeKey(headerOrIdx) : (iniEdits[headerOrIdx] ? editTypeKey(iniEdits[headerOrIdx]) : ''),
      nodeTypeKey: (n) => n.kind === 'header' ? headerTypeKey(n.headerEl) : (iniEdits[n.idx] ? editTypeKey(iniEdits[n.idx]) : ''),
      skipDataNode: (idx) => !iniEdits[idx] || iniEdits[idx]._delete,
      writeSourceData: (idx, field, val) => { if (iniEdits[idx]) iniEdits[idx].value = val; },
      writeTargetData: (idx, field, val) => { if (iniEdits[idx]) iniEdits[idx].value = val; },
      applyToHeader: (headerEl, field, val, color) => {
        const g = CSS.escape(headerEl.dataset.group);
        if (field === 'toggle') {
          const el = headerEl.querySelector(`.ini-value-toggle[data-group="${g}"]`);
          if (el && el.checked !== (val === '1')) el.checked = (val === '1');
        } else if (field === 'section') {
          const el = headerEl.querySelector(`.ini-value-section[data-group="${g}"]`);
          if (el && el.value !== val) el.value = val;
        } else {
          const el = headerEl.querySelector(`.ini-value-input[data-group="${g}"]`);
          if (el) el.value = val;
          if (color) {
            const sw = headerEl.querySelector(`.ini-color-swatch[data-group="${g}"]`);
            if (sw) sw.style.background = color;
          }
        }
      },
      applyToData: (idx, field, val, color) => {
        if (field === 'toggle') {
          const el = pickControl('.ini-value-toggle', idx);
          if (el && el.checked !== (val === '1')) el.checked = (val === '1');
        } else if (field === 'section') {
          const el = pickControl('.ini-value-section', idx);
          if (el && el.value !== val) el.value = val;
        } else {
          const el = pickControl('.ini-value-input', idx);
          if (el) el.value = val;
          if (color) {
            const sw = pickControl('.ini-color-swatch', idx);
            if (sw) sw.style.background = color;
          }
        }
      },
      commit: () => { setActions([...iniEdits]); lastActionsRef = iniEdits; },
    });

    // Value change handlers (color inputs are handled separately below)
    container.querySelectorAll('.ini-value-input').forEach(input => {
      if (input.classList.contains('ini-color-value')) return;
      // Group-header controls hold a TEMPORARY value. A FOLDED header acts as a
      // full sync node (source + target); an EXPANDED header edit stays local.
      const isGroupHeader = !!input.dataset.groupHeader;
      if (isGroupHeader) {
        const folded = !input.closest('.ini-collapsed-row')?.classList.contains('ini-collapsed-row--expanded');
        if (folded) {
          input.addEventListener('change', () => {
            if (window.InputConfirm && window.InputConfirm.wasEscCancel(input)) return;
            syncField(input, 'value', input.value);
          });
        }
        return; // temporary value — no per-keystroke data write
      }
      const idx = parseInt(input.dataset.idx);
      // No per-keystroke data write (mirrors file-copy): the value commits on
      // change (Enter/blur). This keeps the DOM and stored data in sync so ESC
      // (which restores the DOM) truly cancels — no stale typed value lingers in
      // the data. Siblings sync on change/Enter via syncField.
      input.addEventListener('change', () => {
        if (window.InputConfirm && window.InputConfirm.wasEscCancel(input)) return;
        syncField(input, 'value', input.value);
      });
    });
    // Live color value box: commit per keystroke, update swatch, forward to open popover.
    // Accepts any format ColorPicker.parseColor understands (hex, rgb(), hsl(), named, R,G,B[,A])
    // and normalizes the stored INI value back to "r,g,b[,a]".
    const isBlackLiteral = v => /^(0,0,0(,0)?|#0{3,8}|black|rgba?\(\s*0\s*,\s*0\s*,\s*0\b|hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*0%\b)/i.test(v || '');
    container.querySelectorAll('.ini-color-value').forEach(input => {
      // Group-header color box: temporary value, local only (no data write).
      const isGroupHeader = !!input.dataset.groupHeader;
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
        const swatch = input.parentElement.querySelector('.ini-color-swatch');
        const bg = type === 'rgba'
          ? `rgba(${parsed.r},${parsed.g},${parsed.b},${parsed.a/255})`
          : `rgb(${parsed.r},${parsed.g},${parsed.b})`;
        if (swatch) swatch.style.background = bg;
        if (isGroupHeader) return; // temporary — don't write data or sync
        // Commit the edited row's own value live (siblings sync on change/Enter).
        iniEdits[idx].value = normalized;
        setActions([...iniEdits]);
        lastActionsRef = iniEdits;
        // Forward the parsed value into the popover bound to this swatch, if it's open.
        if (swatch && window.ColorPicker && typeof window.ColorPicker.forwardInput === 'function') {
          window.ColorPicker.forwardInput(swatch, normalized);
        }
      });
      // On blur/Enter: normalize the box's displayed text to canonical "r,g,b[,a]"
      // and sync to same-type selected rows (value + swatch). Done on commit, not
      // per keystroke, so typing isn't interrupted by cursor resets. A FOLDED
      // header syncs as a virtual row; an EXPANDED header stays local.
      //
      // ESC: restore the original color (value + swatch) and cancel — no sync.
      // Handled locally (not just via InputConfirm) so the swatch is reset too.
      input.addEventListener('change', () => {
        // ESC restored the pre-edit color — reset the swatch to match, skip sync.
        if (window.InputConfirm && window.InputConfirm.wasEscCancel(input)) {
          const type = input.dataset.type;
          const parsed = window.ColorPicker && window.ColorPicker.parseColor
            ? window.ColorPicker.parseColor(input.value)
            : { r: 0, g: 0, b: 0, a: 255 };
          const swatch = input.parentElement.querySelector('.ini-color-swatch');
          if (swatch) swatch.style.background = type === 'rgba'
            ? `rgba(${parsed.r},${parsed.g},${parsed.b},${parsed.a/255})`
            : `rgb(${parsed.r},${parsed.g},${parsed.b})`;
          return;
        }
        const type = input.dataset.type;
        const raw = input.value;
        const parsed = window.ColorPicker && window.ColorPicker.parseColor
          ? window.ColorPicker.parseColor(raw)
          : { r: 0, g: 0, b: 0, a: 255 };
        const normalized = type === 'rgba'
          ? `${parsed.r},${parsed.g},${parsed.b},${parsed.a}`
          : `${parsed.r},${parsed.g},${parsed.b}`;
        if (normalized !== raw) input.value = normalized;
        const bg = type === 'rgba'
          ? `rgba(${parsed.r},${parsed.g},${parsed.b},${parsed.a/255})`
          : `rgb(${parsed.r},${parsed.g},${parsed.b})`;
        if (isGroupHeader) {
          const folded = !input.closest('.ini-collapsed-row')?.classList.contains('ini-collapsed-row--expanded');
          if (folded) syncField(input, 'value', normalized, bg);
          return; // temporary — no data write
        }
        syncField(input, 'value', normalized, bg);
      });
    });
    container.querySelectorAll('.ini-value-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        // Group-header toggle: a FOLDED header syncs as a virtual row; an
        // EXPANDED header stays local. Temporary value either way (no data write).
        if (cb.dataset.groupHeader) {
          const folded = !cb.closest('.ini-collapsed-row')?.classList.contains('ini-collapsed-row--expanded');
          if (folded) syncField(cb, 'toggle', cb.checked ? '1' : '0');
          return;
        }
        syncField(cb, 'toggle', cb.checked ? '1' : '0');
      });
    });
    container.querySelectorAll('.ini-value-section').forEach(s => {
      s.addEventListener('change', () => {
        // Group-header select: FOLDED header syncs as a virtual row; EXPANDED
        // stays local. Temporary value either way.
        if (s.dataset.groupHeader) {
          const folded = !s.closest('.ini-collapsed-row')?.classList.contains('ini-collapsed-row--expanded');
          if (folded) syncField(s, 'section', s.value);
          return;
        }
        syncField(s, 'section', s.value);
      });
    });
    // Color picker binding
    container.querySelectorAll('.ini-color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const idx = parseInt(swatch.dataset.idx);
        const type = swatch.dataset.type;
        const isGroupHeader = !!swatch.dataset.groupHeader;
        // Initial value: group header uses its own (temporary) box text; a data
        // row uses the stored value.
        const headerInput = isGroupHeader ? swatch.parentElement.querySelector('.ini-color-value') : null;
        ColorPicker.attach(swatch, {
          type,
          value: isGroupHeader ? (headerInput ? headerInput.value : '') : iniEdits[idx].value,
          onChange(newValue) {
            const parsed = newValue.split(',').map(Number);
            const r = parsed[0]||0, g = parsed[1]||0, b = parsed[2]||0, a = parsed[3] !== undefined ? parsed[3] : 255;
            const bg = type === 'rgba'
              ? `rgba(${r},${g},${b},${a/255})`
              : `rgb(${r},${g},${b})`;
            // Update the edited row's swatch + input box.
            swatch.style.background = bg;
            const input = swatch.parentElement.querySelector('.ini-color-value');
            if (input) input.value = newValue;
            if (isGroupHeader) {
              // A FOLDED header syncs as a virtual row; EXPANDED stays local.
              const folded = !swatch.closest('.ini-collapsed-row')?.classList.contains('ini-collapsed-row--expanded');
              if (folded) syncField(swatch, 'value', newValue, bg);
              return; // temporary — no data write
            }
            // Sync to same-type selected rows (value + swatch + input box).
            syncField(swatch, 'value', newValue, bg);
          }
        });
      });
    });
    // Fill-all buttons for Mania per-column fields (collapsed group)
    container.querySelectorAll('.ini-fill-btn[data-gid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const gid = btn.dataset.gid;
        const syncKey = btn.dataset.group;
        // Find all sub-rows belonging to THIS group (by gid, so a same-name
        // sibling group is never touched).
        const subRows = container.querySelectorAll(`.ini-sub-row[data-gid="${CSS.escape(gid)}"]`);
        if (subRows.length === 0) return;
        // Read the group HEADER's current (temporary) value — the header holds a
        // local value initialized from the first sub-row; the user may have edited
        // it. Committing (fill) writes that value to every sub-row. Header controls
        // are queried by the content sync key (data-group).
        const headerInput = container.querySelector(`.ini-value-input[data-group-header="1"][data-group="${CSS.escape(syncKey)}"]`);
        const headerToggle = container.querySelector(`.ini-value-toggle[data-group-header="1"][data-group="${CSS.escape(syncKey)}"]`);
        const headerSelect = container.querySelector(`.ini-value-section[data-group-header="1"][data-group="${CSS.escape(syncKey)}"]`);
        let fillValue;
        if (headerToggle) fillValue = headerToggle.checked ? '1' : '0';
        else if (headerSelect) fillValue = headerSelect.value;
        else if (headerInput) fillValue = headerInput.value;
        else fillValue = '';
        // Set all sub-rows' values to the header's current value.
        for (const sr of subRows) {
          const si = parseInt(sr.dataset.idx);
          if (iniEdits[si]) iniEdits[si].value = fillValue;
        }
        setActions([...iniEdits]);
        render(container);
        Toast.success(i18n.t('ini.filled', { n: subRows.length }));
      });
    });
    // Expand/collapse a perColumn group. Triggered by double-clicking the row
    // OR single-clicking the group tag (the "分组" badge in the Action column).
    // State lives in the module-level expandedSeqGroups Set (keyed by gid); the
    // DOM display/class follow as a consequence.
    function toggleGroupExpansion(row) {
      const gid = row.dataset.gid;
      if (!gid) return;
      const subRows = container.querySelectorAll(`.ini-sub-row[data-gid="${CSS.escape(gid)}"]`);
      if (subRows.length === 0) return;
      if (expandedSeqGroups.has(gid)) expandedSeqGroups.delete(gid);
      else expandedSeqGroups.add(gid);
      const expand = expandedSeqGroups.has(gid);
      for (const sr of subRows) sr.style.display = expand ? '' : 'none';
      row.classList.toggle('ini-collapsed-row--expanded', expand);
    }
    container.querySelectorAll('.ini-collapsed-row').forEach(row => {
      let last = 0;
      row.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) { last = 0; return; }
        if (e.target.closest('button, input, select, .ini-group-toggle')) return;
        const now = Date.now();
        if (now - last < 250) { toggleGroupExpansion(row); last = 0; }
        else { last = now; }
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
        Toast.success(i18n.t('ini.filledColumns', { n: count }));
      });
    });

    // Center button for ColumnStart: ColumnStart = (480*ratio - (sum(ColumnWidth)+sum(ColumnSpacing)))/2
    container.querySelectorAll('.ini-center-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        const edit = iniEdits[idx];
        if (!edit || edit.key !== 'ColumnStart' || edit.maniaKeys == null) return;
        const keys = edit.maniaKeys;
        const findVal = (key) => {
          const e = iniEdits.find(x => x.section === 'Mania' && x.maniaKeys === keys && x.key === key);
          return e ? (e.value || '') : '';
        };
        // Sum a comma list; if a single value is given, expand it to the field's item count
        // (ColumnWidth → keys items, ColumnSpacing → keys-1 items).
        const sumField = (s, count) => {
          const nums = (s || '').split(',').map(t => parseFloat(t.trim())).filter(n => !isNaN(n));
          if (nums.length === 0) return 0;
          if (nums.length === 1 && count > 1) return nums[0] * count;
          return nums.reduce((a, b) => a + b, 0);
        };
        const curWidth = findVal('ColumnWidth');
        const curSpacing = findVal('ColumnSpacing');
        // Always confirm via modal: existing values are shown read-only, missing are editable.
        const inputs = await promptCenterValues({ ratio: '16/9', ColumnWidth: curWidth, ColumnSpacing: curSpacing }, keys);
        if (!inputs) return;
        // Parse ratio: accept "W/H" or a decimal.
        let ratio = 16 / 9;
        if (inputs.ratio && inputs.ratio.trim() !== '') {
          const [a, b] = inputs.ratio.split('/').map(t => parseFloat(t.trim()));
          ratio = (!isNaN(b) && b) ? a / b : a;
          if (isNaN(ratio) || ratio <= 0) ratio = 16 / 9;
        }
        const widthSum = sumField(inputs.ColumnWidth != null ? inputs.ColumnWidth : curWidth, keys);
        const spacingSum = sumField(inputs.ColumnSpacing != null ? inputs.ColumnSpacing : curSpacing, keys - 1);
        const start = (480 * ratio - (widthSum + spacingSum)) / 2;
        // Keep at most 2 decimals (integer when exact).
        edit.value = String(Math.round(start * 100) / 100);
        setActions([...iniEdits]);
        const input = container.querySelector(`.ini-value-input[data-idx="${idx}"]`);
        if (input) input.value = edit.value;
      });
    });

    // Path picker buttons
    container.querySelectorAll('.ini-path-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const isGroupHeader = !!btn.dataset.groupHeader;
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
        // Group-header path button: temporary value. A FOLDED header also syncs
        // as a virtual row; EXPANDED stays local. No data write.
        if (isGroupHeader) {
          const headerInput = btn.parentElement.querySelector('.ini-value-input');
          if (headerInput) headerInput.value = converted;
          const folded = !btn.closest('.ini-collapsed-row')?.classList.contains('ini-collapsed-row--expanded');
          if (folded) syncField(headerInput, 'value', converted);
          return;
        }
        iniEdits[idx].value = converted;
        setActions([...iniEdits]);
        const input = container.querySelector(`.ini-value-input[data-idx="${idx}"]`);
        if (input) input.value = converted;
      });
    });

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
    // Layering: sticky header (z 10) > fades (z 9) > table border/content.
    // The fades cover the border + content (rows fade out at the edge), but the
    // sticky header occludes the fades' top edge.
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

    // Restore Section/Key/ManiaKeys AFTER all event handlers are bound (so the
    // dispatched 'change' sets currentFields; without it key validation fails).
    if (lastSection) {
      restoreSelection(container, lastSection, lastKey, lastManiaKeys);
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

  // Indices a row represents (OpTable adapter): a plain row → [idx]; a perColumn
  // group header → every member index in that group. Selecting a group header
  // selects the whole group.
  function rowMemberIndices(row) {
    const groupIndicesRaw = row.dataset.groupIndices;
    if (groupIndicesRaw && !row.dataset.groupParent) {
      return JSON.parse(groupIndicesRaw);
    }
    const ri = parseInt(row.dataset.idx);
    return isNaN(ri) ? [] : [ri];
  }
  // Range (Shift) selection member set for a row. A group header is treated
  // differently by expansion state so highlighting matches the file editor:
  //   • FOLDED header → all members (a connect-select across it pulls in the
  //     whole group, so the header highlights — matches file editor).
  //   • EXPANDED header → only its FIRST member (transparent: a connect-select
  //     INTO the expanded group lands on the member rows, not the whole group;
  //     fixes the "header vs first member mis-judged" bug).
  // Single-click on a header still selects the whole group via rowMemberIndices.
  // See op-table.js rowRangeMembers hook.
  function rowRangeMemberIndices(row) {
    const groupIndicesRaw = row.dataset.groupIndices;
    if (groupIndicesRaw && !row.dataset.groupParent) {
      const arr = JSON.parse(groupIndicesRaw);
      if (row.classList.contains('ini-collapsed-row--expanded')) {
        return arr.length ? [arr[0]] : []; // expanded → transparent
      }
      return arr; // folded → whole group (highlights like the file editor)
    }
    const ri = parseInt(row.dataset.idx);
    return isNaN(ri) ? [] : [ri];
  }
  // The anchor index for a row (OpTable adapter): a plain row → its idx; a group
  // header → its FIRST member's idx. (FIRST vs LAST produces identical selection
  // sets because group members are consecutive — see op-table.js header comment.)
  function rowAnchorIndex(row) {
    const members = rowMemberIndices(row);
    return members.length ? members[0] : -1;
  }

  function sectionLabel(edit) {
    if (edit.section === 'Mania' && edit.maniaKeys != null) {
      return `Mania (${edit.maniaKeys}K)`;
    }
    return edit.section;
  }

  // Restore selection state after render() rebuilds the DOM. Also persists to
  // module-level so ANY re-render (not just add/delete) can restore.
  function restoreSelection(container, section, key, maniaKeys) {
    if (section) lastSection = section;
    if (key) lastKey = key;
    if (maniaKeys) lastManiaKeys = maniaKeys;
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


  // Confirm dialog for centering ColumnStart. Shown on every center-button click.
  // `values` = { ratio, ColumnWidth, ColumnSpacing } current strings; `keys` = maniaKeys.
  // Existing (non-empty) values render read-only; empty ones are editable.
  // Labels are "description(keyname)" via INI_FIELD_LABELS.fieldLabel.
  function promptCenterValues(values, keys) {
    return new Promise((resolve) => {
      if (document.querySelector('.modal-overlay')) return resolve(null);
      const fieldLabel = (k) => INI_FIELD_LABELS.fieldLabel({ key: k }) + ' (' + k + ')';
      const row = (k, val) => {
        const has = val && val.trim() !== '';
        const ph = k === 'ColumnSpacing' ? '0,0,...' : '30,30,...';
        return `<label style="display:block;margin-top:8px">${escapeHtml(fieldLabel(k))}
          <input type="text" class="form-input center-prompt-input" data-key="${k}" autocomplete="off" spellcheck="false" ${has ? `value="${escapeHtml(val)}" readonly style="width:100%;margin-top:2px;opacity:.7;cursor:not-allowed"` : `style="width:100%;margin-top:2px" placeholder="${ph}"`}>
        </label>`;
      };
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal__title">${i18n.t('ini.centerTitle')}</div>
          <div class="modal__body">
            <p style="white-space:pre-line">${i18n.t('ini.centerPrompt')}</p>
            <label style="display:block;margin-top:8px">${i18n.t('ini.centerRatio')}
              <input type="text" class="form-input center-prompt-input" data-key="ratio" value="${escapeHtml(values.ratio || '16/9')}" autocomplete="off" spellcheck="false" style="width:100%;margin-top:2px">
            </label>
            ${row('ColumnWidth', values.ColumnWidth)}
            ${row('ColumnSpacing', values.ColumnSpacing)}
          </div>
          <div class="modal__actions">
            <button class="btn btn--primary btn--sm" data-value="ok">${i18n.t('dialog.confirm')}</button>
            <button class="btn btn--secondary btn--sm" data-value="cancel">${i18n.t('dialog.cancel')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const collect = () => {
        const out = {};
        overlay.querySelectorAll('.center-prompt-input').forEach(inp => { out[inp.dataset.key] = inp.value; });
        return out;
      };
      overlay.querySelectorAll('.modal__actions button').forEach(b => {
        b.addEventListener('click', () => { const v = b.dataset.value; overlay.remove(); resolve(v === 'ok' ? collect() : null); });
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
      const onKey = (e) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(null); }
        if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(collect()); }
      };
      document.addEventListener('keydown', onKey);
      setTimeout(() => { const first = overlay.querySelector('.center-prompt-input:not([readonly])'); if (first) first.focus(); }, 0);
    });
  }

  // Toggle fill-button labels between the full text and a compact '#' based on
  // available width in the value cell. Called after render + on window resize.
  function adjustFillButtons() {
    document.querySelectorAll('.ini-list-fill-btn, .ini-fill-btn, .ini-center-btn').forEach(btn => {
      const full = btn.dataset.full || '#';
      // The button's sibling span (the value input area) is the space budget.
      const cell = btn.parentElement;
      if (!cell) return;
      // Measure: does the full label fit alongside the input at current width?
      // Heuristic: if the cell's scrollWidth exceeds its clientWidth, it's tight.
      btn.textContent = (cell.scrollWidth > cell.clientWidth + 2) ? '#' : full;
    });
  }


  function renderIniTableBody(iniEdits) {
    if (iniEdits.length === 0) {
      return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">${i18n.t('ini.empty')}</div>`;
    }

    // Rows display in source (add) order, left to right — no column sort.

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

    // Assign stable per-instance gids to each collapsed group (writes _groupId
    // onto the member iniEdits objects; reuses when a group's members already
    // share one). Reorder moves object refs, so _groupId survives → expand state
    // survives. Then drop expand-state for gids that no longer exist.
    const groupEntries = [];
    for (const p of rowPlan) {
      if (p.kind === 'collapsed-group') groupEntries.push({ members: p.indices.map(i => iniEdits[i]) });
    }
    OpTable.assignSeqGroupIds(groupEntries);
    let gi = 0;
    for (const p of rowPlan) if (p.kind === 'collapsed-group') p.gid = groupEntries[gi++].gid;
    OpTable.pruneExpanded(expandedSeqGroups, groupEntries.map(e => e.gid));

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
                const cnLabel = INI_FIELD_LABELS.fieldLabel(field || { key: edit.key });
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
                const isCenterable = edit.key === 'ColumnStart' && edit.section === 'Mania' && edit.maniaKeys != null;
                const centerBtn = isCenterable
                  ? `<button type="button" class="btn btn--secondary btn--sm ini-center-btn" data-idx="${idx}" title="${i18n.t('ini.centerTitle')}" data-full="${escapeHtml(i18n.t('ini.center'))}" style="padding:4px 6px;flex:0 0 auto;white-space:nowrap">${i18n.t('ini.center')}</button>`
                  : '';
                const valueCell = isListMania
                  ? `<td style="display:flex;align-items:center;gap:8px;padding-right:12px"><span style="flex:1;min-width:0">${renderValueInput(type, edit, idx, field)}</span>${listFillBtn}</td>`
                  : isCenterable
                    ? `<td style="display:flex;align-items:center;gap:8px;padding-right:12px"><span style="flex:1;min-width:0">${renderValueInput(type, edit, idx, field)}</span>${centerBtn}</td>`
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
              // gid = stable per-instance id (expand state + parent linkage);
              // syncKey = content-derived key for control-sync queries (applyToHeader).
              const groupId = plan.gid;
              const syncKey = `${plan.baseKey}-${plan.maniaKeys}`;
              const templateKey = plan.field.key;
              const fieldCn = INI_FIELD_LABELS.fieldLabel(plan.field);
              const rowTitle = `title="${escapeHtml(INI_FIELD_LABELS.fieldLabel(plan.field) + ' (' + templateKey + ')')}"`;

              // Determine group composition (modify, delete, or mixed)
              const hasModify = plan.indices.some(i => !iniEdits[i]._delete);
              const hasDelete = plan.indices.some(i => iniEdits[i]._delete);
              // Use string-based data-idx to avoid collision with sub-row indices
              const groupDataIdx = `G-${groupId}`;
              const expanded = expandedSeqGroups.has(groupId);

              let html = `<tr class="ini-edit-row ini-collapsed-row${expanded ? ' ini-collapsed-row--expanded' : ''}" data-gid="${escapeHtml(groupId)}" data-group="${escapeHtml(syncKey)}" data-group-indices="${escapeHtml(JSON.stringify(plan.indices))}" data-idx="${escapeHtml(groupDataIdx)}" ${rowTitle}>
                <td><span class="tag ini-group-toggle" style="background:rgba(102,153,255,0.15);color:#69f;cursor:pointer">${i18n.t('ini.tagGroup')}</span></td>
                <td><span class="tag">${sectionLabel(firstEdit)}</span></td>
                <td><span class="ini-key-name">${escapeHtml(templateKey)}</span> <span style="color:var(--text-muted);font-size:11px">${escapeHtml(fieldCn)}</span></td>
                <td style="display:flex;align-items:center;gap:8px;padding-right:12px">
                  <span style="flex:1;min-width:0">${hasModify ? renderValueInput(firstType, (!expanded && _headerTempSnapshot[groupId] != null ? { ...firstEdit, value: _headerTempSnapshot[groupId] } : firstEdit), plan.indices[0], firstField, `data-group-header="1" data-group="${escapeHtml(syncKey)}"`) : `<span style="color:var(--danger);font-size:12px">${i18n.t('ini.removeLabel')}</span>`}</span>
                  ${hasModify ? `<button type="button" class="btn btn--secondary btn--sm ini-fill-btn" data-gid="${escapeHtml(groupId)}" data-group="${escapeHtml(syncKey)}" title="${i18n.t('ini.fillAllTitle')}" data-full="${escapeHtml(i18n.t('ini.fillAll'))}" style="padding:4px 6px;flex:0 0 auto;white-space:nowrap">${i18n.t('ini.fillAll')}</button>` : ''}
                </td>
              </tr>`;

              // Sub-rows — visibility follows the group's expand state.
              const subHide = expanded ? '' : ' style="display:none"';
              for (const subIdx of plan.indices) {
                const subEdit = iniEdits[subIdx];
                const subField = findFieldByTemplate(subEdit.section, subEdit.key);
                const subType = subField?.type || 'string';
                const subTitle = subField ? `title="${escapeHtml(INI_FIELD_LABELS.fieldLabel(subField) + ' (' + subField.key + ')')}"` : '';
                if (subEdit._delete) {
                  html += `<tr class="ini-edit-row ini-sub-row ini-delete-row" data-idx="${subIdx}" data-gid="${escapeHtml(groupId)}" data-group-parent="${escapeHtml(groupId)}"${subHide} ${subTitle}>
                    <td><span class="tag tag--danger">${i18n.t('ini.tagDelete')}</span></td>
                    <td><span class="tag">${sectionLabel(subEdit)}</span></td>
                    <td><span class="ini-key-name">${escapeHtml(subEdit.key)}</span> <span style="color:var(--text-muted);font-size:11px">${escapeHtml(subField ? INI_FIELD_LABELS.fieldLabel(subField) : subEdit.key)}</span></td>
                    <td style="color:var(--danger);font-size:12px">${i18n.t('ini.removeLabel')}</td>
                  </tr>`;
                } else {
                  html += `<tr class="ini-edit-row ini-sub-row" data-idx="${subIdx}" data-gid="${escapeHtml(groupId)}" data-group-parent="${escapeHtml(groupId)}"${subHide} ${subTitle}>
                    <td><span class="tag tag--accent">${i18n.t('ini.tagModify')}</span></td>
                    <td><span class="tag">${sectionLabel(subEdit)}</span></td>
                    <td><span class="ini-key-name">${escapeHtml(subEdit.key)}</span> <span style="color:var(--text-muted);font-size:11px">${escapeHtml(subField ? INI_FIELD_LABELS.fieldLabel(subField) : subEdit.key)}</span></td>
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

  function renderValueInput(type, edit, i, field, extraAttr) {
    const x = extraAttr ? (' ' + extraAttr) : '';
    switch (type) {
      case 'bool':
        return `<label class="toggle">
          <input type="checkbox" class="ini-value-toggle" data-idx="${i}"${x} ${edit.value === '1' ? 'checked' : ''}>
          <span class="toggle__slider"></span>
        </label>`;
      case 'section': {
        const opts = field?.options || [];
        return `<select class="form-input ini-value-section" data-idx="${i}"${x} style="width:100%;max-width:200px">
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
          <button type="button" class="color-swatch ini-color-swatch" data-idx="${i}" data-type="${type}"${x} tabindex="0" style="flex:0 0 auto;background:${isRgba ? `rgba(${r},${g},${b},${a/255})` : `rgb(${r},${g},${b})`}"></button>
          <input type="text" class="form-input ini-value-input ini-color-value" data-idx="${i}" data-type="${type}"${x} value="${escapeHtml(val)}" autocomplete="off" spellcheck="false" style="flex:1;min-width:0">
        </div>`;
      }
      case 'path':
        return `<div class="path-input-row" style="display:flex;gap:8px;align-items:center">
          <input type="text" class="form-input ini-value-input" data-idx="${i}"${x} value="${escapeHtml(edit.value)}" autocomplete="off" spellcheck="false" style="flex:1;min-width:0">
          <button type="button" class="btn btn--secondary btn--sm ini-path-btn" data-idx="${i}"${x} title="${i18n.t('ini.pickFileTitle')}" style="flex:0 0 auto">📂</button>
        </div>`;
      case 'integer':
      case 'number': {
        const step = type === 'integer' ? '1' : '0.1';
        const minAttr = field && field.min != null ? ` min="${field.min}"` : '';
        const maxAttr = field && field.max != null ? ` max="${field.max}"` : '';
        const forbiddenAttr = field && Array.isArray(field.forbidden) ? ` data-forbidden="${field.forbidden.join(',')}"` : '';
        return `<input type="number" class="form-input ini-value-input" data-idx="${i}"${x} value="${escapeHtml(edit.value)}" step="${step}"${minAttr}${maxAttr}${forbiddenAttr} autocomplete="off" style="width:100%">`;
      }
      default:
        return `<input type="text" class="form-input ini-value-input" data-idx="${i}"${x} value="${escapeHtml(edit.value)}" autocomplete="off" spellcheck="false" style="width:100%">`;
    }
  }

  function escapeHtml(str) {
    return OpTable.escapeHtml(str);
  }

  // ── Del key: delete selected INI rows with confirmation ──
  // (Selection lives in the OpTable instance; read it via sel.getSelected().)
  async function deleteSelected() {
    const selectedIndices = sel ? sel.getSelected() : new Set();
    if (selectedIndices.size === 0) return;
    const actions = getActions ? getActions() : [];
    const sorted = [...selectedIndices].sort((a, b) => b - a);
    const confirmed = await ApplyDialog.showConfirmDialog(
      i18n.t('ini.deleteRowsConfirm', { n: sorted.length }),
      [
        { label: `${i18n.t('ini.deleteBtn').replace(/^[-+] ?/, '')} (${sorted.length})`, cls: 'btn--danger', value: 'delete' },
        { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
      ]
    );
    if (!confirmed || confirmed !== 'delete') return;

    // selectedIndices reference DISPLAY positions; splice from highest down.
    const updated = [...actions];
    for (const i of sorted) updated.splice(i, 1);
    setActions(updated);
    Toast.info(i18n.t('ini.deleted', { n: sorted.length }));
    // Re-render current container. lastActionsRef differs from the new array →
    // OpTable resets selection (nothing meaningful survives a Del-delete anyway).
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

  // Return the currently-selected INI rows as plain action objects (deep-
  // cloned). Indices from sel.getSelected() map directly into getActions().
  function getSelectedActions() {
    const set = sel ? sel.getSelected() : new Set();
    const actions = getActions ? getActions() : [];
    if (set.size === 0 || actions.length === 0) return [];
    const out = [];
    for (const i of [...set].sort((a, b) => a - b)) {
      if (i >= 0 && i < actions.length) {
        // Hand-pick fields (mirror file-copy): drop _groupId and any other
        // runtime-only keys so they never reach the clipboard/disk/backend.
        const e = actions[i];
        const o = { section: e.section, maniaKeys: e.maniaKeys, key: e.key, value: e.value };
        if (e._cn) o._cn = e._cn;
        if (e._delete) o._delete = true;
        out.push(o);
      }
    }
    return JSON.parse(JSON.stringify(out));
  }

  // Select every row touched by a paste (appended + overwrite-replaced), called
  // by PresetEditor.pasteActions after render. idx are positions within the
  // flat actions array (also the row layout).
  function selectAdded({ idx }) {
    if (!sel) return;
    const actions = getActions ? getActions() : [];
    const ns = new Set();
    let anchor = -1;
    for (const i of (idx || [])) { if (i >= 0 && i < actions.length) { ns.add(i); if (anchor < 0) anchor = i; } }
    if (anchor < 0) return;
    sel.setSelected(ns, anchor);
  }

  window.IniEditor = { init, render, deleteSelected, layoutColumns, getSelectedActions, selectAdded, hasSelection: () => !!(sel && sel.getSelected().size > 0), clearSelection: () => sel && sel.clearSelection() };
})();
