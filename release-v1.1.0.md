# v1.1.0

## Editing & operations

- **Image editor tab** — a tint → crop → darken pipeline with a real-time WebGL tint preview. Generate long-note (Percy LN) slider bodies from a short source via crop + tile, with on-canvas guide lines for the tail / blank / extended body. Per-source tint color and blend mode, plus an optional darken stage.
- **Preview image sequences & animated images** — pick multiple frames as an image sequence (with an FPS input; `-1` plays all frames within 1 second, like osu!'s `AnimationFramerate`), or use animated GIF / APNG / WebP. Works in both edit mode and the use-mode hover panel.
- **Copy / paste actions (Ctrl+C / Ctrl+V).** Copy the **selected rows of the current tab** (INI edits / file moves / image edits — one category at a time) into an in-app clipboard, then paste them into another preset or checkbox-group. Each copy fully resets the clipboard (no stale residue), and pasting merges with a per-category conflict dialog:
  - INI edits: **Skip / Overwrite** (duplicates by `section + maniaKeys + key`).
  - File copies / deletes / image edits: **Skip / Overwrite / Append** (duplicates by `source` / `path`). Append allows a same-path duplicate to coexist.
  - No-conflict categories merge silently; the dialog only appears for categories with actual conflicts.
  - Paste fills the editor and marks it dirty — press Ctrl+S to persist.
- **Duplicate any item (Ctrl+Shift+C).** The old Ctrl+C "duplicate preset" is now Ctrl+Shift+C and works on **presets, groups, and checkbox-groups** — duplicating a group deep-copies its entire subtree (child groups, checkbox-groups, presets, actions, description, preview).
- **Checkbox-group apply reworked.** A checkbox group now applies only the preset chosen **per row** plus any selected child checkbox groups (recursively) — not the entire subtree of presets. The backend `apply_group` reads `tableRowSelection` + `tableExpandedChildren` from config itself, mirroring the renderer's `collectTableRows`, so the applied set always matches what the user sees selected.
- **Mixed multi-select.** Presets and groups can be selected together (Ctrl/Shift); Shift-range works cross-type. Duplicate / delete / drag / create-parent all handle mixed selections. Editor locks during multi-select (tabs disabled + dimmed, save disabled).
- **Unified operation-list selection** — the ini / file-move / image editors share one selection + drag-to-delete engine (`OpTable`): plain / Ctrl / Shift range select, group-header awareness, and drag-to-delete behave identically across all three tabs. Fixes apply everywhere at once instead of drifting between copies.
- **Multi-select value sync** — editing one row syncs its value to other selected rows via `OpTable.createGroupSync`: ini matches by control type (a color row never receives a toggle value); file/tint match by field. A **folded group header is a full virtual row** (sync source + target; multiple folded headers sync to each other); an **expanded header is ignored** (its members are visible sub-rows that sync normally). Type-mismatched rows are never crossed.
- **Group header = temporary value.** A perColumn / sequence group header no longer writes its members live. It holds a local value (initialized from the first member) and commits to all members only via the **fill** button. Expanding a group no longer resets the header to the first member's value (expand/collapse now only toggles `display`, so the temp edit survives).
- **Unified input confirm.** Enter commits the typed value; **Escape restores the pre-edit value and cancels** (no normalize, no multi-select sync). Escape is now **prioritized**: an open input field is restored first, then the operation-table selection is cleared, then the preset selection — one ESC cancels only the innermost level.
- **ESC to deselect.** ESC clears the current selection (single or multi) in edit mode; in use mode ESC clears preset selection first, then deselects the skin. Only fires when nothing is focused (so input fields keep their own ESC behavior).
- **Inline group rename** — double-click a group header in the preset tree to rename it in place.
- **Batch collapse/expand** — collapse or expand a group and all its descendants in one batched operation (no per-group stalls on large trees).
- **Click thumbnail to change source** in file-copy and image-edit tabs. A standalone `SourcePicker` component (paralleling the color picker) owns trigger detection (only the `<img>`/icon, never the filename/whitespace — so clicking the name still selects the row) + the file dialog + skin-relative path normalization.
- **Editor empty state** — when nothing is selected, the editor shows **disabled tabs + a fade-in hint** (new preset steps, group/checkbox-group explanation, shortcuts, Esc to deselect) instead of a blank form. New-preset placement follows the selection (child / sibling / root); saving selects the new item; new preset auto-focuses the name input.
- **Apply dialog & toasts** — unified single/multi apply into one dialog with a three-group summary (INI / file / image). The success toast shows a compact `[INI×N, files×N, image×N]` summary.
- **Edit-mode Space apply** for presets and checkbox-groups; apply button enabled when a table group is selected.
- **Shortcuts dialog gains a global-shortcuts view.** Clicking the title toggles between the in-app **Program shortcuts** and the OS-level **Global shortcuts** view (global opens by default). The global view lists every bound preset / checkbox-group of the current skin with its accelerator, each row showing the **full group path** (`GroupA / GroupB / Name`). Supports **multi-select rebind + delete** using the same click / Ctrl-Cmd / Shift-range model as the edit-mode operation list; selection toggles classes in place (no re-render jump). Rebind captures a new combo with a danger-colored, non-blinking "press new shortcut…" hint, and the footer holds Rebind (warning) + Delete + Close. Program-shortcut rebind now **rejects already-taken combos** (keeps the recorder open with a toast naming the conflicting action).
- **Tint Exact toggle (@2x fallback).** The tint editor gains the same Exact column as file-copy. Non-@2x sources show a dimmed disabled toggle. Copy/tint destinations re-attach the source's @2x + extension from the ACTUAL source used (post-fallback), so a fallback to non-@2x produces a non-@2x output name.
- **Apply dialog save-before-apply.** Edit-mode apply with unsaved edits shows three buttons (Save & apply / Apply without saving / Cancel) inline — no separate confirm dialog.
- **Input confirm unified.** Enter always commits (even unchanged values); Escape restores the pre-edit value. Name/desc inputs mark dirty on focus; doSave flushes focused inputs before saving.
- **Source picker directory.** File dialog opens in the current source's directory (fallback to skin root). Preview image picker also opens in the current preview's directory.

## Drag & drop rewrite

- **Single delegated drag/drop system** replaces the previous 7 binding blocks / 13 handlers / 2 separate pipelines (preset vs group). One zone model: upper 25% = insert before, lower 25% = insert after, middle 50% = nest (group headers only).
- **`reorderChildren` atomic API** used for all reorder moves — computes the final child order array locally and sets it in one call, eliminating all same-parent index-adjustment bugs.
- **Cross-parent drag fixed.** Dragging an item from one parent to another no longer duplicates it (the item is moved via `movePresetGroup`/`moveGroup` first, then reordered).
- **Circular-reference guard** in `reorder_children` (Rust) prevents a group from being placed inside itself → stack overflow.
- **Plain groups can be freely reordered** — removed the forced "plain sub-groups at bottom" constraint in table groups.
- **Drag/drop zone consistency** — dragover and drop thresholds unified (25%/75%).
- **Flatten confirm on drag into table-group rows.** Dragging a plain group into a checkbox group's sub-group prompts to flatten (merge — hoist presets, delete shell). Dropping a group onto itself is a no-op. Auto-scroll during drag near list edges.

## UI / visual

- **Toast redesign** — toasts are click-to-dismiss and animate out with a per-frame **parabolic toss** (arc + spin) instead of a plain fade.
- **Borderless window** — custom titlebar (via `tauri-plugin-decorum`) with the native resize frame kept, so edge-drag resizing stays smooth. Drag the titlebar to move, double-click to maximize; Windows 11 Snap Layout is retained.
- **Update download with progress ring** — clicking the update dot streams the release exe and turns the dot into a spinning progress ring (head-extends / tail-retracts, color graduates yellow → green). Right-click cancels the in-flight download and discards the partial file.
- **Warning button** — the paste conflict dialog's Skip/Overwrite/Append buttons restyled: Skip = red (`btn--danger`), Append = solid yellow (`btn--warning`), Overwrite = green (`btn--primary`). All right-aligned.
- **Multi-select highlight** — preset items and group headers use a unified `--multi-selected` class with `box-shadow: inset` (replaces the `outline` that overlapped between adjacent rows).
- **Row spacing** — preset items and group headers have `margin: 0` (was `1px 0`) so multi-selected rows' highlights sit flush.
- **Group header size** — padding/margin aligned with preset items for visual consistency.
- **Editor empty state** — disabled tabs (`tabs--empty`) dim all tabs (including active), no hover response, no underline indicator. Empty-state hint merged into a single readable block (was two sections), 12px, left-aligned with padding.
- **Editor multi-select lock** — `editor--locked` dims the whole editor with a fade transition (`opacity` 0.18s).
- **Drop line** — element-level `::after` CSS (was a `position:fixed` overlay). Moves with the row on scroll.
- **Nest highlight** — `::before` with `--drop-indent`/`--drop-right` CSS vars (JS-computed from `getBoundingClientRect`); left edge tracks the header on horizontal scroll via a `scroll` listener.
- **Preset list edge-fade** — top/bottom fade overlays show scroll position in the preset tree.
- **Scroll edge-fade layering** — the operation-list top/bottom fades sit below the sticky header and above the table border/content, consistent across the ini / file / tint tabs.
- **Use-mode row label truncation** with hover tooltip for the full name.
- **HSV color picker** repositioned to the left of its trigger.
- **Distinct placeholders** for file-move vs. image-edit destination paths.
- **Disabled stages dim** their controls; Tab cycling reaches the edit-FPS button.
- **Skin hover highlight removed** on the selected skin.
- **Welcome page always shown** when no skin is selected (removed the empty selector state).
- **Editor ID tag.** Basic tab shows [#N] next to the name label.
- **ini delete button prefix** "-" → "+".
- **ESC priority layered.** Input restore → operation-table selection → preset selection → skin deselect. Use mode adds: shortcut selection → preset selection → skin. clearSelection clears anchor (no lingering highlight). Recorder ESC uses stopImmediatePropagation to prevent double-fire. The About/info dialog is now treated as a modal (ESC closes it and stops propagation instead of deselecting the skin).

## Animations

- Mode switch (use ↔ edit) slide.
- Checkbox-group activation / sub-group expansion row slide-in.
- Checkbox-group child switch fade-out → gap → fade-in.
- Group header underline grow.
- Welcome page fade-in.
- Skin switch exit/enter transition.
- Refresh skin list fade-out → reload → fade-in.
- Editor empty-state hint fade-in.
- Editor multi-select lock dim.
- Toast parabolic toss.

## Apply pipeline (backend)

- **Destination @2x + extension preserved.** Non-directory copy/tint destinations now re-attach the **source's `@2x` HD marker and extension** (`apply_source_suffix`), so a byte copy or re-encoded tint to a stem is no longer an extension-less file, and an HD source no longer silently drops to SD. Source has no `@2x` → target gets none; source has no extension → copy keeps the stem as-is, tint falls back to `.png`. Directory/empty destinations keep their existing behavior (full source name; tint empty-dest still overwrites the source in place).
- **Checkbox-group apply** — the toolbar counter and apply-dialog count use the same recursive count as the backend (group itself + per-row selections + selected child groups); a 5-row nested checkbox group correctly reports 5 instead of 12/16/17. After apply, `activePresets`/`activeTableGroups` clear atomically (`setMultiple`) so the checkbox group visibly folds. Group-only apply no longer fails with "无法加载预设数据" — the abort guard checks both the loose-preset and the group list.
- **Image processing parallelized with rayon** — crop went from ~5.6s to ~2.5ms; tint and darken now run in parallel. Release builds use `opt-level = 3`.

## Performance

- **Smooth crop/darken preview at any output height.** The crop output (e.g. a 32800px-tall Percy LN body) is now rendered **virtualized** — only the visible viewport is painted each frame, with the full height still driving the scrollbar. Tint is rasterised on the GPU (off-screen WebGL) so dragging the color picker stays at ~1ms/frame regardless of source size or `cropC`. Previously each frame rebuilt the entire multi-million-pixel output (~200ms).
- **Drag/drop** — delegated listeners bound once (guarded) instead of re-bound on every render.
- **Render batching** — presets/groups/rootChildren listeners collapsed into one microtask.
- **Batched global-shortcut bind/clear** — `global_shortcuts_bind_batch` persists all selected presets + checkbox-groups and re-registers **once**, regardless of selection size. Fixes the slow multi-select bind (previously N full skin rescans + OS re-registrations) and the use-mode badge "double-flash" on bind (the recorder no longer rebuilds the list mid-bind).

## Architecture / refactor

- **`selection.js` module** — multi-select state (presets + groups + Shift-range anchor) extracted from `preset-list.js` into a dedicated module with a clean API (`toggle`, `setSingle`, `setRangeFromAnchor`, `clear`, `beginDragPresetIds`, `beginDragGroupIds`, `outermostGroups`, `commonAncestor`). Eliminated ~10 dead-code items, 2 latent crash/state bugs, and 6+ duplicated logic blocks.
- **`OpTable` shared module** — selection + drag-to-delete + reorder unified. Adds `createGroupSync` (multi-select value-sync skeleton) and `createThumbLoader` (thumbnail cache + sync render + async-fill invariant); ini/file/tint inject differences via adapters.
- **Standalone `SourcePicker` component** (`source-picker.js`) — click-to-repick-source logic extracted, paralleling the color picker.
- **Unified drag/drop** — 7 binding blocks / 13 handlers replaced with a single delegated system.
- **`apply_group` backend rewritten** to read `tableRowSelection` + `tableExpandedChildren` from config (mirrors frontend `collectTableRows`).
- **`keyToAccelerator` shared** — moved out of `preset-selector.js` into the `Shortcuts` module so the use-mode recorder and the shortcuts-dialog global recorder share one KeyboardEvent → accelerator implementation.
- **Dead code removed** — `collect_descendant_preset_ids`, `reorder_children_stable`, plus ~10 items / 2 crash bugs in selection.js + preset-list.js.
- **Single version source** — `package.json` is the single source of truth; a pre-commit hook keeps `Cargo.toml` and `tauri.conf.json` in sync.

## Bug fixes

- ini value sync was effectively dead: it matched by literal key via a `_template` field that was never set, so perColumn columns (Colour0/Colour1…) never matched each other. Now matches by control type.
- "Skip the first item" when syncing into an expanded perColumn group: a group header and its first member both rendered a control with the first member's index, so `querySelector` updated the header instead of the member. `pickControl` now prefers the control not inside the collapsed header.
- ESC cancel no longer leaves the stored data out of sync with the restored input (text/number inputs stopped writing data per keystroke, mirroring file-copy).
- Color box ESC restores both the text and the swatch.
- `clearSelection` now clears the anchor too, so no row stays highlighted after ESC (previously the anchor row stayed lit). file ESC no longer skips clearing (was using a return value that was always undefined).
- `FPS = -1` now persists (previously clamped to 12).
- Switching from a sequence preset to an image preset no longer leaks the sequence preview; the first click on a sequence preset now shows its preview. Replaced the per-`<img>` timer with a single shared timer guarded by a view-generation token.
- Stale sequence fields no longer persist when switching back to a single image.
- Cropped image export now clears the bottom output row (transparent) so the long-note body stops exactly at `cropC` height instead of running one row past.
- **Bottom pixel crop** only when `cropEnabled` (Percy LN), not for plain tint operations.
- Fixed the top edge-fade gap; marked a non-passive wheel listener as passive.
- Stale checkbox-group row selection re-seeded — rows whose persisted selection references a deleted/restructured preset now re-seed the leftmost option.
- Divider position persists across all re-renders (select preset, switch mode, switch skin).
- **Save suppresses stale dirty** — sub-editor blur/change events during post-save re-render no longer re-mark dirty (the "save twice" bug).
- **INI value inputs** commit on Enter/blur (so ESC can truly cancel); the save button lights up on commit.
- **Group save now reloads the editor** — `editData` is refreshed from the freshly-saved group and the preview cache invalidated (previously showed the pre-save state).
- **Duplicate fix** — `refreshSkinData` now runs after duplicating (previously `Selection.clear()` made the guard skip it).
- **Duplicate focuses the new item** — the last created preset/group is selected after duplication.
- **Same-source cache preserved** when changing an image source (other rows using the same source keep their thumbnails).
- **Same-source preview thumbnails no longer lost** — the async fill skips by DOM state and rehydrates from cache, so two operations sharing one source image both paint in a single pass.
- **Checkbox-group enter animation fixed** — option spans were triple-counting rowKeys, inflating the stagger delay 3×. Now only row-level elements animate.
- **Checkbox-group child switch animation** — old rows fade out (`--exit`) before re-render, new rows fade in (`--enter`) with a visible gap.
- **Toolbar buttons blur** after click (no lingering focus).
- **Group children render in stored order** (presets + groups interleaved), not forced presets-first. Fixed in both edit and use mode.
- **New group creation clears preset selection.**
- **Color picker closes on save** — `.cp-popover` removed before the save IPC.
- **StageLight field** added to the Mania section in the INI editor.
- **INI field section order** follows the osu! wiki (General → Fonts → Colours → CatchTheBeat → Mania). Key order within sections unchanged.
- **Single flatten prompt** when creating a checkbox group from multiple nested groups — prompts once for all sources, not per-group.
- **File copy/delete reject out-of-skin files** (both now consistent).
- **Shortcut safety.** refreshSkinData now reloads global shortcuts so compact_ids re-numbering doesn't leave stale bindings. Duplicated presets don't inherit shortcuts.
- **Table-group global shortcuts.** A shortcut bound to a checkbox (table) group applies the group's per-row selection correctly — `apply_group` reads the TOP-LEVEL group's row-selection map with accumulated path prefixes so nested rows resolve. Shortcut apply shows a toast + plays a sound (system notifications removed).

---

**Full changelog:** https://github.com/Sisurtic/osu-skin-configurator/compare/v1.0.0...main

---
