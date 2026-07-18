// File operations editor — copy & delete (unified table)
(function () {
  let getCopies, setCopies, getDeletes, setDeletes, skinName, presetName, skinPath;

  // Selection / drag-to-delete is delegated to the shared OpTable module.
  // `sel` holds the instance, created lazily on first render (it needs the
  // container + currentFileOps at bind time). The legacy module vars below are
  // gone; callers that read selection use sel.getSelected()/sel.getAnchor().
  let sel = null;
  let fileDialogOpen = false;

  // The view-model used for the current render (source order, left to right).
  // All data-idx consumers index into THIS, not a fresh buildFileOps().
  let currentFileOps = null;

  function blockUI() {
    if (document.getElementById('dialog-block-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'dialog-block-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:not-allowed;background:transparent';
    document.body.appendChild(overlay);
  }
  function unblockUI() {
    const overlay = document.getElementById('dialog-block-overlay');
    if (overlay) overlay.remove();
  }

  function init(copiesGetter, copiesSetter, deletesGetter, deletesSetter, skin, preset, skPath) {
    getCopies = copiesGetter;
    setCopies = copiesSetter;
    getDeletes = deletesGetter;
    setDeletes = deletesSetter;
    skinName = typeof skin === 'function' ? skin : () => skin;
    presetName = typeof preset === 'function' ? preset : () => preset;
    skinPath = typeof skPath === 'function' ? skPath : () => skPath || null;
  }

  // ── Unified view-model helpers ──

  function buildFileOps() {
    const copies = getCopies ? getCopies() : [];
    const deletes = getDeletes ? getDeletes() : [];
    return [
      ...copies.map(c => ({ _type: 'copy', source: c.source, destination: c.destination, exact: !!c.exact, _groupId: c._groupId })),
      ...deletes.map(d => ({ _type: 'delete', path: d.path, exact: !!d.exact, _groupId: d._groupId })),
    ];
  }

  // Apply file ops WITHOUT re-rendering (preserves selection + input focus).
  // Use this for live sync (typing/Enter); use applyFileOps+rerenderTable for
  // structural changes (add/delete/reorder).
  function applyFileOpsNoRender(fileOps) {
    const copies = fileOps
      .filter(op => op._type === 'copy')
      .map(op => ({ source: op.source, destination: op.destination, exact: !!op.exact, _groupId: op._groupId }));
    const deletes = fileOps
      .filter(op => op._type === 'delete')
      .map(op => ({ path: op.path, exact: !!op.exact, _groupId: op._groupId }));
    setCopies(copies);
    setDeletes(deletes);
    // Update currentFileOps in-place so display stays consistent without rebuild.
    if (currentFileOps) {
      for (let i = 0; i < currentFileOps.length && i < fileOps.length; i++) {
        if (fileOps[i]._type === 'copy') {
          currentFileOps[i].destination = fileOps[i].destination;
        }
      }
    }
  }

  function applyFileOps(fileOps) {
    applyFileOpsNoRender(fileOps);
  }

  function opFile(op) { return op._type === 'copy' ? (op.source || '') : (op.path || ''); }
  function opDest(op) { return op._type === 'copy' ? (op.destination || '') : ''; }

  // Re-render the body (used by exact-toggle / sequence-group handlers).
  function rerenderTable(container) { render(container); }

  // ── Column widths: ONE unified pipeline (mirrors the INI editor) ──
  // measureColumns(): probe-based; caches all 3 columns' content widths per
  //   locale. layoutColumns(): the ONLY function that applies widths, driven
  //   by a single ResizeObserver. render() only measures.
  let lastMeasureLocale = null;
  let measured = null;            // [action, file, dest] content widths (px)
  const COL_PAD = 24;

  function measureColumns(container) {
    const loc = (window.i18n && window.i18n.locale()) || '';
    if (measured && loc === lastMeasureLocale) return; // cached
    const headerTable = container.querySelector('.files-header-table .table');
    const bodyTable = container.querySelector('.files-body-table .table');
    if (!headerTable || !bodyTable) { measured = null; return; }
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:13px;';
    document.body.appendChild(probe);
    const textW = (html) => { probe.innerHTML = html || ''; return probe.offsetWidth; };
    const widths = [0, 0, 0];
    headerTable.querySelectorAll('thead th').forEach((th, i) => { if (i < 3) widths[i] = Math.max(widths[i], textW(th.innerHTML)); });
    bodyTable.querySelectorAll('tbody tr').forEach(row => {
      // Skip sequence-group header rows (their cells don't represent real op content).
      if (row.classList.contains('file-seq-group')) return;
      const cells = row.querySelectorAll('td');
      for (let i = 0; i < 3 && i < cells.length; i++) widths[i] = Math.max(widths[i], textW(cells[i].innerHTML));
    });
    document.body.removeChild(probe);
    measured = widths.map(w => Math.ceil(w + COL_PAD));
    lastMeasureLocale = loc;
  }

  const BASE_W = 578; // table content width at the minimum window (900 - 280 - 40 - 2)

  function layoutColumns(container) {
    measureColumns(container);
    if (!measured) return;
    const [wAction, wFile, wDest] = measured;
    const exactW = 120;
    const rest = Math.max(0, BASE_W - wAction - exactW);
    const fdSum = (wFile + wDest) || 1;
    const fileW = Math.max(60, Math.round(rest * (wFile / fdSum)));
    const destW = Math.max(60, rest - fileW);
    container.querySelectorAll('.files-header-table .table, .files-body-table .table').forEach(t => {
      const cg = t.querySelector('colgroup');
      if (!cg) return;
      const c = cg.children;
      if (c[0]) c[0].style.width = wAction + 'px';
      if (c[1]) c[1].style.width = fileW + 'px';
      if (c[2]) c[2].style.width = destW + 'px';
      if (c[3]) c[3].style.width = exactW + 'px';
    });
    adjustFillButtons();
  }

  // Collapse fill-button labels to '#' when their cell is too narrow.
  function adjustFillButtons() {
    document.querySelectorAll('.file-seq-fill-btn').forEach(btn => {
      const full = btn.dataset.full || '#';
      const cell = btn.parentElement;
      if (!cell) return;
      btn.textContent = (cell.scrollWidth > cell.clientWidth + 2) ? '#' : full;
    });
  }

  // render() only measures; layoutColumns is driven by the ResizeObserver.
  function autosizeColumns(container) { measureColumns(container); }

  function render(container) {
    const fileOps = buildFileOps();

    // (Re)create the OpTable instance for this container on first render. The
    // adapter closes over currentFileOps so rowMembers resolves group headers.
    if (!sel) {
      sel = OpTable.create({
        container,
        rowSelector: '.file-op-row',
        interactiveSelector: 'input, button, label, .toggle, .toggle__slider, .file-thumb__icon, img',
        deleteMimeType: 'application/file-indices',
        rowMembers: (row) => rowMemberIndices(row),
        rowAnchor: (row) => rowAnchorIndex(row),
        // Group header in range (Shift) selection: FOLDED → whole group (header
        // highlights, matches ini); EXPANDED → only its first member (transparent:
        // a connect-select into an expanded group lands on the members).
        rowRangeMembers: (row) => rowRangeMemberIndices(row),
        applyDelete: (indicesDesc) => {
          const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
          for (const i of indicesDesc) ops.splice(i, 1);
          applyFileOps(ops);
          Toast.info(i18n.t('file.deleted', { n: indicesDesc.length }));
          // Re-render the CURRENT #tab-files node. preset-editor may have rebuilt
          // this node since the OpTable instance was created, so the `container`
          // captured in this closure could be detached — always look up the live node.
          render(document.getElementById('tab-files'));
        },
        isGroupMemberRow: (row) => !!row.dataset.groupParent,
        reorder: (fromIndices, toIndex) => {
          const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
          const { arr, insertAt, count } = OpTable.reorderArray(ops, fromIndices, toIndex);
          applyFileOps(arr);
          // Select the moved block at its new contiguous home.
          const ns = new Set();
          for (let i = 0; i < count; i++) ns.add(insertAt + i);
          sel.setSelected(ns, insertAt);
          render(document.getElementById('tab-files'));
        },
      });
    } else {
      sel.setContainer(container);
    }
    // Reset selection state for the fresh DOM.
    sel.clearSelection();
    container.innerHTML = `
      <div class="editor-sticky-header">
        <div style="padding-bottom:10px;border-bottom:1px solid var(--border)">
          <div style="margin-bottom:8px">
            <h3 style="margin-bottom:4px">${i18n.t('file.heading')}</h3>
            <p style="font-size:12px;color:var(--text-muted)">${i18n.t('file.desc')}</p>
          </div>

          <!-- Add buttons -->
          <div style="display:flex;gap:0;margin-bottom:8px">
            <div style="width:110px;flex-shrink:0;display:flex;gap:8px;padding-right:8px">
              <button class="btn btn--primary btn--sm" id="btn-add-file" style="font-size:11px;padding:4px 6px">${i18n.t('file.copy')}</button>
              <button class="btn btn--danger btn--sm" id="btn-add-delete" style="font-size:11px;padding:4px 6px">${i18n.t('file.delete')}</button>
            </div>
            <div style="flex:1;min-width:0"></div>
            <div style="flex:1;min-width:0"></div>
          </div>

          <!-- Delete drop zone -->
          <div class="editor-delete-zone" id="file-delete-zone"
               style="padding:8px;border:2px dashed var(--danger);border-radius:var(--radius);text-align:center;color:var(--danger);font-size:12px;opacity:0.5;transition:all 0.2s">
            ${i18n.t('file.deleteZone')}
          </div>
        </div>

        <!-- Fixed header table (thead only) — only show when there are operations -->
        ${fileOps.length > 0 ? `
        <div class="files-header-table" style="margin-top:6px">
          <div class="table-wrap">
            <table class="table ini-table">
              <colgroup>
                <col style="width:72px">
                <col>
                <col>
                <col style="width:120px">
              </colgroup>
              <thead><tr>
                <th data-col="action">${i18n.t('file.colAction')}</th>
                <th>${i18n.t('file.colFile')}</th>
                <th title="${escapeHtml(i18n.t('file.colDestTitle'))}">${i18n.t('file.colDest')}</th>
                <th title="${escapeHtml(i18n.t('file.colExactTitle'))}">${i18n.t('file.colExact')}</th>
              </tr></thead>
            </table>
          </div>
        </div>
        ` : ''}
      </div>

      <div class="files-table-body-scroll" id="files-table-body-scroll">
        ${renderFilesTableBody(fileOps)}
      </div>
    `;

    // Add copy file button
    const btnAddFile = container.querySelector('#btn-add-file');
    if (btnAddFile) btnAddFile.addEventListener('click', async () => {
      if (!skinName()) { Toast.warning(i18n.t('file.selectSkinFirst')); return; }
      if (fileDialogOpen) return;
      try {
        fileDialogOpen = true;
        blockUI();
        const skPath = await skinPath() || '';
        const result = await api.selectFile([
          { name: i18n.t('file.allFilesFilter'), extensions: ['*'] }
        ], skPath);
        if (!result.success || !result.data || !result.data.length) return;

        // Only allow files inside the skin folder; store as skin-relative path.
        const copies = getCopies ? [...getCopies()] : [];
        for (const absPath of result.data) {
          let relPath = '';
          if (skPath && absPath.toLowerCase().startsWith(skPath.toLowerCase())) {
            relPath = absPath.slice(skPath.length).replace(/^[/\\]/, '');
          }
          if (!relPath) {
            Toast.warning(i18n.t('file.outsideSkin'));
            continue;
          }
          copies.push({ source: relPath, destination: '', exact: false });
        }
        setCopies(copies);
        render(container);
      } finally {
        fileDialogOpen = false;
        unblockUI();
      }
    });

    // Add delete file button
    const btnAddDelete = container.querySelector('#btn-add-delete');
    if (btnAddDelete) btnAddDelete.addEventListener('click', async () => {
      if (!skinName()) { Toast.warning(i18n.t('file.selectSkinFirst')); return; }
      if (fileDialogOpen) return;
      try {
        fileDialogOpen = true;
        blockUI();
        const defaultPath = await skinPath() || '';
        const result = await api.selectFile([
          { name: i18n.t('file.allFilesFilter'), extensions: ['*'] }
        ], defaultPath);
        if (!result.success || !result.data || !result.data.length) return;

        const filePaths = result.data;
        const skPath = await skinPath();
        const deletes = getDeletes ? [...getDeletes()] : [];
        for (const filePath of filePaths) {
          let relPath = '';
          if (skPath && filePath.toLowerCase().startsWith(skPath.toLowerCase())) {
            relPath = filePath.slice(skPath.length).replace(/^[/\\]/, '');
          }
          if (!relPath) {
            Toast.warning(i18n.t('file.outsideSkin'));
            continue;
          }
          deletes.push({ path: relPath, exact: false });
        }
        setDeletes(deletes);
        render(container);
      } finally {
        fileDialogOpen = false;
        unblockUI();
      }
    });

    // ── Bind row selection (unified) ── delegated to OpTable
    container.querySelectorAll('.file-op-row').forEach(row => {
      sel.bindRow(row);
    });

    // Destination handlers — resolve the row via the SORTED view-model
    // (data-idx indexes currentFileOps, which is sorted when a sort is active).
    //
    // Split into two phases (mirrors the color-value box):
    //  • 'input' (per keystroke): strip quotes and commit the RAW value to the op, so
    //    saving without blurring still captures what the user typed. NO path conversion
    //    and NO input.value rewrite here — that would reset the caret mid-typing.
    //  • 'change' / Enter (blur or commit): run the conversion — absolute path inside the
    //    skin → relative; outside the skin → toast + clear — and rewrite the displayed text.
    // ── Multi-select sync (shared skeleton via OpTable.createGroupSync) ──
    // If member index `i` belongs to a FOLDED sequence group, return that group's
    // header element; otherwise null. (A group is folded when its key is NOT in
    // expandedSeqGroups.) A folded header is treated as a virtual sync row.
    function collapsedGroupHeaderFor(i) {
      const headers = container.querySelectorAll('.file-seq-group');
      for (const h of headers) {
        const key = h.dataset.seqKey;
        if (expandedSeqGroups.has(key)) continue; // expanded
        // Members of THIS group only — scoped to its data-range, not a global
        // seqKey scan (same-name groups must not collapse onto each other).
        const range = h.dataset.range;
        if (!range) continue;
        const [a, b] = range.split('-').map(n => parseInt(n, 10));
        if (!isNaN(a) && !isNaN(b) && i >= a && i < b) return h;
      }
      return null;
    }
    // Inject file-copy specifics into the shared sync skeleton. Folded group
    // headers are virtual rows (source + target); expanded headers ignored.
    // file rows are homogeneous per field, so type-match is a constant (no gate).
    const { syncField } = OpTable.createGroupSync({
      getSelected: () => sel ? sel.getSelected() : new Set(),
      isHeaderControl: (el) => !!el.dataset.groupHeader,
      headerRowOf: (el) => el.closest('.file-seq-group'),
      headerIdOf: (headerEl) => headerEl.dataset.seqKey,
      foldedHeaderForIndex: (i) => collapsedGroupHeaderFor(i),
      sourceTypeKey: () => '',   // no type gate (homogeneous per field)
      nodeTypeKey: () => '',
      skipDataNode: (idx) => {
        const ops = currentFileOps ? currentFileOps : buildFileOps();
        return idx < 0 || idx >= ops.length;
      },
      writeSourceData: (idx, field, val) => {
        const ops = currentFileOps ? currentFileOps : buildFileOps();
        if (ops[idx]) ops[idx][field] = val;
      },
      writeTargetData: (idx, field, val) => {
        const ops = currentFileOps ? currentFileOps : buildFileOps();
        if (ops[idx]) ops[idx][field] = val;
      },
      applyToHeader: (headerEl, field, val) => {
        if (field === 'destination') {
          const el = headerEl.querySelector('.file-seq-dest');
          // Header keeps the full synced value (index preserved, matches member).
          if (el) el.value = val;
        } else if (field === 'exact') {
          const el = headerEl.querySelector('.file-seq-exact-toggle');
          if (el) el.checked = !!val;
        }
      },
      applyToData: (idx, field, val) => {
        const container2 = document.getElementById('tab-files');
        if (field === 'destination') {
          const el = container2.querySelector(`.copy-dest-input[data-idx="${idx}"]`);
          if (el) el.value = val;
        } else if (field === 'exact') {
          const el = container2.querySelector(`.file-exact-toggle[data-idx="${idx}"]`);
          if (el) el.checked = !!val;
        }
      },
      commit: (touched) => { if (touched) applyFileOpsNoRender(currentFileOps ? [...currentFileOps] : buildFileOps()); },
    });

    function commitDestRaw(input) {
      const idx = parseInt(input.dataset.idx);
      if (isNaN(idx)) return;
      const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
      if (idx >= 0 && idx < ops.length && ops[idx]._type === 'copy') {
        const val = input.value.trim().replace(/^["']|["']$/g, '');
        ops[idx].destination = val;
        syncField(input, 'destination', val);
      }
    }
    // Normalize a file dest's extension to the SOURCE's extension (shared impl
    // in OpTable.appendSrcExt — see the comment there).
    function appendSrcExt(val) {
      return OpTable.appendSrcExt(val);
    }

    function convertDestDisplay(input) { return convertDestDisplayImpl(input); }
    async function convertDestDisplayImpl(input) {
      // ESC restored the original value — keep it, skip normalize + sync.
      if (window.InputConfirm && window.InputConfirm.wasEscCancel(input)) return;
      const idx = parseInt(input.dataset.idx);
      const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
      if (idx < 0 || idx >= ops.length || ops[idx]._type !== 'copy') return;
      const source = ops[idx].source || '';
      let val = input.value.trim().replace(/^["']|["']$/g, '');
      if (!val) { ops[idx].destination = ''; applyFileOps(ops); return; }
      // If absolute path (any drive letter + :\ or /), try to convert to skin-relative.
      if (/^[a-zA-Z]:[\\/]?/.test(val)) {
        skinPath().then(sp => {
          if (sp) {
            const skNorm = sp.replace(/\\/g, '/').toLowerCase();
            const valNorm = val.replace(/\\/g, '/').toLowerCase();
            if (valNorm.startsWith(skNorm)) {
              val = val.replace(/\\/g, '/').slice(sp.length).replace(/^\//, '');
            } else {
              Toast.warning(i18n.t('file.destOutsideSkin'));
              val = '';
            }
          }
          val = appendSrcExt(val);
          input.value = val;
          ops[idx].destination = val;
          syncField(input, 'destination', val);
        });
        return;
      }
      // Already relative: normalize separators for display.
      val = val.replace(/\\/g, '/');
      val = appendSrcExt(val);
      if (val !== input.value) input.value = val;
      ops[idx].destination = val;
      syncField(input, 'destination', val);
    }
    container.querySelectorAll('.copy-dest-input').forEach(input => {
      // Sync only on commit (Enter/blur → change), not per keystroke.
      // Enter/Escape→blur is provided globally by InputConfirm (app.js).
      input.addEventListener('change', () => convertDestDisplay(input));
    });

    // Exact-match toggles (@2x fallback on/off). State is per-op, so toggles
    // inside a collapsed sequence group still persist on save.
    container.querySelectorAll('.file-exact-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.idx);
        const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
        if (idx >= 0 && idx < ops.length) { ops[idx].exact = cb.checked; syncField(cb, 'exact', cb.checked); }
      });
    });

    // Sequence-group expand/collapse: double-click anywhere on the header row
    // (except interactive controls) toggles expansion. Fast 250ms double-click.
    // Ignore modifier-key clicks (Shift/Ctrl range/toggle selection) so a quick
    // select-then-shift-select on a header isn't misread as a double-click,
    // which would rerender the table and invalidate the selection anchor.
    container.querySelectorAll('.file-seq-group').forEach(tr => {
      let last = 0;
      tr.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) { last = 0; return; }
        if (e.target.closest('.copy-dest-input, .file-seq-fill-btn, .file-seq-exact-toggle, .toggle, .toggle__slider')) return;
        const now = Date.now();
        if (now - last < 250) {
          // Toggle expansion WITHOUT re-rendering (mirrors ini-editor): flip the
          // sub-rows' display + the header's --expanded class. No rerender means
          // the header's temporary value (edited while folded) is preserved,
          // instead of being reset to the first member's value on rebuild.
          const gid = tr.dataset.gid;
          if (gid) {
            if (expandedSeqGroups.has(gid)) expandedSeqGroups.delete(gid);
            else expandedSeqGroups.add(gid);
            // data-group-parent is the group's gid (instance), so only THIS
            // group's member rows toggle — never a same-name sibling's.
            const subRows = container.querySelectorAll(`.file-op-row[data-group-parent="${CSS.escape(gid)}"]`);
            const expand = expandedSeqGroups.has(gid);
            for (const sr of subRows) sr.style.display = expand ? '' : 'none';
            tr.classList.toggle('file-seq-group--expanded', expand);
          }
          last = 0;
        } else { last = now; }
      });
    });

    // Group-level exact toggle: TEMPORARY value — local only; a FOLDED header
    // also syncs as a virtual row, an EXPANDED header stays local. Commits to
    // members via the fill button.
    container.querySelectorAll('.file-seq-exact-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        if (expandedSeqGroups.has(cb.dataset.seqKey)) return; // expanded → local only
        syncField(cb, 'exact', cb.checked);
      });
    });

    // Group-level destination input: commit raw on each keystroke, normalize on blur/Enter.
    // Member indices are scoped to THIS group's data-range (from the header row),
    // NOT a global seqKey scan — so same-name groups don't all write together.
    const groupMemberIdx = (headerEl) => {
      const range = headerEl ? headerEl.dataset.range : '';
      if (!range) return [];
      const [a, b] = range.split('-').map(n => parseInt(n, 10));
      if (isNaN(a) || isNaN(b)) return [];
      const out = []; for (let k = a; k < b; k++) out.push(k); return out;
    };
    container.querySelectorAll('.file-seq-dest').forEach(input => {
      // Group-header destination = TEMPORARY value. 'input' is local-only (no
      // member writes). 'change' normalizes the header's own text; a FOLDED
      // header also syncs as a virtual row, an EXPANDED header stays local.
      const isGroupHeader = !!input.dataset.groupHeader;
      const isFolded = () => !expandedSeqGroups.has(input.dataset.seqKey);
      input.addEventListener('input', () => {
        // Temporary: no data write per keystroke.
      });
      input.addEventListener('change', () => {
        let val = input.value.trim().replace(/^["']|["']$/g, '');
        if (val && /^[a-zA-Z]:[\\/]?/.test(val)) {
          skinPath().then(sp => {
            if (sp) {
              const skNorm = sp.replace(/\\/g, '/').toLowerCase();
              const valNorm = val.replace(/\\/g, '/').toLowerCase();
              val = valNorm.startsWith(skNorm) ? val.replace(/\\/g, '/').slice(sp.length).replace(/^\//, '') : val;
            }
            val = appendSrcExt(val);
            input.value = val;
            if (isGroupHeader) { if (isFolded()) syncField(input, 'destination', val); return; }
            // Write the BARE stem (no index) to each member; the backend
            // re-attaches each source's own index at apply time.
            const headerEl = input.closest('.file-seq-group');
            const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
            for (const k of groupMemberIdx(headerEl)) ops[k].destination = val;
            applyFileOps(ops);
          });
          return;
        }
        val = val.replace(/\\/g, '/');
        val = appendSrcExt(val);
        if (val !== input.value) input.value = val;
        if (isGroupHeader) { if (isFolded()) syncField(input, 'destination', val); return; }
        const headerEl = input.closest('.file-seq-group');
        const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
        for (const k of groupMemberIdx(headerEl)) ops[k].destination = val;
        applyFileOps(ops);
      });
      // Enter/Escape→blur is provided globally by InputConfirm (app.js).
    });

    // Fill button on copy sequence groups: commit the group HEADER's current
    // TEMPORARY value (destination + exact) to every member. The header holds a
    // local value (init from first member); the user may have edited it.
    container.querySelectorAll('.file-seq-fill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't toggle group expansion
        const headerEl = btn.closest('.file-seq-group');
        const memberIdx = groupMemberIdx(headerEl);
        if (memberIdx.length < 2) return;
        // Read the header's current temp controls.
        const headerDest = headerEl ? headerEl.querySelector('.file-seq-dest') : null;
        const headerExact = headerEl ? headerEl.querySelector('.file-seq-exact-toggle') : null;
        // Normalize the header destination to a BARE stem (strip quotes, \→/,
        // ext/@2x via appendSrcExt). The BARE stem is written to every member;
        // the backend re-attaches each source's own index at apply time, so a
        // header "mania/sliderb" → members "mania/sliderb" → outputs sliderb-0/1/2.
        let dest = headerDest ? headerDest.value.trim().replace(/^["']|["']$/g, '') : '';
        dest = dest.replace(/\\/g, '/');
        dest = appendSrcExt(dest);
        const exact = headerExact ? !!headerExact.checked : false;
        const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
        for (const k of memberIdx) { ops[k].destination = dest; ops[k].exact = exact; }
        applyFileOps(ops);
        rerenderTable(container);
      });
    });


    // ── Tab cycling: scope to the region of the focused element ──
    // Top controls (copy/delete buttons) and the operation table rows each
    // cycle independently — Tab never crosses between them.
    if (!container._ctrlABound) {
      container._ctrlABound = true;
      container.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || !container.contains(document.activeElement)) return;
        const active = document.activeElement;
        const inBody = active.closest && active.closest('.files-body-table');
        const regionRoot = inBody
          ? container.querySelector('.files-body-table')
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

    loadThumbnails();

    // ── Click thumbnail/icon to change source path ──
    // SourcePicker owns trigger detection (img/icon only) + the file dialog +
    // path normalization; onPick does the editor-specific data write/sync/render.
    container.querySelectorAll('.file-thumb[data-path]').forEach(thumb => {
      SourcePicker.attach(thumb, {
        getSkinPath: () => skinPath(),
        onPick: (chosen) => {
          if (!skinName()) return;
          const idx = parseInt(thumb.closest('[data-idx]')?.dataset.idx, 10);
          if (Number.isNaN(idx)) return;
          const op = currentFileOps[idx];
          if (!op) return;
          if (op._type === 'copy') op.source = chosen;
          else op.path = chosen;
          const field = op._type === 'copy' ? 'source' : 'path';
          // source/path has no group-header control, so sync targets data rows only.
          syncField(thumb.closest('[data-idx]') || thumb, field, chosen);
          // Only delete the old source's thumb if no other op still uses it.
          const oldPath = thumb.dataset.path;
          const stillUsed = currentFileOps.some(o => (o._type === 'copy' ? o.source : o.path) === oldPath);
          if (!stillUsed) thumbCache.delete(oldPath);
          // Save selection before rerender (which clears it).
          const savedSel = sel ? [...sel.getSelected()] : [];
          const savedAnchor = sel ? sel.getAnchor() : -1;
          rerenderTable(container);
          if (sel && savedSel.length > 1) sel.setSelected(new Set(savedSel), savedAnchor);
        },
      });
    });

    // ── Delete zone drop handler ── delegated to OpTable
    sel.bindDeleteZone(container.querySelector('#file-delete-zone'));

    // Measure + apply column widths. If the tab is active but layoutColumns
    // skipped (container width not settled yet this frame), retry next frame.
    autosizeColumns(container);
    layoutColumns(container);
    if (container.classList.contains('tab-content--active')) {
      requestAnimationFrame(() => layoutColumns(container));
    }

    // Edge-fade overlays: added to the scroll element's PARENT (container)
    // so they stay fixed at the scroll viewport edges regardless of scroll.
    // Layering: sticky header (z 10) > fades (z 9) > table border/content.
    const scrollEl = container.querySelector('.files-table-body-scroll');
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
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(updateFade).observe(scrollEl);
      }
      requestAnimationFrame(updateFade);
      setTimeout(updateFade, 300);
    }
  }

  // Indices a row represents: a plain row → [idx]; a sequence-group header →
  // the members of THIS group only (its rendered data-range [i,j)). Scoping to
  // the range — not a global seqKey scan — is what keeps same-name groups
  // (e.g. two sliderb-0,-1 columns) from all selecting together.
  function rowMemberIndices(row) {
    const range = row.dataset.range;
    if (range && row.classList.contains('file-seq-group')) {
      const [a, b] = range.split('-').map(n => parseInt(n, 10));
      if (!isNaN(a) && !isNaN(b)) { const out = []; for (let k = a; k < b; k++) out.push(k); return out; }
    }
    const ri = parseInt(row.dataset.idx);
    return isNaN(ri) ? [] : [ri];
  }
  // Range (Shift) selection member set. A FOLDED group header returns ALL members
  // (a connect-select across it pulls in the whole group, so the header highlights
  // — matches the ini editor); an EXPANDED header returns only its FIRST member
  // (transparent: a connect-select INTO an expanded group lands on the members).
  function rowRangeMemberIndices(row) {
    const key = row.dataset.seqKey;
    if (key && row.classList.contains('file-seq-group')) {
      const members = rowMemberIndices(row);
      if (expandedSeqGroups.has(key)) return members.length ? [members[0]] : []; // expanded → transparent
      return members; // folded → whole group
    }
    const ri = parseInt(row.dataset.idx);
    return isNaN(ri) ? [] : [ri];
  }
  // The anchor index for a row: a plain row → its idx; a group header → its
  // first member's idx (so Shift range math works in data-index space).
  function rowAnchorIndex(row) {
    const members = rowMemberIndices(row);
    return members.length ? members[0] : -1;
  }

  // Parsed frame info for an op's source, or null if it is not a frame.
  // { base, style, index } where style is '-' ("-N") or '' (no-hyphen "N").
  function frameOf(op) { return OpTable.parseFrame(opFile(op)); }
  // Sequence-group key: prefixed with op type (so copies & deletes never merge)
  // + the frame BASE name. '' for non-frames.
  function seqKey(op) { return OpTable.seqKey(opFile(op), op._type); }
  // Whether a path is an animation frame: "-N" style, or no-hyphen "N" style for
  // the fixed allowlist (sliderb, pippidonclear/fail/idle/kiai). @2x ignored.
  function isFrame(op) { return OpTable.isFrame(opFile(op)); }
  // Whether the file path has an @2x HD suffix (the exact/@2x toggle only applies to these).
  function has2x(op) {
    return /@2x\.[^.]+$/i.test(opFile(op) || '');
  }
  // Group label: the base name + a placeholder showing the index slot, keeping
  // @2x/ext. "-N" style shows "foo-{n}", no-hyphen style shows "foo{n}", so the
  // two frame styles are visually distinguishable in the header.
  function groupLabel(op) {
    const f = frameOf(op);
    const b = (opFile(op) || '').replace(/\\/g, '/').split('/').pop() || '';
    if (!f) return b;
    const ext = (b.match(/@2x\.[^.]+$/i) || b.match(/\.[^.]+$/) || [''])[0];
    return f.base + (f.style === '-' ? '-{n}' : '{n}') + ext;
  }
  // Expanded sequence groups (by STABLE per-instance gid). Default: collapsed.
  // gids live on the member objects (_groupId), so reorder preserves them.
  const expandedSeqGroups = new Set();

  function renderFilesTableBody(fileOps) {
    if (fileOps.length === 0) {
      return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">${i18n.t('file.empty')}</div>`;
    }
    // Order is user-controlled (drag-reorder); no auto-sort here. buildFileOps()
    // gives copies-then-deletes; the user can drag rows to any order and it
    // persists (applyFileOps preserves within-bucket relative order).
    // Publish the view-model so data-idx consumers (destination input, row
    // selection, delete) index the same order they see.
    currentFileOps = fileOps;

    // Build a render plan: coalesce CONSECUTIVE frame ops into a collapsible
    // group. A group requires: same base (seqKey), same frame STYLE ('-' vs ''),
    // and a STRICTLY ASCENDING index column (0,1,2…) — a repeated or
    // out-of-order index ENDS the group, so a second 0-N run after the first is
    // a SEPARATE group, not a continuation. Length ≥ 2, else singletons.
    const plan = []; // { type:'row', i } | { type:'group', key, indices:[], expanded }
    let i = 0;
    while (i < fileOps.length) {
      const op = fileOps[i];
      const f0 = frameOf(op);
      if (f0) {
        const key = seqKey(op);
        let j = i + 1;
        let prev = f0.index;
        while (j < fileOps.length) {
          const fj = frameOf(fileOps[j]);
          // Continue only while: same base (seqKey), SAME STYLE ('-' vs ''), and
          // index strictly ascending by 1. Any break → end the group here, so a
          // style change (foo-0 then foo0), a repeated/out-of-order index, or a
          // different base all start a fresh group (or a singleton).
          if (!fj || seqKey(fileOps[j]) !== key || fj.style !== f0.style || fj.index !== prev + 1) break;
          prev = fj.index;
          j++;
        }
        if (j - i >= 2) {
          plan.push({ type: 'group', key, indices: [], range: [i, j] });
          i = j;
          continue;
        }
      }
      plan.push({ type: 'row', i });
      i++;
    }

    // Assign stable per-instance gids to each group (writes _groupId onto the
    // member op objects; reuses when a group's members already share one). The
    // members array references the REAL ops, so _groupId persists on them through
    // reorder — expand state survives. Mirror the assigned gid onto each plan
    // entry for renderGroup.
    const groupEntries = [];
    for (const p of plan) if (p.type === 'group') groupEntries.push({ members: fileOps.slice(p.range[0], p.range[1]) });
    OpTable.assignSeqGroupIds(groupEntries);
    let gi = 0;
    for (const p of plan) if (p.type === 'group') p.gid = groupEntries[gi++].gid;
    // Drop expand-state for gids that no longer exist (deleted/re-grouped) so
    // expandedSeqGroups can't accumulate dead keys across renders.
    OpTable.pruneExpanded(expandedSeqGroups, groupEntries.map(e => e.gid));

    const renderRow = (op, idx, groupGid) => {
      const hidden = groupGid && !expandedSeqGroups.has(groupGid) ? ' style="display:none"' : '';
      const parentAttr = groupGid ? ` data-group-parent="${escapeHtml(groupGid)}"` : '';
      // Exact toggle only makes sense for @2x files (fallback target). Non-@2x
      // sources render a dimmed, disabled, unchecked toggle (not an empty cell) —
      // same as the tint editor.
      const is2x = has2x(op);
      const exactCell = `<td><label class="toggle${is2x ? '' : ' is-disabled'}">
          <input type="checkbox" class="file-exact-toggle" data-idx="${idx}" ${(is2x && op.exact) ? 'checked' : ''}${is2x ? '' : ' disabled'}>
          <span class="toggle__slider"></span>
        </label></td>`;
      if (op._type === 'copy') {
        const src = op.source || '';
        const cached = thumbHtmlFor(src, pathBasename(src));
        return `<tr class="file-op-row" data-idx="${idx}" data-type="copy"${parentAttr}${hidden}>
          <td><span class="tag tag--accent">${i18n.t('file.tagCopy')}</span></td>
          <td><span class="file-thumb" data-path="${escapeHtml(src)}" style="display:inline-flex;align-items:center;gap:6px">${cached}</span></td>
          <td><input type="text" class="form-input copy-dest-input" data-idx="${idx}" value="${escapeHtml(op.destination)}" autocomplete="off" spellcheck="false" placeholder="${i18n.t('file.destPlaceholder')}"></td>
          ${exactCell}
        </tr>`;
      } else {
        const p = op.path || '';
        const cached = thumbHtmlFor(p, pathBasename(p), true);
        return `<tr class="file-op-row file-delete-row" data-idx="${idx}" data-type="delete" data-delpath="${escapeHtml(p)}"${parentAttr}${hidden}>
          <td><span class="tag tag--danger">${i18n.t('file.tagDelete')}</span></td>
          <td><span class="file-thumb file-del-thumb" data-path="${escapeHtml(p)}" style="display:inline-flex;align-items:center;gap:6px">${cached}</span></td>
          <td style="color:var(--danger);font-size:12px">${i18n.t('file.removeLabel')}</td>
          ${exactCell}
        </tr>`;
      }
    };

    const renderGroup = (g) => {
      const members = fileOps.slice(g.range[0], g.range[1]);
      // gid = a STABLE per-instance token (assigned from the members' _groupId).
      // Unique per group even for same-name groups; survives reorder. Used as the
      // expand-set key + the data-group-parent link so expanding one group never
      // folds/unfolds a same-name sibling. seqKey is kept only for control sync.
      const gid = g.gid;
      const expanded = expandedSeqGroups.has(gid);
      const first = members[0];
      const isCopy = first._type === 'copy';
      const label = groupLabel(first);
      const groupHas2x = members.every(m => has2x(m));
      const tagCls = isCopy ? 'tag--accent' : 'tag--danger';
      const tagKey = isCopy ? 'file.tagCopy' : 'file.tagDelete';
      // Group-level destination (copy only): TEMPORARY value — init from first
      // member, edits stay local, commits to members via the fill button.
      // data-group-header marks it as a virtual-row control for multi-select sync.
      // data-range scopes member selection to THIS group only (same-name groups
      // must not all select together).
      const ghAttr = `data-group-header="1" data-group="${escapeHtml(g.key)}"`;
      const rangeAttr = `data-range="${g.range[0]}-${g.range[1]}"`;
      const gidAttr = `data-gid="${escapeHtml(gid)}"`;
      // Header keeps the first member's FULL destination (index NOT cleared) —
      // display mirrors the member. Fill writes a bare stem; the backend then
      // re-attaches each source's own index at apply time.
      const headerDest = isCopy ? (first.destination || '') : '';
      const destCell = isCopy
        ? `<td style="padding-right:12px"><input type="text" class="form-input copy-dest-input file-seq-dest" data-seq-key="${escapeHtml(g.key)}" data-idx="G-${escapeHtml(g.key)}" ${ghAttr} value="${escapeHtml(headerDest)}" autocomplete="off" spellcheck="false" placeholder="${i18n.t('file.destPlaceholder')}"></td>`
        : `<td style="color:var(--danger);font-size:12px">${i18n.t('file.removeLabel')}</td>`;
      // Group-level exact toggle (only if the group has @2x files) + fill button.
      const fillBtn = `<button type="button" class="btn btn--secondary btn--sm file-seq-fill-btn" data-seq-key="${escapeHtml(g.key)}" title="${escapeHtml(i18n.t('file.fillAllTitle'))}" data-full="${escapeHtml(i18n.t('file.fillAll'))}" style="padding:4px 6px;flex:0 0 auto;white-space:nowrap;margin-left:auto">${i18n.t('file.fillAll')}</button>`;
      // Group-level exact toggle: enabled only when the group has @2x files;
      // otherwise a dimmed, disabled toggle (not empty) — matches member rows.
      const exactToggle = `<label class="toggle${groupHas2x ? '' : ' is-disabled'}" style="flex:0 0 auto">
          <input type="checkbox" class="file-seq-exact-toggle" data-seq-key="${escapeHtml(g.key)}" ${ghAttr} ${(groupHas2x && first.exact) ? 'checked' : ''}${groupHas2x ? '' : ' disabled'}>
          <span class="toggle__slider"></span>
        </label>`;
      const exactCell = `<td><div style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap">
          ${exactToggle}
          ${fillBtn}
        </div></td>`;
      const rows = [
        `<tr class="file-op-row file-seq-group${expanded ? ' file-seq-group--expanded' : ''}" data-seq-key="${escapeHtml(g.key)}" data-idx="G-${escapeHtml(g.key)}" ${rangeAttr} ${gidAttr}>
          <td><span class="tag ${tagCls}" style="cursor:pointer">${i18n.t(tagKey)}</span></td>
          <td style="cursor:pointer"><span style="display:flex;align-items:center;gap:0;width:100%"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0">${escapeHtml(label)}</span><span style="color:var(--text-muted);flex:0 0 auto;margin-right:-12px">(${members.length})</span></span></td>
          ${destCell}
          ${exactCell}
        </tr>`,
        ...members.map((op, k) => renderRow(op, g.range[0] + k, gid))
      ];
      return rows.join('');
    };

    return `
      <div class="files-body-table">
        <div class="table-wrap">
          <table class="table ini-table">
            <colgroup>
              <col style="width:72px">
              <col>
              <col>
              <col style="width:120px">
            </colgroup>
            <tbody>
            ${plan.map(p => p.type === 'group' ? renderGroup(p) : renderRow(fileOps[p.i], p.i, null)).join('')}
          </tbody>
        </table>
      </div>
      </div>
    `;
  }

  const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);
  // rawPath (the value stored in data-path) → data URL. Cached so re-renders
  // (add/delete/save) render the image synchronously instead of flashing the
  // file-icon placeholder first.
  const thumbCache = new Map();

  // Shared thumbnail loader (OpTable.createThumbLoader): owns the cache + the
  // synchronous htmlFor + the async load invariant (DOM-state skip + cache
  // rehydrate) so same-source previews can't be lost the way a per-editor fill
  // loop could drift. Editors pass their own img/placeholder markup for style.
  const thumbLoader = OpTable.createThumbLoader({
    cache: thumbCache,
    isImage: (raw) => isImagePath(raw),
    skinPath: () => skinPath(),
    imgHtml: (dataUrl) => `<img src="${dataUrl}" title="${i18n.t('file.clickToChange')}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0">`,
    placeholderHtml: () => `<span class="file-thumb__icon" title="${i18n.t('file.clickToChange')}">📄</span>`,
  });

  // Build the inner markup for a file cell: cached <img> if available, else a
  // 📄 icon placeholder (loadThumbnails fills it in async on first load).
  // Delete rows (no source / not an image) render a bare label with no icon.
  function thumbHtmlFor(rawPath, label, isDelete) {
    if (isDelete) {
      return `<span class="file-thumb__name" title="${escapeHtml(rawPath)}">${escapeHtml(label || '')}</span>`;
    }
    return thumbLoader.htmlFor(rawPath, label);
  }

  function pathBasename(p) {
    return OpTable.pathBasename(p);
  }

  function isImagePath(p) {
    const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
    return IMG_EXTS.has(ext);
  }

  async function loadThumbnails() {
    // Delegated to the shared loader (OpTable.createThumbLoader): DOM-state
    // skip + cache-rehydrate invariant, shared with the tint editor so the
    // same-source-preview-loss class of bugs can't recur from drift. Query the
    // whole document so all file rows + group sub-rows are covered.
    await thumbLoader.load(document);
  }

  function escapeHtml(str) {
    return OpTable.escapeHtml(str);
  }

  // Single ResizeObserver: the ONLY driver of layoutColumns (tab visible +
  // window resize). All column logic stays internal.
  const filesContainer = document.getElementById('tab-files');
  if (filesContainer && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => layoutColumns(filesContainer)).observe(filesContainer);
  } else if (filesContainer) {
    window.addEventListener('resize', () => layoutColumns(filesContainer));
  }

  // Return the currently-selected file-copy + file-delete rows as plain
  // objects (deep-cloned), split by _type. Selection indices map into the
  // unified currentFileOps view-model. No anchor fallback (empty = empty).
  function getSelectedActions() {
    const set = sel ? sel.getSelected() : new Set();
    if (set.size === 0) return { fileCopies: [], fileDeletes: [] };
    const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
    const fileCopies = [], fileDeletes = [];
    for (const i of [...set].sort((a, b) => a - b)) {
      const op = ops[i];
      if (!op) continue;
      if (op._type === 'copy') fileCopies.push({ source: op.source, destination: op.destination, exact: !!op.exact });
      else if (op._type === 'delete') fileDeletes.push({ path: op.path, exact: !!op.exact });
    }
    return JSON.parse(JSON.stringify({ fileCopies, fileDeletes }));
  }

  window.FileCopyEditor = { init, render, layoutColumns, getSelectedActions, hasSelection: () => !!(sel && sel.getSelected().size > 0), clearSelection: () => sel && sel.clearSelection(), invalidateCache: () => thumbCache.clear() };
})();
