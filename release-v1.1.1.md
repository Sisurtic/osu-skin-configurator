# Release v1.1.1

Relative to the v1.1.0 release. Covers all changes since the v1.1.0 version bump.

## Features

### Re-source (pick new source files for existing operations)
- **Multi-select re-source.** Click any operation's thumbnail (an ordinary row or a sequence-group header) to repick its source file(s). Every selected target is re-sourced at once: each ordinary row becomes the chosen file group, and each selected group is replaced wholesale. Single-select behaves the same — the clicked target is the only one.
  - Clicking a row **outside** the selection re-sources only that row (the old selection is discarded); clicking **inside** the selection re-sources every selected target.
  - Each re-sourced row inherits its original data (destination/exact for file ops; color/mode/crop for tint). Group re-source carries the header's *current* values, including uncommitted stage edits.
  - Works across mixed selections (ordinary rows + groups), with sequence frames regrouping automatically.
- **Group-level re-source.** Repick a sequence group's sources to regenerate its members by index; same-name groups no longer collide.

### Table groups & activation
- **Row activation** for table groups: scope detection for nested groups, lock-release keeps the target's selection, auto-expand parent on group create, and auto-disabling of sibling options.

### Other
- **Sequence-frame grouping** for file-copy and tint editors (consecutive frames collapse into one group; per-instance stable group ids).
- **Backend apply warnings** are now surfaced in the UI.
- **Global shortcuts view** in the shortcuts dialog, with batched binding and a slide-in animation.
- **Save-before-apply** gate in the apply dialog.

## Fixes

- **Re-source correctness:** fixed the file dialog double-opening on ordinary rows, group headers not opening the dialog at all, multi-select only re-sourcing one group, selection scope (outside-click no longer overwrites unrelated rows), same-name group carry collisions, and lost header values on group re-source.
- **Selection & highlight:** `setSelected` now auto-highlights (matching clear-selection), and call sites that ran before render were reordered (reorder/delete/add across ini/file/tint). Paste (Ctrl+V) selects pasted rows by position — including overwrite-replaced rows — and never the source row an appended copy shares a key with.
- **Group headers:** folded header temporary values (destination/exact, tint stage temp) are preserved across re-renders.
- **Tint:** repaired garbled description color; whole-group stage edits now write a group temp value (Fill pushes tint/crop to members); Exact toggle correctly shows disabled for non-@2x sources; counter alignment and column-width sync.
- **Editors:** paste-Esc cancels the whole paste; first edit (not focus) marks dirty; save flushes the focused field; Enter always commits; single-select edits mark dirty.
- **Presets:** source stays highlighted during the new-preset flow; new groups nest under the selected item; checkbox-group rows with stale persisted selections are re-seeded.
- **i18n:** backend covers ko-KR/ru-RU and follows in-app language switches.
- **Color picker:** removed stray document mousemove/mouseup listeners on close.

## Refactor & Cleanup

- Unified ini expand/collapse onto a shared `expandedSeqGroups` model.
- Extracted shared `apply_index_and_suffix` (used by copy + tint).
- Purged Electron-rewrite leftovers from the source tree.
- Clippy/dead-code/dupe cleanup; removed dead ini sort machinery.
- Removed 19 dead CSS class rules from `components.css`; unified tint's selection class (`row--selected`) and group-header cursor rule with the other editors.
- Group-member sub-rows pass clicks through to row selection (no longer read as re-source buttons).
