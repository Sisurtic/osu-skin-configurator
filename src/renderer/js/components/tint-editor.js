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

  const IMG_EXTS = new Set(['.png']);
  const thumbCache = new Map();      // src path → dataURL (for list thumbnails)
  const sourceImgCache = new Map();  // src path → HTMLImageElement (for preview)
  const FADE = 'tint-preview--fade';
  const MODES = ['multiply', 'lightness', 'screen', 'overlay', 'replace'];

  function isImagePath(p) { return IMG_EXTS.has((p.match(/\.[^.]+$/) || [''])[0].toLowerCase()); }
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
        interactiveSelector: 'input, select, textarea, button',
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
                  <colgroup><col><col></colgroup>
                  <thead><tr>
                    <th>${i18n.t('tint.colSource')}</th>
                    <th title="${escapeHtml(i18n.t('tint.colDestTitle'))}">${i18n.t('tint.colDest')}</th>
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
          <colgroup><col><col></colgroup>
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
    return `<tr class="tint-row${selCls}" data-idx="${idx}">
      <td><span class="file-thumb" data-path="${escapeHtml(src)}" title="${escapeHtml(src)}" style="display:inline-flex;align-items:center;gap:6px">${thumbHtmlFor(src)}</span></td>
      <td><input type="text" class="form-input tint-dest" data-idx="${idx}" value="${escapeHtml(t.destination || '')}" autocomplete="off" spellcheck="false" placeholder="${i18n.t('tint.destPlaceholder')}"></td>
    </tr>`;
  }

  function thumbHtmlFor(src) {
    const label = pathBasename(src);
    if (!isImagePath(src)) return `📄 ${escapeHtml(label)}`;
    if (thumbCache.has(src)) {
      return `<img src="${thumbCache.get(src)}" title="${escapeHtml(src)}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0"> ${escapeHtml(label)}`;
    }
    return `📄 ${escapeHtml(label)}`;
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
        ${field(i18n.t('edit.cropC') + ' (px)', `<input type="number" min="0" step="1" class="form-input crop-c"${dis(cropOn)} value="${t.cropC || 32800}">`)}
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

  // Render one frame. Tint-only uses the WebGL path (fast, smooth live dragging).
  // When crop or darken is enabled we fall back to the canvas2D pipeline — its
  // drawImage scaling produced cleaner results than the GL shader for the crop
  // body stretch / darken composite.
  function drawProcessed(shown, img, t, srcKey) {
    const srcW = img.naturalWidth, srcH = img.naturalHeight;
    const cropOn = !!t.cropEnabled;
    const darkenOn = isDarkening(t);
    const cropOutH = Math.max(1, Math.round(+t.cropC || 32800));
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
    shown.style.width = '';
    shown.style.height = '';
    shown.style.aspectRatio = '';
    let canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = srcH;
    canvas.getContext('2d').drawImage(img, 0, 0);
    if (t.tintEnabled) canvas = tintCanvas(canvas, t.color, t.mode);
    if (cropOn) canvas = cropCanvas(canvas, +t.cropA || 0, +t.cropB || 0, +t.cropC || 32800, !!t.cropTile, t.cropTileDir);
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
      if (fadeOnChange) {
        previewEl.classList.remove(FADE);
        void previewEl.offsetWidth;
        previewEl.classList.add(FADE);
      }
    } catch (_) { /* ignore */ }
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
    if (!skinPath) return;
    const sk = skinName();
    if (!sk) return;
    const skPath = await skinPath();
    const norm = skPath ? skPath.replace(/\\/g, '/').replace(/\/$/, '') : '';
    const spans = container.querySelectorAll('.file-thumb[data-path]');
    for (const span of spans) {
      const raw = span.dataset.path || '';
      if (!isImagePath(raw) || thumbCache.has(raw)) continue;
      let p = raw;
      const isAbs = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');
      if (!isAbs && norm) p = norm + '/' + p.replace(/\\/g, '/');
      const result = await api.getPreviewDataUrl(p);
      if (result && result.success && result.data) {
        thumbCache.set(raw, result.data);
        const label = escapeHtml(pathBasename(raw));
        const pathTitle = escapeHtml(raw);
        span.innerHTML = `<img src="${result.data}" title="${pathTitle}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0"> ${label}`;
      }
    }
  }

  // Add top/bottom edge-fade overlays to a scroll viewport.
  // `relativeEl` is the positioned ancestor the fades attach to; `scrollEl` is the
  // scroller (defaults to relativeEl itself). `bg` overrides the fade gradient color.
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
    // opSel.onSelectionChange → refreshDetailAndList() (re-render stages +
    // re-highlight + recompute preview), so the preview follows the anchor.
    container.querySelectorAll('.tint-row').forEach(row => {
      opSel.bindRow(row);
    });

    // Normalize a file dest's extension to the SOURCE's extension (shared impl
    // in OpTable.appendSrcExt — see the comment there).
    function appendSrcExt(val, source) {
      return OpTable.appendSrcExt(val, source);
    }

    // Destination input (per row).
    container.querySelectorAll('.tint-dest').forEach(input => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.dataset.idx, 10);
        const arr = cur();
        if (arr[idx]) { arr[idx] = { ...arr[idx], destination: input.value }; applyTints(arr); }
      });
      input.addEventListener('change', async () => {
        const idx = parseInt(input.dataset.idx, 10);
        const arr = cur();
        if (!arr[idx]) return;
        let val = input.value.trim().replace(/^["']|["']$/g, '');
        if (!val) { arr[idx] = { ...arr[idx], destination: '' }; applyTints(arr); input.value = ''; return; }
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
        // Keep the user's extension if present; otherwise append the source's
        // extension (mirrors file-copy-editor + the backend).
        val = appendSrcExt(val, arr[idx].source || '');
        if (val !== input.value) input.value = val;
        arr[idx] = { ...arr[idx], destination: val };
        applyTints(arr);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
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
          const stage = previewEl.querySelector('.tint-preview__stage');
          const t = sel();
          if (stage && t && t.cropEnabled) relayoutGuideIndent(stage, t, canvas.height);
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
            const stage = previewEl.querySelector('.tint-preview__stage');
            const t = sel();
            if (stage && t && t.cropEnabled) relayoutGuideIndent(stage, t, canvas.height);
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
            applyToTargets({ cropEnabled: false, cropA: 0, cropB: 0, cropC: 32800, cropTile: false, cropTileDir: 'down', darkenD: 0, darkenOpacity: 0 });
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
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
    // Wheel adjusts value and updates live (some WebViews don't fire input on wheel).
    // No preventDefault here, so mark passive to avoid the non-passive-listener warning.
    el.addEventListener('wheel', () => { requestAnimationFrame(commit); }, { passive: true });
  }

  function defaultOp(relPath) {
    return {
      source: relPath, color: '255,255,255,255', mode: 'multiply', destination: '',
      tintEnabled: false,
      cropEnabled: false, cropA: 0, cropB: 0, cropC: 32800, cropTile: false, cropTileDir: 'down',
      darkenEnabled: false, darkenD: 0, darkenOpacity: 0,
    };
  }

  function layoutColumns() { /* preview uses canvas scaling; no-op */ }

  window.TintEditor = { init, render, layoutColumns, deleteSelected, invalidateCache: () => { thumbCache.clear(); sourceImgCache.clear(); } };
})();
