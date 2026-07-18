// op-table.js — shared selection / drag-to-delete machinery for the operation
// tables in the ini / file / image editors. Introduced to unify the three
// editors' duplicated (and subtly divergent) row-selection logic.
//
// Scope: selection state machine (plain / Ctrl / Shift), drag-to-delete payload
// + drop zone, and highlighting. Column layout, edge-fade, and the expanded-
// group save/restore stay in each editor (they differ enough to not be worth a
// shared abstraction yet). Selection + drag-to-delete is the duplicated core.
//
// Vanilla JS, no modules. window.OpTable = { create }.
// Adapter contract:
//   rowSelector           '.file-op-row' — rows that participate in selection
//   container             the render root (queries are scoped to this)
//   rowMembers(row)       -> number[]   (plain row: [idx]; group header: all members)
//   rowAnchor(row)        -> number     (the index used for Shift-range math)
//   interactiveSelector   'input, button, ...' — clicks here don't select
//   deleteMimeType        'application/file-indices'
//   applyDelete(indicesDesc)  splice + commit + toast (editor owns data shape)
//   shouldResetSelection(dataRef, lastDataRef)  optional; default = always reset.
//       Return false to PRESERVE selection across a re-render (ini's lastActionsRef
//       rule: reset only when the actions array reference changed).
//   onSelectionChange({indices, anchor})  optional; tint uses it to drive preview.
//   selectedClass / draggingClass   defaults 'row--selected' / 'row--dragging'
// Instance API:
//   bindRow(row), bindDeleteZone(zoneEl),
//   highlightAll(), clearSelection(), maybeResetSelection(dataRef),
//   setContainer(c), getSelected(), getAnchor(), setSelected(set, anchor),
//   state (getter) -> { selectedIndices, anchorIndex, lastClickedRow }
//
// Shift-range anchor: FIRST member index of a group header (matches the file
// editor's rowAnchorIndex). This produces selection sets identical to the ini
// editor's former LAST-anchor rule, because perColumn/sequence group members
// occupy CONSECUTIVE indices: a group-header endpoint selects the whole group
// (via the endpoint-group rule) and the numeric span covers the rest either
// way. Verified on the tricky cases (header as anchor, middle-group, collapsed
// members).

