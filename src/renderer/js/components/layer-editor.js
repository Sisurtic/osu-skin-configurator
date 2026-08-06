// Layer compositing editor — layer tab.
// Left: layer-stack operation list (each row = one composite output, drag-to-reorder/delete).
// Right: the selected stack's layer sub-list (per-layer blend/exact/flyout) + composite preview.
//
// An op (fileLayers[i]) = { destination, canvasMode:'bottom'|'max', layers:[{source,exact,
// blendMode,opacity,offsetX,offsetY}] }, layers[0] = top (highest), layers[N-1] = bottom.
// layer to reorder. 9-grid alignment is a UI shortcut that writes offsetX/offsetY (no `align`
// field). canvasMode: 'bottom' = bottom layer's size; 'max' = max width & max height (each
// axis independently) so the widest and tallest layers both fit.
//
// Selection/drag/delete/reorder is delegated to OpTable (`opSel`), same as tint/file-copy.
// Multi-select is for batch-DELETE ONLY — no cross-stack property sync (compositing is too
// per-stack-specific). Selection contract (init/render/getSelectedActions/selectAdded/...)
// mirrors TintEditor.
(function () {
  let getLayers, setLayers, skinName, presetId, skinPath;
  let container;
  let opSel = null;          // outer OpTable: layer-stack operation list
  let layerSel = null;       // inner OpTable: the selected stack's layers[] (z-order)
  let lastAnchor = 0;
  let fileDialogOpen = false;
  let splitFraction = 0.5;
  let previewDebounce = null;
  let liveFrame = 0;

  const IMG_EXTS = new Set(['.png']);
  const thumbCache = new Map();      // src path → dataURL (list thumbnails)
  const sourceImgCache = new Map();  // src path → HTMLImageElement (preview)
  const FADE = 'layer-preview--fade';

  function isImagePath(p) { return IMG_EXTS.has((p.match(/\.[^.]+$/) || [''])[0].toLowerCase()); }
  function has2x(src) { return /@2x\.[^.]+$/i.test(src || ''); }
  function pathBasename(p) { return OpTable.pathBasename(p); }
  function escapeHtml(s) { return OpTable.escapeHtml(s); }

  function init(getter, setter, skName, presetIdFn, skPathFn) {
    getLayers = typeof getter === 'function' ? getter : () => getter;
    setLayers = typeof setter === 'function' ? setter : () => {};
    skinName = typeof skName === 'function' ? skName : () => skName;
    presetId = typeof presetIdFn === 'function' ? presetIdFn : () => presetIdFn;
    skinPath = typeof skPathFn === 'function' ? skPathFn : () => skPathFn;
  }
  function applyLayersData(arr) { setLayers(arr); }
  function cur() { const a = getLayers() || []; return a; }

  function selectedIdx() {
    const a = opSel ? opSel.getAnchor() : 0;
    const len = cur().length;
    if (a < 0 || a >= len) return Math.max(0, len - 1);
    return a;
  }
  function sel() { const a = cur(); return a[selectedIdx()] || null; }
  // True when a row is actually selected (anchor valid + non-empty set). Used to
  // decide preview vs empty-hint — distinct from sel() which clamps to a row even
  // after clearSelection.
  function hasSelection() { return !!(opSel && opSel.getAnchor() >= 0 && opSel.getSelected().size > 0); }
  function rowMemberIndices(row) {
    const ri = parseInt(row.dataset.idx, 10);
    return isNaN(ri) ? [] : [ri];
  }

  // ── Render ──
  function render(parent) {
    container = parent;
    const stacks = cur();
    if (!opSel) {
      opSel = OpTable.create({
        container,
        rowSelector: '.layerop-row',
        interactiveSelector: 'input, select, textarea, button, label, .toggle, .toggle__slider, .file-thumb__icon, img',
        deleteMimeType: 'application/layer-indices',
        rowMembers: (row) => rowMemberIndices(row),
        rowAnchor: (row) => { const m = rowMemberIndices(row); return m.length ? m[0] : -1; },
        onSelectionChange: ({ anchor }) => {
          const moved = anchor !== lastAnchor;
          lastAnchor = anchor;
          // Switching stacks: reset the viewer (back to centered fit) so the new
          // composite isn't shown at the previous stack's pan/zoom.
          if (moved) {
            const el = container && container.querySelector('#layer-preview');
            if (el && window.ImageViewer) window.ImageViewer.reset(el);
          }
          refreshDetailAndList(moved);
        },
        applyDelete: (indicesDesc) => applyDeleteOps(indicesDesc),
        reorder: (fromIndices, toIndex) => applyReorderOps(fromIndices, toIndex),
      });
      opSel.setSelected(cur().length ? new Set([0]) : new Set(), 0);
    } else {
      opSel.setContainer(container);
    }
    container.innerHTML = `
      <div class="tint-split">
        <div class="tint-ops" style="flex:0 0 ${(splitFraction * 100).toFixed(1)}%">
          <div class="editor-sticky-header">
            <div style="padding-bottom:10px;border-bottom:1px solid var(--border)">
              <div style="margin-bottom:8px">
                <h3 style="margin-bottom:4px">${i18n.t('layer.heading')}</h3>
                <p style="font-size:12px;color:var(--text-muted)">${i18n.t('layer.desc')}</p>
              </div>
              <div style="margin:2px 0 8px">
                <button class="btn btn--primary btn--sm" id="btn-add-layer-stack" style="font-size:11px;padding:4px 6px">${i18n.t('layer.addStack')}</button>
              </div>
              <div class="editor-delete-zone" id="layer-delete-zone"
                   style="margin-top:4px;padding:8px;border:2px dashed var(--danger);border-radius:var(--radius);text-align:center;color:var(--danger);font-size:12px;opacity:0.5;transition:all 0.2s">
                ${i18n.t('layer.deleteZone')}
              </div>
            </div>
          </div>
          <div class="files-table-body-scroll" id="layer-table-body-scroll">${renderList(stacks)}</div>
        </div>
        <div class="tint-divider" id="layer-divider"></div>
        <div class="tint-detail" style="flex:1 1 0; position:relative">
          ${hasSelection()
            ? `<div class="tint-preview" id="layer-preview"></div>
               <div class="tint-stages" id="layer-stages">${renderStackDetail()}</div>`
            : `<div class="tint-empty-hint tint-preview--fade">
                 <div>${i18n.t('layer.hintSelect')}</div>
               </div>`}
        </div>
      </div>
    `;
    bindHandlers();
    loadThumbnails();
    // Edge-fade overlays on the operation-list + layer sub-list scroll areas.
    window.setupEdgeFade(container.querySelector('.tint-ops'), container.querySelector('#layer-table-body-scroll'), undefined, '.op-row--head');
    const layerScroll = container.querySelector('#layer-rows-scroll');
    if (layerScroll) window.setupEdgeFade(container.querySelector('.tint-stages'), layerScroll, undefined, '.op-row--head');
    requestAnimationFrame(() => { recomputePreview(true); });
  }

  function renderList(stacks) {
    if (stacks.length === 0) {
      return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">${i18n.t('layer.empty')}</div>`;
    }
    const set = opSel ? opSel.getSelected() : new Set();
    const anchor = opSel ? opSel.getAnchor() : 0;
    const bodyHtml = stacks.map((s, idx) => {
      const isSel = set.has(idx) || (set.size === 0 && idx === anchor);
      const selCls = isSel ? ' row--selected' : '';
      const bottomSrc = (s.layers && s.layers.length ? s.layers[s.layers.length - 1].source : '') || '';
      const count = (s.layers || []).length;
      // Label always shows the bottom layer's source — the destination is edited
      // in its own column next to this, so echoing it here would be redundant.
      const label = bottomSrc ? pathBasename(bottomSrc) : '';
      return `<div class="op-row layerop-row${selCls}" data-idx="${idx}">
        <div class="op-cell" data-col="file"><span style="display:inline-flex;align-items:center;gap:6px;min-width:0"><span class="file-thumb" data-path="${escapeHtml(bottomSrc)}" style="display:inline-flex;align-items:center;gap:6px">${thumbHtmlFor(bottomSrc, label)}</span><span style="color:var(--text-muted);flex:0 0 auto;margin-right:-12px;font-size:11px;line-height:28px">(${count})</span></span></div>
        <div class="op-cell" data-col="dest"><input type="text" class="form-input layer-dest" data-idx="${idx}" value="${escapeHtml(s.destination || '')}" autocomplete="off" spellcheck="false" placeholder="${i18n.t('layer.destPlaceholder')}"></div>
        <div class="op-cell" data-col="canvas"><label class="toggle" style="flex:0 0 auto">
          <input type="checkbox" class="layer-canvas-mode" data-idx="${idx}" ${s.canvasMode === 'max' ? 'checked' : ''}>
          <span class="toggle__slider"></span>
        </label></div>
      </div>`;
    }).join('');
    return `
      <div class="files-body-table"><div class="table-wrap">
        <div class="op-grid op-grid--layer">
          <div class="op-row op-row--head">
            <div class="op-cell op-cell--head" data-col="file">${i18n.t('tint.colSource')}</div>
            <div class="op-cell op-cell--head" data-col="dest" title="${escapeHtml(i18n.t('tint.colDestTitle'))}">${i18n.t('tint.colDest')}</div>
            <div class="op-cell op-cell--head" data-col="canvas" style="white-space:nowrap" title="${escapeHtml(i18n.t('layer.canvasSizeTitle'))}">${i18n.t('layer.canvasSizeCol')}</div>
          </div>
          ${bodyHtml}
        </div>
      </div></div>`;
  }

  // The selected stack's right panel: destination + layer sub-list + (placeholder) preview.
  // The selected stack's right panel: layer sub-list + preview.
  function renderStackDetail() {
    const s = sel();
    if (!s) return '';
    const multi = opSel && opSel.getSelected().size > 1;
    if (multi) {
      return '';
    }
    const layers = s.layers || [];
    // layers[0] = top of the stack (rendered first = list top); layers[N-1] =
    // bottom. Newly added layers unshift to the front. Compositing iterates in
    // reverse (bottom first) — see compositeCanvas / apply_layers.
    const rows = layers.map((l, k) => {
      const is2x = has2x(l.source);
      return `<div class="op-row layer-row" data-idx="${k}">
        <div class="op-cell" data-col="file"><span class="file-thumb layer-thumb" data-path="${escapeHtml(l.source || '')}" style="display:inline-flex;align-items:center;gap:6px">${thumbHtmlFor(l.source || '', pathBasename(l.source))}</span></div>
        <div class="op-cell" data-col="mode"><select class="form-input layer-blend" data-idx="${k}" style="width:110px;margin-left:-4px">${blendOpts(l.blendMode || 'normal')}</select></div>
        <div class="op-cell" data-col="exact"><label class="toggle${is2x ? '' : ' is-disabled'}" style="flex:0 0 auto">
          <input type="checkbox" class="layer-exact" data-idx="${k}" ${(is2x && l.exact) ? 'checked' : ''}${is2x ? '' : ' disabled'}>
          <span class="toggle__slider"></span>
        </label></div>
        <div class="op-cell" data-col="props"><button type="button" class="btn btn--secondary btn--sm layer-flyout-btn" data-idx="${k}" title="${escapeHtml(i18n.t('layer.propsTitle'))}" style="padding:2px 6px;font-size:11px">☰</button></div>
      </div>`;
    }).join('');
    return `
      <div style="padding:8px 0;display:flex;align-items:stretch;gap:8px">
        <button class="btn btn--primary btn--sm" id="btn-add-layer" style="font-size:11px;padding:4px 10px;flex:0 0 auto;display:flex;align-items:center">${i18n.t('layer.addLayer')}</button>
        <div class="editor-delete-zone" id="layer-row-delete-zone"
             style="flex:1;display:flex;align-items:center;justify-content:center;padding:0 10px;border:2px dashed var(--danger);border-radius:var(--radius);text-align:center;color:var(--danger);font-size:11px;opacity:0.4;transition:all 0.2s">
          ${i18n.t('layer.dragToDelete')}
        </div>
      </div>
      ${rows ? `
      <div class="files-table-body-scroll" id="layer-rows-scroll" style="max-height:300px;overflow-y:auto">
        <div class="files-body-table"><div class="table-wrap">
          <div class="op-grid op-grid--layersub">
            <div class="op-row op-row--head">
              <div class="op-cell op-cell--head" data-col="file">${i18n.t('tint.colSource')}</div>
              <div class="op-cell op-cell--head" data-col="mode">${i18n.t('tint.colMode')}</div>
              <div class="op-cell op-cell--head" data-col="exact" title="${escapeHtml(i18n.t('tint.colExactTitle'))}">${i18n.t('tint.colExact')}</div>
              <div class="op-cell op-cell--head" data-col="props" style="padding-left:4px;padding-right:4px"></div>
            </div>
            ${rows}
          </div>
        </div></div>
      </div>` : ''}`;
  }

  // Blend-mode options. Layers reuse tint's mode names (tint.mode_*) + 'normal'.
  const BLEND_MODES = [
    ['normal'],
    ['darken', 'multiply'],
    ['lighten', 'screen'],
    ['overlay', 'soft-light', 'hard-light'],
    ['difference', 'exclusion'],
    ['hue', 'saturation', 'color', 'luminosity'],
  ];
  function blendOpts(curMode) {
    return BLEND_MODES.map(group =>
      group.map(m => `<option value="${m}" ${m === curMode ? 'selected' : ''}>${i18n.t('tint.mode_' + m)}</option>`).join('')
    ).join('');
  }

  // Shared thumbnail loader (OpTable.createThumbLoader): same cache + async invariant as
  // tint/file-copy, so same-source previews can't be lost.
  const thumbLoader = OpTable.createThumbLoader({
    cache: thumbCache,
    isImage: (raw) => isImagePath(raw),
    skinPath: () => skinPath(),
    imgHtml: (dataUrl) => `<img src="${dataUrl}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0">`,
    placeholderHtml: () => `<span class="file-thumb__icon">📄</span>`,
  });
  function thumbHtmlFor(src, label) {
    return thumbLoader.htmlFor(src, label != null ? label : pathBasename(src));
  }

  // ── Detail refresh ──
  function refreshDetailAndList(recompute) {
    // Rebuild the whole detail pane when the selection-presence flips (selected
    // → empty-hint or vice versa), since the two states are different DOM.
    const detail = container.querySelector('.tint-detail');
    const previewExists = !!container.querySelector('#layer-preview');
    if (detail && previewExists !== hasSelection()) {
      detail.innerHTML = hasSelection()
        ? `<div class="tint-preview" id="layer-preview"></div>
           <div class="tint-stages" id="layer-stages">${renderStackDetail()}</div>`
        : `<div class="tint-empty-hint tint-preview--fade">
             <div>${i18n.t('layer.hintSelect')}</div>
           </div>`;
    } else {
      const stages = container.querySelector('#layer-stages');
      if (stages) stages.innerHTML = renderStackDetail();
    }
    if (opSel) opSel.highlightAll();
    bindStageHandlers();
    loadThumbnails();
    if (recompute) recomputePreview(true);
  }

  // ── Handlers ──
  function bindHandlers() {
    const btnAdd = container.querySelector('#btn-add-layer-stack');
    if (btnAdd) btnAdd.addEventListener('click', async () => {
      if (!skinName()) { Toast.warning(i18n.t('file.selectSkinFirst')); return; }
      const stacks = cur();
      stacks.push(defaultStack());
      applyLayersData(stacks);
      render(container);
      opSel.setSelected(new Set([stacks.length - 1]), stacks.length - 1);
      refreshDetailAndList(true); // render used the OLD selection state; rebuild detail for the new one
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });

    container.querySelectorAll('.layerop-row').forEach(row => opSel.bindRow(row));
    opSel.bindDeleteZone(container.querySelector('#layer-delete-zone'));

    // Stack destination input.
    container.querySelectorAll('.layer-dest').forEach(input => {
      input.addEventListener('change', async () => {
        if (window.InputConfirm && window.InputConfirm.wasEscCancel(input)) return;
        const idx = parseInt(input.dataset.idx, 10);
        const arr = cur();
        if (!arr[idx]) return;
        let val = input.value.trim().replace(/^["']|["']$/g, '');
        // If absolute path (any drive letter + :\ or /), convert to skin-relative.
        // Mirrors file-copy/tint: strip the skin root, warn + clear if outside.
        if (/^[a-zA-Z]:[\\/]?/.test(val)) {
          const sp = await skinPath();
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
          val = val.replace(/\\/g, '/');
          val = OpTable.appendSrcExt(val);
          input.value = val;
          arr[idx] = { ...arr[idx], destination: val };
          applyLayersData(arr);
          return;
        }
        // Already relative: normalize separators + strip suffix.
        val = val.replace(/\\/g, '/');
        val = OpTable.appendSrcExt(val);
        if (val !== input.value) input.value = val;
        arr[idx] = { ...arr[idx], destination: val };
        applyLayersData(arr);
      });
    });

    // canvasMode toggle (per operation row): off = bottom canvas, on = max canvas.
    container.querySelectorAll('.layer-canvas-mode').forEach(cb => {
      if (cb.dataset.idx == null) return; // skip any non-row instance
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.idx, 10);
        const arr = cur();
        if (!arr[idx]) return;
        arr[idx] = { ...arr[idx], canvasMode: cb.checked ? 'max' : 'bottom' };
        applyLayersData(arr);
        if (idx === selectedIdx()) schedulePreview();
      });
    });

    // Divider drag → resize split.
    const divider = container.querySelector('#layer-divider');
    if (divider) {
      const ops = container.querySelector('.tint-ops');
      divider.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const splitEl = container.querySelector('.tint-split');
        const rect = splitEl.getBoundingClientRect();
        const startFrac = splitFraction;
        const startX = e.clientX;
        const onMove = (ev) => {
          const frac = Math.max(0.4, Math.min(0.6, startFrac + (ev.clientX - startX) / rect.width));
          splitFraction = frac;
          ops.style.flex = `0 0 ${(frac * 100).toFixed(1)}%`;
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    bindStageHandlers();
  }

  function bindStageHandlers() {
    const stages = container.querySelector('#layer-stages');
    if (!stages) return;

    // Add a layer to the selected stack (pick a source PNG).
    const btnAddLayer = stages.querySelector('#btn-add-layer');
    if (btnAddLayer) btnAddLayer.addEventListener('click', async () => {
      if (!skinName()) { Toast.warning(i18n.t('file.selectSkinFirst')); return; }
      if (fileDialogOpen) return;
      try {
        fileDialogOpen = true;
        const defaultPath = await skinPath() || '';
        const result = await api.selectFile([{ name: 'PNG', extensions: ['png'] }], defaultPath);
        if (!result.success || !result.data || !result.data.length) return;
        const skPath = await skinPath();
        const idx = selectedIdx();
        const arr = cur();
        const stack = arr[idx];
        if (!stack) return;
        stack.layers = stack.layers || [];
        for (const absPath of result.data) {
          let relPath = '';
          if (skPath && absPath.toLowerCase().startsWith(skPath.toLowerCase())) {
            relPath = absPath.slice(skPath.length).replace(/^[/\\]/, '');
          }
          if (!relPath) { Toast.warning(i18n.t('file.outsideSkin')); continue; }
          stack.layers.unshift(defaultLayer(relPath));
        }
        applyLayersData(arr);
        render(container);
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      } finally { fileDialogOpen = false; }
    });

    // Inner OpTable for the layer sub-list: drag-to-reorder (z-order) +
    // drag-to-delete, same mechanics as the outer operation list. Created fresh
    // each render (it scopes to the selected stack's rows).
    const rowsScroll = stages.querySelector('#layer-rows-scroll');
    if (rowsScroll && (sel() || {}).layers) {
      layerSel = OpTable.create({
        container: rowsScroll,
        rowSelector: '.layer-row',
        // img/.file-thumb__icon stay in the selector: clicking a layer thumbnail
        // re-sources that layer (bound separately below), it must NOT select the
        // row — same arrangement as tint/file-copy.
        interactiveSelector: 'input, select, textarea, button, label, .toggle, .toggle__slider, .file-thumb__icon, img',
        deleteMimeType: 'application/layer-z',
        rowMembers: (row) => { const ri = parseInt(row.dataset.idx, 10); return isNaN(ri) ? [] : [ri]; },
        rowAnchor: (row) => { const ri = parseInt(row.dataset.idx, 10); return isNaN(ri) ? -1 : ri; },
        applyDelete: (desc) => {
          const arr = cur();
          const stack = arr[selectedIdx()];
          if (!stack || !stack.layers) return;
          for (const i of desc) stack.layers.splice(i, 1);
          applyLayersData(arr);
          render(container);
        },
        reorder: (fromVis, toVis) => reorderLayers(fromVis, toVis),
      });
      rowsScroll.querySelectorAll('.layer-row').forEach(r => layerSel.bindRow(r));
      layerSel.bindDeleteZone(stages.querySelector('#layer-row-delete-zone'));
    }

    // Click a layer's thumbnail to re-source it (swap that layer's source PNG),
    // same interaction as tint/file-copy. Only a click on the image/icon starts
    // a re-source — the label/whitespace still selects the row. img/.file-thumb__icon
    // are in layerSel's interactiveSelector so the row click is suppressed here.
    stages.querySelectorAll('.layer-thumb').forEach(thumb => {
      thumb.addEventListener('click', async (e) => {
        if (!e.target.matches('img, .file-thumb__icon')) return;
        if (!skinName()) { Toast.warning(i18n.t('file.selectSkinFirst')); return; }
        if (fileDialogOpen) return;
        const row = thumb.closest('.layer-row');
        const k = row ? parseInt(row.dataset.idx, 10) : NaN;
        if (isNaN(k)) return;
        try {
          fileDialogOpen = true;
          const arr = cur();
          const stack = arr[selectedIdx()];
          if (!stack || !stack.layers || !stack.layers[k]) return;
          const oldSrc = stack.layers[k].source;
          // SourcePicker opens the dialog in the CURRENT layer source's folder
          // (not always the skin root) and returns skin-relative paths with the
          // outside-skin guard built in — same path tint/file-copy use.
          const picked = await window.SourcePicker.pickMulti({
            getSkinPath: () => skinPath(),
            currentSource: oldSrc,
          });
          if (!picked.length) return;
          const relPath = picked[0];
          stack.layers[k] = { ...stack.layers[k], source: relPath };
          applyLayersData(arr);
          // Drop cached preview state for the old source so the preview reloads.
          if (oldSrc !== relPath) sourceImgCache.delete(oldSrc);
          thumbCache.delete(oldSrc);
          render(container);
        } finally { fileDialogOpen = false; }
      });
    });

    // Per-layer blend mode (inline dropdown — enhanced below).
    stages.querySelectorAll('.layer-blend').forEach(selEl => {
      const groups = BLEND_MODES.map(modes => modes.map(m => [m, i18n.t('tint.mode_' + m)]));
      window.Dropdown.enhance(selEl, { groups, wheelInline: !selEl.disabled });
      selEl.addEventListener('change', () => {
        patchLayer(parseInt(selEl.dataset.idx, 10), { blendMode: selEl.value });
      });
    });

    // Per-layer exact toggle.
    stages.querySelectorAll('.layer-exact').forEach(cb => {
      cb.addEventListener('change', () => patchLayer(parseInt(cb.dataset.idx, 10), { exact: cb.checked }));
    });

    // Per-layer properties flyout (opacity / 9-grid / offset).
    stages.querySelectorAll('.layer-flyout-btn').forEach(btn => {
      btn.addEventListener('click', () => openLayerFlyout(parseInt(btn.dataset.idx, 10), btn));
    });

  }

  // ── Layer properties flyout (opacity / 9-grid / offset) ──
  // A small popover anchored to the ☰ button, like the color picker. Writes go
  // straight to the layer via patchLayer (live preview). Closes on outside click / Esc / Enter.
  function openLayerFlyout(layerIdx, btn) {
    // Toggle: if this same button's flyout is already open, just close it.
    if (_layerFlyoutClose && _layerFlyoutBtn === btn) { closeLayerFlyout(); return; }
    closeLayerFlyout();
    _layerFlyoutBtn = btn;
    btn.classList.add('layer-flyout-btn--open');
    const stack = sel();
    const layer = stack && stack.layers && stack.layers[layerIdx];
    if (!layer) return;
    const pop = document.createElement('div');
    pop.className = 'cp-popover layer-flyout';
    pop.tabIndex = -1;
    const imgEl = sourceImgCache.get(layer.source);
    const lw = (imgEl && imgEl.naturalWidth) || 0, lh = (imgEl && imgEl.naturalHeight) || 0;
    // 9-grid alignment glyphs as inline SVG paths (corners = L-shape, edges = T,
    // center = cross). Each viewBox 0..10; the path strokes the sides the layer
    // hugs at that alignment.
    const alignSvg = {
      'top-left':     '<path d="M9 1H1V9"/>',
      'top':          '<path d="M1 1H9M5 1V9"/>',
      'top-right':    '<path d="M1 1H9V9"/>',
      'left':         '<path d="M1 1V9M1 5H9"/>',
      'center':       '<path d="M1 5H9M5 1V9"/>',
      'right':        '<path d="M9 1V9M9 5H1"/>',
      'bottom-left':  '<path d="M1 9V1M1 9H9"/>',
      'bottom':       '<path d="M1 9H9M5 9V1"/>',
      'bottom-right': '<path d="M9 9V1M9 9H1"/>',
    };
    const alignOrder = ['top-left','top','top-right','left','center','right','bottom-left','bottom','bottom-right'];
    pop.innerHTML = `
      <div class="layer-flyout__cols">
        <div class="layer-9grid">
          ${alignOrder.map(a => `<button type="button" class="layer-9grid__cell" data-align="${a}"><svg viewBox="0 0 10 10" width="16" height="16">${alignSvg[a]}</svg></button>`).join('')}
        </div>
        <div class="layer-flyout__fields">
          <div class="layer-flyout__row">
            <span class="stage__field-label">${escapeHtml(i18n.t('layer.posX'))}</span>
            <input type="number" class="form-input cp-num-input layer-fp-ox" step="any" value="${+layer.offsetX || 0}">
          </div>
          <div class="layer-flyout__row">
            <span class="stage__field-label">${escapeHtml(i18n.t('layer.posY'))}</span>
            <input type="number" class="form-input cp-num-input layer-fp-oy" step="any" value="${+layer.offsetY || 0}">
          </div>
          <div class="layer-flyout__row">
            <span class="stage__field-label">${escapeHtml(i18n.t('layer.opacity'))}</span>
            <input type="number" class="form-input cp-num-input layer-fp-opacity" min="0" max="100" step="1" value="${+layer.opacity || 100}">
          </div>
        </div>
      </div>`;
    document.body.appendChild(pop);

    const opacityIn = pop.querySelector('.layer-fp-opacity');
    const oxIn = pop.querySelector('.layer-fp-ox');
    const oyIn = pop.querySelector('.layer-fp-oy');
    const numCommit = (el, key, clampLo, clampHi) => {
      let v = parseFloat(el.value);
      if (isNaN(v)) v = 0;
      v = Math.round(v * 100) / 100; // format to 2 decimals on commit
      if (clampLo != null) v = Math.max(clampLo, v);
      if (clampHi != null) v = Math.min(clampHi, v);
      el.value = v;
      patchLayer(layerIdx, { [key]: v });
      schedulePreview(true);
    };
    opacityIn.addEventListener('change', () => numCommit(opacityIn, 'opacity', 0, 100));
    oxIn.addEventListener('change', () => numCommit(oxIn, 'offsetX'));
    oyIn.addEventListener('change', () => numCommit(oyIn, 'offsetY'));
    // Wheel adjusts the value (like tint's bindNumber). Focus first so the
    // wheel targets the right input.
    const wheelAdjust = (el, key, step, clampLo, clampHi) => {
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s = e.shiftKey ? step * 10 : step;
        const dir = e.deltaY < 0 ? 1 : -1;
        let v = parseFloat(el.value) || 0;
        v = Math.round((v + s * dir) * 100) / 100;
        if (clampLo != null) v = Math.max(clampLo, v);
        if (clampHi != null) v = Math.min(clampHi, v);
        el.value = v;
        numCommit(el, key, clampLo, clampHi);
      }, true);
    };
    wheelAdjust(opacityIn, 'opacity', 1, 0, 100);
    wheelAdjust(oxIn, 'offsetX', 1);
    wheelAdjust(oyIn, 'offsetY', 1);

    // 9-grid: compute offset from the canvas size (per current canvasMode) and the
    // layer's own size, then write offsetX/offsetY.
    pop.querySelectorAll('.layer-9grid__cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const { cw, ch } = canvasSizeFor(stack);
        const a = cell.dataset.align;
        const h = a.includes('left') ? 0 : a.includes('right') ? (cw - lw) : (cw - lw) / 2;
        const v = a.includes('top') ? 0 : a.includes('bottom') ? (ch - lh) : (ch - lh) / 2;
        patchLayer(layerIdx, { offsetX: h, offsetY: v });
        oxIn.value = Math.round(h * 100) / 100;
        oyIn.value = Math.round(v * 100) / 100;
        schedulePreview();
      });
    });

    positionFlyout(pop, btn);
    pop.focus();

    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { closeLayerFlyout(); return; }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLayerFlyout(); }
      else if (e.key === 'Enter') {
        // Enter commits the focused input (blur) or closes if none focused.
        const ae = document.activeElement;
        if (ae && ae.tagName === 'INPUT' && pop.contains(ae)) { ae.blur(); }
        else { e.preventDefault(); closeLayerFlyout(); }
      }
      // All other keys (digits, backspace, etc.) pass through to the inputs.
    };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => {
      document.addEventListener('mousedown', function onOut(ev) {
        if (!pop.contains(ev.target) && ev.target !== btn) { closeLayerFlyout(); document.removeEventListener('mousedown', onOut); }
      });
    }, 0);
    _layerFlyoutClose = () => {
      pop.remove();
      document.removeEventListener('keydown', onKey, true);
      if (_layerFlyoutBtn) _layerFlyoutBtn.classList.remove('layer-flyout-btn--open');
      _layerFlyoutClose = null;
      _layerFlyoutBtn = null;
    };
  }
  function closeLayerFlyout() { if (_layerFlyoutClose) _layerFlyoutClose(); }
  let _layerFlyoutClose = null;
  let _layerFlyoutBtn = null;

  function positionFlyout(pop, btn) {
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const left = r.left - pw - 6;
    let top = r.top;
    if (top + ph > window.innerHeight - 20) top = window.innerHeight - ph - 20;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }
  // Canvas size per the stack's canvasMode. 'bottom' uses the LOWEST layer
  // (layers[N-1], the last in the array); 'max' uses max w/h across all layers.
  function canvasSizeFor(stack) {
    const sizes = (stack.layers || []).map(l => {
      const im = sourceImgCache.get(l.source);
      return im ? [im.naturalWidth, im.naturalHeight] : [0, 0];
    });
    if (stack.canvasMode === 'max') {
      return { cw: Math.max(1, ...sizes.map(s => s[0])), ch: Math.max(1, ...sizes.map(s => s[1])) };
    }
    const bot = sizes[sizes.length - 1] || [1, 1];
    return { cw: bot[0] || 1, ch: bot[1] || 1 };
  }

  // Reorder layers within the selected stack. OpTable's reorder reports TRUE
  // array indices (rowAnchor returns dataset.idx directly), so we pass them
  // straight to reorderArray — no visual↔array conversion needed despite the
  // reversed render. The "insert before/after" (upper/lower half) is computed
  // by OpTable from the drop position and is correct as-is.
  function reorderLayers(fromArr, toArr) {
    const arr = cur();
    const stack = arr[selectedIdx()];
    if (!stack || !stack.layers) return;
    const { arr: newLayers, insertAt, count } = OpTable.reorderArray(stack.layers, fromArr, toArr);
    arr[selectedIdx()] = { ...stack, layers: newLayers };
    applyLayersData(arr);
    render(container);
  }

  function patchLayer(layerIdx, partial) {
    const arr = cur();
    const stack = arr[selectedIdx()];
    if (!stack || !stack.layers || !stack.layers[layerIdx]) return;
    stack.layers[layerIdx] = { ...stack.layers[layerIdx], ...partial };
    applyLayersData(arr);
    schedulePreview();
  }


  function applyDeleteOps(indicesDesc) {
    const arr = cur();
    for (const i of indicesDesc) if (i >= 0 && i < arr.length) arr.splice(i, 1);
    applyLayersData(arr);
    render(document.getElementById('tab-layer'));
    const len = arr.length;
    const anchor = opSel ? opSel.getAnchor() : 0;
    const a2 = len ? Math.min(anchor, len - 1) : 0;
    opSel.setSelected(len ? new Set([a2]) : new Set(), a2);
  }
  function applyReorderOps(fromIndices, toIndex) {
    const { arr, insertAt, count } = OpTable.reorderArray(cur(), fromIndices, toIndex);
    applyLayersData(arr);
    render(document.getElementById('tab-layer'));
    const sel = new Set();
    for (let i = 0; i < count; i++) sel.add(insertAt + i);
    opSel.setSelected(sel, insertAt);
  }

  async function getSourceImg(src) {
    if (sourceImgCache.has(src)) return sourceImgCache.get(src);
    const sk = skinName();
    if (!sk) return null;
    const skPath = await skinPath();
    const norm = skPath ? skPath.replace(/\\/g, '/').replace(/\/$/, '') : '';
    let p = src;
    const isAbs = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');
    if (!isAbs && norm) p = norm + '/' + p.replace(/\\/g, '/');
    const result = await api.getPreviewDataUrl(p);
    if (!result || !result.success || !result.data) return null;
    const img = new Image();
    img.src = result.data;
    await new Promise(res => { img.onload = res; img.onerror = res; });
    if (!img.naturalWidth) return null;
    sourceImgCache.set(src, img);
    return img;
  }

  // ── Composite preview (canvas2D) ──
  function compositeCanvas(canvas, stack, imgs) {
    // Determine canvas size.
    const sizes = imgs.map(im => im ? [im.naturalWidth, im.naturalHeight] : [0, 0]);
    let cw, ch;
    if (stack.canvasMode === 'max') {
      cw = Math.max(1, ...sizes.map(s => s[0]));
      ch = Math.max(1, ...sizes.map(s => s[1]));
    } else {
      // bottom: the canvas matches the LOWEST layer (layers[N-1]). If that layer's
      // source is missing, walk UP the stack to the first layer that has a real
      // image and use its size — so a missing base never collapses the canvas to
      // 1×1 (which loses the whole preview). Falls back to 1×1 only if every layer is gone.
      let base = null;
      for (let k = sizes.length - 1; k >= 0; k--) {
        if (sizes[k][0] && sizes[k][1]) { base = sizes[k]; break; }
      }
      cw = base ? base[0] : 1;
      ch = base ? base[1] : 1;
    }
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    // Over-composite layers bottom→top: layers[N-1] (list bottom = lowest) is
    // drawn first, layers[0] (list top = highest) last, so layers[0] ends up on
    // top — matching the visual list order.
    const layers = stack.layers || [];
    for (let k = layers.length - 1; k >= 0; k--) {
      const im = imgs[k];
      if (!im) continue;
      const l = layers[k];
      ctx.globalAlpha = Math.max(0, Math.min(1, (+l.opacity || 100) / 100));
      ctx.globalCompositeOperation = blendToComposite(l.blendMode || 'normal');
      ctx.drawImage(im, +l.offsetX || 0, +l.offsetY || 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  // PS blend name → canvas2D globalCompositeOperation.
  function blendToComposite(mode) {
    const map = {
      normal: 'source-over',
      multiply: 'multiply', screen: 'screen', overlay: 'overlay',
      'soft-light': 'soft-light', 'hard-light': 'hard-light',
      darken: 'darken', lighten: 'lighten', difference: 'difference', exclusion: 'exclusion',
      hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'lightness',
    };
    return map[mode] || 'source-over';
  }

  async function recomputePreview(fadeOnChange) {
    const previewEl = container && container.querySelector('#layer-preview');
    if (!previewEl) return; // no selection → detail shows empty-hint, no preview element
    const stack = sel();
    const multi = opSel && opSel.getSelected().size > 1;
    if (multi) { previewEl.innerHTML = `<div class="tint-preview__empty">${i18n.t('layer.multiSelectHint')}</div>`; return; }
    if (!stack || !stack.layers || !stack.layers.length) {
      previewEl.innerHTML = `<div class="tint-preview__empty">${i18n.t('layer.noLayers')}</div>`;
      return;
    }
    try {
      const imgs = await Promise.all((stack.layers || []).map(l => getSourceImg(l.source)));
      // Every layer's source missing → show the file-missing hint (mirrors tint's
      // single-source previewMissing). A partial miss is fine: compositeCanvas
      // just skips the null layers.
      if (imgs.every(im => !im)) {
        previewEl.innerHTML = `<div class="tint-preview__empty">${i18n.t('edit.previewMissing')}</div>`;
        return;
      }
      // Composite into a fresh canvas at natural resolution, then hand it to the
      // ImageViewer (pan/zoom/double-click-fit). The viewer owns placement; the
      // fade effect still drives off #layer-preview.
      const canvas = document.createElement('canvas');
      compositeCanvas(canvas, stack, imgs);
      window.ImageViewer.mount(previewEl, canvas);
      if (fadeOnChange) {
        previewEl.classList.remove(FADE);
        void previewEl.offsetWidth;
        previewEl.classList.add(FADE);
      }
    } catch (_) { /* ignore */ }
  }

  function schedulePreview(live) {
    if (live) {
      if (liveFrame) return;
      liveFrame = requestAnimationFrame(() => { liveFrame = 0; recomputePreview(false); });
    } else {
      clearTimeout(previewDebounce);
      previewDebounce = setTimeout(() => recomputePreview(false), 60);
    }
  }

  async function loadThumbnails() {
    await thumbLoader.load(() => container);
  }

  // ── Defaults ──
  function defaultStack() {
    return { destination: '', canvasMode: 'bottom', layers: [] };
  }
  function defaultLayer(src) {
    return { source: src, exact: false, blendMode: 'normal', opacity: 100, offsetX: 0, offsetY: 0 };
  }

  function layoutColumns() { /* canvas scaling; no-op */ }

  // Return the currently-selected layer stacks as plain objects (deep-cloned).
  // Empty set falls back to the anchor row.
  function getSelectedActions() {
    const set = opSel ? opSel.getSelected() : new Set();
    const stacks = cur();
    const idxs = set.size > 0 ? [...set] : (opSel && opSel.getAnchor() >= 0 ? [opSel.getAnchor()] : []);
    if (idxs.length === 0 || stacks.length === 0) return [];
    const out = [];
    for (const i of idxs.sort((a, b) => a - b)) {
      if (i >= 0 && i < stacks.length) {
        const s = stacks[i];
        out.push({
          destination: s.destination || '', canvasMode: s.canvasMode === 'max' ? 'max' : 'bottom',
          layers: (s.layers || []).map(l => ({
            source: l.source || '', exact: !!l.exact, blendMode: l.blendMode || 'normal',
            opacity: +l.opacity || 100, offsetX: +l.offsetX || 0, offsetY: +l.offsetY || 0,
          })),
        });
      }
    }
    return JSON.parse(JSON.stringify(out));
  }

  function selectAdded({ idx }) {
    if (!opSel) return;
    const arr = cur();
    const ns = new Set();
    let anchor = -1;
    for (const i of (idx || [])) { if (i >= 0 && i < arr.length) { ns.add(i); if (anchor < 0) anchor = i; } }
    if (anchor < 0) return;
    opSel.setSelected(ns, anchor);
  }

  async function deleteSelected() {
    const set = opSel ? opSel.getSelected() : new Set();
    const targetIdx = set.size > 0 ? [...set] : (opSel && opSel.getAnchor() >= 0 ? [opSel.getAnchor()] : []);
    if (targetIdx.length === 0) return;
    const sorted = [...new Set(targetIdx)].sort((a, b) => b - a);
    const confirmed = await ApplyDialog.showConfirmDialog(
      i18n.t('layer.deleteStacksConfirm', { n: sorted.length }),
      [
        { label: `${i18n.t('layer.deleteBtn').replace(/^- ?/, '')} (${sorted.length})`, cls: 'btn--danger', value: 'delete' },
        { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
      ]
    );
    if (!confirmed || confirmed !== 'delete') return;
    applyDeleteOps(sorted);
    Toast.info(i18n.t('layer.deleted', { n: sorted.length }));
  }

  window.LayerEditor = {
    init, render, layoutColumns, deleteSelected, getSelectedActions, selectAdded,
    hasSelection: () => !!(layerSel && layerSel.getSelected().size > 0) || !!(opSel && opSel.getSelected().size > 0),
    clearSelection: () => {
      // Inner layer selection first (innermost Esc layer), then the outer op list.
      if (layerSel && layerSel.getSelected().size > 0) { layerSel.clearSelection(); return; }
      if (opSel) opSel.clearSelection();
    },
    // Clear BOTH layers at once (unlike clearSelection's Esc-style peeling).
    // Used on skin/preset switch where every stale selection must go.
    clearAllSelections: () => {
      if (layerSel) layerSel.clearSelection();
      if (opSel) opSel.clearSelection();
    },
    invalidateCache: () => { thumbCache.clear(); sourceImgCache.clear(); },
  };
})();
