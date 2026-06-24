// File operations editor — copy & delete (unified table)
(function () {
  let getCopies, setCopies, getDeletes, setDeletes, skinName, presetName, skinPath;

  // Multi-select state (unified)
  let selectedIndices = new Set();
  let lastClickedIndex = null;
  let fileDialogOpen = false;

  // Column sort state. Default = by action type (copy/delete grouped), asc.
  // There is always an active sort.
  let sortState = { col: 'action', dir: 'asc' };
  // The view-model used for the current render (sorted if a sort is active).
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
      ...copies.map(c => ({ _type: 'copy', source: c.source, destination: c.destination })),
      ...deletes.map(d => ({ _type: 'delete', path: d.path })),
    ];
  }

  function applyFileOps(fileOps) {
    const copies = fileOps
      .filter(op => op._type === 'copy')
      .map(op => ({ source: op.source, destination: op.destination }));
    const deletes = fileOps
      .filter(op => op._type === 'delete')
      .map(op => ({ path: op.path }));
    setCopies(copies);
    setDeletes(deletes);
  }

  function cmpStr(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  function opFile(op) { return op._type === 'copy' ? (op.source || '') : (op.path || ''); }
  function opDest(op) { return op._type === 'copy' ? (op.destination || '') : ''; }
  function opActRank(op) { return op._type === 'copy' ? 0 : 1; } // copy(green) < delete(red)

  // Per-header sort-key chains. action → action, file, dest; etc. Reverse
  // inverts the whole compare but keeps field PRIORITY.
  function opSortKeys(op, col) {
    const f = opFile(op), d = opDest(op), a = opActRank(op);
    if (col === 'action') return [a, f, d];
    if (col === 'file')   return [f, d, a];
    /* dest */            return [d, f, a];
  }
  function compareOp(a, b, col) {
    const ka = opSortKeys(a, col), kb = opSortKeys(b, col);
    for (let i = 0; i < ka.length; i++) {
      const c = cmpStr(ka[i], kb[i]);
      if (c !== 0) return c;
    }
    return 0;
  }

  function sortIndicatorHtml(col) {
    if (sortState.col !== col) return '';
    const ascActive = sortState.dir === 'asc';
    const upCls = ascActive ? 'ini-sort-arrow ini-sort-arrow--active' : 'ini-sort-arrow';
    const downCls = !ascActive ? 'ini-sort-arrow ini-sort-arrow--active' : 'ini-sort-arrow';
    return `<span class="ini-sort-indicator"><span class="${upCls}">▲</span><span class="${downCls}">▼</span></span>`;
  }

  // Re-render after a sort change.
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
    const rest = Math.max(0, BASE_W - wAction);
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
              </colgroup>
              <thead><tr>
                <th class="th--sortable" data-col="action">${i18n.t('file.colAction')}${sortIndicatorHtml('action')}</th>
                <th class="th--sortable" data-col="file">${i18n.t('file.colFile')}${sortIndicatorHtml('file')}</th>
                <th class="th--sortable" data-col="dest">${i18n.t('file.colDest')}${sortIndicatorHtml('dest')}</th>
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
          copies.push({ source: relPath, destination: '' });
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
          deletes.push({ path: relPath });
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
    function convertDestDisplay(input) {
      const idx = parseInt(input.dataset.idx);
      const ops = currentFileOps ? [...currentFileOps] : buildFileOps();
      if (idx < 0 || idx >= ops.length || ops[idx]._type !== 'copy') return;
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
          input.value = val;
          ops[idx].destination = val;
          applyFileOps(ops);
        });
        return;
      }
      // Already relative: normalize separators for display.
      val = val.replace(/\\/g, '/');
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

    // ── Column header sort (click toggles: same col flips asc/desc, new col = asc) ──
    container.querySelectorAll('.files-header-table th.th--sortable').forEach(th => {
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

  function renderFilesTableBody(fileOps) {
    if (fileOps.length === 0) {
      return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">${i18n.t('file.empty')}</div>`;
    }
    // Apply the active column sort — DISPLAY ONLY (no applyFileOps). There is
    // always an active sort (default = action).
    const dirMul = sortState.dir === 'desc' ? -1 : 1;
    fileOps.sort((a, b) => dirMul * compareOp(a, b, sortState.col));
    // Publish the (possibly sorted) view-model so data-idx consumers
    // (destination input, row selection, delete) index the same order they see.
    currentFileOps = fileOps;
    return `
      <div class="files-body-table">
        <div class="table-wrap">
          <table class="table ini-table">
            <colgroup>
              <col style="width:72px">
              <col>
              <col>
            </colgroup>
            <tbody>
            ${fileOps.map((op, i) => {
              if (op._type === 'copy') {
                const src = op.source || '';
                const cached = thumbHtmlFor(src, pathBasename(src));
                return `<tr class="file-op-row" data-idx="${i}" data-type="copy">
                  <td><span class="tag tag--accent">${i18n.t('file.tagCopy')}</span></td>
                  <td><span class="file-thumb" data-path="${escapeHtml(src)}" style="display:inline-flex;align-items:center;gap:6px">${cached}</span></td>
                  <td><input type="text" class="form-input copy-dest-input" data-idx="${i}" value="${escapeHtml(op.destination)}" placeholder="${i18n.t('file.destPlaceholder')}"></td>
                </tr>`;
              } else {
                const p = op.path || '';
                const cached = thumbHtmlFor(p, p, true);
                return `<tr class="file-op-row file-delete-row" data-idx="${i}" data-type="delete" data-delpath="${escapeHtml(p)}">
                  <td><span class="tag tag--danger">${i18n.t('file.tagDelete')}</span></td>
                  <td><span class="file-thumb file-del-thumb" data-path="${escapeHtml(p)}" style="display:inline-flex;align-items:center;gap:6px">${cached}</span></td>
                  <td style="color:var(--danger);font-size:12px">${i18n.t('file.removeLabel')}</td>
                </tr>`;
              }
            }).join('')}
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
      return `<img src="${thumbCache.get(rawPath)}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0"> ${escapeHtml(label)}`;
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
        const label = span.classList.contains('file-del-thumb') ? raw : pathBasename(raw);
        span.innerHTML = `<img src="${thumbCache.get(raw)}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0"> ${escapeHtml(label)}`;
        continue;
      }
      try {
        const result = await api.getPreviewDataUrl(p);
        if (result.success && result.data) {
          thumbCache.set(raw, result.data);
          const label = span.classList.contains('file-del-thumb') ? raw : pathBasename(raw);
          span.innerHTML = `<img src="${result.data}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0"> ${escapeHtml(label)}`;
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

  window.FileCopyEditor = { init, render, deleteSelected, layoutColumns };
})();
