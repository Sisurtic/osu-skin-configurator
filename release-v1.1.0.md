# v1.1.0

## New features

- **Image editor tab** — a tint → crop → darken pipeline with a real-time WebGL tint preview. Generate long-note (Percy LN) slider bodies from a short source via crop + tile, with on-canvas guide lines for the tail / blank / extended body. Per-source tint color and blend mode, plus an optional darken stage.
- **Preview image sequences & animated images** — pick multiple frames as an image sequence (with an FPS input; `-1` plays all frames within 1 second, like osu!'s `AnimationFramerate`), or use animated GIF / APNG / WebP. Works in both edit mode and the use-mode hover panel.
- **Compact `config.osp` storage** — disabled stages are dropped; enabled stages keep their full parameter set. A migration script (`scripts/migrate-osp.{js,bat}`) converts older pretty-printed files.
- **Inline group rename** — double-click a group header in the preset tree to rename it in place.
- **Batch collapse/expand** — collapse or expand a group and all its descendants in one batched operation (no per-group stalls on large trees).
- **Borderless window** — custom titlebar (via `tauri-plugin-decorum`) with the native resize frame kept, so edge-drag resizing stays smooth. Drag the titlebar to move, double-click to maximize; Windows 11 Snap Layout is retained.
- **Update download with progress ring** — clicking the update dot streams the release exe and turns the dot into a spinning progress ring (head-extends / tail-retracts, color graduates yellow → green). Right-click cancels the in-flight download and discards the partial file.

## Performance

- **Smooth crop/darken preview at any output height.** The crop output (e.g. a 32800px-tall Percy LN body) is now rendered **virtualized** — only the visible viewport is painted each frame, with the full height still driving the scrollbar. Tint is rasterised on the GPU (off-screen WebGL) so dragging the color picker stays at ~1ms/frame regardless of source size or `cropC`. Previously each frame rebuilt the entire multi-million-pixel output (~200ms).
- Image processing parallelized with rayon: crop went from ~5.6s to ~2.5ms; tint and darken now run in parallel. Release builds use `opt-level = 3`.

## UX & polish

- **Toast redesign** — toasts are now click-to-dismiss and animate out with a per-frame **parabolic toss** (arc + spin) instead of a plain fade.
- **Unified operation-list selection** — the ini / file-move / image editors now share one selection + drag-to-delete engine (`OpTable`): plain / Ctrl / Shift range select, group-header awareness, and drag-to-delete behave identically across all three tabs, and edge-fade scroll indicators are consistent. Selection fixes now apply everywhere at once instead of drifting between copies.
- **Preset list edge-fade** — top/bottom fade overlays show scroll position in the preset tree.
- HSV color picker repositioned to the left of its trigger.
- Disabled stages dim their controls; Tab cycling now reaches the edit-FPS button.
- Distinct destination-path placeholders for file moves vs. image edits.

## Apply dialog & toasts

- Unified single/multi apply into one dialog with a three-group summary (INI edits / file moves / image edits). The success toast shows a compact `[INI×N, files×N, image×N]` summary.

## Bug fixes

- `FPS = -1` now persists (previously clamped to 12).
- Switching from a sequence preset to an image preset no longer leaks the sequence preview; the first click on a sequence preset now shows its preview. Replaced the per-`<img>` timer with a single shared timer guarded by a view-generation token.
- Fixed the top edge-fade gap; marked a non-passive wheel listener as passive.
- Stale sequence fields no longer persist when switching back to a single image.
- Cropped image export now clears the bottom output row (transparent) so the long-note body stops exactly at `cropC` height instead of running one row past.

## Project

- `package.json` is now the single source of truth for the version; a pre-commit hook keeps `Cargo.toml` and `tauri.conf.json` in sync.

---

**Full changelog:** https://github.com/Sisurtic/osu-skin-configurator/compare/v1.0.0...main

---

## Post-release fixes (in-development)

### Checkbox (multi-select) group apply

- **Apply semantics reworked.** A checkbox group now applies only the preset chosen **per row** plus any selected child checkbox groups (recursively) — not the entire subtree of presets. The backend `apply_group` reads `tableRowSelection` + `tableExpandedChildren` from config itself, mirroring the renderer's `collectTableRows`, so the applied set always matches what the user sees selected.
- **Counter fixed.** The toolbar apply counter and the apply-dialog count now use the same recursive count as the backend (group itself + per-row selections + selected child groups). A 5-row nested checkbox group correctly reports 5 instead of 12/16/17.
- **Group-only apply no longer fails** with "无法加载预设数据" — the abort guard now checks both the loose-preset list and the group list.
- **Apply-dialog action counts are accurate.** A checkbox group's summary now merges actions from the root group + selected child groups + selected presets (previously only the root's own actions were shown). The dialog shows the total unit count as `(N)`.
- **Selection clears after apply.** `activePresets` and `activeTableGroups` are now cleared atomically (`setMultiple`) so the checkbox group visibly folds after a successful apply.

### Animations

- **Slide-in animation** for newly-appeared rows/items: checkbox group activation, child sub-group expansion, and plain-group expansion (including sub-table-group headers) now fade + slide in from the left. Two-phase (sync hidden state + next-frame animation class) avoids flash and browser class-coalescing.
- **Collapse / deselect closes immediately** (the previous upward-shrink exit animation was janky and has been removed).
- Fixed an issue where no animation played: a duplicate `groups` state listener caused a second re-render that discarded the just-added animation elements before their `requestAnimationFrame` class was applied.

### Edit mode

- **Group save now reloads the editor**, mirroring the preset-save path: `editData` is refreshed from the freshly-saved group, and the preview cache is invalidated. Previously the editor kept showing the pre-save state.

### Copy / paste & duplication

- **Duplicate any item (Ctrl+Shift+C).** The old Ctrl+C "duplicate preset" is now Ctrl+Shift+C and works on **presets, groups, and checkbox-groups** — duplicating a group deep-copies its entire subtree (child groups, checkbox-groups, presets, actions, description, preview).
- **Copy / paste actions (Ctrl+C / Ctrl+V).** Copy the **selected rows of the current tab** (INI edits / file moves / image edits — one category at a time) into an in-app clipboard, then paste them into another preset or checkbox-group. Each copy fully resets the clipboard (no stale residue), and pasting merges with a per-category conflict dialog:
  - INI edits: **Skip / Overwrite** (duplicates by `section + maniaKeys + key`).
  - File copies / deletes / image edits: **Skip / Overwrite / Append** (duplicates by `source` / `path`). Append allows a same-path duplicate to coexist.
  - No-conflict categories merge silently; the dialog only appears for categories with actual conflicts.
- Paste fills the editor and marks it dirty — press Ctrl+S to persist.
- **Checkbox-group creation merge check.** Creating a checkbox group from a selected group that has nested plain sub-groups now prompts to flatten (same as the drag-into-table path), instead of producing an invalid tree.
