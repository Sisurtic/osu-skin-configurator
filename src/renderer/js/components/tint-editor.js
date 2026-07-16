// Image editor — 图像编辑 tab.
// Left: operations list (source + destination per row, drag-to-delete).
// Right: live canvas preview of the selected row + stage controls (tint → crop → darken).
// Each stage is toggled by a clickable header (green underline when enabled).
// Preview is computed client-side on a <canvas>; apply runs the same pipeline in Rust.
// Selection + drag-to-delete is delegated to the shared OpTable module (`opSel`).
// Dual anchor: opSel.anchorIndex drives the preview; opSel.selectedIndices drives
// multi-select / batch edits (empty set = single, just the anchor).
(function () {
  let getTints, setTints, skinName, presetId, skinPath;
  let container;
  // OpTable instance — created lazily on first render (needs the container).
  let opSel = null;
  // Last anchor seen by onSelectionChange, to detect anchor moves (which alone
  // justify a preview rebuild) vs mere multi-select changes (highlight + stages only).
  let lastAnchor = 0;
  let fileDialogOpen = false;
  let splitFraction = 0.5;
  let previewDebounce = null;
  let liveFrame = 0;            // rAF id for in-flight live (color-drag) preview
  let previewFullFit = false;
  let vpActive = false;            // true while the live preview is viewport-virtualized
  let vpScrollFrame = 0;           // rAF id coalescing virtualized scroll repaints

  const IMG_EXTS = new Set(['.png']);
  const thumbCache = new Map();      // src path → dataURL (for list thumbnails)
  const sourceImgCache = new Map();  // src path → HTMLImageElement (for preview)
  const FADE = 'tint-preview--fade';
  const MODES = ['multiply', 'lightness', 'screen', 'overlay', 'replace'];
  // Above this logical output height the canvas2D backing would be too large to
  // repaint per frame (e.g. cropC=32768 → ~8M px → ~200ms/clear+drawImage). We
  // instead render only the visible viewport (sticky canvas) and keep a spacer
  // the size of the full logical output to drive the scrollbar. Below it the
  // whole canvas is small enough to render directly (no virtualization needed).
  const VIRTUALIZE_THRESHOLD = 2000;

  function isImagePath(p) { return IMG_EXTS.has((p.match(/\.[^.]+$/) || [''])[0].toLowerCase()); }
  // Whether a tint source has an @2x HD suffix (the Exact toggle only applies to these).
  function has2x(t) { return /@2x\.[^.]+$/i.test(t.source || ''); }
  function pathBasename(p) { return OpTable.pathBasename(p); }
  function escapeHtml(s) { return OpTable.escapeHtml(s); }
  function colorToCss(c) {
    const p = (c || '255,255,255,255').split(',').map(n => parseInt(n.trim(), 10));
    const r = p[0] || 0, g = p[1] || 0, b = p[2] || 0, a = (p[3] !== undefined ? p[3] : 255) / 255;
    return `rgba(${r},${g},${b},${a})`;
  }
  function blockUI() { document.body.style.cursor = 'wait'; }
  function unblockUI() { document.body.style.cursor = ''; }

  function init(getter, setter, skName, presetIdFn, skPathFn) {
    getTints = typeof getter === 'function' ? getter : () => getter;
    setTints = typeof setter === 'function' ? setter : () => {};
    skinName = typeof skName === 'function' ? skName : () => skName;
    presetId = typeof presetIdFn === 'function' ? presetIdFn : () => presetIdFn;
    skinPath = typeof skPathFn === 'function' ? skPathFn : () => skPathFn;
  }
  function applyTints(tints) { setTints(tints); }
  function cur() { const a = getTints() || []; return a; }
  // The anchor row index (drives the preview). Read from the OpTable instance
  // once it exists; clamp into range so a deleted/shortened list never indexes OOB.
  function selectedIdx() {
    const a = opSel ? opSel.getAnchor() : 0;
    const len = cur().length;
    if (a < 0 || a >= len) return Math.max(0, len - 1);
    return a;
  }
  function sel() { const a = cur(); return a[selectedIdx()] || null; }

  // ── Render ──
  function render(parent) {
    container = parent;
    const tints = cur();
    // (Re)create the OpTable instance for this container on first render.
    if (!opSel) {
      opSel = OpTable.create({
        container,
        rowSelector: '.tint-row',
        // NOTE: do NOT include `.file-thumb` (the whole container) — only the
        // icon/img are "interactive" (click-to-change-source). Including the
        // container blocks row selection when clicking the filename/whitespace,
        // which file-copy gets right. Keep this aligned with file-copy-editor.
        interactiveSelector: 'input, select, textarea, button, label, .toggle, .toggle__slider, .file-thumb__icon, img',
        deleteMimeType: 'application/tint-indices',
        selectedClass: 'tint-row--selected',
        rowMembers: (row) => {
          const ri = parseInt(row.dataset.idx, 10);
          return isNaN(ri) ? [] : [ri];
        },
        rowAnchor: (row) => {
          const ri = parseInt(row.dataset.idx, 10);
          return isNaN(ri) ? -1 : ri;
        },
        // Selection change → refresh stages + re-highlight. Only recompute the
        // (heavy) preview when the ANCHOR moved (it drives the preview); a mere
        // multi-select change (Ctrl/Shift adding rows) just re-highlights + re-
        // renders the stage panel (batch-edit targets changed), no preview rebuild.
        onSelectionChange: ({ anchor }) => {
          const moved = anchor !== lastAnchor;
          lastAnchor = anchor;
          refreshDetailAndList(moved);
        },
        applyDelete: (indicesDesc) => applyDeleteOps(indicesDesc),
        reorder: (fromIndices, toIndex) => applyReorderOps(fromIndices, toIndex),
      });
      // Default anchor = 0 (preview the first row on initial load).
      opSel.setSelected(new Set(), 0);
    } else {
      opSel.setContainer(container);
    }
    container.innerHTML = `
      <div class="tint-split">
        <div class="tint-ops" style="flex:0 0 ${(splitFraction * 100).toFixed(1)}%">
          <div class="editor-sticky-header">
            <div style="padding-bottom:10px;border-bottom:1px solid var(--border)">
              <div style="margin-bottom:8px">
                <h3 style="margin-bottom:4px">${i18n.t('tint.heading')}</h3>
                <p style="font-size:12px;color:var(--text-muted)">${i18n.t('tint.desc')}</p>
              </div>
              <div style="margin:2px 0 8px">
                <button class="btn btn--primary btn--sm" id="btn-add-tint-image" style="font-size:11px;padding:4px 6px">${i18n.t('tint.addImage')}</button>
              </div>
              <div class="editor-delete-zone" id="tint-delete-zone"
                   style="margin-top:4px;padding:8px;border:2px dashed var(--danger);border-radius:var(--radius);text-align:center;color:var(--danger);font-size:12px;opacity:0.5;transition:all 0.2s">
                ${i18n.t('tint.deleteZone')}
              </div>
            </div>
            ${tints.length > 0 ? `
            <div class="files-header-table" style="margin-top:6px">
              <div class="table-wrap">
                <table class="table ini-table tint-table">
                  <colgroup><col><col><col style="width:80px"></colgroup>
                  <thead><tr>
                    <th>${i18n.t('tint.colSource')}</th>
                    <th title="${escapeHtml(i18n.t('tint.colDestTitle'))}">${i18n.t('tint.colDest')}</th>
                    <th title="${escapeHtml(i18n.t('tint.colExactTitle'))}">${i18n.t('tint.colExact')}</th>
                  </tr></thead>
                </table>
              </div>
            </div>` : ''}
          </div>
          <div class="files-table-body-scroll" id="tint-table-body-scroll">${renderList(tints)}</div>
        </div>
        <div class="tint-divider" id="tint-divider"></div>
        <div class="tint-detail" style="flex:1 1 0">
          ${sel()
            ? `<div class="tint-preview" id="tint-preview"><div class="tint-preview__empty">${i18n.t('edit.previewEmpty')}</div></div>
               <div class="tint-stages" id="tint-stages">${renderStages()}</div>`
            : `<div class="tint-empty-hint tint-preview--fade">
                 <div>${i18n.t('edit.hintAddSelect')}</div>
                 <div>${i18n.t('edit.hintApply')}</div>
               </div>`}
        </div>
      </div>
    `;
    bindHandlers();
    loadThumbnails();
    requestAnimationFrame(() => { recomputePreview(true); });
  }

  function renderList(tints) {
    if (tints.length === 0) {
      return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">${i18n.t('tint.empty')}</div>`;
    }
    return `
      <div class="files-body-table"><div class="table-wrap">
        <table class="table ini-table tint-table tint-body-table">
          <colgroup><col><col><col style="width:80px"></colgroup>
          <tbody>${tints.map((t, i) => renderRow(t, i)).join('')}</tbody>
        </table>
      </div></div>`;
  }

  function renderRow(t, idx) {
    const src = t.source || '';
    // Initial paint: match OpTable's highlight rule (in-set, or anchor when empty).
    // OpTable.highlightAll() reconciles this after rows are bound.
    const set = opSel ? opSel.getSelected() : new Set();
    const anchor = opSel ? opSel.getAnchor() : 0;
    const isSel = set.has(idx) || (set.size === 0 && idx === anchor);
    const selCls = isSel ? ' tint-row--selected' : '';
    // Exact toggle only applies to @2x sources (fallback to the non-HD variant
    // when the @2x file is missing and Exact is off) — mirrors file-copy.
    // Exact toggle only applies to @2x sources (fallback to the non-HD variant
    // when the @2x file is missing and Exact is off) — mirrors file-copy.
    // Non-@2x sources render a dimmed, disabled, unchecked toggle (not an empty cell).
    const is2x = has2x(t);
    const exactCell = `<td><label class="toggle${is2x ? '' : ' is-disabled'}">
        <input type="checkbox" class="tint-exact-toggle" data-idx="${idx}" ${(is2x && t.exact) ? 'checked' : ''}${is2x ? '' : ' disabled'}>
        <span class="toggle__slider"></span>
      </label></td>`;
    return `<tr class="tint-row${selCls}" data-idx="${idx}">
      <td><span class="file-thumb" data-path="${escapeHtml(src)}" style="display:inline-flex;align-items:center;gap:6px">${thumbHtmlFor(src)}</span></td>
      <td><input type="text" class="form-input tint-dest" data-idx="${idx}" value="${escapeHtml(t.destination || '')}" autocomplete="off" spellcheck="false" placeholder="${i18n.t('tint.destPlaceholder')}"></td>
      ${exactCell}
    </tr>`;
  }

  // Shared thumbnail loader (OpTable.createThumbLoader): owns the cache + the
  // synchronous htmlFor + the async load invariant (DOM-state skip + cache
  // rehydrate), shared with file-copy so same-source previews can't be lost.
  const thumbLoader = OpTable.createThumbLoader({
    cache: thumbCache,
    isImage: (raw) => isImagePath(raw),
    skinPath: () => skinPath(),
    imgHtml: (dataUrl) => `<img src="${dataUrl}" title="${i18n.t('file.clickToChange')}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0">`,
    placeholderHtml: () => `<span class="file-thumb__icon" title="${i18n.t('file.clickToChange')}">📄</span>`,
  });

  function thumbHtmlFor(src) {
    return thumbLoader.htmlFor(src, pathBasename(src));
  }

  // ── Stage controls (right panel, under preview; no fade) ──
  // field() returns a label+input row aligned in a 2-col grid for vertical alignment.
  function field(label, inner, hint) {
    const hintAttr = hint ? ` title="${escapeHtml(hint)}"` : '';
    return `<div class="stage__field"${hintAttr}><span class="stage__field-label">${escapeHtml(label)}</span><span class="stage__field-input">${inner}</span></div>`;
  }
  // Darkening is a derived sub-state of the crop stage: active only when crop is
  // enabled AND both darkenD and darkenOpacity are > 0.
  function isDarkening(t) {
    return !!t.cropEnabled && (+t.darkenOpacity || 0) > 0;
  }
  function renderStages() {
    const t = sel();
    if (!t) return '';
    const tintOn = !!t.tintEnabled;
    const cropOn = !!t.cropEnabled;
    const dis = (on) => on ? '' : 'disabled';
    const modeOpts = MODES.map(m => `<option value="${m}" ${t.mode === m ? 'selected' : ''}>${i18n.t('tint.mode_' + m)}</option>`).join('');
    const tileDown = t.cropTileDir !== 'up'; // default: tile downward
    const tileDirIcon = tileDown ? '▼' : '▲';
    const tileDirTitle = tileDown ? i18n.t('edit.tileDownHint') : i18n.t('edit.tileUpHint');
    const tileDirCls = t.cropTile ? ' crop-tile-dir--on' : '';
    return `
      ${stageBlock('tint', tintOn, i18n.t('edit.stageTint'), `
        <div class="stage__field" style="flex:1 1 100%">
          <span class="stage__field-input" style="display:flex;align-items:center;gap:8px">
            <button type="button" class="tint-color-swatch"${dis(tintOn)} style="width:24px;height:24px;border-radius:4px;border:1px solid var(--border);background:${colorToCss(t.color)};flex:0 0 auto"></button>
            <select class="form-input tint-mode"${dis(tintOn)} style="flex:1;min-width:0">${modeOpts}</select>
          </span>
        </div>`)}
      ${stageBlock('percy', cropOn, i18n.t('edit.stagePercy'), `
        ${field(i18n.t('edit.cropA') + ' (px)', `<input type="number" min="0" step="1" class="form-input crop-a"${dis(cropOn)} value="${t.cropA || 0}">`, i18n.t('edit.cropAHint'))}
        ${field(i18n.t('edit.cropB') + ' (px)', `<input type="number" min="0" step="1" class="form-input crop-b"${dis(cropOn)} value="${t.cropB || 0}">`)}
        ${field(i18n.t('edit.cropC') + ' (px)', `<input type="number" min="0" step="1" class="form-input crop-c"${dis(cropOn)} value="${t.cropC || 32768}">`)}
        ${field(i18n.t('edit.cropTile'), `<div style="display:flex;align-items:center;gap:6px;width:100%;min-height:32px"><label class="toggle crop-tile-toggle${cropOn ? '' : ' is-disabled'}"><input type="checkbox" class="crop-tile"${dis(cropOn)} ${t.cropTile ? 'checked' : ''}><span class="toggle__slider"></span></label><button type="button" class="crop-tile-dir${tileDirCls}"${dis(cropOn)} title="${escapeHtml(tileDirTitle)}">${tileDirIcon}</button></div>`)}
        <div class="stage__sep"></div>
        ${field(i18n.t('edit.darkenD') + ' (px)', `<input type="number" min="0" step="1" class="form-input darken-d"${dis(cropOn)} value="${t.darkenD || 0}">`)}
        ${field(i18n.t('edit.darkenOpacity') + ' (%)', `<input type="number" min="0" max="100" step="1" class="form-input darken-opacity"${dis(cropOn)} value="${t.darkenOpacity || 0}">`)}
      `)}`;
  }

  function stageBlock(name, enabled, label, inner) {
    return `<div class="stage${enabled ? ' stage--active' : ''}" data-stage="${name}">
      <div class="stage__toggle">${escapeHtml(label)}</div>
      <div class="stage__body">${inner}</div>
    </div>`;
  }

  // ── Canvas preview pipeline ──
  // Apply the current fit mode (width-fit default, full-fit after dblclick) to a preview canvas.
  function applyPreviewFit(canvasEl, previewEl) {
    // Virtualized previews own their own canvas layout (sticky + spacer); a fit
    // toggle / resize just needs a re-layout + repaint, not max-dimension tweaks.
    if (vpActive && repaintVirtual(previewEl)) return;
    // The GL renderer sets canvas.style.width (real logical px) + aspect-ratio;
    // here we only constrain max dimensions and scrolling behavior.
    if (previewFullFit) {
      // Constrain to both preview width and height; no scrolling in this mode.
      const maxH = previewEl.clientHeight;
      canvasEl.style.maxWidth = '100%';
      canvasEl.style.maxHeight = Math.max(40, maxH) + 'px';
      previewEl.style.overflow = 'hidden';
    } else {
      // Width-fit only: show at real width, shrink only if it overflows the pane.
      canvasEl.style.maxWidth = '100%';
      canvasEl.style.maxHeight = 'none';
      previewEl.style.overflowY = 'auto';
    }
  }

  // One hue per guide kind, so each line+label reads as a distinct color band.
  const GUIDE_COLORS = {
    blank:  '#4aa3ff', // blue   — 留白
    top:    '#36d399', // green  — 面尾
    ext:    '#c084fc', // purple — 面身
    darken: '#fb923c', // orange — 暗化偏移
  };

  // A horizontal guide line at `topPct`% of the canvas height, tinted `color`.
  // The label floats beside its own line; its vertical position is finalized in
  // relayoutGuideIndent (snaps to the line, cascades down on overlap).
  function guideLine(topPct, label, color, above, bottom) {
    const arrow = above ? '▼' : '▲';
    const aboveCls = above ? ' tint-guide__label--above' : '';
    // Bottom-anchored lines sit 1px INSIDE the stage bottom edge so the dashed
    // border always renders (at a fractional stage height a border right on the
    // last pixel row can drop out due to subpixel sampling).
    const posStyle = bottom ? 'bottom:1px;top:auto' : `top:${topPct}%`;
    // Line (full-width dashed) and label are SIBLINGS so the label's stacking
    // (z-index 3) clearly sits above the line (z-index 1) — the dashed line
    // never paints over the label text.
    return `<div class="tint-guide__line" style="${posStyle};border-color:${color}"></div>`
      + `<div class="tint-guide__labelwrap" style="${posStyle}">`
      + `<span class="tint-guide__label tint-guide__label--left${aboveCls}" style="background:${color}"><span class="tint-guide__arrow">${arrow}</span>${escapeHtml(label)}</span>`
      + `</div>`;
  }

  // Build the guide-lines container (positions only; indent recomputed on layout).
  // Layout of the cropped output (height = total = outH):
  //   0 .. blank              留白 (blank spacing)
  //   blank .. blank+tailH    面尾 (top content)
  //   blank+tailH .. total    面身 (bottom, stretched/tiled) — anchored to bottom
  // Guide lines:
  //   留白     at blank              (blank's bottom = split point)
  //   面尾     at blank + tailH      (tail's bottom)
  //   暗化偏移 at 面尾 + shift        (offset from the 面尾 line)
  function buildGuide(t, total) {
    const tailH = Math.min(Math.max(0, Math.round(+t.cropA || 0)), total);
    const blank = Math.max(0, Math.round(+t.cropB || 0));
    const tailBottom = Math.min(total, blank + tailH);
    const darkening = isDarkening(t);
    const shift = darkening ? Math.min(total - tailBottom, Math.max(0, Math.round(+t.darkenD || 0))) : 0;
    const lines = [
      { pct: (blank / total) * 100, label: i18n.t('edit.guideBlank') + ' ' + blank, color: GUIDE_COLORS.blank, above: false, bottom: false },
      { pct: (tailBottom / total) * 100, label: i18n.t('edit.guideTop') + ' ' + tailH, color: GUIDE_COLORS.top, above: false, bottom: false },
      { pct: 0, label: i18n.t('edit.guideExt') + ' ' + (total - tailBottom), color: GUIDE_COLORS.ext, above: true, bottom: true },
    ];
    if (darkening) {
      lines.push({ pct: ((tailBottom + shift) / total) * 100, label: i18n.t('edit.darkenD') + ' ' + shift, color: GUIDE_COLORS.darken, above: false, bottom: false });
    }
    const guide = document.createElement('div');
    guide.className = 'tint-guide';
    guide.innerHTML = lines.map(ln => guideLine(ln.pct, ln.label, ln.color, ln.above, ln.bottom)).join('');
    return guide;
  }

  // Float each label next to its own dashed line. Overlap is detected from the
  // labels' ACTUAL rendered rects (not a computed pixel guess), so the layout is
  // stable across zoom changes — a value tweak only re-cascades when labels
  // genuinely overlap at the current size.
  function relayoutGuideIndent(stage, t, total) {
    const guide = stage.querySelector('.tint-guide');
    if (!guide) return;
    const wraps = guide.querySelectorAll('.tint-guide__labelwrap');
    if (!wraps.length) return;
    const labels = guide.querySelectorAll('.tint-guide__label');
    if (!labels.length || labels.length !== wraps.length) return;
    const stageRect = stage.getBoundingClientRect();
    // Reset any prior cascade so we measure natural (line-hugging) positions.
    wraps.forEach(w => { w.style.marginTop = ''; });
    // Force a reflow so the rects reflect the reset positions.
    void guide.offsetWidth;
    const aboveFlags = [
      false, false, true, // 留白, 面尾, 面身(bottom-anchored)
    ];
    if (isDarkening(t)) aboveFlags.push(false);
    // Build entries: measure the LABEL (it has real height; the wrap is 0-height
    // since the label is position:absolute), but move the WRAP (which is anchored
    // to the line) so the label follows.
    const entries = [];
    for (let i = 0; i < wraps.length; i++) {
      entries.push({ wrap: wraps[i], label: labels[i], above: !!aboveFlags[i] });
    }
    // Top-anchored labels, ordered by natural top.
    const casc = entries.filter(e => !e.above)
      .sort((a, b) => a.label.getBoundingClientRect().top - b.label.getBoundingClientRect().top);
    const placed = []; // {top, bottom} of settled labels (stage coords)
    for (const e of casc) {
      const r = e.label.getBoundingClientRect();
      const top = r.top - stageRect.top;
      const bottom = r.bottom - stageRect.top;
      let shift = 0;
      for (const p of placed) {
        if (top + shift < p.bottom && bottom + shift > p.top) {
          shift = Math.max(shift, p.bottom - top);
        }
      }
      if (shift > 0) e.wrap.style.marginTop = Math.round(shift) + 'px';
      placed.push({ top: top + shift, bottom: bottom + shift });
    }
  }

  // Parse "r,g,b[,a]" → { color:[r,g,b] 0..1, t = a/255 }.
  function parseColorUniforms(c) {
    const p = (c || '255,255,255,255').split(',').map(n => parseInt(n.trim(), 10));
    const r = (p[0] || 0) / 255, g = (p[1] || 0) / 255, b = (p[2] || 0) / 255;
    const t = (p[3] !== undefined ? p[3] : 255) / 255;
    return { color: [r, g, b], t };
  }
  const TINT_MODE_IDX = { multiply: 0, screen: 1, overlay: 2, lightness: 3, replace: 4 };

  // ── Viewport virtualization (crop/darken canvas2D path) ──
  // Build the TINTED source canvas (the input cropCanvas/darkenCanvas operate
  // on). Factored out so the viewport painter and the full-render path share it.
  //
  // When tint is on, prefer an OFF-SCREEN WebGL render (GlPreview, tint-only):
  // tint is the one stage GL does in O(1) — a color drag is a uniform update,
  // the source texture is cached by srcKey, and a single drawArrays rasterises
  // the tinted source without the JS per-pixel tintCanvas loop (which is the
  // color-drag bottleneck). `host` is the canvas element the GL renderer is
  // cached on (the live / shown preview canvas); falls back to JS tintCanvas if
  // WebGL is unavailable.
  function buildTintedSource(img, t, host) {
    if (t.tintEnabled) {
      const gl = getTintedSourceGL(img, t, host);
      if (gl) return gl;
    }
    let canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    if (t.tintEnabled) canvas = tintCanvas(canvas, t.color, t.mode);
    return canvas;
  }

  // Lazily create / reuse an off-screen GlPreview renderer that rasterises the
  // tinted source. Cached on `host` keyed by srcKey (texture never re-uploaded
  // for the same source). Each call re-renders with the CURRENT t.color/mode —
  // a uniform update + one drawArrays — so color dragging is cheap.
  //
  // The GL canvas uses preserveDrawingBuffer:false (per gl-preview.js), so we
  // blit each render into a stable 2D result canvas before returning — that 2D
  // canvas is what cropViewportCanvas samples via drawImage, and it stays valid
  // across frames. The blit is a GPU→readback but only touches source px (not
  // the huge cropC output), far cheaper than the JS tintCanvas loop.
  function getTintedSourceGL(img, t, host) {
    const GlPreview = window.GlPreview;
    if (!GlPreview) return null;
    const srcW = img.naturalWidth, srcH = img.naturalHeight;
    if (!srcW || !srcH) return null;
    // GPU caps texture size; render at source resolution but clamp to the limit.
    const MAX = 16384;
    const scale = (srcW > MAX || srcH > MAX) ? Math.min(MAX / srcW, MAX / srcH) : 1;
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    // Reuse the off-screen GL canvas + renderer + 2D result canvas on the host;
    // rebuild if the source changed (different srcKey) or dims changed.
    let entry = host && host._tintGL;
    if (entry && (entry.srcKey !== t.source || entry.gl.width !== w || entry.gl.height !== h)) {
      // Source/dims changed: release the previous GL renderer before rebuilding.
      try { entry.renderer.destroy(); } catch (_) {}
      entry = null;
    }
    if (!entry) {
      try {
        const gl = document.createElement('canvas');
        gl.width = w; gl.height = h;
        const renderer = GlPreview.createRenderer(gl);
        if (!renderer) { if (host) host._tintGL = null; return null; }
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        entry = { srcKey: t.source, gl, renderer, out };
        if (host) host._tintGL = entry;
      } catch (_) { if (host) host._tintGL = null; return null; }
    }
    try {
      const tc = parseColorUniforms(t.color);
      entry.renderer.render({
        img, srcKey: t.source, srcW, srcH, outW: srcW, outH: srcH,
        tint: { on: true, color: tc.color, t: tc.t, mode: TINT_MODE_IDX[t.mode] || 0 },
        crop: { on: false }, darken: { on: false },
      });
      // Blit the (possibly volatile) GL backing into the stable 2D result canvas.
      entry.out.getContext('2d').clearRect(0, 0, w, h);
      entry.out.getContext('2d').drawImage(entry.gl, 0, 0);
      return entry.out;
    } catch (_) { return null; }
  }

  // Signature of everything that affects the (tinted) source canvas EXCEPT the
  // tint COLOR — color is applied at paint time via the GL tint renderer (a
  // uniform update), so a color drag must NOT invalidate the cached source.
  function tintSourceSig(img, t) {
    return (img && img.naturalWidth) + 'x' + (img && img.naturalHeight) + '|' +
      (t.source || '') + '|' + (t.tintEnabled ? 1 : 0) + '|' + (t.mode || '');
  }

  // Draw the crop+darken result for ONE output row range [visTop, visTop+visH)
  // into `ctx` at destination y = 0 (the top of the viewport canvas).
  //
  // This is a viewport-clipped reimplementation of cropCanvas()+darkenCanvas():
  // it never materialises the full outW×total backing — it only paints the rows
  // actually visible. Geometry is byte-identical to the full render:
  //   tail  : output [blank, blank+tailSrcH) ← source [0, tailSrcH) 1:1
  //   body  : output [blank+tailSrcH, total) ← source [tailSrcH, srcH)
  //           stretched (one drawImage) OR tiled (down from y0 / up from bottom)
  //   blank : output [0, blank) transparent (nothing drawn)
  // darken (post-crop, over-composite):
  //   ghost  = crop slice [visTop, visTop+visH) at alpha=darkenAlpha
  //   opaque = crop slice [visTop-shift, visTop+visH-shift) at alpha=1, shifted DOWN
  //
  // `ds` (dest scale, default 1) multiplies the DESTINATION width/height/x/y of
  // every drawImage so the result can be painted at a smaller backing resolution
  // (full-fit mode downsamples the whole output; width-fit keeps ds=1 = crisp).
  // Source sampling stays at full source resolution in every case.
  function cropViewportCanvas(ctx, src, tailH, blank, total, tile, tileDir,
                              darkenOn, shift, darkenAlpha, visTop, visH, ds) {
    if (ds == null) ds = 1;
    const w = src.width, h = src.height;
    const tailSrcH = Math.min(Math.max(0, Math.round(tailH)), h);
    const bodySrcH = h - tailSrcH;
    // Visible output rows, clamped to the logical canvas.
    const visBot = Math.min(total, visTop + visH);
    const y0 = blank + tailSrcH;            // body starts here in output
    const dw = w * ds;                      // dest width

    // Paint the crop result for the visible range into a scratch canvas, then
    // composite darken over it. (For non-darken we draw straight into ctx.)
    let baseCtx = ctx;
    let scratch = null;
    if (darkenOn) {
      scratch = document.createElement('canvas');
      scratch.width = Math.max(1, Math.round(dw));
      scratch.height = Math.max(1, Math.round(visH * ds));
      baseCtx = scratch.getContext('2d');
    }
    baseCtx.clearRect(0, 0, dw, visH * ds);

    // --- TAIL (面尾): output [blank, blank+tailSrcH) ← source [0, tailSrcH) 1:1 ---
    if (tailSrcH > 0) {
      const tailOutTop = blank;
      const tailOutBot = Math.min(total, blank + tailSrcH);
      if (tailOutBot > visTop && tailOutTop < visBot) {
        const drawTop = Math.max(visTop, tailOutTop);
        const drawBot = Math.min(visBot, tailOutBot);
        baseCtx.drawImage(src,
          0, drawTop - tailOutTop, w, drawBot - drawTop,
          0, (drawTop - visTop) * ds, dw, (drawBot - drawTop) * ds);
      }
    }

    // --- BODY (面身): output [y0, total) ← source [tailSrcH, srcH) ---
    if (bodySrcH > 0) {
      const bodyOutTop = y0;
      const bodyOutBot = total;
      if (bodyOutBot > visTop && bodyOutTop < visBot) {
        if (tile) {
          if (tileDir === 'up') {
            // Tile UPWARD from the bottom edge: tile j (0 = bottom-most) covers
            // output [total-(j+1)*bodySrcH, total-j*bodySrcH), drawn 1:1 from
            // source [tailSrcH, tailSrcH+bodySrcH). The bottom tile is j=0; as j
            // grows the tile moves UP. Only tiles intersecting the viewport are
            // drawn, and the walk stops once it passes above the region top.
            // Start at the lowest j whose tile is at/above the viewport bottom.
            let j = Math.max(0, Math.floor((total - visBot) / bodySrcH));
            for (; ; j++) {
              const tileOutTop = total - (j + 1) * bodySrcH;
              const tileOutBot = tileOutTop + bodySrcH;   // = total - j*bodySrcH
              if (tileOutBot <= visTop) break;            // tile fully above viewport
              if (tileOutBot <= bodyOutTop) break;        // tile fully above the body region
              const drawTop = Math.max(visTop, Math.max(bodyOutTop, tileOutTop));
              const drawBot = Math.min(visBot, tileOutBot);
              if (drawBot > drawTop) {
                baseCtx.drawImage(src,
                  0, tailSrcH + (drawTop - tileOutTop), w, drawBot - drawTop,
                  0, (drawTop - visTop) * ds, dw, (drawBot - drawTop) * ds);
              }
            }
          } else {
            // Tile DOWNWARD from y0: tiles at output y = y0 + k*bodySrcH.
            const firstK = Math.max(0, Math.floor((visTop - bodyOutTop) / bodySrcH));
            for (let k = firstK; ; k++) {
              const tileOutTop = bodyOutTop + k * bodySrcH;
              const tileOutBot = tileOutTop + bodySrcH;
              if (tileOutTop >= visBot) break;      // past viewport
              const drawTop = Math.max(visTop, tileOutTop);
              const drawBot = Math.min(visBot, tileOutBot);
              if (drawBot > drawTop) {
                baseCtx.drawImage(src,
                  0, tailSrcH + (drawTop - tileOutTop), w, drawBot - drawTop,
                  0, (drawTop - visTop) * ds, dw, (drawBot - drawTop) * ds);
              }
            }
          }
        } else {
          // STRETCH: source [tailSrcH, srcH) → output [bodyOutTop, bodyOutBot)
          // linearly. Map the visible sub-range back into the source.
          const drawTop = Math.max(visTop, bodyOutTop);
          const drawBot = Math.min(visBot, bodyOutBot);
          if (drawBot > drawTop) {
            const outSpan = bodyOutBot - bodyOutTop;
            const srcFromTop = (drawTop - bodyOutTop) * (bodySrcH / outSpan);
            const srcFromBot = (drawBot - bodyOutTop) * (bodySrcH / outSpan);
            baseCtx.drawImage(src,
              0, tailSrcH + srcFromTop, w, srcFromBot - srcFromTop,
              0, (drawTop - visTop) * ds, dw, (drawBot - drawTop) * ds);
          }
        }
      }
    }

    // --- DARKEN (over-composite): ghost + opaque-shifted copy, within viewport ---
    if (darkenOn) {
      // Ghost: the crop viewport slice at alpha=darkenAlpha, drawn at dest y=0.
      ctx.globalAlpha = darkenAlpha;
      ctx.drawImage(scratch, 0, 0);
      // Opaque: the crop slice [visTop-shift, visBot-shift) shifted DOWN by
      // `shift` lands back at [visTop, visBot) — i.e. we re-render the crop
      // result for rows (visTop-shift .. visBot-shift) and draw it at dest y=0.
      ctx.globalAlpha = 1;
      const opVisTop = visTop - shift;
      if (opVisTop < total && opVisTop + visH > 0) {
        // Build the opaque crop slice (no darken — straight crop) into a 2nd scratch.
        const opScratch = document.createElement('canvas');
        opScratch.width = Math.max(1, Math.round(dw));
        opScratch.height = Math.max(1, Math.round(visH * ds));
        const opCtx = opScratch.getContext('2d');
        // Recursive call with darken OFF paints only the crop slice [opVisTop, +visH).
        cropViewportCanvas(opCtx, src, tailH, blank, total, tile, tileDir,
                           false, 0, 0, opVisTop, visH, ds);
        ctx.drawImage(opScratch, 0, 0);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ── Virtualized viewport plumbing ──
  // The viewport canvas is `position: sticky; top: 0` so it stays pinned to the
  // top of the scroll pane while the (tall) stage scrolls behind it. Only the
  // visible output rows are painted into its (small) backing each frame.
  //
  // Scale relationship between logical output px and CSS display px:
  //   displayW = min(paneW, outW)         (canvas is width-fit then height-auto)
  //   scale    = displayW / outW           (CSS px per logical px)
  //   visH     = ceil(paneH / scale)       (logical rows that fill the viewport)
  //   spacerH  = total * scale             (full logical height, in CSS px)
  //   visTop   = scrollTop / scale         (top logical row currently in view)

  // Paint the viewport slice into the on-screen canvas. Returns the visH used.
  // In full-fit mode the whole logical output is rendered (downsampled via ds so
  // the backing stays small); in width-fit mode only the scrolled viewport is
  // painted at full logical resolution (ds=1, crisp).
  function paintViewport(shown, srcCanvas, t, total) {
    const outW = srcCanvas.width;
    const previewEl = shown.closest('.tint-preview');
    const paneW = previewEl ? previewEl.clientWidth : outW;
    // The pane has no size while its tab is hidden (clientWidth=0). Painting now
    // would compute scale=0 → visH=Infinity → a broken canvas. Skip; the caller
    // re-paints once the tab is shown (ResizeObserver / rAF / scroll).
    if (paneW <= 0) return 0;
    // clientHeight can be 0 on first render before layout settles. Fall back to
    // a sane default so the viewport canvas gets a real height.
    const paneH = (previewEl && previewEl.clientHeight > 0) ? previewEl.clientHeight : 400;

    let bw, bh, cssW, cssH, ds, visTop, visH;
    if (previewFullFit) {
      // Whole output fits the pane; downsample so the backing is small.
      const fit = Math.min(paneW / outW, paneH / total);
      ds = fit;
      bw = Math.max(1, Math.round(outW * ds));
      bh = Math.max(1, Math.round(total * ds));
      cssW = bw; cssH = bh;
      visTop = 0; visH = total;
    } else {
      const displayW = Math.min(paneW, outW);
      const scale = displayW / outW;
      ds = 1;                                 // width-fit: render at full resolution
      visH = Math.max(1, Math.ceil((paneH + 2) / scale));
      const scrollTop = previewEl ? previewEl.scrollTop : 0;
      visTop = Math.max(0, scrollTop / scale);
      bw = outW; bh = visH;
      cssW = displayW; cssH = paneH;
    }

    if (shown.width !== bw || shown.height !== bh) {
      shown.width = bw; shown.height = bh;
    }
    // Force the canvas CSS size to the viewport (override height:auto /
    // maxWidth so our explicit sticky layout wins).
    shown.style.width = cssW + 'px';
    shown.style.height = cssH + 'px';
    shown.style.maxWidth = 'none';
    shown.style.maxHeight = 'none';
    shown.style.position = 'sticky';
    shown.style.top = '0';

    const ctx = shown.getContext('2d');
    ctx.clearRect(0, 0, bw, bh);
    cropViewportCanvas(ctx, srcCanvas,
      +t.cropA || 0, +t.cropB || 0, total, !!t.cropTile, t.cropTileDir,
      isDarkening(t), +t.darkenD || 0, Math.max(0, Math.min(1, (+t.darkenOpacity || 0) / 100)),
      visTop, visH, ds);
    return visH;
  }

  // Size the stage (spacer) so the scrollbar reflects the full logical height,
  // and re-measure the visible viewport scale (pane may have resized). Returns
  // the displayed total CSS height. In full-fit the stage is exactly the pane
  // height (no scrolling); in width-fit it is the full logical output height.
  function layoutVirtualStage(stage, srcCanvas, total) {
    const outW = srcCanvas.width;
    const previewEl = stage.closest('.tint-preview');
    const paneW = previewEl ? previewEl.clientWidth : outW;
    const paneH = (previewEl && previewEl.clientHeight > 0) ? previewEl.clientHeight : 400;
    let spacerH;
    if (previewFullFit) {
      const fit = Math.min(paneW / outW, paneH / total);
      spacerH = total * fit;
    } else {
      const displayW = Math.min(paneW, outW);
      const scale = displayW / outW;
      spacerH = total * scale;
    }
    stage.style.height = spacerH + 'px';
    return spacerH;
  }

  // Should this op's crop/darken preview be viewport-virtualized? Only when crop
  // (or its derived darken) is on AND the logical output exceeds the threshold —
  // small outputs render the whole canvas directly (no virtualization needed).
  function shouldVirtualize(t, img) {
    if (!t || !t.cropEnabled || !img) return false;
    const cropOutH = Math.max(1, Math.round(+t.cropC || 32768));
    return cropOutH > VIRTUALIZE_THRESHOLD;
  }

  // Re-layout the spacer + repaint the viewport of an ALREADY-built virtualized
  // preview (used by scroll, pane resize, and fit-toggle). No-op if the preview
  // is not currently virtualized.
  function repaintVirtual(previewEl) {
    if (!vpActive) return false;
    const shown = previewEl && previewEl.querySelector('.tint-preview__canvas');
    const stage = previewEl && previewEl.querySelector('.tint-preview__stage');
    if (!shown || !stage || !shown._vpSrc) return false;
    const t = sel();
    if (!t) return false;
    const total = Math.max(1, Math.round(+t.cropC || 32768));
    // Keep the scroll mode in sync with the current fit (applyPreviewFit is
    // virtualization-aware and calls back into us, so set overflow directly).
    previewEl.style.overflow = previewFullFit ? 'hidden' : 'auto';
    layoutVirtualStage(stage, shown._vpSrc, total);
    paintViewport(shown, shown._vpSrc, t, total);
    relayoutGuideIndent(stage, t, total);
    return true;
  }

  // Render one frame. Tint-only uses the WebGL path (fast, smooth live dragging).
  // When crop or darken is enabled we fall back to the canvas2D pipeline — its
  // drawImage scaling produced cleaner results than the GL shader for the crop
  // body stretch / darken composite.
  function drawProcessed(shown, img, t, srcKey) {
    const srcW = img.naturalWidth, srcH = img.naturalHeight;
    const cropOn = !!t.cropEnabled;
    const darkenOn = isDarkening(t);
    const cropOutH = Math.max(1, Math.round(+t.cropC || 32768));
    const outW = srcW;
    const outH = cropOn ? cropOutH : srcH;
    const tc = parseColorUniforms(t.color);

    // WebGL fast path: tint only (no crop/darken).
    if (t.tintEnabled && !cropOn && !darkenOn) {
      const gl = window.GlPreview;
      let renderer = shown._glRenderer;
      if (renderer == null && gl) {
        const r = gl.createRenderer(shown);
        renderer = r;
        shown._glRenderer = r;
        shown._glFailed = !r;
      }
      if (renderer) {
        renderer.render({
          img, srcKey, srcW, srcH, outW, outH,
          tint: { on: true, color: tc.color, t: tc.t, mode: TINT_MODE_IDX[t.mode] || 0 },
          crop: { on: false }, darken: { on: false },
        });
        // Clear any leftover canvas2D layout artifacts (style.width etc.).
        shown.style.width = '';
        shown.style.height = '';
        shown.style.aspectRatio = '';
        return outH;
      }
    }

    // canvas2D path (crop/darken, or WebGL unavailable).
    // Release any GL renderer bound to this canvas before using its 2D context.
    if (shown._glRenderer) { try { shown._glRenderer.destroy(); } catch (_) {} shown._glRenderer = null; }
    // Clear any leftover virtual-viewport layout (sticky positioning etc.) so a
    // live drag that crosses the threshold back to a full render lays out inline.
    shown.style.width = '';
    shown.style.height = '';
    shown.style.aspectRatio = '';
    shown.style.position = '';
    shown.style.top = '';
    shown.style.maxWidth = '';
    shown.style.maxHeight = '';
    shown._vpSrc = null;
    shown._vpSig = null;
    let canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = srcH;
    canvas.getContext('2d').drawImage(img, 0, 0);
    if (t.tintEnabled) canvas = tintCanvas(canvas, t.color, t.mode);
    if (cropOn) canvas = cropCanvas(canvas, +t.cropA || 0, +t.cropB || 0, +t.cropC || 32768, !!t.cropTile, t.cropTileDir);
    if (darkenOn) canvas = darkenCanvas(canvas, +t.darkenD || 0, +t.darkenOpacity || 0);
    if (shown.width !== canvas.width || shown.height !== canvas.height) {
      shown.width = canvas.width; shown.height = canvas.height;
    }
    shown.getContext('2d').clearRect(0, 0, shown.width, shown.height);
    shown.getContext('2d').drawImage(canvas, 0, 0);
    return canvas.height;
  }

  async function recomputePreview(fadeOnChange, live) {
    const previewEl = container && container.querySelector('#tint-preview');
    if (!previewEl) return;
    const t = sel();
    if (!t || !t.source) {
      previewEl.innerHTML = `<div class="tint-preview__empty">${i18n.t('edit.previewEmpty')}</div>`;
      return;
    }
    try {
      const img = await getSourceImg(t.source);
      if (!img) { previewEl.innerHTML = `<div class="tint-preview__empty">${i18n.t('edit.previewMissing')}</div>`; return; }
      // Live fast path: reuse the on-screen canvas + GL renderer (uniform update
      // only, no DOM teardown, no texture re-upload). When crop is on we also
      // refresh the guide lines in place so dragging crop/darken values tracks.
      if (live) {
        const liveCanvas = previewEl.querySelector('.tint-preview__canvas');
        if (liveCanvas) {
          // If the output is huge (shouldVirtualize) but the viewport-virtualized
          // state isn't ready yet (e.g. cropC just crossed the threshold from a
          // small value), do NOT fall through to drawProcessed — it would build
          // an outW×cropC backing (fails / goes blank past the canvas size limit,
          // ~65536). Force a full rebuild instead, which sets up virtualization.
          if (shouldVirtualize(t, img) && !(vpActive && liveCanvas._vpSrc)) {
            recomputePreview(false);
            return;
          }
          // Virtualized live update: the source canvas is cached on the canvas
          // element; just re-layout the spacer + repaint the viewport (cheap).
          if (vpActive && liveCanvas._vpSrc && shouldVirtualize(t, img)) {
            // If the tinted SOURCE changed (mode/source swap while crop is on),
            // rebuild the cached source canvas before repainting. The tint COLOR
            // is NOT in the sig: when tint is on and GL is available, the source
            // is re-rasterised every paint via a uniform update (cheap), so a
            // color drag repaints without rebuilding the (expensive) JS source.
            const sig = tintSourceSig(img, t);
            const glTint = t.tintEnabled && window.GlPreview;
            if (glTint || liveCanvas._vpSig !== sig) {
              liveCanvas._vpSrc = buildTintedSource(img, t, liveCanvas);
              liveCanvas._vpSig = sig;
            }
            const total = Math.max(1, Math.round(+t.cropC || 32768));
            const stage = previewEl.querySelector('.tint-preview__stage');
            if (stage) {
              const guide = stage.querySelector('.tint-guide');
              if (guide) guide.replaceWith(buildGuide(t, total));
              layoutVirtualStage(stage, liveCanvas._vpSrc, total);
              paintViewport(liveCanvas, liveCanvas._vpSrc, t, total);
              relayoutGuideIndent(stage, t, total);
            }
            return;
          }
          const outH = drawProcessed(liveCanvas, img, t, t.source);
          if (t.cropEnabled) {
            const stage = previewEl.querySelector('.tint-preview__stage');
            if (stage) {
              const guide = stage.querySelector('.tint-guide');
              const total = outH || 1;
              if (guide) {
                const fresh = buildGuide(t, total);
                guide.replaceWith(fresh);
              }
              relayoutGuideIndent(stage, t, total);
            }
          }
          return;
        }
      }
      // Full rebuild of the preview DOM.
      // Release the previous canvas's GL renderer (if any) before dropping it.
      const prevCanvas = previewEl.querySelector('.tint-preview__canvas');
      if (prevCanvas && prevCanvas._glRenderer) { try { prevCanvas._glRenderer.destroy(); } catch (_) {} }
      previewEl.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'tint-preview__wrap';
      const stage = document.createElement('div');
      stage.className = 'tint-preview__stage';
      const shown = document.createElement('canvas');
      shown.className = 'tint-preview__canvas';

      // ── Virtualized crop/darken path: sticky viewport canvas + tall spacer. ──
      // Renders only the visible output rows each frame (and on scroll), keeping
      // the canvas2D backing small regardless of cropC. Falls back to the full
      // canvas render below when the output fits the threshold (small cropC).
      if (shouldVirtualize(t, img)) {
        vpActive = true;
        const srcCanvas = buildTintedSource(img, t, shown);
        shown._vpSrc = srcCanvas;
        shown._vpSig = tintSourceSig(img, t);
        const total = Math.max(1, Math.round(+t.cropC || 32768));
        previewEl.style.overflow = previewFullFit ? 'hidden' : 'auto';
        stage.appendChild(shown);
        const guide = buildGuide(t, total);
        stage.appendChild(guide);
        wrap.appendChild(stage);
        previewEl.appendChild(wrap);
        // Paint must run AFTER the stage is in the DOM (paintViewport measures
        // the pane). Spacer layout first so the scrollbar is correct.
        layoutVirtualStage(stage, srcCanvas, total);
        paintViewport(shown, srcCanvas, t, total);
        relayoutGuideIndent(stage, t, total);
        bindVirtualScroll(previewEl);
        // On first open the pane may not have a measured height yet (clientHeight
        // 0 → canvas painted at 0 height → sticky-scroll dead). Re-paint next
        // frame once layout has settled.
        requestAnimationFrame(() => {
          if (vpActive && shown._vpSrc) {
            layoutVirtualStage(stage, shown._vpSrc, total);
            paintViewport(shown, shown._vpSrc, t, total);
            relayoutGuideIndent(stage, t, total);
          }
        });
      } else {
        vpActive = false;
        const outH = drawProcessed(shown, img, t, t.source);
        applyPreviewFit(shown, previewEl);
        stage.appendChild(shown);
        // Percy LN guide lines: mark blank / top / extended-bottom heights.
        if (t.cropEnabled) {
          const total = outH || 1;
          const guide = buildGuide(t, total);
          stage.appendChild(guide);
        }
        wrap.appendChild(stage);
        previewEl.appendChild(wrap);
        // Re-measure indents AFTER the stage is in the DOM, so the displayed
        // height (post-fit) is real — otherwise getBoundingClientRect() returns 0
        // and every label collapses onto one line.
        if (t.cropEnabled) {
          const total = outH || 1;
          relayoutGuideIndent(stage, t, total);
        }
      }
      if (fadeOnChange) {
        previewEl.classList.remove(FADE);
        void previewEl.offsetWidth;
        previewEl.classList.add(FADE);
      }
    } catch (_) { /* ignore */ }
  }

  // Bind (once per scroll container) a passive scroll listener that repaints the
  // virtualized viewport on a rAF. No-op when not virtualized or in full-fit.
  function bindVirtualScroll(previewEl) {
    if (!previewEl || previewEl._vpScrollBound) return;
    previewEl._vpScrollBound = true;
    previewEl.addEventListener('scroll', () => {
      if (!vpActive || previewFullFit) return;
      if (vpScrollFrame) return;
      vpScrollFrame = requestAnimationFrame(() => {
        vpScrollFrame = 0;
        repaintVirtual(previewEl);
      });
    }, { passive: true });
  }

  // schedulePreview(live): live updates (color drag) are coalesced on a rAF and
  // rendered at a smaller downscale for responsiveness; the final flush (live=false,
  // also used by every non-drag change) cancels any pending live frame and runs the
  // full-quality recompute on a short debounce.
  function schedulePreview(live) {
    if (live) {
      clearTimeout(previewDebounce);
      if (liveFrame) return;
      liveFrame = requestAnimationFrame(() => { liveFrame = 0; recomputePreview(false, true); });
    } else {
      if (liveFrame) { cancelAnimationFrame(liveFrame); liveFrame = 0; }
      clearTimeout(previewDebounce);
      previewDebounce = setTimeout(() => recomputePreview(false), 60);
    }
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

  // RGB↔HSL helpers (0..1 floats). Hue shift = keep pixel S+L, take color's H.
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    if (Math.abs(mx - mn) < 1e-9) return [0, 0, l];
    const d = mx - mn;
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hsl2rgb(h, s, l) {
    if (s < 1e-9) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2 = (t) => {
      let tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      if (tt < 1/6) return p + (q - p) * 6 * tt;
      if (tt < 0.5) return q;
      if (tt < 2/3) return p + (q - p) * (2/3 - tt) * 6;
      return p;
    };
    return [hue2(h + 1/3) * 255, hue2(h) * 255, hue2(h - 1/3) * 255];
  }
  function hslHueShift(pr, pg, pb, cr, cg, cb) {
    const [, ps, pl] = rgb2hsl(pr, pg, pb);
    const [ch] = rgb2hsl(cr, cg, cb);
    const [r, g, b] = hsl2rgb(ch, ps, pl);
    return [Math.round(r), Math.round(g), Math.round(b)];
  }

  function tintCanvas(src, color, mode) {
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, out.width, out.height);
    const d = data.data;
    const p = (color || '255,255,255,255').split(',').map(n => parseInt(n.trim(), 10));
    const cr = p[0] || 0, cg = p[1] || 0, cb = p[2] || 0;
    // The picker's alpha is the BLEND STRENGTH (how much of the tint applies),
    // NOT the output image opacity. alpha is preserved from the source pixel.
    const t = (p[3] !== undefined ? p[3] : 255) / 255;
    const lerp = (a, b) => a + (b - a) * t;
    for (let i = 0; i < d.length; i += 4) {
      const pa = d[i + 3];
      if (pa === 0) continue;
      const pr = d[i], pg = d[i + 1], pb = d[i + 2];
      let r, g, b;
      if (mode === 'multiply') { r = lerp(pr, pr * cr / 255); g = lerp(pg, pg * cg / 255); b = lerp(pb, pb * cb / 255); }
      else if (mode === 'screen') { r = lerp(pr, 255 - (255 - pr) * (255 - cr) / 255); g = lerp(pg, 255 - (255 - pg) * (255 - cg) / 255); b = lerp(pb, 255 - (255 - pb) * (255 - cb) / 255); }
      else if (mode === 'overlay') {
        const o = (pp, cc) => pp < 128 ? 2 * pp * cc / 255 : 255 - 2 * (255 - pp) * (255 - cc) / 255;
        r = lerp(pr, o(pr, cr)); g = lerp(pg, o(pg, cg)); b = lerp(pb, o(pb, cb));
      } else if (mode === 'lightness') {
        // Hue shift: keep pixel S+L, take color's H.
        const [nr, ng, nb] = hslHueShift(pr, pg, pb, cr, cg, cb);
        r = lerp(pr, nr); g = lerp(pg, ng); b = lerp(pb, nb);
      } else { r = lerp(pr, cr); g = lerp(pg, cg); b = lerp(pb, cb); } // replace → solid color
      d[i] = Math.round(r); d[i + 1] = Math.round(g); d[i + 2] = Math.round(b);
      d[i + 3] = pa; // preserve source alpha
    }
    ctx.putImageData(data, 0, 0);
    return out;
  }

  function cropCanvas(src, tailH, blank, outH, tile, tileDir) {
    const w = src.width, h = src.height;
    const tailSrcH = Math.min(Math.max(0, Math.round(tailH)), h);
    const bodySrcH = h - tailSrcH;
    const total = Math.max(1, Math.round(outH));
    const out = document.createElement('canvas');
    out.width = w; out.height = total;
    const ctx = out.getContext('2d');
    // Tail (面尾) placed at y = blank.
    if (tailSrcH > 0 && blank < total) ctx.drawImage(src, 0, 0, w, tailSrcH, 0, blank, w, tailSrcH);
    // Body (面身) extended into (blank + tailSrcH .. total).
    if (bodySrcH > 0) {
      const y0 = blank + tailSrcH;
      const remain = total - y0;
      if (remain > 0) {
        if (tile) {
          if (tileDir === 'up') {
            // Tile upward from the bottom edge of the region.
            let y = total - bodySrcH;
            while (y + bodySrcH > y0) { ctx.drawImage(src, 0, tailSrcH, w, bodySrcH, 0, Math.max(y0, y), w, bodySrcH); y -= bodySrcH; }
          } else {
            let y = y0;
            while (y < total) { ctx.drawImage(src, 0, tailSrcH, w, bodySrcH, 0, y, w, bodySrcH); y += bodySrcH; }
          }
        } else {
          ctx.drawImage(src, 0, tailSrcH, w, bodySrcH, 0, y0, w, remain);
        }
      }
    }
    return out;
  }

  function darkenCanvas(src, shift, opacityPct) {
    const w = src.width, h = src.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    const alpha = Math.max(0, Math.min(1, opacityPct / 100));
    // Translucent (ghost) copy at original position.
    ctx.globalAlpha = alpha;
    ctx.drawImage(src, 0, 0);
    // Full-opacity copy shifted down by `shift` — covers the ghost except the top strip.
    ctx.globalAlpha = 1;
    ctx.drawImage(src, 0, Math.round(shift));
    return out;
  }

  // ── Thumbnails ──
  async function loadThumbnails() {
    // Delegated to the shared loader (OpTable.createThumbLoader): DOM-state
    // skip + cache-rehydrate invariant, shared with file-copy. Pass a function
    // so the container is resolved AFTER the skinPath await (a re-render during
    // the await reassigns `container`; resolving late avoids iterating a
    // detached node). This fixes same-source previews being left as placeholders.
    await thumbLoader.load(() => container);
  }

  // Add top/bottom edge-fade overlays to a scroll viewport.
  // `relativeEl` is the positioned ancestor the fades attach to; `scrollEl` is the
  // scroller (defaults to relativeEl itself). `bg` overrides the fade gradient color.
  // Layering: sticky header (z 10) > fades (z 9) > table border/content.
  function setupEdgeFade(relativeEl, scrollEl, bg) {
    if (!relativeEl || relativeEl._fadeBound) return;
    relativeEl._fadeBound = true;
    relativeEl.style.position = 'relative';
    const scroller = scrollEl || relativeEl;
    const topFade = document.createElement('div');
    topFade.className = 'scroll-edge-fade scroll-edge-fade--top';
    const botFade = document.createElement('div');
    botFade.className = 'scroll-edge-fade scroll-edge-fade--bottom';
    if (bg) {
      topFade.style.background = `linear-gradient(to bottom, ${bg} 0%, transparent 100%)`;
      botFade.style.background = `linear-gradient(to top, ${bg} 0%, transparent 100%)`;
    }
    relativeEl.appendChild(topFade);
    relativeEl.appendChild(botFade);
    const updateFade = () => {
      const r = scroller.getBoundingClientRect();
      const cr = relativeEl.getBoundingClientRect();
      if (r.height === 0) return;
      topFade.style.top = (r.top - cr.top) + 'px';
      botFade.style.bottom = (cr.bottom - r.bottom) + 'px';
      const canScroll = scroller.scrollHeight > scroller.clientHeight + 2;
      topFade.style.opacity = (canScroll && scroller.scrollTop > 2) ? '1' : '0';
      botFade.style.opacity = (canScroll && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2) ? '1' : '0';
    };
    scroller.addEventListener('scroll', updateFade, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateFade).observe(scroller);
    requestAnimationFrame(updateFade);
    setTimeout(updateFade, 300);
  }

  // Indices to apply stage edits to: the multi-select set if non-empty, else the anchor row.
  function editTargets() {
    const set = opSel ? opSel.getSelected() : new Set();
    const s = set.size > 0 ? [...set] : [selectedIdx()];
    return s.filter(i => cur()[i] != null);
  }

  // Remove ops at the given (descending) indices, evicting a source's cached
  // thumb/image ONLY when no remaining op still uses it. Tint ops frequently
  // share a source (same skin asset, different crop/tint); deleting one must not
  // blank the others' previews. Shared by drag-to-delete and Del-key delete.
  function applyDeleteOps(indicesDesc) {
    const arr = cur();
    const removedSources = new Set();
    for (const i of indicesDesc) {
      if (i < 0 || i >= arr.length) continue;
      const src = arr[i].source;
      arr.splice(i, 1);
      if (src) removedSources.add(src);
    }
    const stillUsed = new Set(arr.map(t => t.source));
    for (const src of removedSources) {
      if (!stillUsed.has(src)) {
        thumbCache.delete(src);
        sourceImgCache.delete(src);
      }
    }
    applyTints(arr);
    // Re-anchor to a valid row, then re-render. preset-editor may have rebuilt
    // #tab-tint since opSel was created, so look up the live node.
    const len = arr.length;
    const anchor = opSel ? opSel.getAnchor() : 0;
    opSel.setSelected(new Set(), len ? Math.min(anchor, len - 1) : 0);
    render(document.getElementById('tab-tint'));
  }

  // Move the rows at `fromIndices` to land at `toIndex` (original-array index,
  // "insert before"). Splice + commit + re-select the moved block + re-render.
  function applyReorderOps(fromIndices, toIndex) {
    const { arr, insertAt, count } = OpTable.reorderArray(cur(), fromIndices, toIndex);
    applyTints(arr);
    // Select the moved block at its new contiguous home [insertAt, insertAt+count).
    const sel = new Set();
    for (let i = 0; i < count; i++) sel.add(insertAt + i);
    if (opSel) opSel.setSelected(sel, insertAt);
    render(document.getElementById('tab-tint'));
  }

  // ── Del key: delete selected tint rows with confirmation ──
  async function deleteSelected() {
    const set = opSel ? opSel.getSelected() : new Set();
    const targetIdx = set.size > 0 ? [...set] : (opSel && opSel.getAnchor() >= 0 ? [opSel.getAnchor()] : []);
    if (targetIdx.length === 0) return;
    const sorted = [...new Set(targetIdx)].sort((a, b) => b - a);
    const confirmed = await ApplyDialog.showConfirmDialog(
      i18n.t('tint.deleteRowsConfirm', { n: sorted.length }),
      [
        { label: `${i18n.t('tint.deleteBtn').replace(/^- ?/, '')} (${sorted.length})`, cls: 'btn--danger', value: 'delete' },
        { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
      ]
    );
    if (!confirmed || confirmed !== 'delete') return;
    applyDeleteOps(sorted);
    Toast.info(i18n.t('tint.deleted', { n: sorted.length }));
  }
  // Enforce: tailH (cropA) + blank (cropB) + darkenD ≤ outH (cropC).
  // When a field grows past the available room, clamp THAT field so the sum
  // stays within outH. outH itself is clamped to be ≥ the sum when it shrinks.
  function normalizeOp(op, changedKey) {
    if (!op.cropEnabled) return op;
    const outH = Math.max(0, Math.floor(+op.cropC || 0));
    const tailH = Math.max(0, Math.floor(+op.cropA || 0));
    const blank = Math.max(0, Math.floor(+op.cropB || 0));
    const darkenD = Math.max(0, Math.floor(+op.darkenD || 0));
    // others = sum of the two values NOT being changed.
    let others;
    if (changedKey === 'cropA') others = blank + darkenD;
    else if (changedKey === 'cropB') others = tailH + darkenD;
    else if (changedKey === 'darkenD') others = tailH + blank;
    else others = tailH + blank + darkenD; // cropC or toggle: keep all as-is

    if (changedKey === 'cropC') {
      // outH can't be smaller than the sum of the other three.
      if (outH < others) op.cropC = others;
    } else {
      // Clamp the changed value so (changed + others) ≤ outH.
      const maxVal = Math.max(0, outH - others);
      if (changedKey === 'cropA') op.cropA = Math.min(tailH, maxVal);
      else if (changedKey === 'cropB') op.cropB = Math.min(blank, maxVal);
      else if (changedKey === 'darkenD') op.darkenD = Math.min(darkenD, maxVal);
    }
    return op;
  }

  // Apply a partial-update (object) to every edit target, with the
  // tailH+blank+darkenD ≤ outH constraint enforced.
  function applyToTargets(partial) {
    const arr = cur();
    const changedKey = Object.keys(partial)[0];
    for (const i of editTargets()) {
      arr[i] = { ...arr[i], ...partial };
      arr[i] = normalizeOp(arr[i], changedKey);
    }
    applyTints(arr);
  }
  // Apply WITHOUT constraint enforcement (for live input preview; the final
  // clamped value is committed on blur/change).
  function applyToTargetsRaw(partial) {
    const arr = cur();
    for (const i of editTargets()) arr[i] = { ...arr[i], ...partial };
    applyTints(arr);
  }
  // Apply a per-op updater function to every edit target.
  function patch(updater) {
    const arr = cur();
    for (const i of editTargets()) {
      if (arr[i]) arr[i] = { ...arr[i], ...updater(arr[i]) };
    }
    applyTints(arr);
  }

  // Refresh the stage panel + row highlights. `recompute` controls whether the
  // (heavy) preview is rebuilt: the anchor drives the preview, so only an anchor
  // change needs it; a multi-select change re-renders stages (batch targets) +
  // re-highlights but skips the preview rebuild.
  function refreshDetailAndList(recompute) {
    const stages = container.querySelector('#tint-stages');
    if (stages) stages.innerHTML = renderStages();
    // Highlight via OpTable (empty set → anchor only; non-empty → every member).
    if (opSel) opSel.highlightAll();
    bindStageHandlers();
    if (recompute) recomputePreview(true);
  }

  function bindHandlers() {
    // Add image
    const btnAdd = container.querySelector('#btn-add-tint-image');
    if (btnAdd) btnAdd.addEventListener('click', async () => {
      if (!skinName()) { Toast.warning(i18n.t('file.selectSkinFirst')); return; }
      if (fileDialogOpen) return;
      try {
        fileDialogOpen = true; blockUI();
        const defaultPath = await skinPath() || '';
        const result = await api.selectFile([{ name: 'PNG', extensions: ['png'] }], defaultPath);
        if (!result.success || !result.data || !result.data.length) return;
        const skPath = await skinPath();
        const tints = cur();
        for (const absPath of result.data) {
          let relPath = '';
          if (skPath && absPath.toLowerCase().startsWith(skPath.toLowerCase())) {
            relPath = absPath.slice(skPath.length).replace(/^[/\\]/, '');
          }
          if (!relPath) { Toast.warning(i18n.t('file.outsideSkin')); continue; }
          tints.push(defaultOp(relPath));
        }
        applyTints(tints);
        // Select the newly-added row (anchor it for preview).
        opSel.setSelected(new Set(), tints.length - 1);
        render(container);
      } finally { fileDialogOpen = false; unblockUI(); }
    });

    // ── Bind row selection (unified) ── delegated to OpTable.
    // Click thumbnail image/icon to change source path. SourcePicker owns trigger
    // detection + dialog + path normalization; onPick does tint's data write/sync/render.
    container.querySelectorAll('.file-thumb[data-path]').forEach(thumb => {
      SourcePicker.attach(thumb, {
        getSkinPath: () => skinPath(),
        onPick: (chosen) => {
          if (!skinName()) return;
          const idx = parseInt(thumb.closest('[data-idx]')?.dataset.idx, 10);
          if (Number.isNaN(idx)) return;
          const arr = cur();
          if (!arr[idx]) return;
          arr[idx] = { ...arr[idx], source: chosen };
          // Sync source to other selected rows.
          const srcSet = opSel ? opSel.getSelected() : new Set();
          if (srcSet.size > 1 && srcSet.has(idx)) {
            for (const i of srcSet) { if (i !== idx && arr[i]) { arr[i] = { ...arr[i], source: chosen }; } }
          }
          applyTints(arr);
          // Only delete the old source's thumb if no other row still uses it.
          const oldSrc = thumb.dataset.path;
          const stillUsed = arr.some(t => t.source === oldSrc);
          if (!stillUsed) { thumbCache.delete(oldSrc); sourceImgCache.delete(oldSrc); }
          // Save selection before render (which clears it), restore after — mirrors
          // file-copy so changing a source doesn't drop the multi-selection.
          const savedSel = opSel ? [...opSel.getSelected()] : [];
          const savedAnchor = opSel ? opSel.getAnchor() : -1;
          render(document.getElementById('tab-tint'));
          if (opSel && savedSel.length > 1) opSel.setSelected(new Set(savedSel), savedAnchor);
        },
      });
    });

    container.querySelectorAll('.tint-row').forEach(row => {
      opSel.bindRow(row);
    });

    // Strip a destination's extension + @2x, leaving just the stem (shared impl
    // in OpTable.appendSrcExt — the backend re-attaches the source's suffix).
    function appendSrcExt(val) {
      return OpTable.appendSrcExt(val);
    }

    // Multi-select destination sync — shared skeleton (OpTable.createGroupSync),
    // same as file-copy/ini. Tint has no perColumn group headers, so every
    // selected row is a data node (no header virtual-row logic); type-match is
    // a no-op (all rows share the destination field).
    const { syncDest, syncExact } = (() => {
      const { syncField } = OpTable.createGroupSync({
        getSelected: () => opSel ? opSel.getSelected() : new Set(),
        isHeaderControl: () => false,
        headerRowOf: () => null,
        headerIdOf: () => '',
        foldedHeaderForIndex: () => null,
        sourceTypeKey: () => '',
        nodeTypeKey: () => '',
        skipDataNode: (idx) => { const a = cur(); return idx < 0 || idx >= a.length; },
        writeSourceData: (idx, field, val) => { const a = cur(); if (a[idx]) a[idx] = { ...a[idx], [field]: val }; },
        writeTargetData: (idx, field, val) => { const a = cur(); if (a[idx]) a[idx] = { ...a[idx], [field]: val }; },
        applyToHeader: () => {},
        applyToData: (idx, field, val) => {
          if (field === 'destination') {
            const other = container.querySelector(`.tint-dest[data-idx="${idx}"]`);
            if (other) other.value = val;
          } else if (field === 'exact') {
            const other = container.querySelector(`.tint-exact-toggle[data-idx="${idx}"]`);
            if (other) other.checked = !!val;
          }
        },
        commit: () => { applyTints(cur()); },
      });
      return {
        syncDest: (source, val) => syncField(source, 'destination', val),
        syncExact: (source, val) => syncField(source, 'exact', val),
      };
    })();

    // Destination input (per row). When multiple rows are selected, the value
    // is synced to all selected rows.
    container.querySelectorAll('.tint-dest').forEach(input => {
      // Sync only on commit (Enter/blur → change), not per keystroke — mirrors
      // file-copy-editor. Enter/Escape→blur is provided globally by InputConfirm.
      input.addEventListener('change', async () => {
        // ESC restored the original value — keep it, skip normalize + sync.
        if (window.InputConfirm && window.InputConfirm.wasEscCancel(input)) return;
        const idx = parseInt(input.dataset.idx, 10);
        const arr = cur();
        if (!arr[idx]) return;
        let val = input.value.trim().replace(/^["']|["']$/g, '');
        if (!val) {
          input.value = '';
          syncDest(input, '');   // writes source '' + syncs to selected siblings (data + DOM)
          return;
        }
        // Absolute path: try to convert to skin-relative; reject if outside skin
        // (mirrors file-copy-editor so both tabs share the same destination format).
        if (/^[a-zA-Z]:[\\/]?/.test(val)) {
          const sp = skinPath ? await skinPath() : '';
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
        }
        val = val.replace(/\\/g, '/');
        // Strip to a stem (the backend re-attaches the source's @2x + extension).
        val = appendSrcExt(val);
        if (val !== input.value) input.value = val;
        // Writes the source row's normalized destination + syncs to selected
        // siblings (data + DOM).
        syncDest(input, val);
      });
      // Enter/Escape→blur is provided globally by InputConfirm (app.js); blur
      // fires the 'change' handler above (normalize + sync).
    });

    // Exact-match (@2x fallback) toggles — mirrors file-copy's exact toggle.
    container.querySelectorAll('.tint-exact-toggle').forEach(cb => {
      cb.addEventListener('change', () => syncExact(cb, cb.checked));
    });

    // ── Delete zone drop handler ── delegated to OpTable.
    // The delete + shared-source cache eviction lives in applyDeleteOps (the
    // adapter callback), so it also serves the new Del-key deleteSelected.
    opSel.bindDeleteZone(container.querySelector('#tint-delete-zone'));

    // Divider drag → resize split.
    const divider = container.querySelector('#tint-divider');
    if (divider) {
      const ops = container.querySelector('.tint-ops');
      divider.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const splitEl = container.querySelector('.tint-split');
        const rect = splitEl.getBoundingClientRect();
        const onMove = (ev) => {
          const frac = Math.max(0.2, Math.min(0.8, (ev.clientX - rect.left) / rect.width));
          splitFraction = frac;
          ops.style.flex = `0 0 ${(frac * 100).toFixed(1)}%`;
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    // Tab key cycles focus independently within the operations list and within the
    // edit (detail) panel — three independent Tab regions (toolbar is handled elsewhere).
    const bindTabCycle = (root) => {
      if (!root || root._tabBound) return;
      root._tabBound = true;
      root.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const focusable = Array.from(root.querySelectorAll(
          'input:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null);
        if (focusable.length === 0) return;
        e.preventDefault();
        const i = focusable.indexOf(document.activeElement);
        const next = e.shiftKey
          ? (i <= 0 ? focusable.length - 1 : i - 1)
          : (i >= focusable.length - 1 ? 0 : i + 1);
        focusable[next].focus();
      });
    };
    bindTabCycle(container.querySelector('.tint-ops .editor-sticky-header'));
    bindTabCycle(container.querySelector('.tint-ops .files-table-body-scroll'));
    bindTabCycle(container.querySelector('.tint-detail'));

    // Edge-fade overlays on the ops-list scroll viewport.
    setupEdgeFade(container.querySelector('.tint-ops'), container.querySelector('#tint-table-body-scroll'));

    // Double-click (custom 250ms) toggles fit; drag-to-scroll (width-fit mode) pans vertically.
    const previewEl = container.querySelector('#tint-preview');
    if (previewEl && !previewEl._dblclickBound) {
      previewEl._dblclickBound = true;
      let lastClick = 0;
      let dragStart = null;
      let suppressClick = false;
      previewEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('.tint-guide__label')) return;
        if (previewFullFit) return; // no scroll in full-fit
        dragStart = { y: e.clientY, top: previewEl.scrollTop, moved: false };
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragStart) return;
        const dy = e.clientY - dragStart.y;
        if (Math.abs(dy) > 3) dragStart.moved = true;
        previewEl.scrollTop = dragStart.top - dy;
      });
      document.addEventListener('mouseup', () => {
        if (dragStart) {
          if (dragStart.moved) suppressClick = true; // don't let the ensuing click count as a dblclick
          dragStart = null;
        }
      });
      previewEl.addEventListener('click', () => {
        if (suppressClick) { suppressClick = false; return; }
        const now = Date.now();
        if (now - lastClick < 250) {
          previewFullFit = !previewFullFit;
          const canvas = previewEl.querySelector('.tint-preview__canvas');
          if (canvas) applyPreviewFit(canvas, previewEl);
          // Re-measure guide indents now that the canvas has its new display size.
          // (Virtualized previews are fully re-laid-out inside applyPreviewFit →
          // repaintVirtual, so skip the manual call there — canvas.height would be
          // the viewport height, not the full logical height, in that mode.)
          if (!vpActive) {
            const stage = previewEl.querySelector('.tint-preview__stage');
            const t = sel();
            if (stage && t && t.cropEnabled) relayoutGuideIndent(stage, t, canvas.height);
          }
          lastClick = 0;
        } else {
          lastClick = now;
        }
      });
      // Re-fit + re-layout guides when the preview pane resizes (splitter drag,
      // window resize) so width/height-fit and label indents track live.
      if (typeof ResizeObserver !== 'undefined' && !previewEl._resizeObserved) {
        previewEl._resizeObserved = true;
        let raf = 0;
        const onResize = () => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            const canvas = previewEl.querySelector('.tint-preview__canvas');
            if (!canvas) return;
            applyPreviewFit(canvas, previewEl);
            if (!vpActive) {
              const stage = previewEl.querySelector('.tint-preview__stage');
              const t = sel();
              if (stage && t && t.cropEnabled) relayoutGuideIndent(stage, t, canvas.height);
            }
          });
        };
        new ResizeObserver(onResize).observe(previewEl);
      }
    }

    bindStageHandlers();
  }

  function bindStageHandlers() {
    const stages = container.querySelector('#tint-stages');
    if (!stages) return;
    // Stage toggles — applied to all edit targets (anchor's state decides the new value).
    stages.querySelectorAll('.stage__toggle').forEach(tog => {
      tog.addEventListener('click', () => {
        const stage = tog.parentElement.dataset.stage;
        const anchor = sel();
        if (!anchor) return;
        if (stage === 'tint') {
          if (anchor.tintEnabled) {
            // Turning tint OFF → reset color/mode to defaults.
            applyToTargets({ tintEnabled: false, color: '255,255,255,255', mode: 'multiply' });
          } else {
            applyToTargets({ tintEnabled: true });
          }
        } else if (stage === 'percy') {
          if (anchor.cropEnabled) {
            // Turning crop OFF → reset the whole crop/darken block to defaults.
            applyToTargets({ cropEnabled: false, cropA: 0, cropB: 0, cropC: 32768, cropTile: false, cropTileDir: 'down', darkenD: 0, darkenOpacity: 0 });
          } else {
            applyToTargets({ cropEnabled: true });
          }
        }
        refreshDetailAndList(true);
      });
    });
    // Tint color swatch.
    const sw = stages.querySelector('.tint-color-swatch');
    if (sw) sw.addEventListener('click', () => {
      const t = sel();
      if (!t || !t.tintEnabled || sw.disabled) return; // ignore when tint stage is off
      window.ColorPicker.attach(sw, { type: 'rgba', value: t.color, onChange(v) {
        applyToTargets({ color: v });
        sw.style.background = colorToCss(v);
        schedulePreview(true);   // live: coalesced on rAF, downsampled
      }, onClose() {
        schedulePreview(false);  // final: full-quality recompute
      }});
    });
    // Tint mode.
    const modeSel = stages.querySelector('.tint-mode');
    if (modeSel) modeSel.addEventListener('change', () => {
      applyToTargets({ mode: modeSel.value });
      schedulePreview();
    });
    // Crop inputs.
    bindNumber(stages, '.crop-a', 'cropA');
    bindNumber(stages, '.crop-b', 'cropB');
    bindNumber(stages, '.crop-c', 'cropC');
    const tileCb = stages.querySelector('.crop-tile');
    const tileDir = stages.querySelector('.crop-tile-dir');
    if (tileCb) tileCb.addEventListener('change', () => {
      applyToTargets({ cropTile: tileCb.checked });
      // Sync the arrow's green state without re-rendering (keeps the toggle animation smooth).
      if (tileDir) tileDir.classList.toggle('crop-tile-dir--on', tileCb.checked);
      schedulePreview();
    });
    // Tile direction toggle (▼ down / ▲ up) — only effective while tiling is on.
    if (tileDir) tileDir.addEventListener('click', () => {
      const anchor = sel();
      if (!anchor || !anchor.cropTile) return; // no effect when tiling is off
      const next = anchor.cropTileDir === 'up' ? 'down' : 'up';
      applyToTargets({ cropTileDir: next });
      // Update icon + title in place (no full re-render).
      tileDir.textContent = next === 'up' ? '▲' : '▼';
      tileDir.title = next === 'up' ? i18n.t('edit.tileUpHint') : i18n.t('edit.tileDownHint');
      schedulePreview();
    });
    // Darken inputs.
    bindNumber(stages, '.darken-d', 'darkenD');
    bindNumber(stages, '.darken-opacity', 'darkenOpacity');
  }

  function bindNumber(stages, sel, key) {
    const el = stages.querySelector(sel);
    if (!el) return;
    const readVal = () => Math.max(0, Math.floor(+el.value || 0));
    // Live preview while typing (no constraint enforcement — let the user drag
    // freely; the clamped value is committed on blur/Enter).
    el.addEventListener('input', () => {
      applyToTargetsRaw({ [key]: readVal() });
      schedulePreview(true);
    });
    // Confirm on blur/Enter: enforce the constraint and reflect the clamped value
    // back into the input. Listen to both `change` and `blur` since some WebViews
    // are unreliable about firing `change` for number inputs.
    const commit = () => {
      const inputVal = readVal();
      applyToTargets({ [key]: inputVal });
      // Read the clamped value back from the anchor target.
      const arr = cur();
      const t = arr[selectedIdx()];
      const clamped = t && t[key] != null ? t[key] : inputVal;
      el.value = clamped;
      schedulePreview(true);
    };
    el.addEventListener('change', commit);
    el.addEventListener('blur', commit);
    // Enter/Escape→blur is provided globally by InputConfirm (app.js); blur
    // fires `commit` above (enforce constraint + reflect clamped value).
    // Wheel adjusts value and updates live (some WebViews don't fire input on wheel).
    // No preventDefault here, so mark passive to avoid the non-passive-listener warning.
    el.addEventListener('wheel', () => { requestAnimationFrame(commit); }, { passive: true });
  }

  function defaultOp(relPath) {
    return {
      source: relPath, color: '255,255,255,255', mode: 'multiply', destination: '',
      tintEnabled: false,
      cropEnabled: false, cropA: 0, cropB: 0, cropC: 32768, cropTile: false, cropTileDir: 'down',
      darkenEnabled: false, darkenD: 0, darkenOpacity: 0,
      exact: false,
    };
  }

  function layoutColumns() { /* preview uses canvas scaling; no-op */ }

  // Return the currently-selected tint rows as plain objects (deep-cloned).
  // Mirrors deleteSelected's index resolution: empty set falls back to the
  // anchor row (the highlighted preview row).
  function getSelectedActions() {
    const set = opSel ? opSel.getSelected() : new Set();
    const tints = cur();
    const idxs = set.size > 0 ? [...set] : (opSel && opSel.getAnchor() >= 0 ? [opSel.getAnchor()] : []);
    if (idxs.length === 0 || tints.length === 0) return [];
    const out = [];
    for (const i of idxs.sort((a, b) => a - b)) {
      if (i >= 0 && i < tints.length) out.push(tints[i]);
    }
    return JSON.parse(JSON.stringify(out));
  }

  window.TintEditor = { init, render, layoutColumns, deleteSelected, getSelectedActions, hasSelection: () => !!(opSel && opSel.getSelected().size > 0), clearSelection: () => opSel && opSel.clearSelection(), invalidateCache: () => { thumbCache.clear(); sourceImgCache.clear(); } };
})();
