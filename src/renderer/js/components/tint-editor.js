// Image editor — image editing tab.
// Left: operations list (source + destination per row, drag-to-delete).
// Right: live canvas preview of the selected row + stage controls (tint → crop → darken).
// Each stage is toggled by a clickable header (green underline when enabled).
// Preview is computed client-side on a <canvas>; apply runs the same pipeline in Rust.
// Selection + drag-to-delete is delegated to the shared OpTable module (`opSel`).
// opSel.anchorIndex drives the preview; opSel.selectedIndices drives
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

  const IMG_EXTS = new Set(['.png']);
  const thumbCache = new Map();      // src path → dataURL (for list thumbnails)
  const sourceImgCache = new Map();  // src path → HTMLImageElement (for preview)
  const FADE = 'tint-preview--fade';
  // Blend-mode table + tint color math live in the shared TintPipeline module
  // (reused by layer-editor's per-layer tint). Alias them locally so the rest of
  // this file reads unchanged.
  const { MODE_GROUPS, TINT_MODE_IDX, HUE_SHIFT_BASE_RGB,
    colorToCss, hueShiftPreviewCss,
    rgb2hsl, hsl2rgb, hslCombine,
    parseColorUniforms, tintCanvas,
    getTintedSourceGL, buildTintedSource, tintSourceSig } = window.TintPipeline;
  // Above this logical output height the canvas2D backing would be too large to
  // repaint per frame (e.g. cropC=32768 → ~8M px → ~200ms/clear+drawImage). We
  // instead render only the visible viewport (sticky canvas) and keep a spacer
  // the size of the full logical output to drive the scrollbar. Below it the
  // whole canvas is small enough to render directly (no virtualization needed).
  const VIRTUALIZE_THRESHOLD = 2000;

  function isImagePath(p) { return IMG_EXTS.has((p.match(/\.[^.]+$/) || [''])[0].toLowerCase()); }
  // Whether a tint source has an @2x HD suffix (the Exact toggle only applies to these).
  function has2x(t) { return /@2x\.[^.]+$/i.test(t.source || ''); }
  // ── Sequence-frame grouping (ported from file-copy-editor) ──
  // Parsed frame info for a tint's source, or null if it is not a frame.
  function frameOf(t) { return OpTable.parseFrame(t.source || ''); }
  // Whether a tint source is an animation frame ("-N" or no-hyphen "N" allowlist).
  function isFrame(t) { return OpTable.isFrame(t.source || ''); }
  // Sequence-group key for a tint source. Tints are homogeneous (no type prefix).
  function seqKeyOf(t) { return OpTable.seqKey(t.source || '', 'tint'); }
  // Group label: base + '{n}' placeholder in the frame's style, keeping @2x/ext.
  function groupLabel(t) {
    const f = frameOf(t);
    const b = (t.source || '').replace(/\\/g, '/').split('/').pop() || '';
    if (!f) return b;
    const ext = (b.match(/@2x\.[^.]+$/i) || b.match(/\.[^.]+$/) || [''])[0];
    return f.base + (f.style === '-' ? '-{n}' : '{n}') + ext;
  }
  // Expanded sequence groups (by STABLE per-instance gid). Default: collapsed.
  const expandedSeqGroups = new Set();
  // Temporary tint/crop params for a whole-group selection, keyed by seqKey.
  // Mirrors the group-header destination/exact model: editing tint/crop on the
  // stage while a whole group is selected writes HERE (not to any member), and
  // is applied to every member only via the Fill button. Falls back to the
  // first member's values when unset (the stage's initial template).
  const headerTempParams = new Map();
  // Snapshot of FOLDED group-header destination + exact, taken at render start
  // so a rebuild preserves an in-flight header edit. Keyed by per-instance gid.
  let _headerDestSnapshot = {};
  function pathBasename(p) { return OpTable.pathBasename(p); }
  function escapeHtml(s) { return OpTable.escapeHtml(s); }
  function blockUI() { document.body.style.cursor = 'wait'; }
  function unblockUI() { document.body.style.cursor = ''; }

  function init(getter, setter, skName, presetIdFn, skPathFn) {
    getTints = typeof getter === 'function' ? getter : () => getter;
    setTints = typeof setter === 'function' ? setter : () => {};
    skinName = typeof skName === 'function' ? skName : () => skName;
    presetId = typeof presetIdFn === 'function' ? presetIdFn : () => presetIdFn;
    skinPath = typeof skPathFn === 'function' ? skPathFn : () => skPathFn;
    // A new preset/group edit session: drop any leftover stage tint/crop temp
    // values from the previous session (render() also clears, but init guards
    // paths that re-init without an immediate render).
    headerTempParams.clear();
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
  function hasSelection() { return !!(opSel && opSel.getAnchor() >= 0 && opSel.getSelected().size > 0); }
  // Indices a row represents: a plain row → [idx]; a sequence-group header →
  // the members of THIS group only (its rendered data-range [i,j)). Scoping to
  // the range — not a global seqKey scan — keeps same-name groups from all
  // selecting together.
  function rowMemberIndices(row) {
    const range = row.dataset.range;
    if (range && row.classList.contains('tint-seq-group')) {
      const [a, b] = range.split('-').map(n => parseInt(n, 10));
      if (!isNaN(a) && !isNaN(b)) { const out = []; for (let k = a; k < b; k++) out.push(k); return out; }
    }
    const ri = parseInt(row.dataset.idx, 10);
    return isNaN(ri) ? [] : [ri];
  }
  // Shift-range member set: FOLDED header → whole group; EXPANDED → first member.
  function rowRangeMemberIndices(row) {
    const key = row.dataset.seqKey;
    if (key && row.classList.contains('tint-seq-group')) {
      const members = rowMemberIndices(row);
      return expandedSeqGroups.has(key) ? (members.length ? [members[0]] : []) : members;
    }
    const ri = parseInt(row.dataset.idx, 10);
    return isNaN(ri) ? [] : [ri];
  }

  // ── Render ──
  function render(parent) {
    container = parent;
    const tints = cur();
    // Snapshot FOLDED group-header destination + exact from the live DOM before
    // rebuilding, so renderGroup can preserve an in-flight header edit (matches
    // file-copy). Keyed by per-instance gid.
    _headerDestSnapshot = {};
    if (container && container.querySelectorAll) {
      container.querySelectorAll('.tint-seq-group:not(.tint-seq-group--expanded)').forEach(r => {
        const gid = r.dataset.gid;
        const dest = r.querySelector('.tint-seq-dest[data-group-header="1"]');
        const ex = r.querySelector('.tint-seq-exact-toggle[data-group-header="1"]');
        if (gid && dest) {
          _headerDestSnapshot[gid] = { dest: dest.value, exact: ex ? !!ex.checked : null };
        }
      });
    }
    // NOTE: do NOT clear headerTempParams here — a full table render rebuilds
    // every group-header row, but an in-flight header edit (tint/crop temp)
    // must survive it. Only a new edit session (init) clears them.
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
        // A plain row → [idx]; a sequence-group header → every member index.
        rowMembers: (row) => rowMemberIndices(row),
        rowAnchor: (row) => { const m = rowMemberIndices(row); return m.length ? m[0] : -1; },
        // Shift-range: FOLDED header → whole group; EXPANDED → first member only.
        rowRangeMembers: (row) => rowRangeMemberIndices(row),
        isGroupMemberRow: (row) => !!row.dataset.groupParent,
        // Selection change → refresh stages + re-highlight. Only recompute the
        // (heavy) preview when the ANCHOR moved (it drives the preview); a mere
        // multi-select change (Ctrl/Shift adding rows) just re-highlights + re-
        // renders the stage panel (batch-edit targets changed), no preview rebuild.
        onSelectionChange: ({ anchor }) => {
          const moved = anchor !== lastAnchor;
          lastAnchor = anchor;
          // NOTE: stage tint/crop temp values (headerTempParams) are NOT cleared
          // here — they persist across selection changes just like the group-
          // header destination/exact inputs (whose values live in the DOM and
          // survive until a full table render). They are only dropped when their
          // group is deleted/re-grouped (see render()) or consumed by Fill.
          refreshDetailAndList(moved);
        },
        applyDelete: (indicesDesc) => applyDeleteOps(indicesDesc),
        reorder: (fromIndices, toIndex) => applyReorderOps(fromIndices, toIndex),
      });
      // Default anchor = 0 (preview the first row on initial load).
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
          </div>
          <div class="files-table-body-scroll" id="tint-table-body-scroll">${renderList(tints)}</div>
        </div>
        <div class="tint-divider" id="tint-divider"></div>
        <div class="tint-detail" style="flex:1 1 0">
          ${hasSelection()
            ? `<div class="tint-preview" id="tint-preview"></div>
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
    // Build a render plan: coalesce CONSECUTIVE frame tints with the same base,
    // same style, and a strictly ascending index column (0,1,2…) into a group.
    // Length ≥ 2, else singletons. A repeated/out-of-order index or a style
    // change ends the group → separate group (or singleton).
    const plan = []; // { type:'row', i } | { type:'group', key, range:[i,j] }
    let i = 0;
    while (i < tints.length) {
      const f0 = frameOf(tints[i]);
      if (f0) {
        const key = seqKeyOf(tints[i]);
        let j = i + 1, prev = f0.index;
        while (j < tints.length) {
          const fj = frameOf(tints[j]);
          if (!fj || seqKeyOf(tints[j]) !== key || fj.style !== f0.style || fj.index !== prev + 1) break;
          prev = fj.index; j++;
        }
        if (j - i >= 2) { plan.push({ type: 'group', key, range: [i, j] }); i = j; continue; }
      }
      plan.push({ type: 'row', i });
      i++;
    }
    // Assign stable per-instance gids (writes _groupId onto the real member tint
    // objects; reuses when members already share one). tints are store objects,
    // so _groupId survives reorder → expand state survives.
    const groupEntries = [];
    for (const p of plan) if (p.type === 'group') groupEntries.push({ members: tints.slice(p.range[0], p.range[1]) });
    OpTable.assignSeqGroupIds(groupEntries);
    let gi = 0;
    for (const p of plan) if (p.type === 'group') p.gid = groupEntries[gi++].gid;
    // Drop expand-state for gids that no longer exist (deleted/re-grouped) so
    // expandedSeqGroups can't accumulate dead keys across renders.
    OpTable.pruneExpanded(expandedSeqGroups, groupEntries.map(e => e.gid));
    const bodyHtml = plan.map(p => p.type === 'group' ? renderGroup(tints, p) : renderRow(tints[p.i], p.i, null)).join('');
    return `
      <div class="files-body-table"><div class="table-wrap">
        <div class="op-grid op-grid--tint">
          <div class="op-row op-row--head">
            <div class="op-cell op-cell--head" data-col="file">${i18n.t('tint.colSource')}</div>
            <div class="op-cell op-cell--head" data-col="dest" title="${escapeHtml(i18n.t('tint.colDestTitle'))}">${i18n.t('tint.colDest')}</div>
            <div class="op-cell op-cell--head" data-col="exact" title="${escapeHtml(i18n.t('tint.colExactTitle'))}">${i18n.t('tint.colExact')}</div>
          </div>
          ${bodyHtml}
        </div>
      </div></div>`;
  }

  function renderRow(t, idx, groupGid) {
    const src = t.source || '';
    const hidden = groupGid && !expandedSeqGroups.has(groupGid) ? ' style="display:none"' : '';
    const parentAttr = groupGid ? ` data-group-parent="${escapeHtml(groupGid)}"` : '';
    // Initial paint: match OpTable's highlight rule (in-set, or anchor when empty).
    // OpTable.highlightAll() reconciles this after rows are bound.
    const set = opSel ? opSel.getSelected() : new Set();
    const anchor = opSel ? opSel.getAnchor() : 0;
    const isSel = set.has(idx) || (set.size === 0 && idx === anchor);
    const selCls = isSel ? ' row--selected' : '';
    // Exact toggle only applies to @2x sources (fallback to the non-HD variant
    // when the @2x file is missing and Exact is off) — mirrors file-copy.
    // Non-@2x sources render a dimmed, disabled, unchecked toggle (not an empty cell).
    const is2x = has2x(t);
    const exactCell = `<div class="op-cell" data-col="exact"><label class="toggle${is2x ? '' : ' is-disabled'}">
        <input type="checkbox" class="tint-exact-toggle" data-idx="${idx}" ${(is2x && t.exact) ? 'checked' : ''}${is2x ? '' : ' disabled'}>
        <span class="toggle__slider"></span>
      </label></div>`;
    return `<div class="op-row tint-row${selCls}" data-idx="${idx}"${parentAttr}${hidden}>
      <div class="op-cell" data-col="file"><span class="file-thumb" data-path="${escapeHtml(src)}" style="display:inline-flex;align-items:center;gap:6px">${thumbHtmlFor(src)}</span></div>
      <div class="op-cell" data-col="dest"><input type="text" class="form-input tint-dest" data-idx="${idx}" value="${escapeHtml(t.destination || '')}" autocomplete="off" spellcheck="false" placeholder="${i18n.t('tint.destPlaceholder')}"></div>
      ${exactCell}
    </div>`;
  }

  function renderGroup(tints, g) {
    const members = tints.slice(g.range[0], g.range[1]);
    // gid = a STABLE per-instance token (from the members' _groupId). Unique per
    // group even for same-name groups; survives reorder. Used as the expand-set
    // key + the data-group-parent link so expanding one group never touches a
    // same-name sibling. seqKey is kept only for control sync.
    const gid = g.gid;
    const expanded = expandedSeqGroups.has(gid);
    const first = members[0];
    const label = groupLabel(first);
    const groupHas2x = members.every(m => has2x(m));
    const ghAttr = `data-group-header="1" data-group="${escapeHtml(g.key)}"`;
    const rangeAttr = `data-range="${g.range[0]}-${g.range[1]}"`;
    const gidAttr = `data-gid="${escapeHtml(gid)}"`;
    // Group-header dest/exact: folded snapshot (uncommitted folded edit) if set,
    // else the first member's value. Re-source bakes the old header's values
    // (incl. stage temp color/crop) into the new rows' own data (collectTargets
    // reads the header input box + headerTempParams), so first-member display is
    // correct with no carryStore.
    const snap = _headerDestSnapshot[gid];
    const headerDest = (snap && snap.dest != null) ? snap.dest : (first.destination || '');
    const headerExact = (snap && snap.exact != null) ? snap.exact : !!first.exact;
    const destCell = `<div class="op-cell" data-col="dest"><input type="text" class="form-input tint-dest tint-seq-dest" data-seq-key="${escapeHtml(g.key)}" data-idx="G-${escapeHtml(g.key)}" ${ghAttr} value="${escapeHtml(headerDest)}" autocomplete="off" spellcheck="false" placeholder="${i18n.t('tint.destPlaceholder')}"></div>`;
    const fillBtn = `<button type="button" class="btn btn--secondary btn--sm tint-seq-fill-btn" data-seq-key="${escapeHtml(g.key)}" title="${escapeHtml(i18n.t('file.fillAllTitle'))}" style="padding:4px 6px;flex:0 0 auto;white-space:nowrap;margin-left:auto">${i18n.t('file.fillAll')}</button>`;
    const exactToggle = `<label class="toggle${groupHas2x ? '' : ' is-disabled'}" style="flex:0 0 auto">
        <input type="checkbox" class="tint-seq-exact-toggle" data-seq-key="${escapeHtml(g.key)}" ${ghAttr} ${(groupHas2x && headerExact) ? 'checked' : ''}${groupHas2x ? '' : ' disabled'}>
        <span class="toggle__slider"></span>
      </label>`;
    const exactCell = `<div class="op-cell" data-col="exact"><div style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap">${exactToggle}${fillBtn}</div></div>`;
    const rows = [
      `<div class="op-row tint-row tint-seq-group${expanded ? ' tint-seq-group--expanded' : ''}" data-seq-key="${escapeHtml(g.key)}" data-idx="G-${escapeHtml(g.key)}" ${rangeAttr} ${gidAttr}>
        <div class="op-cell" data-col="file"><span style="display:flex;align-items:center;gap:6px;width:100%"><span class="file-thumb file-seq-resrc" data-group-resrc="${escapeHtml(gid)}" data-path="${escapeHtml(first.source || '')}" title="${escapeHtml(i18n.t('file.resrcGroupTitle'))}" style="display:inline-flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0">${thumbHtmlFor(first.source || '', label)}</span><span style="color:var(--text-muted);flex:0 0 auto;margin-right:-12px">(${members.length})</span></span></div>
        ${destCell}
        ${exactCell}
      </div>`,
      ...members.map((t, k) => renderRow(t, g.range[0] + k, gid))
    ];
    return rows.join('');
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

  function thumbHtmlFor(src, label) {
    return thumbLoader.htmlFor(src, label != null ? label : pathBasename(src));
  }

  // ── Stage controls (right panel, under preview; no fade) ──
  // field() returns a label+input row aligned in a 2-col grid for vertical alignment.
  // `enabled` (default true): when false, the field is disabled — drop the hint
  // title (no tooltip on inert controls).
  function field(label, inner, hint, enabled = true) {
    const hintAttr = (hint && enabled) ? ` title="${escapeHtml(hint)}"` : '';
    return `<div class="stage__field"${hintAttr}><span class="stage__field-label">${escapeHtml(label)}</span><span class="stage__field-input">${inner}</span></div>`;
  }
  // Darkening is a derived sub-state of the crop stage: active only when crop is
  // enabled AND both darkenD and darkenOpacity are > 0.
  function isDarkening(t) {
    return !!t.cropEnabled && (+t.darkenOpacity || 0) > 0;
  }
  function renderStages() {
    // Whole-group selection reads the group's temp params (→ first member as
    // template); otherwise the anchor member. Temp edits never write member data.
    const t = stageParams();
    if (!t) return '';
    const tintOn = !!t.tintEnabled;
    const cropOn = !!t.cropEnabled;
    const dis = (on) => on ? '' : 'disabled';
    // Mode options as a native <select> (hidden by Dropdown.enhance, which
    // overlays the custom trigger + popover). Options read from MODE_GROUPS so
    // the divider grouping matches the custom menu.
    const curMode = t.mode || 'replace';
    const modeOpts = MODE_GROUPS.map(modes =>
      modes.map(m => `<option value="${m}" ${m === curMode ? 'selected' : ''}>${i18n.t('tint.mode_' + m)}</option>`).join('')
    ).join('');
    const tileDown = t.cropTileDir !== 'up'; // default: tile downward
    const tileDirIcon = tileDown ? '▼' : '▲';
    const tileDirTitle = tileDown ? i18n.t('edit.tileDownHint') : i18n.t('edit.tileUpHint');
    const tileDirCls = t.cropTile ? ' crop-tile-dir--on' : '';
    return `
      ${stageBlock('tint', tintOn, i18n.t('edit.stageTint'), `
        <div class="stage__field" style="flex:1 1 100%">
          <span class="stage__field-input" style="display:flex;align-items:center;gap:8px">
            <button type="button" class="tint-color-swatch"${dis(tintOn)} style="width:24px;height:24px;border-radius:4px;border:1px solid var(--border);background:${t.mode === 'hue-shift' ? hueShiftPreviewCss(t) : colorToCss(t.color)};flex:0 0 auto"></button>
            <select class="form-input tint-mode"${dis(tintOn)} style="flex:1;min-width:0">${modeOpts}</select>
          </span>
        </div>`)}
      ${stageBlock('percy', cropOn, i18n.t('edit.stagePercy'), `
        ${field(i18n.t('edit.cropA') + ' (px)', `<input type="number" min="0" step="1" class="form-input crop-a"${dis(cropOn)} value="${t.cropA || 0}">`, i18n.t('edit.cropAHint'), cropOn)}
        ${field(i18n.t('edit.cropD') + ' (px)', `<input type="number" min="0" step="1" class="form-input crop-d"${dis(cropOn)} value="${t.cropD || 0}">`, i18n.t('edit.cropDHint'), cropOn)}
        ${field(i18n.t('edit.cropB') + ' (px)', `<input type="number" min="0" step="1" class="form-input crop-b"${dis(cropOn)} value="${t.cropB || 0}">`, i18n.t('edit.cropBHint'), cropOn)}
        ${field(i18n.t('edit.cropC') + ' (px)', `<input type="number" min="0" step="1" class="form-input crop-c"${dis(cropOn)} value="${t.cropC || 32768}">`, i18n.t('edit.cropCHint'), cropOn)}
        ${field(i18n.t('edit.cropTile'), `<div style="display:flex;align-items:center;gap:6px;width:100%;min-height:32px"><label class="toggle crop-tile-toggle${cropOn ? '' : ' is-disabled'}"><input type="checkbox" class="crop-tile"${dis(cropOn)} ${t.cropTile ? 'checked' : ''}><span class="toggle__slider"></span></label><button type="button" class="crop-tile-dir${tileDirCls}"${dis(cropOn)}${cropOn ? ` title="${escapeHtml(tileDirTitle)}"` : ''}>${tileDirIcon}</button></div>`)}
        <div class="stage__sep"></div>
        ${field(i18n.t('edit.darkenD') + ' (px)', `<input type="number" min="0" step="1" class="form-input darken-d"${dis(cropOn)} value="${t.darkenD || 0}">`, i18n.t('edit.darkenDHint'), cropOn)}
        ${field(i18n.t('edit.darkenOpacity') + ' (%)', `<input type="number" min="0" max="100" step="1" class="form-input darken-opacity"${dis(cropOn)} value="${t.darkenOpacity || 0}">`, i18n.t('edit.darkenOpacityHint'), cropOn)}
      `)}`;
  }

  function stageBlock(name, enabled, label, inner) {
    return `<div class="stage${enabled ? ' stage--active' : ''}" data-stage="${name}">
      <div class="stage__toggle">${escapeHtml(label)}</div>
      <div class="stage__body">${inner}</div>
    </div>`;
  }

  // ── TintTransform: pan/zoom engine for the NON-virtualized preview ──
  // Mirror of ImageViewer's transform model, but tint-specific: X is ALWAYS
  // centered (no horizontal pan / no ox), only Y pans. The group element holds
  // the canvas (+ guide) at its NATURAL size; the engine scales it and offsets
  // it vertically. State is keyed on the preview element via a WeakMap so pan/
  // zoom survives across re-mounts (anchor change rebuilds the group, but the
  // state is intentionally dropped via reset() on anchor change — see stage D).
  //
  // Interactions:
  //   • Alt + wheel   → zoom (X stays centered, Y follows the cursor)
  //   • wheel         → vertical pan (Shift = 10× faster)
  //   • drag          → vertical pan
  //   • double-click  → cycle: custom → fit → actual(1:1) → fit → …
  const TintTransform = (function () {
    const states = new WeakMap();

    function getSt(previewEl) {
      let st = states.get(previewEl);
      if (!st) {
        // virtual: true while the group shows a viewport SLICE (cropC>threshold).
        // In that mode groupNatH = st.total (not the canvas backing, which is
        // just the slice), and apply() schedules a viewport re-raster via
        // paintViewportFromTransform instead of relying on a pre-drawn canvas.
        st = { scale: null, oy: 0, mode: 'fit', dragging: null,
               virtual: false, total: 0, vpSrc: null, cropArgs: null, paintRaf: 0 };
        states.set(previewEl, st);
      }
      return st;
    }

    // Update the virtualization context (called on full rebuild / live redraw).
    // cropArgs is the argument bundle paintViewportFromTransform forwards to
    // cropViewportCanvas; vpSrc is the tinted source canvas; total = cropC.
    function configure(previewEl, opts) {
      const st = getSt(previewEl);
      st.virtual = !!(opts && opts.virtual);
      st.total = (opts && opts.total) || 0;
      st.vpSrc = (opts && opts.vpSrc) || null;
      st.cropArgs = (opts && opts.cropArgs) || null;
    }

    // Geometry context for a group's NATURAL (un-scaled) size.
    // Non-virtualized: natural size = the canvas backing (outW × outH).
    // Virtualized: the canvas is only a viewport SLICE — its backing is a
    // downsampled sliver (round(outW*ds) wide), NOT the natural width. So the
    // natural width must come from the tinted source (st.vpSrc.width = outW),
    // never from canvas.width. Natural height = st.total (the full cropC output).
    function geom(previewEl, group, st) {
      let groupNatW, groupNatH;
      if (st && st.virtual) {
        groupNatW = (st.vpSrc && st.vpSrc.width) || group.offsetWidth;
        groupNatH = st.total || group.offsetHeight;
      } else {
        const canvas = group.querySelector('.tint-preview__canvas');
        groupNatW = canvas ? canvas.width : group.offsetWidth;
        groupNatH = canvas ? canvas.height : group.offsetHeight;
      }
      const paneW = previewEl.clientWidth;
      const paneH = previewEl.clientHeight > 0 ? previewEl.clientHeight : 400;
      return { groupNatW, groupNatH, paneW, paneH };
    }

    // Fit = containment: scale so the WHOLE image fits entirely inside the pane
    // (the smaller of the width/height ratios). Every guide line lands within
    // the pane and is visible at once — no panning needed, the whole output is
    // already on screen. (Zoom in past fit to pan around a partial view.)
    function fitScale(g) {
      if (!g.paneW || !g.paneH || !g.groupNatW || !g.groupNatH) return 1;
      return Math.min(g.paneW / g.groupNatW, g.paneH / g.groupNatH);
    }

    // Zoom badge text (top-right of the pane), mirroring ImageViewer.
    function badgeText(st) {
      if (st.mode === 'fit') return 'Fit';
      if (st.mode === 'actual') return '100%';
      return Math.round((st.scale || 1) * 100) + '%';
    }

    // Ensure the badge exists on the pane and reflects the current state. The
    // badge is a pane-level overlay (not inside the scaled group) so it stays
    // fixed at the top-right regardless of pan/zoom.
    function syncBadge(previewEl, st) {
      // The badge is re-created if it was dropped (previewEl.innerHTML='' on a
      // full rebuild clears it, but the stale reference survives in state).
      if (!st.badge || !st.badge.isConnected) {
        const badge = document.createElement('div');
        badge.className = 'iv-badge';
        previewEl.appendChild(badge);
        st.badge = badge;
      }
      st.badge.textContent = badgeText(st);
    }

    // Place the group: scale to its natural size, center X, center+oy Y. For a
    // virtualized group, also schedule a viewport-slice re-raster so the slice
    // tracks the new pan/zoom (coalesced on a rAF).
    function apply(previewEl, group, st) {
      const g = geom(previewEl, group, st);
      // fit is a deterministic containment view: always (re)compute its scale and
      // center it (oy=0), writing both back so a stale st.scale/st.oy from a prior
      // actual/custom state can never leak into a fit view (which would paint the
      // wrong viewport slice or shift the centered image).
      const scale = st.mode === 'fit' ? fitScale(g) : (st.scale != null ? st.scale : fitScale(g));
      if (st.mode === 'fit') {
        st.scale = scale;
        st.oy = 0;
      }
      const dispW = g.groupNatW * scale, dispH = g.groupNatH * scale;
      group.style.position = 'absolute';
      group.style.left = (g.paneW - dispW) / 2 + 'px';
      group.style.top = (g.paneH - dispH) / 2 + st.oy + 'px';
      group.style.width = g.groupNatW + 'px';
      group.style.height = g.groupNatH + 'px';
      group.style.transformOrigin = '0 0';
      group.style.transform = `scale(${scale})`;
      syncBadge(previewEl, st);
      // Reposition the pane-level guide overlay to match the content's vertical
      // pan/zoom (groupScreenTop mirrors group.style.top above).
      const groupScreenTop = (g.paneH - dispH) / 2 + st.oy;
      syncGuide(previewEl, scale, groupScreenTop, g.paneH);
      if (st.virtual && st.vpSrc) schedulePaint(previewEl, group, st);
    }

    // Coalesce viewport re-rasters: one rAF per frame regardless of how many
    // apply() calls fired (wheel/drag fire many). The rAF re-measures geometry
    // fresh (pane size may have changed; scale/oy in st are current) so the
    // slice always matches the group's actual on-screen transform — never a
    // stale capture from the first apply of the burst.
    function schedulePaint(previewEl, group, st) {
      if (st.paintRaf) return;
      st.paintRaf = requestAnimationFrame(() => {
        st.paintRaf = 0;
        const canvas = group.querySelector('.tint-preview__canvas');
        if (!canvas) return;
        const g = geom(previewEl, group, st);
        const scale = st.scale != null ? st.scale : fitScale(g);
        paintViewportFromTransform(canvas, previewEl, st, g.paneW, g.paneH, scale);
      });
    }

    // Vertical clamp: the image edge may never be dragged past the pane edge it
    // would expose — i.e. the group always fully COVERS the pane (when larger than
    // it) or stays fully INSIDE it (when smaller). Concretely groupScreenTop is
    // pinned to [min(0, paneH-dispH), max(0, paneH-dispH)], which in oy space is
    // [-|paneH-dispH|/2, |paneH-dispH|/2]. At fit, dispH≈paneH → maxOy≈0 → the
    // view is locked (the whole image already fills the pane, so pan is a no-op
    // and can never push the engine into a partial-viewport slice). Zoom in past
    // fit and maxOy grows, re-enabling pan over the now-larger-than-pane image.
    function clamp(g, scale, st) {
      if (!g.groupNatW || !g.groupNatH) return;
      const dispH = g.groupNatH * scale;
      const maxOy = Math.abs(g.paneH - dispH) / 2;
      st.oy = Math.max(-maxOy, Math.min(maxOy, st.oy));
    }

    function currentScale(previewEl, group, st) {
      if (st.scale != null) return st.scale;
      return fitScale(geom(previewEl, group, st));
    }

    // Recompute layout (called after a live re-draw / resize / mode change).
    // In fit mode the scale tracks the pane; in custom/actual it is held.
    function refresh(previewEl) {
      const group = previewEl.querySelector('.tint-preview__group');
      if (!group) return;
      const st = getSt(previewEl);
      const g = geom(previewEl, group, st);
      if (st.mode === 'fit' || st.scale == null) st.scale = fitScale(g);
      clamp(g, st.scale, st);
      apply(previewEl, group, st);
    }

    // Bind the interactions on a preview element (idempotent via _ttBound).
    // Both the non-virtualized and virtualized groups drive the same transform;
    // the only difference is whether apply() also re-rasters a viewport slice.
    function bind(previewEl) {
      if (!previewEl || previewEl._ttBound) return;
      previewEl._ttBound = true;
      const st = getSt(previewEl);

      const onWheel = (e) => {
        const group = previewEl.querySelector('.tint-preview__group');
        if (!group) return;
        e.preventDefault();
        const shift = e.shiftKey ? 10 : 1;
        const g = geom(previewEl, group, st);
        if (e.altKey) {
          // Zoom: X centered, Y follows cursor. py = cursor Y relative to the
          // pane center; imgY = the natural row under the cursor. After zoom,
          // recompute oy so imgY stays under the cursor.
          const rect = previewEl.getBoundingClientRect();
          const py = e.clientY - rect.top - rect.height / 2;
          const oldScale = currentScale(previewEl, group, st);
          const imgY = (py - st.oy) / oldScale + g.groupNatH / 2;
          // No lower clamp on ns: we want to be able to scroll down to/below 1%
          // so the snap-to-fit check below triggers (a hard 0.02 floor would
          // make 1% unreachable).
          const ns = Math.min(64, oldScale * Math.exp(-e.deltaY * 0.0015 * shift));
          // Zooming out past ~1% snaps to fit (the view is already near the
          // containment floor; going lower just starves the rasteriser for no
          // visible gain). Fit re-centers and re-clamps oy.
          if (ns <= 0.01) {
            st.mode = 'fit'; st.scale = null; st.oy = 0;
          } else {
            st.oy = py - (imgY - g.groupNatH / 2) * ns;
            st.scale = ns;
            st.mode = 'custom';
            clamp(g, st.scale, st);
          }
          apply(previewEl, group, st);
        } else {
          // Vertical pan only. Natural direction: scroll DOWN → content moves up
          // → see lower content (matches browsers / PS).
          const step = 40 * shift;
          st.oy -= (e.deltaY > 0 ? step : -step);
          clamp(g, currentScale(previewEl, group, st), st);
          apply(previewEl, group, st);
        }
      };
      previewEl.addEventListener('wheel', onWheel, { passive: false });

      const onDblClick = (e) => {
        const group = previewEl.querySelector('.tint-preview__group');
        if (!group) return;
        if (e.target.closest('.tint-guide__label')) return;
        const g = geom(previewEl, group, st);
        if (st.mode === 'fit') {
          // fit → actual (1:1): top-align so the top of the image is visible
          // (a tall image centered at 100% would show only its middle).
          st.mode = 'actual'; st.scale = 1;
          const dispH = g.groupNatH * 1;
          st.oy = dispH > g.paneH ? (dispH - g.paneH) / 2 : 0;
        } else {
          st.mode = 'fit'; st.scale = fitScale(g);
          st.oy = 0;
        }
        clamp(g, st.scale, st);
        apply(previewEl, group, st);
      };
      previewEl.addEventListener('dblclick', onDblClick);

      const onDown = (e) => {
        if (e.button !== 0) return;
        const group = previewEl.querySelector('.tint-preview__group');
        if (!group) return;
        if (e.target.closest('.tint-guide__label')) return;
        st.dragging = { y: e.clientY, oy: st.oy, moved: false };
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!st.dragging) return;
        if (!st.dragging.moved) {
          if (Math.abs(e.clientY - st.dragging.y) < 3) return;
          st.dragging.moved = true;
        }
        st.oy = st.dragging.oy + (e.clientY - st.dragging.y);
        const group = previewEl.querySelector('.tint-preview__group');
        if (group) {
          clamp(geom(previewEl, group, st), currentScale(previewEl, group, st), st);
          apply(previewEl, group, st);
        }
      };
      const onUp = () => {
        if (!st.dragging) return;
        if (st.dragging.moved) st.mode = 'custom';
        st.dragging = null;
      };
      previewEl.addEventListener('mousedown', onDown);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);

      // Re-fit when the pane resizes, but only in fit mode (custom/actual hold).
      if (typeof ResizeObserver !== 'undefined') {
        let raf = 0;
        new ResizeObserver(() => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            const group = previewEl.querySelector('.tint-preview__group');
            if (!group) return;
            const g = geom(previewEl, group, st);
            if (st.mode === 'fit' || st.scale == null) st.scale = fitScale(g);
            clamp(g, st.scale, st);
            apply(previewEl, group, st);
          });
        }).observe(previewEl);
      }
    }

    function reset(previewEl) {
      const st = states.get(previewEl);
      if (st) { st.scale = null; st.oy = 0; st.mode = 'fit'; }
    }

    return { bind, refresh, reset, configure };
  })();

  // ── Canvas preview pipeline ──
  // (Fit/pan/zoom layout is owned by TintTransform; see the engine above. The
  // helpers below draw pixel content into the canvas backing.)

  // One hue per guide kind, so each line+label reads as a distinct color band.
  const GUIDE_COLORS = {
    blank:   '#4aa3ff', // blue   — blank spacing
    top:     '#36d399', // green  — top (tail)
    ext:     '#c084fc', // purple — body (extended region)
    stretch: '#f472b6', // pink   — stretch height
    darken:  '#fb923c', // orange — darken offset
  };

  // A horizontal guide line at natural output row `row` (0..total), tinted
  // `color`. The line + its label live in a pane-level overlay (NOT inside the
  // scaled group), so zoom never stretches them horizontally — only their
  // vertical position tracks the content. The screen Y is computed from the
  // current transform state in syncGuide() (called after every apply); the row
  // is stored on data-row so syncGuide can reposition without rebuilding.
  function guideLine(row, label, color, above) {
    const arrow = above ? '▼' : '▲';
    const aboveCls = above ? ' tint-guide__label--above' : '';
    // Line (full-width dashed) and label are SIBLINGS so the label's stacking
    // (z-index 3) clearly sits above the line (z-index 1) — the dashed line
    // never paints over the label text.
    return `<div class="tint-guide__line" data-row="${row}" style="border-color:${color}"></div>`
      + `<div class="tint-guide__labelwrap" data-row="${row}">`
      + `<span class="tint-guide__label tint-guide__label--left${aboveCls}" style="background:${color}"><span class="tint-guide__arrow">${arrow}</span>${escapeHtml(label)}</span>`
      + `</div>`;
  }

  // Build the guide-lines container (positions only; indent recomputed on layout).
  // Layout of the cropped output (height = total = outH):
  //   0 .. blank              blank spacing
  //   blank .. blank+tailH    top (tail content)
  //   blank+tailH .. total    body (bottom, stretched/tiled) — anchored to bottom
  // Guide lines:
  //   blank spacing  at blank              (blank's bottom = split point)
  //   top (tail)     at blank + tailH      (tail's bottom)
  //   darken offset  at top + shift        (offset from the tail line)
  function buildGuide(t, total, srcH) {
    const tailH = Math.min(Math.max(0, Math.round(+t.cropA || 0)), total);
    const blank = Math.max(0, Math.round(+t.cropB || 0));
    const tailBottom = Math.min(total, blank + tailH);
    const darkening = isDarkening(t);
    const shift = darkening ? Math.min(total - tailBottom, Math.max(0, Math.round(+t.darkenD || 0))) : 0;
    // cropD (b) is the SOURCE height of the stretched middle. The output layout:
    //   [0, tailBottom)            1:1 tail
    //   [tailBottom, pinOutTop)    STRETCHED middle (b source rows → stretched)
    //   [pinOutTop, total)         1:1 bottom (botSrc source rows)
    // pinOutTop = total - botSrc, botSrc = srcH - tailH - b (clamped).
    const sh = srcH != null ? srcH : tailH;
    const bodySrcH = Math.max(0, sh - tailH);
    const b = Math.min(Math.max(0, Math.round(+t.cropD || 0)), bodySrcH);
    const botSrc = Math.max(0, sh - tailH - b);
    const pinOutTop = Math.max(tailBottom, total - botSrc);
    const lines = [
      { row: blank, label: i18n.t('edit.guideBlank') + ' ' + blank, color: GUIDE_COLORS.blank, above: false },
      { row: tailBottom, label: i18n.t('edit.guideTop') + ' ' + tailH, color: GUIDE_COLORS.top, above: false },
      { row: 0, label: i18n.t('edit.guideExt') + ' ' + total, color: GUIDE_COLORS.ext, above: true },
    ];
    if (b > 0) {
      // stretch line at pinOutTop: above is the stretched middle, below is 1:1 bottom.
      lines.push({ row: pinOutTop, label: i18n.t('edit.guideStretch') + ' ' + b, color: GUIDE_COLORS.stretch, above: false });
    }
    if (darkening) {
      lines.push({ row: tailBottom + shift, label: i18n.t('edit.guideDarken') + ' ' + shift, color: GUIDE_COLORS.darken, above: false });
    }
    const guide = document.createElement('div');
    guide.className = 'tint-guide';
    guide.innerHTML = lines.map(ln => guideLine(ln.row, ln.label, ln.color, ln.above)).join('');
    return guide;
  }

  // Reposition every guide line + label to its screen Y for the current
  // transform. The guide is a pane-level overlay (not inside the scaled group),
  // so a line at natural row `row` sits at screen Y = groupScreenTop + row*scale
  // — it tracks the content's vertical pan/zoom but is never stretched. Labels
  // that would render off-pane are hidden (clamped to nothing); the cascade in
  // relayoutGuideIndent then stacks overlapping on-screen labels.
  function syncGuide(previewEl, scale, groupScreenTop, paneH) {
    const guide = previewEl.querySelector('.tint-guide');
    if (!guide) return;
    const lines = guide.querySelectorAll('.tint-guide__line');
    const wraps = guide.querySelectorAll('.tint-guide__labelwrap');
    const setY = (el) => {
      const row = parseFloat(el.dataset.row);
      let y = groupScreenTop + row * scale;
      // A line at the pane top (y=0) renders fine; a line at the pane bottom
      // (y=paneH) is half-clipped by overflow:hidden, so nudge only the BOTTOM
      // up by 2px. Do NOT nudge the top — that would lift the top guide off the
      // image's top edge (it should sit flush at y=0). Lines far off-pane hide.
      const onPane = y > -2 && y < paneH + 2;
      if (onPane) y = Math.min(y, paneH - 2);
      el.style.top = y + 'px';
      el.style.bottom = 'auto';
      el.style.visibility = onPane ? '' : 'hidden';
    };
    lines.forEach(setY);
    // Position each label wrap, then flip its badge to the INSIDE of the pane:
    // a line in the upper half anchors its label BELOW the line (▼, pointing up
    // at it), a line in the lower half anchors it ABOVE (▲, pointing down). This
    // keeps the badges off the pane edges (the bottom guide's label would else
    // render past the pane bottom and be clipped).
    wraps.forEach((wrap) => {
      const row = parseFloat(wrap.dataset.row);
      const y = groupScreenTop + row * scale;
      wrap.style.top = y + 'px';
      wrap.style.bottom = 'auto';
      wrap.style.visibility = (y > -2 && y < paneH + 2) ? '' : 'hidden';
      const label = wrap.querySelector('.tint-guide__label');
      const arrow = wrap.querySelector('.tint-guide__arrow');
      if (label && arrow) {
        const above = y >= paneH / 2;
        label.classList.toggle('tint-guide__label--above', above);
        arrow.textContent = above ? '▼' : '▲';
      }
    });
    relayoutGuideIndent(previewEl);
  }

  // Float each label next to its own dashed line. Overlap is detected from the
  // labels' ACTUAL rendered rects (not a computed pixel guess), so the layout is
  // stable across zoom changes — a value tweak only re-cascades when labels
  // genuinely overlap at the current size. Base coordinate space = the pane.
  function relayoutGuideIndent(previewEl) {
    const guide = previewEl.querySelector('.tint-guide');
    if (!guide) return;
    const wraps = guide.querySelectorAll('.tint-guide__labelwrap');
    if (!wraps.length) return;
    const labels = guide.querySelectorAll('.tint-guide__label');
    if (!labels.length || labels.length !== wraps.length) return;
    const paneRect = previewEl.getBoundingClientRect();
    // Reset any prior cascade so we measure natural (line-hugging) positions.
    wraps.forEach(w => { w.style.marginTop = ''; });
    // Force a reflow so the rects reflect the reset positions.
    void guide.offsetWidth;
    // Build entries: measure the LABEL (it has real height; the wrap is 0-height
    // since the label is position:absolute), but move the WRAP (which is anchored
    // to the line) so the label follows. Read each label's above/below state
    // directly from its class instead of hardcoding the line order — the set of
    // guide lines varies (cropD / darken are conditional), so a positional guess
    // would drift out of sync with the actual DOM.
    const entries = [];
    for (let i = 0; i < wraps.length; i++) {
      const above = labels[i].classList.contains('tint-guide__label--above');
      entries.push({ wrap: wraps[i], label: labels[i], above });
    }
    // Top-anchored labels, ordered by natural top.
    const casc = entries.filter(e => !e.above)
      .sort((a, b) => a.label.getBoundingClientRect().top - b.label.getBoundingClientRect().top);
    const placed = []; // {top, bottom} of settled labels (pane coords)
    for (const e of casc) {
      const r = e.label.getBoundingClientRect();
      const top = r.top - paneRect.top;
      const bottom = r.bottom - paneRect.top;
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

  // ── Viewport virtualization (crop/darken canvas2D path) ──
  // (buildTintedSource / getTintedSourceGL / tintSourceSig now live in
  // window.TintPipeline; aliased at the top of this IIFE.)

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
  function cropViewportCanvas(ctx, src, tailH, blank, total, tile, tileDir, stretchH,
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

    // --- TAIL (top): output [blank, blank+tailSrcH) ← source [0, tailSrcH) 1:1 ---
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

    // --- BODY (body): output [y0, total) ← source [tailSrcH, srcH) ---
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
          // Three-segment model (mirrors cropCanvas):
          //   src [0, tailSrcH)       → out [0, bodyOutTop)      1:1  (top/tail, drawn above)
          //   src [tailSrcH, midBot) → out [bodyOutTop, pinOutTop) STRETCHED (middle b)
          //   src [midBot, h)         → out [pinOutTop, total)   1:1  (bottom, anchored)
          // b = cropD is the SOURCE height of the stretched middle; the output gap
          // is implicit. Each segment is mapped & clipped against the viewport.
          const b = Math.min(Math.max(0, stretchH), bodySrcH); // middle source height
          const midBot = tailSrcH + b;                         // middle source bottom
          const botSrc = Math.max(0, h - midBot);              // bottom source span (1:1)
          const pinOutTop = bodyOutBot - botSrc;               // bottom output start
          const stretchOutH = Math.max(0, pinOutTop - bodyOutTop);
          // (a) stretched middle region. When b=0 the gap is filled by copying the
          // tail's last source row across the whole gap (no blank region).
          if (stretchOutH > 0) {
            const drawTop = Math.max(visTop, bodyOutTop);
            const drawBot = Math.min(visBot, pinOutTop);
            if (drawBot > drawTop) {
              if (b > 0) {
                const srcFromTop = (drawTop - bodyOutTop) * (b / stretchOutH);
                const srcFromBot = (drawBot - bodyOutTop) * (b / stretchOutH);
                baseCtx.drawImage(src,
                  0, tailSrcH + srcFromTop, w, srcFromBot - srcFromTop,
                  0, (drawTop - visTop) * ds, dw, (drawBot - drawTop) * ds);
              } else {
                const tailLastRow = Math.max(0, tailSrcH - 1);
                baseCtx.drawImage(src,
                  0, tailLastRow, w, 1,
                  0, (drawTop - visTop) * ds, dw, (drawBot - drawTop) * ds);
              }
            }
          }
          // (b) 1:1 bottom region, anchored to the output bottom.
          if (botSrc > 0 && pinOutTop < bodyOutBot) {
            const drawTop = Math.max(visTop, pinOutTop);
            const drawBot = Math.min(visBot, bodyOutBot);
            if (drawBot > drawTop) {
              baseCtx.drawImage(src,
                0, midBot + (drawTop - pinOutTop), w, drawBot - drawTop,
                0, (drawTop - visTop) * ds, dw, (drawBot - drawTop) * ds);
            }
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
        cropViewportCanvas(opCtx, src, tailH, blank, total, tile, tileDir, stretchH,
                           false, 0, 0, opVisTop, visH, ds);
        ctx.drawImage(opScratch, 0, 0);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ── Virtualized viewport slice (transform-driven) ──
  // The group's natural height = total (the full cropC output), but only a
  // viewport-sized slice of it is rasterised into the canvas each frame. The
  // canvas is absolutely positioned at top=visTop inside the group (group
  // natural coordinates); the group's CSS transform provides the visual scale.
  // Pan/zoom change st.oy/st.scale → apply() schedules this repaint, which
  // recomputes which slice is visible and re-rasters just those rows.
  //
  // Geometry (mirrors apply()'s group.top so visTop tracks the slice actually
  // under the pane):
  //   groupScreenTop = (paneH - total*scale)/2 + oy
  //   visTop = clamp(0, total, (0 - groupScreenTop)/scale)   // top natural row
  //   visBot = clamp(0, total, (paneH - groupScreenTop)/scale)
  //   visH   = max(1, ceil(visBot - visTop))
  //   backing = outW × visH   (full source width; only height is sliced)

  // Bundle the crop/darken args cropViewportCanvas expects, from an op t.
  function cropArgsFromT(t) {
    return {
      tailH: +t.cropA || 0, blank: +t.cropB || 0, total: Math.max(1, Math.round(+t.cropC || 32768)),
      tile: !!t.cropTile, tileDir: t.cropTileDir, stretchH: +t.cropD || 0,
      darkenOn: isDarkening(t), shift: +t.darkenD || 0,
      darkenAlpha: Math.max(0, Math.min(1, (+t.darkenOpacity || 0) / 100)),
    };
  }

  // Paint the visible slice into the on-screen canvas, positioned absolutely
  // inside the group at the slice's natural top. paneW/paneH/scale are passed
  // in (already measured by apply) so we don't re-read layout.
  function paintViewportFromTransform(canvas, previewEl, st, paneW, paneH, scale) {
    const srcCanvas = st.vpSrc;
    const ca = st.cropArgs;
    if (!srcCanvas || !ca || paneW <= 0) return;
    const outW = srcCanvas.width;
    const total = st.total || ca.total;
    // Where the group's top edge sits on screen, in screen px (mirrors apply).
    const groupScreenTop = (paneH - total * scale) / 2 + st.oy;
    const visTop = Math.max(0, Math.min(total, (0 - groupScreenTop) / scale));
    const visBot = Math.max(0, Math.min(total, (paneH - groupScreenTop) / scale));
    const visH = Math.max(1, Math.ceil(visBot - visTop));
    // Backing resolution. When (nearly) the WHOLE output is visible — fit, or
    // any zoom where the image fits the pane — rasterise the full canvas once at
    // natural resolution (ds=1), so a tall cropC output displays complete and
    // crisp (the CSS transform does the final shrink). Only when zoomed IN past
    // the pane (a true partial viewport) do we downsample the slice (ds=scale) to
    // keep the backing small. The whole-image test uses a 99% threshold so a few
    // rows of float/rounding slack at the containment edge still count as whole.
    const whole = visH >= total * 0.99;
    const ds = whole ? 1 : Math.min(1, scale);
    const bw = Math.max(1, Math.round(outW * ds));
    const bh = Math.max(1, Math.round(visH * ds));

    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw; canvas.height = bh;
    }
    // Position the slice in the group's natural coordinate space: the group's
    // transform scales it to the screen. width/height in natural px (outW/visH)
    // so the slice aligns with the guide lines (which are also in natural space).
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = visTop + 'px';
    canvas.style.width = outW + 'px';
    canvas.style.height = visH + 'px';
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
    canvas.style.margin = '0';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, bw, bh);
    cropViewportCanvas(ctx, srcCanvas,
      ca.tailH, ca.blank, total, ca.tile, ca.tileDir, ca.stretchH,
      ca.darkenOn, ca.shift, ca.darkenAlpha,
      visTop, visH, ds);
  }

  // Should this op's crop/darken preview be viewport-virtualized? Only when crop
  // (or its derived darken) is on AND the logical output exceeds the threshold —
  // small outputs render the whole canvas directly (no virtualization needed).
  function shouldVirtualize(t, img) {
    if (!t || !t.cropEnabled || !img) return false;
    const cropOutH = Math.max(1, Math.round(+t.cropC || 32768));
    return cropOutH > VIRTUALIZE_THRESHOLD;
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
          tint: { on: true, color: tc.color, t: tc.t, mode: TINT_MODE_IDX[t.mode] || 0,
          hueShift: +t.hueShift || 0, satShift: +t.satShift || 0, lightShift: +t.lightShift || 0 },
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
    if (t.tintEnabled) canvas = tintCanvas(canvas, t.color, t.mode, t);
    if (cropOn) canvas = cropCanvas(canvas, +t.cropA || 0, +t.cropB || 0, +t.cropC || 32768, !!t.cropTile, t.cropTileDir, +t.cropD || 0);
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
    if (!previewEl) return; // no selection → detail shows empty-hint, no preview element
    // Whole-group selection: preview the anchor member's source with the group's
    // STAGE TEMP tint/crop params (→ first member when no temp set), so live
    // stage edits show in the preview before Fill commits them to every member.
    const anchor = sel();
    const sp = stageParams();
    const t = (sp && sp !== anchor) ? { ...anchor, ...sp } : anchor;
    if (!t || !t.source) {
      previewEl.innerHTML = ''; // no source → plain black backdrop, no text
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
        const group = previewEl.querySelector('.tint-preview__group');
        if (liveCanvas && group) {
          const virtual = shouldVirtualize(t, img);
          // If cropC just crossed the threshold (either direction), the on-screen
          // group is the wrong kind (full-canvas vs slice). Force a full rebuild
          // rather than mutating in place — drawProcessed would build an
          // outW×cropC backing (blank past the canvas size limit) one way, and a
          // slice canvas can't show a small full output the other.
          if (virtual !== !!liveCanvas._vpSrc) { recomputePreview(false); return; }
          if (virtual) {
            // Rebuild the tinted SOURCE only when it changed (mode/source swap).
            // The tint COLOR is NOT in the sig: with GL it is a uniform update
            // each paint, so a color drag repaints without rebuilding the source.
            const sig = tintSourceSig(img, t);
            const glTint = t.tintEnabled && window.GlPreview;
            if (glTint || liveCanvas._vpSig !== sig) {
              liveCanvas._vpSrc = buildTintedSource(img, t, liveCanvas);
              liveCanvas._vpSig = sig;
            }
            const total = Math.max(1, Math.round(+t.cropC || 32768));
            TintTransform.configure(previewEl, { virtual: true, vpSrc: liveCanvas._vpSrc, total, cropArgs: cropArgsFromT(t) });
            if (t.cropEnabled) {
              const guide = previewEl.querySelector('.tint-guide');
              const fresh = buildGuide(t, total, img.naturalHeight);
              if (guide) guide.replaceWith(fresh); else previewEl.appendChild(fresh);
            }
            TintTransform.refresh(previewEl);   // → apply → syncGuide + paintViewportFromTransform
          } else {
            // Non-virtualized: re-draw the full backing in place.
            const outH = drawProcessed(liveCanvas, img, t, t.source);
            TintTransform.configure(previewEl, { virtual: false });
            if (t.cropEnabled) {
              const guide = previewEl.querySelector('.tint-guide');
              const fresh = buildGuide(t, outH || 1, img.naturalHeight);
              if (guide) guide.replaceWith(fresh); else previewEl.appendChild(fresh);
            }
            TintTransform.refresh(previewEl);
          }
          return;
        }
      }
      // Full rebuild of the preview DOM into the unified group-transform model.
      // Release the previous canvas's GL renderer (if any) before dropping it.
      const prevCanvas = previewEl.querySelector('.tint-preview__canvas');
      if (prevCanvas && prevCanvas._glRenderer) { try { prevCanvas._glRenderer.destroy(); } catch (_) {} }
      previewEl.innerHTML = '';
      previewEl.style.overflow = 'hidden';
      // A full rebuild is a fresh view (new op, or a source/size change like
      // crossing the virtualization threshold): reset pan/zoom to fit so a
      // prior op's custom/actual state can't carry over.
      TintTransform.reset(previewEl);
      const shown = document.createElement('canvas');
      shown.className = 'tint-preview__canvas';
      const group = document.createElement('div');
      group.className = 'tint-preview__group';

      if (shouldVirtualize(t, img)) {
        // Virtualized: the group's natural height = total (cropC), but the canvas
        // is only a viewport slice, re-rastered on pan/zoom by the engine. The
        // tinted source is cached on the canvas; the engine reads it via state.
        const srcCanvas = buildTintedSource(img, t, shown);
        shown._vpSrc = srcCanvas;
        shown._vpSig = tintSourceSig(img, t);
        const total = Math.max(1, Math.round(+t.cropC || 32768));
        group.appendChild(shown);
        previewEl.appendChild(group);
        if (t.cropEnabled) previewEl.appendChild(buildGuide(t, total, img.naturalHeight));
        TintTransform.configure(previewEl, { virtual: true, vpSrc: srcCanvas, total, cropArgs: cropArgsFromT(t) });
        TintTransform.bind(previewEl);
        TintTransform.refresh(previewEl);   // → apply → syncGuide + paintViewportFromTransform
        // On first open the pane may not have a measured height yet (clientHeight
        // 0 → empty slice). Re-refresh next frame once layout has settled.
        requestAnimationFrame(() => { if (shown._vpSrc) TintTransform.refresh(previewEl); });
      } else {
        // Non-virtualized: the canvas is the full processed output (backing =
        // outW × outH), filling the group at natural size. The engine scales it.
        const outH = drawProcessed(shown, img, t, t.source);
        shown.style.position = 'relative';
        shown.style.display = 'block';
        shown.style.margin = '0';
        group.appendChild(shown);
        previewEl.appendChild(group);
        // Percy LN guide lines: a pane-level overlay (not inside the group), so
        // zoom only moves them vertically — they span the full pane width.
        if (t.cropEnabled) previewEl.appendChild(buildGuide(t, outH || 1, img.naturalHeight));
        TintTransform.configure(previewEl, { virtual: false });
        TintTransform.bind(previewEl);
        TintTransform.refresh(previewEl);   // → apply → syncGuide positions the lines
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

  // RGB↔HSL helpers + tintCanvas now live in window.TintPipeline (aliased at
  // the top of this IIFE). Only crop/darken canvas math remains local below.

  function cropCanvas(src, tailH, blank, outH, tile, tileDir, stretchH) {
    const w = src.width, h = src.height;
    const tailSrcH = Math.min(Math.max(0, Math.round(tailH)), h);
    const bodySrcH = h - tailSrcH;
    const total = Math.max(1, Math.round(outH));
    const out = document.createElement('canvas');
    out.width = w; out.height = total;
    const ctx = out.getContext('2d');
    // Tail (top) placed at y = blank.
    if (tailSrcH > 0 && blank < total) ctx.drawImage(src, 0, 0, w, tailSrcH, 0, blank, w, tailSrcH);
    // Body (body) extended into (blank + tailSrcH .. total).
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
          // Three-segment model. The source is split into TOP (tail, height a),
          // MIDDLE (stretch source, height b = cropD), BOTTOM (body bottom, the rest); the
          // output mirrors TOP and BOTTOM 1:1 (top-aligned / bottom-aligned) and
          // STRETCHES the middle to fill the gap between them:
          //   src [0, tailSrcH)              → out [0, y0)            1:1  (tail, drawn above)
          //   src [tailSrcH, midBot)        → out [y0, pinOutTop)    STRETCHED (middle b)
          //   src [midBot, h)                → out [pinOutTop, total) 1:1  (bottom, anchored)
          // where midBot = tailSrcH + b and pinOutTop = total - (h - midBot).
          // b is the SOURCE height of the stretched middle (NOT the output gap);
          // the gap is implicit (total - srcH + b). When b=0 the middle is empty,
          // so the gap is filled by copying the tail's LAST source row (tail bottom row)
          // stretched across the whole gap — no blank region is left.
          const b = Math.min(Math.max(0, stretchH), bodySrcH); // middle source height
          const midBot = tailSrcH + b;                         // middle source bottom
          const botSrc = Math.max(0, h - midBot);              // bottom source span (1:1)
          const pinOutTop = total - botSrc;                    // bottom output start
          const stretchOutH = Math.max(0, pinOutTop - y0);     // stretched output span
          if (stretchOutH > 0) {
            if (b > 0) {
              ctx.drawImage(src, 0, tailSrcH, w, b, 0, y0, w, stretchOutH);
            } else {
              // b=0: copy the tail's bottom source row across the gap.
              const tailLastRow = Math.max(0, tailSrcH - 1);
              ctx.drawImage(src, 0, tailLastRow, w, 1, 0, y0, w, stretchOutH);
            }
          }
          if (botSrc > 0) {
            ctx.drawImage(src, 0, midBot, w, botSrc, 0, pinOutTop, w, botSrc);
          }
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

  // Indices to apply stage edits to: the multi-select set if non-empty, else the anchor row.
  // BUT: when the selection is a whole sequence GROUP (i.e. the user clicked a
  // group header, which selects all its members), stage edits must NOT batch-
  // write the group — tint/crop params have no per-group control to act as a
  // temporary value, so batch-writing would silently overwrite every frame.
  // Instead, fall back to the anchor (the previewed row) only. Batch sync of a
  // whole group is done explicitly via the Fill button. Plain multi-select
  // (Ctrl/Shift-clicked individual rows that happen to be a group) is detected
  // by checking whether the selected set exactly equals one group's members AND
  // is contiguous in the array — header-click selects exactly that.
  function editTargets() {
    const set = opSel ? opSel.getSelected() : new Set();
    const s = (set.size > 0 ? [...set] : [selectedIdx()]).filter(i => cur()[i] != null);
    if (s.length >= 2 && isWholeGroupSelection(s)) {
      const a = selectedIdx();
      return a >= 0 && cur()[a] != null ? [a] : (s.length ? [s[0]] : []);
    }
    return s;
  }
  // True when the selected indices form exactly ONE sequence group's full member
  // set (contiguous, same seqKey) — the signature of a group-header click, as
  // opposed to an arbitrary manual multi-select.
  function isWholeGroupSelection(idxs) {
    const a = cur();
    const sorted = [...idxs].sort((x, y) => x - y);
    for (let k = 1; k < sorted.length; k++) if (sorted[k] !== sorted[k - 1] + 1) return false; // contiguous
    const first = a[sorted[0]];
    if (!first || !isFrame(first)) return false;
    const key = seqKeyOf(first);
    const sel = new Set(sorted);
    // The full group = the contiguous run [lo,hi] of same-key frames. The
    // selection is "the whole group" iff that run has no gaps and equals `sel`.
    let lo = sorted[0];
    while (lo - 1 >= 0 && isFrame(a[lo - 1]) && seqKeyOf(a[lo - 1]) === key) lo--;
    let hi = sorted[sorted.length - 1];
    while (hi + 1 < a.length && isFrame(a[hi + 1]) && seqKeyOf(a[hi + 1]) === key) hi++;
    if (hi - lo + 1 !== sel.size) return false; // group bigger/smaller than selection
    for (let i = lo; i <= hi; i++) {
      const t = a[i];
      if (!t || !isFrame(t) || seqKeyOf(t) !== key || !sel.has(i)) return false;
    }
    return true;
  }
  // The seqKey of the whole group currently selected, or null when the
  // selection is NOT a whole group (single row, or arbitrary multi-select).
  // When this returns a key, stage tint/crop edits target the group's temp
  // params (headerTempParams) instead of any member's data — matching the
  // group-header destination/exact model.
  function wholeGroupSeqKey() {
    const set = opSel ? opSel.getSelected() : new Set();
    const s = [...set].filter(i => cur()[i] != null);
    if (s.length >= 2 && isWholeGroupSelection(s)) {
      const first = cur()[s[0]];
      return first ? seqKeyOf(first) : null;
    }
    return null;
  }
  // The tint/crop params of a group's first member — the stage's initial
  // template when a whole group is selected but no temp value is set yet.
  function firstMemberParams(gk) {
    const a = cur();
    for (const t of a) {
      if (t && isFrame(t) && seqKeyOf(t) === gk) {
        return {
          tintEnabled: !!t.tintEnabled, color: t.color || '255,255,255,255', mode: t.mode || 'replace',
          cropEnabled: !!t.cropEnabled, cropA: t.cropA, cropB: t.cropB, cropC: t.cropC, cropD: t.cropD,
          cropTile: !!t.cropTile, cropTileDir: t.cropTileDir,
          darkenEnabled: !!t.darkenEnabled, darkenD: t.darkenD, darkenOpacity: t.darkenOpacity,
          hueShift: +t.hueShift || 0, satShift: +t.satShift || 0, lightShift: +t.lightShift || 0,
        };
      }
    }
    return {};
  }
  // The effective params the stage should show for the current selection: the
  // group's temp value when a whole group is selected (unset → first member),
  // else the anchor member's own params.
  function stageParams() {
    const gk = wholeGroupSeqKey();
    if (gk) return headerTempParams.get(gk) || firstMemberParams(gk);
    return sel();
  }
  // Re-render just the stage panel (temp-value edits don't touch member data,
  // so the preview and row highlights are unaffected). Re-binds stage handlers.
  function refreshStagesLite() {
    const stages = container.querySelector('#tint-stages');
    if (stages) stages.innerHTML = renderStages();
    bindStageHandlers();
  }
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
    // Re-render FIRST, then re-anchor to a valid row AFTER render so the row
    // exists when setSelected auto-highlights it. preset-editor may have rebuilt
    // #tab-tint since opSel was created, so look up the live node.
    const len = arr.length;
    const anchor = opSel ? opSel.getAnchor() : 0;
    render(document.getElementById('tab-tint'));
    const a2 = len ? Math.min(anchor, len - 1) : 0;
    opSel.setSelected(len ? new Set([a2]) : new Set(), a2);
  }

  // Move the rows at `fromIndices` to land at `toIndex` (original-array index,
  // "insert before"). Splice + commit + re-select the moved block + re-render.
  function applyReorderOps(fromIndices, toIndex) {
    const { arr, insertAt, count } = OpTable.reorderArray(cur(), fromIndices, toIndex);
    applyTints(arr);
    render(document.getElementById('tab-tint'));
    // Select the moved block AFTER render so the rows exist when setSelected
    // auto-highlights them.
    const sel = new Set();
    for (let i = 0; i < count; i++) sel.add(insertAt + i);
    if (opSel) opSel.setSelected(sel, insertAt);
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
  // Enforce: tailH (cropA) + blank (cropB) + darkenD ≤ outH (cropC), and the
  // stretch region [tail bottom, tail bottom + cropD) stays within outH.
  // cropD is measured from the tail bottom (blank + tailH) downward — the same
  // anchor as darkenD — so each is clamped to (outH - blank - tailH) on its own
  // (they may overlap: darken is an over-composite, not a layout slot).
  // When a field grows past the available room, clamp THAT field so the sum
  // stays within outH. outH itself is clamped to be ≥ the sum when it shrinks.
  function normalizeOp(op, changedKey, srcH) {
    if (!op.cropEnabled) return op;
    const outH = Math.max(0, Math.floor(+op.cropC || 0));
    const tailH = Math.max(0, Math.floor(+op.cropA || 0));
    // cut height (cropA) + stretch height (cropD) must not exceed the source height:
    // both come from the source (tail top + stretched middle), so a+b ≤ srcH.
    const srcCap = (srcH != null && srcH > 0) ? srcH : Infinity;
    // blank height (cropB) and shadow distance (darkenD) are NOT clamped to outH — they are
    // allowed to push content below the canvas (off the bottom). Only cropA/cropC/
    // cropD are constrained.
    if (changedKey === 'cropA') {
      // cropA ≤ outH (tail must fit the canvas) AND cropA + cropD ≤ srcH.
      const cap = Math.min(outH, srcCap - Math.max(0, Math.floor(+op.cropD || 0)));
      op.cropA = Math.min(tailH, Math.max(0, cap));
    } else if (changedKey === 'cropD') {
      // cropD ≤ outH - cropA (fits the canvas) AND cropA + cropD ≤ srcH.
      const cap = Math.min(Math.max(0, outH - tailH), srcCap - tailH);
      op.cropD = Math.min(Math.max(0, Math.floor(+op.cropD || 0)), Math.max(0, cap));
    } else if (changedKey === 'cropC') {
      // outH can't be smaller than the tail (cropA); cropB/darkenD may overflow.
      if (outH < tailH) op.cropC = tailH;
    }
    // cropB / darkenD: no clamp (kept as entered, ≥0 via readVal).
    return op;
  }

  // The cached natural height of a tint op's source image (sync; null if not yet
  // loaded). Used by normalizeOp to enforce cropA + cropD ≤ source height.
  function srcHeightOf(op) {
    if (!op || !op.source) return null;
    const img = sourceImgCache.get(op.source);
    return (img && img.naturalHeight) ? img.naturalHeight : null;
  }

  // Apply a partial-update (object) to every edit target, with the
  // tailH+blank+darkenD ≤ outH constraint enforced. When a whole group is
  // selected, the edit goes to the group's temp params (no member data).
  function applyToTargets(partial) {
    const changedKey = Object.keys(partial)[0];
    const gk = wholeGroupSeqKey();
    if (gk) {
      const base = headerTempParams.get(gk) || firstMemberParams(gk);
      // Whole-group: clamp against the first member's source height (the stage
      // template). Members may differ, but the stage shows one set of values.
      const firstMember = cur().find(t => t && isFrame(t) && seqKeyOf(t) === gk);
      const srcH = firstMember ? srcHeightOf(firstMember) : null;
      const next = normalizeOp({ ...base, ...partial }, changedKey, srcH);
      headerTempParams.set(gk, next);
      refreshStagesLite();
      return;
    }
    const arr = cur();
    const targets = editTargets();
    for (const i of targets) {
      arr[i] = { ...arr[i], ...partial };
      arr[i] = normalizeOp(arr[i], changedKey, srcHeightOf(arr[i]));
    }
    applyTints(arr);
    if (targets.length > 1) Toast.success(i18n.t('editor.synced', { n: targets.length }));
  }
  // Apply WITHOUT constraint enforcement (for live input preview; the final
  // clamped value is committed on blur/change). Whole-group → temp params.
  function applyToTargetsRaw(partial) {
    const gk = wholeGroupSeqKey();
    if (gk) {
      const base = headerTempParams.get(gk) || firstMemberParams(gk);
      headerTempParams.set(gk, { ...base, ...partial });
      refreshStagesLite();
      return;
    }
    const arr = cur();
    for (const i of editTargets()) arr[i] = { ...arr[i], ...partial };
    applyTints(arr);
  }
  // Apply a per-op updater function to every edit target. Whole-group → temp.
  function patch(updater) {
    const gk = wholeGroupSeqKey();
    if (gk) {
      const base = headerTempParams.get(gk) || firstMemberParams(gk);
      headerTempParams.set(gk, { ...base, ...updater(base) });
      refreshStagesLite();
      return;
    }
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
    // Rebuild the whole detail pane when the selection-presence flips (selected
    // → empty-hint or vice versa), since the two states are different DOM.
    const detail = container.querySelector('.tint-detail');
    const previewExists = !!container.querySelector('#tint-preview');
    if (detail && previewExists !== hasSelection()) {
      detail.innerHTML = hasSelection()
        ? `<div class="tint-preview" id="tint-preview"></div>
           <div class="tint-stages" id="tint-stages">${renderStages()}</div>`
        : `<div class="tint-empty-hint tint-preview--fade">
             <div>${i18n.t('edit.hintAddSelect')}</div>
             <div>${i18n.t('edit.hintApply')}</div>
           </div>`;
    } else {
      const stages = container.querySelector('#tint-stages');
      if (stages) stages.innerHTML = renderStages();
    }
    // Highlight via OpTable (empty set → anchor only; non-empty → every member).
    if (opSel) opSel.highlightAll();
    bindStageHandlers();
    if (recompute) recomputePreview(true);
  }

  function bindHandlers() {
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
        render(container);
        opSel.setSelected(new Set([tints.length - 1]), tints.length - 1);
        refreshDetailAndList(true); // render used the OLD selection state; rebuild detail for the new one
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      } finally { fileDialogOpen = false; unblockUI(); }
    });

    // ── Re-source: ordinary rows AND group headers share ONE path ──
    // A target is the UNIFIED model { removeIdxs, insertAt, value }:
    //   • ordinary row → removeIdxs=[i], insertAt=i, value = that row's tint config
    //   • group header → removeIdxs=all member idxs, insertAt=first member,
    //                     value = the header's CURRENT dest/exact + stage temp
    // The main loop treats every target identically; only BUILDING differs.
    // `chosen` comes from the caller (pickAndReSource) so the dialog opens once.
    function collectTargets(arr, clickedRow) {
      const selSet = opSel ? opSel.getSelected() : new Set();
      const targets = [];
      const claimedIdx = new Set();
      const seenHeader = new Set();
      // value shape: { base, dest, exact, params }. base = the op to clone for
      // the source swap; dest/exact/params override base's fields.
      const rowValue = (op) => ({ base: op, dest: op.destination, exact: !!op.exact, params: null });
      const headerValue = (headerRow, firstOp) => {
        const destInput = headerRow.querySelector('.tint-seq-dest[data-group-header="1"], [data-group-header="1"].tint-seq-dest');
        const exactInput = headerRow.querySelector('.tint-seq-exact-toggle[data-group-header="1"], [data-group-header="1"].tint-seq-exact-toggle');
        const sk = headerRow.dataset.seqKey;
        const params = sk ? (headerTempParams.get(sk) || firstMemberParams(sk)) : null;
        return {
          base: firstOp,
          dest: destInput ? destInput.value : (firstOp ? (firstOp.destination || '') : ''),
          exact: exactInput ? !!exactInput.checked : (firstOp ? !!firstOp.exact : false),
          params,
        };
      };
      const addRow = (i) => {
        if (Number.isNaN(i) || i < 0 || i >= arr.length || claimedIdx.has(i)) return;
        claimedIdx.add(i);
        const op = arr[i]; if (!op) return;
        targets.push({ removeIdxs: [i], insertAt: i, value: rowValue(op) });
      };
      const addGroup = (headerRow) => {
        if (!headerRow || seenHeader.has(headerRow.dataset.gid)) return;
        seenHeader.add(headerRow.dataset.gid);
        const idxs = groupMemberIdx(headerRow);
        if (!idxs || !idxs.length) return;
        idxs.forEach(i => claimedIdx.add(i));
        targets.push({ removeIdxs: idxs, insertAt: idxs[0], value: headerValue(headerRow, arr[idxs[0]]) });
      };
      const consider = (v) => {
        const tr = container.querySelector(`tr[data-idx="${v}"]`);
        if (!tr) return;
        if (tr.classList.contains('tint-seq-group')) addGroup(tr);
        else if (tr.dataset.groupParent) {
          // A selected MEMBER row resolves back to its group header (selecting a
          // group adds member idxs to the selection); add the WHOLE group so
          // every selected group is re-sourced, not just the clicked one.
          const gid = tr.dataset.groupParent;
          const header = container.querySelector(`.tint-seq-group[data-gid="${gid}"]`);
          if (header) addGroup(header);
        }
        else addRow(parseInt(v, 10));
      };
      // Re-source scope: clicked row IN selection → re-source every selected
      // target (multi); OUTSIDE selection → re-source ONLY the clicked row and
      // discard the old selection. Clicking the thumbnail img doesn't change the
      // selection (img is in OpTable's interactiveSelector), so we read the
      // pre-click selection and decide scope here.
      const clickedIdxNum = parseInt(clickedRow.dataset.idx, 10);
      const clickedInSelection = clickedRow.classList.contains('tint-seq-group')
        ? groupMemberIdx(clickedRow).some(i => selSet.has(i))
        : (!Number.isNaN(clickedIdxNum) && selSet.has(clickedIdxNum));
      if (selSet.size > 0 && clickedInSelection) [...selSet].forEach(consider);
      else if (clickedRow.classList.contains('tint-seq-group')) addGroup(clickedRow);
      else addRow(clickedIdxNum);
      return targets;
    }

    function syncReSource(chosen, clickedRow) {
      if (!skinName() || !clickedRow || !chosen || !chosen.length) return;
      const arr = cur();
      const targets = collectTargets(arr, clickedRow);
      if (!targets.length) return;

      // Unified builder: clone value.base, swap source, overlay dest/exact/params.
      const makeOps = (v) => chosen.map(src => {
        const base = v.base ? { ...v.base } : {};
        delete base._groupId;
        base.source = src;
        if (v.dest != null) base.destination = v.dest;
        if (v.exact != null) base.exact = !!v.exact;
        if (v.params) Object.assign(base, v.params);
        return base;
      });

      const oldSrcs = new Set();
      const replacements = [];
      for (const t of targets) {
        for (const i of t.removeIdxs) { if (arr[i]) oldSrcs.add(arr[i].source); }
        const newOps = makeOps(t.value);
        t.removeIdxs.forEach((i, k) => replacements.push({ idx: i, newOps: k === 0 ? newOps : [] }));
      }
      const next = OpTable.replaceOpsAt(arr, replacements);

      const ordered = [...targets].sort((a, b) => a.insertAt - b.insertAt);
      const newSel = new Set();
      let offset = 0;
      for (const t of ordered) {
        for (let k = 0; k < chosen.length; k++) newSel.add(t.insertAt + offset + k);
        offset += chosen.length - t.removeIdxs.length;
      }

      applyTints(next);
      for (const s of oldSrcs) {
        if (!next.some(t => t.source === s)) { thumbCache.delete(s); sourceImgCache.delete(s); }
      }
      render(document.getElementById('tab-tint'));
      if (opSel) opSel.setSelected(newSel, ordered[0].insertAt);
    }

    // Open the file dialog ONCE, then hand the chosen paths to syncReSource.
    async function pickAndReSource(clickedRow) {
      if (!skinName() || !clickedRow) return;
      const arr = cur();
      let currentSource = '';
      if (clickedRow.classList.contains('tint-seq-group')) {
        const idxs = groupMemberIdx(clickedRow);
        const op = idxs && idxs.length ? arr[idxs[0]] : null;
        currentSource = op ? (op.source || '') : '';
      } else {
        const idx = parseInt(clickedRow.dataset.idx, 10);
        const op = !Number.isNaN(idx) ? arr[idx] : null;
        currentSource = op ? (op.source || '') : '';
      }
      const chosen = await window.SourcePicker.pickMulti({ getSkinPath: () => skinPath(), currentSource });
      syncReSource(chosen, clickedRow);
    }

    // Bind ordinary-row AND group-header thumbnails to pickAndReSource (one
    // dialog → syncReSource). Ordinary rows skip sub-rows (resrc disabled).
    const bindResrc = (thumb, getRow) => {
      thumb.addEventListener('click', (e) => {
        if (!e.target.matches('img, .file-thumb__icon')) return;
        pickAndReSource(getRow());
      });
    };
    container.querySelectorAll('.file-thumb[data-path]:not(.file-seq-resrc)').forEach(thumb => {
      const row = thumb.closest('[data-idx]');
      if (row && row.dataset.groupParent) return;   // sub-row: resrc disabled
      bindResrc(thumb, () => row);
    });
    container.querySelectorAll('.file-seq-resrc[data-group-resrc]').forEach(thumb => {
      bindResrc(thumb, () => thumb.closest('.tint-seq-group'));
    });

    container.querySelectorAll('.tint-row').forEach(row => {
      opSel.bindRow(row);
    });


    // Multi-select destination/exact sync — shared skeleton (OpTable.createGroupSync),
    // same as file-copy/ini. Folded sequence-group headers act as virtual rows
    // (source + target); expanded headers are local-only. Type-match is a no-op
    // (all rows share the destination field).
    const collapsedGroupHeaderFor = (i) => {
      const hs = container.querySelectorAll('.tint-seq-group');
      for (const h of hs) {
        if (expandedSeqGroups.has(h.dataset.seqKey)) continue; // expanded → not a sync node
        // Members of THIS group only — scoped to its data-range, not a global
        // seqKey scan (same-name groups must not collapse onto each other).
        const range = h.dataset.range;
        if (!range) continue;
        const [a, b] = range.split('-').map(n => parseInt(n, 10));
        if (!isNaN(a) && !isNaN(b) && i >= a && i < b) return h;
      }
      return null;
    };
    const { syncDest, syncExact } = (() => {
      const { syncField } = OpTable.createGroupSync({
        getSelected: () => opSel ? opSel.getSelected() : new Set(),
        isHeaderControl: (el) => !!el.dataset.groupHeader,
        headerRowOf: (el) => el.closest('.tint-seq-group'),
        headerIdOf: (headerEl) => headerEl.dataset.seqKey,
        foldedHeaderForIndex: (i) => collapsedGroupHeaderFor(i),
        sourceTypeKey: () => '',
        nodeTypeKey: () => '',
        skipDataNode: (idx) => { const a = cur(); return idx < 0 || idx >= a.length; },
        writeSourceData: (idx, field, val) => { const a = cur(); if (a[idx]) a[idx] = { ...a[idx], [field]: val }; },
        // exact is disabled on non-@2x rows — skip syncing it there.
        disableFieldFor: (idx, field) => {
          if (field !== 'exact') return false;
          const a = cur();
          return !a[idx] || !has2x(a[idx]);
        },
        writeTargetData: (idx, field, val) => { const a = cur(); if (a[idx]) a[idx] = { ...a[idx], [field]: val }; },
        onSynced: (n) => Toast.success(i18n.t('editor.synced', { n })),
        applyToHeader: (headerEl, field, val) => {
          if (field === 'destination') {
            const el = headerEl.querySelector('.tint-seq-dest');
            if (el) el.value = val; // header keeps the full value (index preserved)
          } else if (field === 'exact') {
            const el = headerEl.querySelector('.tint-seq-exact-toggle');
            if (el) el.checked = !!val;
          }
        },
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
        val = OpTable.appendSrcExt(val);
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

    // ── Sequence-group handlers (ported from file-copy-editor) ──
    // Expand/collapse: double-click the header row (excluding interactive
    // controls) toggles expansion WITHOUT re-rendering (preserves the header's
    // temporary edited value). Ignores modifier-key clicks so a quick select-then-
    // shift-select isn't misread as a double-click.
    container.querySelectorAll('.tint-seq-group').forEach(tr => {
      let last = 0;
      tr.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) { last = 0; return; }
        if (e.target.closest('.tint-dest, .tint-seq-fill-btn, .tint-seq-exact-toggle, .toggle, .toggle__slider')) return;
        const now = Date.now();
        if (now - last < 250) {
          const gid = tr.dataset.gid;
          if (gid) {
            if (expandedSeqGroups.has(gid)) expandedSeqGroups.delete(gid);
            else expandedSeqGroups.add(gid);
            // data-group-parent is the group's gid (instance), so only THIS
            // group's member rows toggle — never a same-name sibling's.
            const subRows = container.querySelectorAll(`.tint-row[data-group-parent="${CSS.escape(gid)}"]`);
            const expand = expandedSeqGroups.has(gid);
            for (const sr of subRows) sr.style.display = expand ? '' : 'none';
            tr.classList.toggle('tint-seq-group--expanded', expand);
          }
          last = 0;
        } else { last = now; }
      });
    });

    // Member indices of THIS group only — scoped to the header's data-range, not
    // a global seqKey scan (same-name groups must not all write together).
    const groupMemberIdx = (headerEl) => {
      const range = headerEl ? headerEl.dataset.range : '';
      if (!range) return [];
      const [a, b] = range.split('-').map(n => parseInt(n, 10));
      if (isNaN(a) || isNaN(b)) return [];
      const out = []; for (let k = a; k < b; k++) out.push(k); return out;
    };
    // Group-header destination: TEMPORARY value (local per keystroke). On commit,
    // normalize the header to a BARE stem, then a FOLDED header also syncs as a
    // virtual row; an EXPANDED header stays local. Members are committed via Fill.
    container.querySelectorAll('.tint-seq-dest').forEach(input => {
      const isFolded = () => !expandedSeqGroups.has(input.dataset.seqKey);
      input.addEventListener('change', async () => {
        if (window.InputConfirm && window.InputConfirm.wasEscCancel(input)) return;
        let val = input.value.trim().replace(/^["']|["']$/g, '');
        if (/^[a-zA-Z]:[\\/]?/.test(val)) {
          const sp = skinPath ? await skinPath() : '';
          if (sp) {
            const skNorm = sp.replace(/\\/g, '/').toLowerCase();
            const valNorm = val.replace(/\\/g, '/').toLowerCase();
            val = valNorm.startsWith(skNorm) ? val.replace(/\\/g, '/').slice(sp.length).replace(/^\//, '') : val;
          }
        }
        val = val.replace(/\\/g, '/');
        val = OpTable.appendSrcExt(val);
        if (val !== input.value) input.value = val;
        if (isFolded()) syncDest(input, val); // folded header syncs as a virtual row
      });
    });
    // Group-level exact toggle: FOLDED header syncs as a virtual row; EXPANDED local.
    container.querySelectorAll('.tint-seq-exact-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        if (expandedSeqGroups.has(cb.dataset.seqKey)) return;
        syncExact(cb, cb.checked);
      });
    });
    // Fill button: commit the header's BARE stem + exact AND the group's tint +
    // crop params to every member. Tint/crop come from the group's STAGE TEMP
    // value (set by editing the stage while the whole group is selected) if one
    // exists, else the first member. The backend re-attaches each source's own
    // index at apply time, so a header "mania/sliderb" → members
    // "mania/sliderb" → outputs sliderb-0/1/2. This is the only way to batch-
    // unify tint/crop across a group — stage edits on a whole-group selection
    // only update the temp value, never member data.
    container.querySelectorAll('.tint-seq-fill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const headerEl = btn.closest('.tint-seq-group');
        const memberIdx = groupMemberIdx(headerEl);
        if (memberIdx.length < 2) return;
        const headerDest = headerEl ? headerEl.querySelector('.tint-seq-dest') : null;
        const headerExact = headerEl ? headerEl.querySelector('.tint-seq-exact-toggle') : null;
        let dest = headerDest ? headerDest.value.trim().replace(/^["']|["']$/g, '') : '';
        dest = dest.replace(/\\/g, '/');
        dest = OpTable.appendSrcExt(dest);
        const exact = headerExact ? !!headerExact.checked : false;
        const arr = cur();
        const seqKey = headerEl ? headerEl.dataset.seqKey : '';
        // Temp stage value wins; else the first member is the template.
        const temp = seqKey ? headerTempParams.get(seqKey) : null;
        const tpl = temp || arr[memberIdx[0]] || {};
        const params = {
          tintEnabled: !!tpl.tintEnabled, color: tpl.color || '255,255,255,255', mode: tpl.mode || 'replace',
          cropEnabled: !!tpl.cropEnabled, cropA: tpl.cropA, cropB: tpl.cropB, cropC: tpl.cropC, cropD: tpl.cropD,
          cropTile: !!tpl.cropTile, cropTileDir: tpl.cropTileDir,
          darkenEnabled: !!tpl.darkenEnabled, darkenD: tpl.darkenD, darkenOpacity: tpl.darkenOpacity,
          hueShift: +tpl.hueShift || 0, satShift: +tpl.satShift || 0, lightShift: +tpl.lightShift || 0,
        };
        for (const k of memberIdx) {
          arr[k] = { ...arr[k], destination: dest, exact, ...params };
          arr[k] = normalizeOp(arr[k], null, srcHeightOf(arr[k]));
        }
        if (seqKey) headerTempParams.delete(seqKey); // temp consumed
        applyTints(arr);
        render(document.getElementById('tab-tint'));
        Toast.success(i18n.t('tint.filled', { n: memberIdx.length }));
      });
    });

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
    window.setupEdgeFade(container.querySelector('.tint-ops'), container.querySelector('#tint-table-body-scroll'), undefined, '.op-row--head');

    // Preview pan/zoom/dblclick interactions are all bound lazily in
    // recomputePreview → TintTransform.bind (both virtualized and non-virtualized
    // share the group-transform engine), so there is nothing to wire here.

    bindStageHandlers();
  }

  function bindStageHandlers() {
    const stages = container.querySelector('#tint-stages');
    if (!stages) return;
    // Stage toggles — applied to all edit targets (anchor's state decides the new value).
    stages.querySelectorAll('.stage__toggle').forEach(tog => {
      tog.addEventListener('click', () => {
        const stage = tog.parentElement.dataset.stage;
        const anchor = stageParams();
        if (!anchor) return;
        if (stage === 'tint') {
          if (anchor.tintEnabled) {
            // Turning tint OFF → drop the flag only. The color/mode/shift values
            // stay on the in-memory op (so re-opening restores them), but are NOT
            // persisted: the save path omits tint fields when tintEnabled is false.
            applyToTargets({ tintEnabled: false });
          } else {
            applyToTargets({ tintEnabled: true });
          }
        } else if (stage === 'percy') {
          if (anchor.cropEnabled) {
            // Turning crop OFF → drop the flag only (same stash-on-close model
            // as tint: in-memory values survive for re-open, but aren't saved).
            applyToTargets({ cropEnabled: false });
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
      const t = stageParams();
      if (!t || !t.tintEnabled || sw.disabled) return; // ignore when tint stage is off
      // hue-shift mode → PS-style adjust picker (H/S/L offsets + opacity 0..100).
      // Otherwise the normal rgba picker (opacity shown as 0..100 via alphaPercent).
      if (t.mode === 'hue-shift') {
        const parsed = window.ColorPicker.parseColor(t.color);
        window.ColorPicker.attach(sw, {
          adjust: true,
          value: { hue: +t.hueShift || 0, sat: +t.satShift || 0, light: +t.lightShift || 0,
                   alpha: Math.round((parsed.a / 255) * 100) },
          onChange(v) {
            applyToTargets({
              hueShift: v.hue, satShift: v.sat, lightShift: v.light,
              color: `255,255,255,${Math.round(v.alpha * 2.55)}`,
            });
            // Update the swatch live (don't re-render — that would rebuild DOM
            // and lose the open popover). onClose lets renderStages finalize.
            sw.style.background = hueShiftPreviewCss({ hueShift: v.hue, satShift: v.sat, lightShift: v.light });
            schedulePreview(true);   // live: coalesced on rAF, downsampled
          },
          onClose() { schedulePreview(false); }, // final: full-quality recompute
        });
        return;
      }
      window.ColorPicker.attach(sw, { type: 'rgba', alphaPercent: true, value: t.color, onChange(v) {
        applyToTargets({ color: v });
        sw.style.background = colorToCss(v);
        schedulePreview(true);   // live: coalesced on rAF, downsampled
      }, onClose() {
        schedulePreview(false);  // final: full-quality recompute
      }});
    });
    // Tint mode — custom dropdown (native <select> can't style dividers or
    // control popup direction). Clicking the trigger opens a popover listing
    // Tint mode — native <select> overlaid by the shared custom dropdown.
    // Options come from MODE_GROUPS (so dividers land between PS categories);
    // wheelInline mirrors native <select>'s hover-to-wheel value cycling.
    const modeSel = stages.querySelector('.tint-mode');
    if (modeSel) {
      const groups = MODE_GROUPS.map(modes => modes.map(m => [m, i18n.t('tint.mode_' + m)]));
      window.Dropdown.enhance(modeSel, { groups, wheelInline: !modeSel.disabled });
      modeSel.addEventListener('change', () => {
        const t0 = stageParams();
        const prevMode = t0 ? t0.mode : null;
        applyToTargets({ mode: modeSel.value });
        // Update the swatch in place to reflect the new mode (hue-shift shows
        // the shifted-base-red preview; other modes show the tint color). Mode
        // controls nothing else in the stage UI, so there's no need to rebuild.
        // Rebuilding would swap out the <select> mid-interaction and orphan the
        // open dropdown menu — same reason the color picker updates live.
        const t = stageParams();
        if (sw && t) sw.style.background = t.mode === 'hue-shift' ? hueShiftPreviewCss(t) : colorToCss(t.color);
        // Close the open picker ONLY when its TYPE changed (hue-shift ↔ a solid
        // mode swaps the PS adjust picker for the rgba picker and back). Within-
        // type mode changes leave the rgba picker valid. Mirrors layer-editor.
        const typeChanged = (prevMode === 'hue-shift') !== (modeSel.value === 'hue-shift');
        if (typeChanged && window.ColorPicker) window.ColorPicker.closeAll();
        schedulePreview(false);
      });
    }
    // Crop inputs.
    bindNumber(stages, '.crop-a', 'cropA');
    bindNumber(stages, '.crop-d', 'cropD');
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
      const anchor = stageParams();
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
      // Read the clamped value back: from the group's temp params when a whole
      // group is selected (applyToTargets wrote there, not to member data), else
      // from the anchor target.
      const t = stageParams();
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
      source: relPath, color: '255,255,255,255', mode: 'replace', destination: '',
      tintEnabled: false,
      cropEnabled: false, cropA: 0, cropB: 0, cropC: 32768, cropD: 0, cropTile: false, cropTileDir: 'down',
      darkenEnabled: false, darkenD: 0, darkenOpacity: 0,
      hueShift: 0, satShift: 0, lightShift: 0,
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
      // Explicit field mapping: strips runtime-only fields (e.g. _groupId) so
      // they don't leak into the actions clipboard / cross-preset paste.
      if (i >= 0 && i < tints.length) {
        const t = tints[i];
        out.push({
          source: t.source, destination: t.destination, color: t.color, mode: t.mode,
          tintEnabled: !!t.tintEnabled,
          cropEnabled: !!t.cropEnabled, cropA: t.cropA, cropB: t.cropB, cropC: t.cropC, cropD: t.cropD,
          cropTile: !!t.cropTile, cropTileDir: t.cropTileDir,
          darkenEnabled: !!t.darkenEnabled, darkenD: t.darkenD, darkenOpacity: t.darkenOpacity,
          hueShift: +t.hueShift || 0, satShift: +t.satShift || 0, lightShift: +t.lightShift || 0,
          exact: !!t.exact,
        });
      }
    }
    return JSON.parse(JSON.stringify(out));
  }

  // Select every row touched by a paste (appended + overwrite-replaced), called
  // by PresetEditor.pasteActions after render. idx are positions within the
  // single tints array (which is also the flat row layout).
  function selectAdded({ idx }) {
    if (!opSel) return;
    const arr = cur();
    const ns = new Set();
    let anchor = -1;
    for (const i of (idx || [])) { if (i >= 0 && i < arr.length) { ns.add(i); if (anchor < 0) anchor = i; } }
    if (anchor < 0) return;
    opSel.setSelected(ns, anchor);
  }

  window.TintEditor = { init, render, layoutColumns, deleteSelected, getSelectedActions, selectAdded, hasSelection: () => !!(opSel && opSel.getSelected().size > 0), clearSelection: () => opSel && opSel.clearSelection(), invalidateCache: () => { thumbCache.clear(); sourceImgCache.clear(); } };
})();
