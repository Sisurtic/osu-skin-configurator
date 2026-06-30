// File operations editor — copy & delete (unified table)
(function () {
  let getCopies, setCopies, getDeletes, setDeletes, skinName, presetName, skinPath;

  // Multi-select state (unified)
  let selectedIndices = new Set();
  let lastClickedIndex = null;
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
      ...copies.map(c => ({ _type: 'copy', source: c.source, destination: c.destination, exact: !!c.exact })),
      ...deletes.map(d => ({ _type: 'delete', path: d.path, exact: !!d.exact })),
    ];
  }

  function applyFileOps(fileOps) {
    const copies = fileOps
      .filter(op => op._type === 'copy')
      .map(op => ({ source: op.source, destination: op.destination, exact: !!op.exact }));
    const deletes = fileOps
      .filter(op => op._type === 'delete')
      .map(op => ({ path: op.path, exact: !!op.exact }));
    setCopies(copies);
    setDeletes(deletes);
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
    if (!measured) return;                        // tables not ready yet
    // Always use BASE_W (minimum window). Fixed layout + width:100% scales
    // proportionally to the actual table width, keeping proportions stable.
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

    // Reset selection
    selectedIndices = new Set();
    lastClickedIndex = null;
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
          let relPath = filePath;
          if (skPath && filePath.toLowerCase().startsWith(skPath.toLowerCase())) {
            relPath = filePath.slice(skPath.length).replace(/^[/\\]/, '');
          } else {
            relPath = filePath.split(/[/\\]/).pop();
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

    // ── Bind row selection (unified) ──
    container.querySelectorAll('.file-op-row').forEach(row => {
      bindRowSelection(row, fileOps);
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
    function commitDestRaw(input) {
      const idx = parseInt(input.dataset.idx);
      const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
      if (idx >= 0 && idx < ops.length && ops[idx]._type === 'copy') {
        const val = input.value.trim().replace(/^["']|["']$/g, '');
        ops[idx].destination = val;
        applyFileOps(ops);
      }
    }
    // Normalize a file dest's extension to the SOURCE's extension: strip any
    // extension the user typed, then append the source's. Copies are byte-for-
    // byte, so a mismatched extension would corrupt the file — we always honor
    // the source. Directory dests (ending in /) are left untouched.
    function appendSrcExt(val, source) {
      if (!val || val.endsWith('/')) return val;
      const slash = val.lastIndexOf('/');
      const base = val.slice(slash + 1);
      const dotPos = base.indexOf('.');
      const stem = dotPos >= 0 ? base.slice(0, dotPos) : base;
      const srcBase = (source || '').split(/[/\\]/).pop() || '';
      const sDot = srcBase.lastIndexOf('.');
      if (sDot < 0) return dotPos >= 0 ? val.slice(0, slash + 1) + stem : val; // source has no ext
      return val.slice(0, slash + 1) + stem + srcBase.slice(sDot);
    }

    function convertDestDisplay(input) {
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
          val = appendSrcExt(val, source);
          input.value = val;
          ops[idx].destination = val;
          applyFileOps(ops);
        });
        return;
      }
      // Already relative: normalize separators for display.
      val = val.replace(/\\/g, '/');
      val = appendSrcExt(val, source);
      if (val !== input.value) input.value = val;
      ops[idx].destination = val;
      applyFileOps(ops);
    }
    container.querySelectorAll('.copy-dest-input').forEach(input => {
      input.addEventListener('input', () => commitDestRaw(input));
      input.addEventListener('change', () => convertDestDisplay(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); convertDestDisplay(input); }
      });
    });

    // Exact-match toggles (@2x fallback on/off). State is per-op, so toggles
    // inside a collapsed sequence group still persist on save.
    container.querySelectorAll('.file-exact-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.idx);
        const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
        if (idx >= 0 && idx < ops.length) { ops[idx].exact = cb.checked; applyFileOps(ops); }
      });
    });

    // Sequence-group expand/collapse: double-click anywhere on the header row
    // (except interactive controls) toggles expansion. Fast 250ms double-click.
    container.querySelectorAll('.file-seq-group').forEach(tr => {
      let last = 0;
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.copy-dest-input, .file-seq-fill-btn, .file-seq-exact-toggle, .toggle, .toggle__slider')) return;
        const now = Date.now();
        if (now - last < 250) {
          const key = tr.dataset.seqKey;
          if (key) {
            if (expandedSeqGroups.has(key)) expandedSeqGroups.delete(key);
            else expandedSeqGroups.add(key);
            rerenderTable(container);
          }
          last = 0;
        } else { last = now; }
      });
    });

    // Group-level exact toggle: apply to all members of the group.
    container.querySelectorAll('.file-seq-exact-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.seqKey;
        const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
        for (let k = 0; k < ops.length; k++) {
          if (isFrame(ops[k]) && seqKey(ops[k]) === key) ops[k].exact = cb.checked;
        }
        applyFileOps(ops);
      });
    });

    // Group-level destination input: commit raw on each keystroke, normalize on blur/Enter.
    const groupMemberIdx = (key, ops) => {
      const out = [];
      for (let k = 0; k < ops.length; k++) if (isFrame(ops[k]) && seqKey(ops[k]) === key) out.push(k);
      return out;
    };
    container.querySelectorAll('.file-seq-dest').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.seqKey;
        const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
        for (const k of groupMemberIdx(key, ops)) ops[k].destination = input.value;
        applyFileOps(ops);
      });
      input.addEventListener('change', () => {
        const key = input.dataset.seqKey;
        const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
        const idxs = groupMemberIdx(key, ops);
        if (idxs.length === 0) return;
        const source = ops[idxs[0]].source || ''; // frame members share an extension
        let val = input.value.trim().replace(/^["']|["']$/g, '');
        if (val && /^[a-zA-Z]:[\\/]?/.test(val)) {
          skinPath().then(sp => {
            if (sp) {
              const skNorm = sp.replace(/\\/g, '/').toLowerCase();
              const valNorm = val.replace(/\\/g, '/').toLowerCase();
              val = valNorm.startsWith(skNorm) ? val.replace(/\\/g, '/').slice(sp.length).replace(/^\//, '') : val;
            }
            val = appendSrcExt(val, source);
            input.value = val;
            for (const k of idxs) ops[k].destination = val;
            applyFileOps(ops);
          });
          return;
        }
        val = val.replace(/\\/g, '/');
        val = appendSrcExt(val, source);
        if (val !== input.value) input.value = val;
        for (const k of idxs) ops[k].destination = val;
        applyFileOps(ops);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    });

    // Fill button on copy sequence groups: copy the first member's destination
    // and exact-match state to every member of the group.
    container.querySelectorAll('.file-seq-fill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't toggle group expansion
        const key = btn.dataset.seqKey;
        const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
        const memberIdx = [];
        for (let k = 0; k < ops.length; k++) {
          if (isFrame(ops[k]) && seqKey(ops[k]) === key) memberIdx.push(k);
        }
        if (memberIdx.length < 2) return;
        const first = ops[memberIdx[0]];
        const dest = first.destination || '';
        const exact = !!first.exact;
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

    // ── Load thumbnails for image files ──
    loadThumbnails();

    // ── Delete zone drop handler ──
    const deleteZone = container.querySelector('#file-delete-zone');
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
        const raw = e.dataTransfer.getData('application/file-indices');
        if (!raw) return;
        try {
          const indices = JSON.parse(raw).sort((a, b) => b - a);
          const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
          for (const i of indices) ops.splice(i, 1);
          applyFileOps(ops);
          Toast.info(i18n.t('file.deleted', { n: indices.length }));
          render(container);
        } catch (_) { /* ignore malformed data */ }
      });
    }

    // Measure + apply column widths. If the tab is active but layoutColumns
    // skipped (container width not settled yet this frame), retry next frame.
    autosizeColumns(container);
    layoutColumns(container);
    if (container.classList.contains('tab-content--active')) {
      requestAnimationFrame(() => layoutColumns(container));
    }

    // Edge-fade overlays: added to the scroll element's PARENT (container)
    // so they stay fixed at the scroll viewport edges regardless of scroll.
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

  function bindRowSelection(row, fileOps) {
    row.addEventListener('click', (e) => {
      if (e.target.closest('input, button')) return;
      const idx = parseInt(row.dataset.idx);
      if (isNaN(idx)) return;

      if (e.ctrlKey || e.metaKey) {
        if (selectedIndices.has(idx)) selectedIndices.delete(idx);
        else selectedIndices.add(idx);
        lastClickedIndex = idx;
      } else if (e.shiftKey && lastClickedIndex !== null) {
        const start = Math.min(lastClickedIndex, idx);
        const end = Math.max(lastClickedIndex, idx);
        if (!e.ctrlKey && !e.metaKey) selectedIndices.clear();
        for (let i = start; i <= end; i++) selectedIndices.add(i);
      } else {
        selectedIndices.clear();
        selectedIndices.add(idx);
        lastClickedIndex = idx;
      }
      updateAllHighlights();
    });

    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', (e) => {
      // Block drag while actively editing a value input in this row
      const activeEl = document.activeElement;
      if (activeEl && row.contains(activeEl) && activeEl.closest('input, select, textarea, button')) {
        e.preventDefault();
        return;
      }
      const idx = parseInt(row.dataset.idx);

      if (!selectedIndices.has(idx)) {
        selectedIndices.clear();
        selectedIndices.add(idx);
        lastClickedIndex = idx;
        updateAllHighlights();
      }

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/file-indices', JSON.stringify([...selectedIndices]));
      // Visual feedback
      document.querySelectorAll('.file-op-row').forEach(r => {
        const ri = parseInt(r.dataset.idx);
        if (selectedIndices.has(ri)) r.classList.add('row--dragging');
      });
    });

    row.addEventListener('dragend', () => {
      document.querySelectorAll('.file-op-row').forEach(r => r.classList.remove('row--dragging'));
    });
  }

  function updateAllHighlights() {
    document.querySelectorAll('.file-op-row').forEach(row => {
      const idx = parseInt(row.dataset.idx);
      row.classList.toggle('row--selected', selectedIndices.has(idx));
    });
  }

  // Sequence-group key: strips extension, @2x, frame number (-N), and format
  // suffix from the filename so animation frames (foo-0.png … foo-9.png) share
  // a key. Prefixed with op type so copies and deletes never merge.
  function seqKey(op) {
    let b = (opFile(op) || '').replace(/\\/g, '/').split('/').pop() || '';
    b = b.replace(/\.[^.]+$/, '');             // extension
    b = b.replace(/@2x$/i, '');                 // HD suffix
    b = b.replace(/-\d+$/, '');                 // animation frame
    b = b.replace(/-(x|dot|comma|percent)$/i, ''); // format suffix
    return op._type + '|' + b;
  }
  // Whether a path looks like an animation frame: "id-N.ext" or "id-N@2x.ext".
  function isFrame(op) {
    const b = (opFile(op) || '').replace(/\\/g, '/').split('/').pop() || '';
    return /-\d+(@2x)?\.[^.]+$/i.test(b);
  }
  // Whether the file path has an @2x HD suffix (the exact/@2x toggle only applies to these).
  function has2x(op) {
    return /@2x\.[^.]+$/i.test(opFile(op) || '');
  }
  // Group label: strip the frame number (-N) but keep @2x and extension.
  function groupLabel(op) {
    let b = (opFile(op) || '').replace(/\\/g, '/').split('/').pop() || '';
    return b.replace(/-\d+(?=@2x\.|\.[^.]+$)/i, '');
  }
  // Expanded sequence groups (by key). Default: collapsed (set holds expanded keys).
  const expandedSeqGroups = new Set();

  function renderFilesTableBody(fileOps) {
    if (fileOps.length === 0) {
      return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">${i18n.t('file.empty')}</div>`;
    }
    // Sort by file extension, then by file name (stable).
    fileOps.sort((a, b) => {
      const fa = (opFile(a) || '').replace(/\\/g, '/').split('/').pop() || '';
      const fb = (opFile(b) || '').replace(/\\/g, '/').split('/').pop() || '';
      const ea = (fa.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      const eb = (fb.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      if (ea !== eb) return ea < eb ? -1 : 1;
      return fa < fb ? -1 : (fa > fb ? 1 : 0);
    });
    // Publish the view-model so data-idx consumers (destination input, row
    // selection, delete) index the same order they see.
    currentFileOps = fileOps;

    // Build a render plan: coalesce CONSECUTIVE frame ops with the same seqKey
    // (length ≥ 2) into a collapsible group. Singletons render as plain rows.
    const plan = []; // { type:'row', i } | { type:'group', key, indices:[], expanded }
    let i = 0;
    while (i < fileOps.length) {
      const op = fileOps[i];
      if (isFrame(op)) {
        const key = seqKey(op);
        let j = i + 1;
        while (j < fileOps.length && isFrame(fileOps[j]) && seqKey(fileOps[j]) === key) j++;
        if (j - i >= 2) {
          plan.push({ type: 'group', key, indices: [], range: [i, j] });
          i = j;
          continue;
        }
      }
      plan.push({ type: 'row', i });
      i++;
    }

    const renderRow = (op, idx, groupKey) => {
      const hidden = groupKey && !expandedSeqGroups.has(groupKey) ? ' style="display:none"' : '';
      const parentAttr = groupKey ? ` data-group-parent="${escapeHtml(groupKey)}"` : '';
      // Exact toggle only makes sense for @2x files (fallback target).
      const exactCell = has2x(op)
        ? `<td><label class="toggle">
            <input type="checkbox" class="file-exact-toggle" data-idx="${idx}" ${op.exact ? 'checked' : ''}>
            <span class="toggle__slider"></span>
          </label></td>`
        : '<td></td>';
      if (op._type === 'copy') {
        const src = op.source || '';
        const cached = thumbHtmlFor(src, pathBasename(src));
        return `<tr class="file-op-row" data-idx="${idx}" data-type="copy"${parentAttr}${hidden}>
          <td><span class="tag tag--accent">${i18n.t('file.tagCopy')}</span></td>
          <td><span class="file-thumb" data-path="${escapeHtml(src)}" title="${escapeHtml(src)}" style="display:inline-flex;align-items:center;gap:6px">${cached}</span></td>
          <td><input type="text" class="form-input copy-dest-input" data-idx="${idx}" value="${escapeHtml(op.destination)}" autocomplete="off" spellcheck="false" placeholder="${i18n.t('file.destPlaceholder')}"></td>
          ${exactCell}
        </tr>`;
      } else {
        const p = op.path || '';
        const cached = thumbHtmlFor(p, pathBasename(p), true);
        return `<tr class="file-op-row file-delete-row" data-idx="${idx}" data-type="delete" data-delpath="${escapeHtml(p)}"${parentAttr}${hidden}>
          <td><span class="tag tag--danger">${i18n.t('file.tagDelete')}</span></td>
          <td><span class="file-thumb file-del-thumb" data-path="${escapeHtml(p)}" title="${escapeHtml(p)}" style="display:inline-flex;align-items:center;gap:6px">${cached}</span></td>
          <td style="color:var(--danger);font-size:12px">${i18n.t('file.removeLabel')}</td>
          ${exactCell}
        </tr>`;
      }
    };

    const renderGroup = (g) => {
      const members = fileOps.slice(g.range[0], g.range[1]);
      const expanded = expandedSeqGroups.has(g.key);
      const first = members[0];
      const isCopy = first._type === 'copy';
      const label = groupLabel(first);
      const groupHas2x = members.every(m => has2x(m));
      const tagCls = isCopy ? 'tag--accent' : 'tag--danger';
      const tagKey = isCopy ? 'file.tagCopy' : 'file.tagDelete';
      // Group-level destination (copy only): show first member's value.
      const destCell = isCopy
        ? `<td style="padding-right:12px"><input type="text" class="form-input copy-dest-input file-seq-dest" data-seq-key="${escapeHtml(g.key)}" data-idx="G-${escapeHtml(g.key)}" value="${escapeHtml(first.destination || '')}" autocomplete="off" spellcheck="false" placeholder="${i18n.t('file.destPlaceholder')}"></td>`
        : `<td style="color:var(--danger);font-size:12px">${i18n.t('file.removeLabel')}</td>`;
      // Group-level exact toggle (only if the group has @2x files) + fill button.
      const fillBtn = `<button type="button" class="btn btn--secondary btn--sm file-seq-fill-btn" data-seq-key="${escapeHtml(g.key)}" title="${escapeHtml(i18n.t('file.fillAllTitle'))}" data-full="${escapeHtml(i18n.t('file.fillAll'))}" style="padding:4px 6px;flex:0 0 auto;white-space:nowrap;margin-left:auto">${i18n.t('file.fillAll')}</button>`;
      const exactToggle = groupHas2x
        ? `<label class="toggle">
            <input type="checkbox" class="file-seq-exact-toggle" data-seq-key="${escapeHtml(g.key)}" ${first.exact ? 'checked' : ''}>
            <span class="toggle__slider"></span>
          </label>`
        : '';
      const exactCell = `<td><div style="display:flex;align-items:center;gap:8px">
          ${exactToggle}
          ${fillBtn}
        </div></td>`;
      const rows = [
        `<tr class="file-op-row file-seq-group${expanded ? ' file-seq-group--expanded' : ''}" data-seq-key="${escapeHtml(g.key)}" data-idx="G-${escapeHtml(g.key)}">
          <td><span class="tag ${tagCls}" style="cursor:pointer">${i18n.t(tagKey)}</span></td>
          <td style="cursor:pointer"><span style="display:inline-flex;align-items:center;gap:6px;min-width:0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(label)} <span style="color:var(--text-muted)">(${members.length})</span></span></span></td>
          ${destCell}
          ${exactCell}
        </tr>`,
        ...members.map((op, k) => renderRow(op, g.range[0] + k, g.key))
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

  // Build the inner markup for a file cell: cached <img> if available, else a
  // 📄 icon placeholder (loadThumbnails fills it in async on first load).
  function thumbHtmlFor(rawPath, label, isDelete) {
    if (isDelete ? !rawPath : !isImagePath(rawPath)) {
      // Non-image (or empty): plain icon + label, no async load.
      return isDelete ? escapeHtml(label) : `📄 ${escapeHtml(label || '')}`;
    }
    if (thumbCache.has(rawPath)) {
      return `<img src="${thumbCache.get(rawPath)}" title="${escapeHtml(rawPath)}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0"> ${escapeHtml(label)}`;
    }
    return `📄 ${escapeHtml(label || '')}`;
  }

  function pathBasename(p) {
    return p.split(/[/\\]/).pop() || p;
  }

  function isImagePath(p) {
    const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
    return IMG_EXTS.has(ext);
  }

  async function loadThumbnails() {
    const skPath = await skinPath() || '';
    const thumbs = document.querySelectorAll('.file-thumb[data-path]');
    for (const span of thumbs) {
      const raw = span.dataset.path;
      // Skip spans that already show an image (rendered from cache synchronously).
      if (span.querySelector('img')) continue;
      // Resolve the on-disk path to fetch (both copy and delete use skin-relative paths).
      let p = raw;
      const isAbs = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');
      if (!isAbs && skPath) {
        p = skPath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + p.replace(/\\/g, '/');
      }
      if (!isImagePath(p)) continue;
      // Cache keyed by the RAW data-path so re-renders can use it synchronously.
      if (thumbCache.has(raw)) {
        const label = pathBasename(raw);
        span.innerHTML = `<img src="${thumbCache.get(raw)}" title="${escapeHtml(raw)}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0"> ${escapeHtml(label)}`;
        continue;
      }
      try {
        const result = await api.getPreviewDataUrl(p);
        if (result.success && result.data) {
          thumbCache.set(raw, result.data);
          const label = pathBasename(raw);
          span.innerHTML = `<img src="${result.data}" title="${escapeHtml(raw)}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0"> ${escapeHtml(label)}`;
        }
      } catch (_) { /* skip failed thumbnails */ }
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ── Del key: delete selected file operation rows with confirmation ──
  async function deleteSelected() {
    if (selectedIndices.size === 0) return;

    const confirmed = await ApplyDialog.showConfirmDialog(
      i18n.t('file.deleteRowsConfirm', { n: selectedIndices.size }),
      [
        { label: `${i18n.t('file.delete')} (${selectedIndices.size})`, cls: 'btn--danger', value: 'delete' },
        { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
      ]
    );
    if (!confirmed || confirmed !== 'delete') return;

    const fileOps = currentFileOps ? [...currentFileOps] : buildFileOps();
    const sorted = [...selectedIndices].sort((a, b) => b - a);
    for (const i of sorted) fileOps.splice(i, 1);
    applyFileOps(fileOps);
    selectedIndices.clear();
    lastClickedIndex = null;
    Toast.info(i18n.t('file.deleted', { n: sorted.length }));
    // Re-render current container
    const container = document.getElementById('tab-files');
    if (container && container.classList.contains('tab-content--active')) {
      render(container);
    }
  }

  // Single ResizeObserver: the ONLY driver of layoutColumns (tab visible +
  // window resize). All column logic stays internal.
  const filesContainer = document.getElementById('tab-files');
  if (filesContainer && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => layoutColumns(filesContainer)).observe(filesContainer);
  } else if (filesContainer) {
    window.addEventListener('resize', () => layoutColumns(filesContainer));
  }

  window.FileCopyEditor = { init, render, deleteSelected, layoutColumns, invalidateCache: () => thumbCache.clear() };
})();
