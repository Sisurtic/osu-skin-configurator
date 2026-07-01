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
            // Endpoint groups → select whole group (selecting a header = the group).
            const aMembers = A.rowMembers(aRow);
            const bMembers = A.rowMembers(bRow);
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
              const rm = A.rowMembers(r);
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
      });
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

  // Normalize a file destination's extension to the SOURCE's extension: strip
  // any extension the user typed, then append the source's. Copies/tints are
  // byte-for-byte, so a mismatched extension would corrupt the file. Directory
  // dests (trailing /) are left untouched.
  function appendSrcExt(val, source) {
    if (!val || val.endsWith('/')) return val;
    const slash = val.lastIndexOf('/');
    const base = val.slice(slash + 1);
    const dotPos = base.indexOf('.');
    const stem = dotPos >= 0 ? base.slice(0, dotPos) : base;
    const srcBase = (source || '').split(/[/\\]/).pop() || '';
    const sDot = srcBase.lastIndexOf('.');
    if (sDot < 0) return dotPos >= 0 ? val.slice(0, slash + 1) + stem : val;
    return val.slice(0, slash + 1) + stem + srcBase.slice(sDot);
  }

  window.OpTable = { create, escapeHtml, pathBasename, appendSrcExt };
})();