(function () {
  function create(adapter) {
    const A = adapter;
    const interactiveSel = A.interactiveSelector || 'input, select, button, label, .toggle';
    const selectedClass = A.selectedClass || 'row--selected';
    const draggingClass = A.draggingClass || 'row--dragging';

    let selectedIndices = new Set();
    let anchorIndex = -1;
    let lastClickedRow = null;
    // Last data reference passed to maybeResetSelection. Editors that want to
    // preserve selection across re-renders caused by sort/delete (same data
    // array, rebuilt DOM) pass the current data array; OpTable resets selection
    // only when the reference changes (real data change) — mirrors ini-editor's
    // lastActionsRef rule. Defaults to "always reset" (file/tint behavior).
    let lastDataRef = null;

    function root() { return A.container; }

    // Called by the editor at the top of its render(). Returns true and clears
    // selection when the underlying data reference changed; otherwise the prior
    // selection survives the DOM rebuild. `dataRef` is whatever the editor treats
    // as its identity token (the actions array, or null/undefined to force reset).
    function maybeResetSelection(dataRef) {
      const should = typeof A.shouldResetSelection === 'function'
        ? A.shouldResetSelection(dataRef, lastDataRef)
        : true;
      if (should) {
        selectedIndices.clear();
        anchorIndex = -1;
        lastClickedRow = null;
        lastDataRef = dataRef;
        return true;
      }
      lastDataRef = dataRef;
      return false;
    }

    function visibleRows() {
      const out = [];
      root().querySelectorAll(A.rowSelector).forEach(r => {
        if (getComputedStyle(r).display === 'none') return;
        out.push(r);
      });
      return out;
    }

    function highlightAll() {
      root().querySelectorAll(A.rowSelector).forEach(row => {
        const members = A.rowMembers(row);
        let sel;
        if (members.length === 0) {
          sel = false;
        } else if (selectedIndices.size === 0) {
          // Empty-set rule (tint preview): highlight only the anchor row.
          sel = A.rowAnchor(row) === anchorIndex;
        } else {
          sel = members.every(m => selectedIndices.has(m));
        }
        row.classList.toggle(selectedClass, sel);
      });
    }

    function fireChange() {
      if (typeof A.onSelectionChange === 'function') {
        A.onSelectionChange({ indices: selectedIndices, anchor: anchorIndex });
      }
    }

    function bindRow(row) {
      row.addEventListener('click', (e) => {
        // Skip if an input is focused (text selection drag, typing, etc.)
        const ae = document.activeElement;
        if (ae && ae.closest('input, textarea, select')) return;
        if (e.target.closest(interactiveSel)) return;
        const members = A.rowMembers(row);
        if (members.length === 0) return;
        const anchor = A.rowAnchor(row);

        if (e.shiftKey && anchorIndex !== -1) {
          // Range select between the anchor and this row.
          // - If an endpoint IS a group header, that whole group is selected
          //   (selecting the header = selecting the group).
          // - Otherwise the range is a NUMERIC index span [lo, hi]: every visible
          //   row whose own/member index falls in [lo, hi] is selected. A group
          //   header sitting in the MIDDLE of the range does NOT pull in its whole
          //   group — only the members whose indices are actually in the span.
          //   This makes "click a plain row, shift-click a member inside an
          //   expanded group" select just that member, not the whole group.
          if (!e.ctrlKey && !e.metaKey) selectedIndices.clear();
          const rows = visibleRows();
          // Resolve the anchor row and current row by reference, then by anchor idx.
          let aRow = rows.find(r => r === lastClickedRow);
          if (!aRow) aRow = rows.find(r => A.rowAnchor(r) === anchorIndex);
          let bRow = rows.find(r => r === row);
          if (!bRow) bRow = rows.find(r => A.rowAnchor(r) === anchor);
          if (aRow && bRow) {
            // `rowRangeMembers` (optional adapter hook) lets an editor make a group
            // header TRANSPARENT in range selection: it reports only the in-range
            // member set (e.g. just the first member) so the header neither forces
            // its whole group in as an endpoint nor skews the numeric span. Click
            // selection still uses rowMembers (whole group). Defaults to rowMembers.
            const rangeMembers = (rr) => (typeof A.rowRangeMembers === 'function') ? A.rowRangeMembers(rr) : A.rowMembers(rr);
            // Endpoint groups → select whole group (selecting a header = the group).
            const aMembers = rangeMembers(aRow);
            const bMembers = rangeMembers(bRow);
            const aIsGroup = aMembers.length > 1 || (aRow.classList.contains('file-seq-group') || !!aRow.dataset.seqKey);
            const bIsGroup = bMembers.length > 1 || (bRow.classList.contains('file-seq-group') || !!bRow.dataset.seqKey);
            if (aIsGroup) aMembers.forEach(m => selectedIndices.add(m));
            if (bIsGroup) bMembers.forEach(m => selectedIndices.add(m));
            // Numeric span between the two anchors (use each row's anchor idx).
            const aIdx = A.rowAnchor(aRow);
            const bIdx = A.rowAnchor(bRow);
            const lo = Math.min(aIdx, bIdx), hi = Math.max(aIdx, bIdx);
            // Every visible row (INCLUDING the endpoints) contributes the member
            // indices that fall in the numeric span. A group header whose members
            // are in range selects those members even when the group is COLLAPSED
            // (its header is still visible, so range-crossing it pulls in its
            // members) — matching the "range across a group header selects" rule.
            // Only a header that is an ENDPOINT additionally forces the WHOLE
            // group in (handled above via aIsGroup/bIsGroup); a middle header
            // contributes just the in-span members, not the entire group.
            for (const r of rows) {
              const rm = rangeMembers(r);
              if (rm.length === 0) continue;
              for (const m of rm) {
                if (m >= lo && m <= hi) selectedIndices.add(m);
              }
            }
          } else {
            members.forEach(m => selectedIndices.add(m));
          }
          // anchorIndex unchanged (shift extends from the anchor)
        } else if (e.ctrlKey || e.metaKey) {
          const allSel = members.every(m => selectedIndices.has(m));
          if (allSel) members.forEach(m => selectedIndices.delete(m));
          else members.forEach(m => selectedIndices.add(m));
          anchorIndex = anchor;
          lastClickedRow = row;
        } else {
          selectedIndices.clear();
          members.forEach(m => selectedIndices.add(m));
          anchorIndex = anchor;
          lastClickedRow = row;
        }
        highlightAll();
        fireChange();
      });

      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', (e) => {
        const activeEl = document.activeElement;
        if (activeEl && row.contains(activeEl) && activeEl.closest(interactiveSel)) {
          e.preventDefault();
          return;
        }
        // Group MEMBER rows can't be dragged (no reordering inside a group, no
        // dragging out). Only plain rows and group headers start a drag.
        if (typeof A.isGroupMemberRow === 'function' && A.isGroupMemberRow(row)) {
          e.preventDefault();
          return;
        }
        const members = A.rowMembers(row);
        const fullySelected = members.length > 0 && members.every(m => selectedIndices.has(m));
        if (!fullySelected) {
          // Select the dragged row (so the payload includes it) WITHOUT firing
          // onSelectionChange: this selection exists only to build the delete
          // payload, not as a user intent. Editors that recompute heavy state on
          // selection change (e.g. tint's preview) must not pay that cost mid-drag.
          selectedIndices.clear();
          members.forEach(m => selectedIndices.add(m));
          anchorIndex = A.rowAnchor(row);
          lastClickedRow = row;
          highlightAll();
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(A.deleteMimeType, JSON.stringify([...selectedIndices]));
        root().querySelectorAll(A.rowSelector).forEach(r => {
          const ms = A.rowMembers(r);
          if (ms.length && ms.every(m => selectedIndices.has(m))) r.classList.add(draggingClass);
        });
      });
      row.addEventListener('dragend', () => {
        root().querySelectorAll(A.rowSelector).forEach(r => r.classList.remove(draggingClass));
        const line = document.getElementById('__op_drop_line');
        if (line) line.style.display = 'none';
      });

      // ── Drop-to-reorder: this row is a drop target (parallel to the delete
      // zone). Upper half of the row → insert before it; lower half → after.
      // Group member rows are NOT reorder targets (no changing in-group order).
      if (typeof A.reorder === 'function') {
        const isMember = typeof A.isGroupMemberRow === 'function';
        // A single fixed-position overlay line — drawn ABOVE the table, never
        // inserted into it, so it can't trigger a reflow or make rows jitter.
        const getLine = () => {
          let line = document.getElementById('__op_drop_line');
          if (!line) {
            line = document.createElement('div');
            line.id = '__op_drop_line';
            line.className = 'op-drop-line-overlay';
            document.body.appendChild(line);
          }
          return line;
        };
        const hideLine = () => {
          const line = document.getElementById('__op_drop_line');
          if (line) line.style.display = 'none';
        };
        row.addEventListener('dragover', (e) => {
          const raw = e.dataTransfer.types.includes(A.deleteMimeType);
          if (!raw) return;
          if (isMember && A.isGroupMemberRow(row)) return; // members: no reorder drop
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const r = row.getBoundingClientRect();
          const before = (e.clientY - r.top) < r.height / 2;
          const line = getLine();
          line.style.display = '';
          line.style.left = r.left + 'px';
          line.style.width = r.width + 'px';
          line.style.top = (before ? r.top : r.bottom) + 'px';
        });
        row.addEventListener('dragleave', hideLine);
        row.addEventListener('drop', (e) => {
          const raw = e.dataTransfer.getData(A.deleteMimeType);
          hideLine();
          if (!raw) return;
          if (isMember && A.isGroupMemberRow(row)) return;
          e.preventDefault();
          let from;
          try { from = JSON.parse(raw); } catch (_) { return; }
          if (!Array.isArray(from) || from.length === 0) return;
          const r = row.getBoundingClientRect();
          const before = (e.clientY - r.top) < r.height / 2;
          const anchor = A.rowAnchor(row);
          // Insert before the anchor row, or after its last member.
          const toIndex = before ? anchor : anchor + A.rowMembers(row).length;
          // No-op if dropping onto itself (anchor inside the dragged set).
          if (from.includes(anchor)) return;
          A.reorder(from, toIndex);
        });
      }
    }

    function bindDeleteZone(zoneEl) {
      if (!zoneEl) return;
      zoneEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zoneEl.style.opacity = '1';
        zoneEl.style.background = 'rgba(224,85,85,0.1)';
      });
      zoneEl.addEventListener('dragleave', () => {
        zoneEl.style.opacity = '0.5';
        zoneEl.style.background = '';
      });
      zoneEl.addEventListener('drop', (e) => {
        e.preventDefault();
        zoneEl.style.opacity = '0.5';
        zoneEl.style.background = '';
        const raw = e.dataTransfer.getData(A.deleteMimeType);
        if (!raw) return;
        let indices;
        try {
          indices = JSON.parse(raw).sort((x, y) => y - x);
        } catch (_) { return; /* malformed payload */ }
        selectedIndices.clear();
        anchorIndex = -1;
        lastClickedRow = null;
        A.applyDelete(indices);
      });
    }

    function clearSelection() {
      selectedIndices.clear();
      anchorIndex = -1;
      lastClickedRow = null;
      highlightAll();
      fireChange();
    }

    return {
      bindRow, bindDeleteZone,
      highlightAll, clearSelection, maybeResetSelection,
      // The container can change across re-renders (same DOM node reused, but be
      // safe); editors call this if they re-create the instance-less container.
      setContainer: (c) => { A.container = c; },
      getSelected: () => selectedIndices,
      getAnchor: () => anchorIndex,
      setSelected: (set, anchor) => { selectedIndices = new Set(set); if (anchor != null) anchorIndex = anchor; },
      // direct field access for editors that read selection during their own handlers
      get state() { return { selectedIndices, anchorIndex, lastClickedRow }; },
    };
  }

  // ── Shared pure utility helpers ──
  // These were duplicated across the ini / file / image editors; centralized
  // here so all three stay in sync. escapeHtml uses the regex form (no DOM
  // dependency) — the tint editor's version, the cleanest of the three.
  // (isImagePath is NOT shared: tint only handles PNG, file handles all image
  // types — each editor keeps its own.)

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function pathBasename(p) {
    return (p || '').split(/[/\\]/).pop() || p;
  }

  // ── Sequence-frame (动画序列帧) helpers ──
  // osu! animation frames come in two naming styles (the trailing @2x HD marker
  // and the extension are ALWAYS ignored when classifying):
  //   • "-N" style: foo-0, foo-1, foo-2 …  (the overwhelming majority)
  //   •  "N" style: foo0, foo1, foo2 …     (only a fixed set of names, below)
  // A "group" is a run of CONSECUTIVE ops whose frames share one base name AND
  // form a single ascending index column (0,1,2…). A second 0-N run after the
  // first is a SEPARATE group, not a continuation.
  // The only names that use the no-hyphen "N" style — fixed allowlist, no
  // wildcards. Used both for DETECTING no-hyphen frames (so "menu0" is never
  // misread as one) and for OUTPUT hyphen style when re-attaching an index.
  const SEQ_NOHYPHEN = new Set([
    'sliderb', 'pippidonclear', 'pippidonfail', 'pippidonidle', 'pippidonkiai',
  ]);

  // Filename stem classification. Given a filename's bare stem (extension and
  // @2x already stripped, or this strips them), return:
  //   { base, style, index }   when the stem ends in a sequence index, or
  //   null                      when it does not look like a frame.
  //   style is '-' ("-N") or '' ("N", no-hyphen). The "N" style is only valid
  //   for names in SEQ_NOHYPHEN; a digit suffix on any other name (e.g.
  //   "menu0") is NOT a frame — returns null.
  //   index is the parsed integer.
  function parseFrame(stem) {
    let b = (stem || '').replace(/\\/g, '/').split('/').pop() || '';
    b = b.replace(/\.[^.]+$/, '');   // extension
    b = b.replace(/@2x$/i, '');        // HD suffix
    b = b.replace(/-(x|dot|comma|percent)$/i, ''); // format suffix
    // "-N" style (hyphenated): e.g. "sliderb-0".
    let m = b.match(/^(.*)-(\d+)$/);
    if (m) return { base: m[1], style: '-', index: parseInt(m[2], 10) };
    // "N" style (no hyphen): ONLY for the fixed allowlist, e.g. "sliderb0".
    m = b.match(/^(\D+?)(\d+)$/);
    if (m && SEQ_NOHYPHEN.has(m[1])) return { base: m[1], style: '', index: parseInt(m[2], 10) };
    return null;
  }
  // Whether a source filename is an animation frame (either style).
  function isFrame(sourceName) { return !!parseFrame(sourceName); }
  // Sequence-group key for a source filename: type prefix (so copies & deletes
  // never merge) + base name. Returns '' for non-frames.
  function seqKey(sourceName, typePrefix) {
    const f = parseFrame(sourceName);
    if (!f) return '';
    return (typePrefix == null ? '' : typePrefix) + '|' + f.base;
  }
  // ── Stable per-instance group ids (data-layer) ──
  // Each group instance carries a stable groupId stored ON its member objects
  // (runtime field `_groupId`). Save paths explicitly map fields, so any `_`-prefixed
  // field is stripped from the preset on disk — disk format is unchanged. Because the
  // id lives on the member object, reorder (which only moves object refs) preserves it,
  // so expand state survives. No accumulating Map: state lives on the data, nothing leaks.
  //
  // Rule: a group REUSES its members existing _groupId iff ALL members currently share
  // the same non-empty _groupId (the group was not just assembled from disparate sources);
  // otherwise a fresh id is minted and written to every member. Same-name groups keep
  // distinct ids (their members never shared one), so they never select/expand together.
  function assignSeqGroupIds(groups) {
    // Collect every _groupId already in use across all groups' members, so a
    // freshly minted id NEVER collides with a residual one (defence-in-depth:
    // even if some path failed to strip _groupId on copy/paste, new ids stay
    // distinct from carried-over ones).
    const used = new Set();
    for (const g of groups) for (const m of (g.members || [])) if (m._groupId) used.add(m._groupId);
    let next = 1;
    const mint = () => { let id; do { id = 'g' + (next++); } while (used.has(id)); used.add(id); return id; };
    for (const g of groups) {
      const ms = g.members || [];
      if (ms.length) {
        const first = ms[0]._groupId;
        const allSame = first && ms.every(m => m._groupId === first);
        const gid = allSame ? first : mint();
        for (const m of ms) m._groupId = gid;
        g.gid = gid;
      }
    }
  }
  // Drop expanded-set entries for gids that no longer exist (the group was
  // deleted, or its members were re-grouped). Called after assignSeqGroupIds so
  // expandedSeqGroups can't accumulate dead keys. `currentGids` = the set of
  // gids still present this render (from the group entries' .gid).
  function pruneExpanded(expandedSet, currentGids) {
    if (!expandedSet || !expandedSet.size) return;
    const keep = new Set(currentGids);
    for (const id of [...expandedSet]) if (!keep.has(id)) expandedSet.delete(id);
  }

  // Format a destination path: strip the user's file extension and trailing
  // @2x (keep only the stem). The SOURCE file's full suffix (@2x + extension)
  // is re-attached at apply time by the backend (apply_source_suffix), so the
  // stored destination is just the directory + stem with no suffix.
  // NOTE: this does NOT strip a sequence index — plain single-row destinations
  // (e.g. "cursor-rank2") must keep their "-2". Sequence-index re-attachment for
  // GROUP frames is handled by the BACKEND (apply_seq_index), not here.
  // e.g. dest=mania/custom@2x.png → mania/custom (stem only, no suffix)
  function appendSrcExt(val) {
    if (!val || val.endsWith('/')) return val;
    const slash = val.lastIndexOf('/');
    const base = val.slice(slash + 1);
    // Strip extension (everything from the first dot).
    const dotPos = base.indexOf('.');
    let stem = dotPos >= 0 ? base.slice(0, dotPos) : base;
    // Strip trailing @2x.
    stem = stem.replace(/@2x$/i, '');
    const dir = val.slice(0, slash + 1);
    return dir + stem;
  }

  // Reorder `arr`: move the items at `fromIndices` (in original-array positions)
  // so they land at `toIndex` (original-array position, "insert before this row"
  // semantics). Returns { arr: NEW array, insertAt: start index of the moved
  // block in the new array, count: how many were moved }. `toIndex` is adjusted
  // for the removed items. fromIndices need not be contiguous (multi-select /
  // whole-group block).
  function reorderArray(arr, fromIndices, toIndex) {
    const set = new Set(fromIndices);
    const moved = arr.filter((_, i) => set.has(i));           // preserve order
    const rest = arr.filter((_, i) => !set.has(i));
    // Map original toIndex → index in `rest` (subtract removed items before it).
    const sortedFrom = [...fromIndices].sort((a, b) => a - b);
    let removedBefore = 0;
    for (const f of sortedFrom) { if (f < toIndex) removedBefore++; else break; }
    let target = toIndex - removedBefore;
    if (target < 0) target = 0;
    if (target > rest.length) target = rest.length;
    rest.splice(target, 0, ...moved);
    return { arr: rest, insertAt: target, count: moved.length };
  }

  // ── createGroupSync: shared multi-select value-sync skeleton ──
  // Both the ini and file-copy editors sync an edited value to other selected
  // rows, treating a FOLDED group header as a virtual row (sync source + target)
  // and ignoring expanded headers. The control flow is identical; only the
  // data shape, control selectors, and type-matching differ. This factory takes
  // an adapter and returns { syncField }.
  //
  // Adapter contract:
  //   getSelected()           -> Set<number>          current selection indices
  //   isHeaderControl(el)     -> bool                 el is a group-header control
  //   headerRowOf(el)         -> element|null         the header row for el
  //   headerIdOf(headerEl)    -> string               stable id for the header
  //   foldedHeaderForIndex(i) -> element|null         folded header containing i, else null
  //   sourceTypeKey(isHeader, headerEl|idx) -> string type-match key for the source
  //   nodeTypeKey(node)       -> string               type-match key for a target node
  //   skipDataNode(idx)       -> bool                 skip this data node (e.g. _delete)
  //   writeSourceData(idx, field, val)                write the source data row value
  //   writeTargetData(idx, field, val)                write a target data row value
  //   applyToHeader(headerEl, field, val, color)      DOM update on a header control
  //   applyToData(idx, field, val, color)             DOM update on a data row control
  //   commit(touched)                                commit data to the store
  function createGroupSync(A) {
    function collectSyncNodes() {
      const set = A.getSelected();
      const nodes = [];
      const seenHeader = new Set();
      for (const i of set) {
        const h = A.foldedHeaderForIndex(i);
        if (h) {
          const id = 'h:' + A.headerIdOf(h);
          if (!seenHeader.has(id)) { seenHeader.add(id); nodes.push({ kind: 'header', id, headerEl: h }); }
        } else {
          nodes.push({ kind: 'data', id: 'i:' + i, idx: i });
        }
      }
      return nodes;
    }
    // Sync an edit to other selected rows. `source` is the edited element.
    function syncField(source, field, val, color) {
      const isHeaderSource = A.isHeaderControl(source);
      let sourceId, sourceTypeKey;
      if (isHeaderSource) {
        const headerEl = A.headerRowOf(source);
        sourceId = headerEl ? ('h:' + A.headerIdOf(headerEl)) : null;
        sourceTypeKey = A.sourceTypeKey(true, headerEl);
      } else {
        const idx = parseInt(source.dataset.idx);
        if (isNaN(idx)) { A.commit(false); return; }
        A.writeSourceData(idx, field, val);
        sourceId = 'i:' + idx;
        sourceTypeKey = A.sourceTypeKey(false, idx);
      }
      const set = A.getSelected();
      // Single selection (or none): a data-source edit still wrote its own row
      // (writeSourceData) and must be committed to the store (so dirty/save
      // state updates); a header-source edit is temporary and commits nothing.
      if (!set || set.size <= 1) { A.commit(!isHeaderSource); return; }
      const nodes = collectSyncNodes();
      let touched = false;
      for (const n of nodes) {
        if (n.id === sourceId) continue;
        if (n.kind === 'header') {
          if (A.nodeTypeKey(n) !== sourceTypeKey) continue;
          A.applyToHeader(n.headerEl, field, val, color);
        } else {
          if (A.skipDataNode(n.idx) || A.nodeTypeKey(n) !== sourceTypeKey) continue;
          A.writeTargetData(n.idx, field, val);
          A.applyToData(n.idx, field, val, color);
          touched = true;
        }
      }
      A.commit(isHeaderSource ? touched : true);
    }
    return { syncField };
  }

  // ── createThumbLoader: shared thumbnail cache + render/fill invariant ──
  // Both the ini (n/a), file-copy, and tint editors render a small thumbnail per
  // row from a source path, caching the fetched dataURL keyed by the RAW path so
  // re-renders paint synchronously. The bug-prone part is the async fill: it must
  // (a) skip spans that already show an <img> (DOM state, NOT cache state — cache
  // state skips same-source siblings and leaves them as placeholders), and
  // (b) rehydrate a placeholder span from the cache when the DOM lacks the img.
  // Centralizing this here stops the "same-source preview lost" class of bugs
  // from recurring whenever one editor's fill logic drifts from the other's.
  //
  // Adapter contract:
  //   cache                 Map<rawPath, dataURL>   shared, mutated in place
  //   isImage(raw)          -> bool                 raw is a loadable image
  //   skinPath()            -> Promise<string>      (optional) skin root for resolving
  //   resolveDiskPath(raw, skPath) -> string        (optional) raw → on-disk path; default: prepend skPath if relative
  //   getPreview(diskPath)  -> Promise<{success,data}> (optional) default api.getPreviewDataUrl
  //   imgHtml(dataUrl)      -> string               (optional) <img> markup (shared default style)
  //   placeholderHtml(raw)  -> string               (optional) non-image / not-yet-cached markup (default '📄')
  // Returns { htmlFor(raw, label), load(root) }:
  //   htmlFor — synchronous inner HTML (cached <img> + label, or placeholder + label)
  //   load    — async fill over `.file-thumb[data-path]` under `root` (container or document)
  function createThumbLoader(A) {
    const cache = A.cache;
    const isImage = A.isImage;
    const skinPath = A.skinPath || (async () => '');
    const resolveDiskPath = A.resolveDiskPath || ((raw, skPath) => {
      let p = raw;
      const isAbs = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');
      if (!isAbs && skPath) p = skPath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + p.replace(/\\/g, '/');
      return p;
    });
    const getPreview = A.getPreview || ((p) => api.getPreviewDataUrl(p));
    const esc = escapeHtml;
    const imgHtml = A.imgHtml || ((dataUrl) => `<img src="${dataUrl}" title="change" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0">`);
    const placeholderHtml = A.placeholderHtml || (() => '📄');

    // Synchronous inner HTML for a thumbnail cell. `label` is the visible name
    // (basename) the caller chose. Cached → <img>; not-an-image → placeholder;
    // image-but-uncached → placeholder (load() fills it).
    function htmlFor(raw, label) {
      const labelText = `<span class="file-thumb__name" title="${esc(raw)}">${esc(label || '')}</span>`;
      if (!isImage(raw)) return `${placeholderHtml(raw)} ${labelText}`;
      if (cache.has(raw)) return `${imgHtml(cache.get(raw))} ${labelText}`;
      return `${placeholderHtml(raw)} ${labelText}`;
    }

    // Async-fill every `.file-thumb[data-path]` under `root`. `root` may be an
    // element or a function returning the (possibly reassigned) element — a
    // function is resolved AFTER the skinPath await so a re-render during the
    // await doesn't leave us iterating a detached container.
    // Invariants:
    //   • skip by DOM state (span already shows an <img>), never by cache state;
    //   • if the cache already has the entry, rehydrate the span from cache;
    //   • otherwise fetch, cache (keyed by raw), then fill.
    async function load(root) {
      const skPath = await skinPath() || '';
      const el = typeof root === 'function' ? root() : root;
      if (!el) return;
      const spans = el.querySelectorAll('.file-thumb[data-path]');
      for (const span of spans) {
        const raw = span.dataset.path || '';
        if (span.querySelector('img')) continue;       // DOM state — already shown
        if (!isImage(raw)) continue;
        const label = pathBasename(raw);
        if (cache.has(raw)) {                           // rehydrate from cache (fixes same-source siblings)
          span.innerHTML = `${imgHtml(cache.get(raw))} <span class="file-thumb__name" title="${esc(raw)}">${esc(label)}</span>`;
          continue;
        }
        const p = resolveDiskPath(raw, skPath);
        try {
          const result = await getPreview(p);
          if (result && result.success && result.data) {
            cache.set(raw, result.data);
            span.innerHTML = `${imgHtml(result.data)} <span class="file-thumb__name" title="${esc(raw)}">${esc(label)}</span>`;
          }
        } catch (_) { /* skip failed thumbnail */ }
      }
    }

    return { htmlFor, load };
  }

  window.OpTable = { create, createGroupSync, createThumbLoader, escapeHtml, pathBasename, appendSrcExt, reorderArray, parseFrame, isFrame, seqKey, SEQ_NOHYPHEN, assignSeqGroupIds, pruneExpanded };
})();
