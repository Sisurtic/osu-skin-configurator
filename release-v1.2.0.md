# v1.2.0

## Editor consistency & shared infrastructure

The ini / file-move / image editors used to drift apart — selection, multi-select sync, thumbnails, and input behavior each had per-editor copies that broke in subtly different ways. This release consolidates the duplicated cores into shared modules so a fix applies everywhere at once.

- **Shared multi-select value sync (`OpTable.createGroupSync`).** All three row editors now sync an edited value to other selected rows through one skeleton. ini matches by control type (a color row never receives a toggle value); file and tint match by field. A **folded group header is a full virtual row** (sync source + target; multiple folded headers sync to each other); an **expanded header is ignored** (its members are visible sub-rows that sync normally). Type-mismatched rows are never crossed.
- **Group header = temporary value.** A perColumn / sequence group header no longer writes its members live. It holds a local value (initialized from the first member) and commits to all members only via the **fill** button. Expanding a group no longer resets the header to the first member's value (the temp edit survives, because expand/collapse stopped re-rendering).
- **Consistent Shift range-select.** A connect-select across a **folded** group header pulls in the whole group and highlights it; across an **expanded** header it lands on the member rows (header transparent). Single-click on a header still selects the whole group.
- **Shared thumbnail loader (`OpTable.createThumbLoader`).** The recurring "same-source preview thumbnail gets lost" bug class is fixed structurally: the async fill now skips by **DOM state** (not cache state) and **rehydrates from cache**, so two operations sharing one source image both paint in a single pass. A stale-container race (rapid re-render mid-await) is also closed by resolving the query root after the await.
- **Standalone SourcePicker component.** Click-to-repick a source file (thumbnail/icon) is extracted into `source-picker.js`, paralleling the color picker. It owns trigger detection (only the `<img>`/icon, never the filename/whitespace — so row selection works when clicking the name) + the file dialog + skin-relative path normalization. Each editor's `onPick` does its own data write / sync / render.
- **Unified input confirm.** Enter commits the typed value; **Escape restores the pre-edit value and cancels** (no normalize, no multi-select sync). The pre-edit value is captured at focus time (so a prior multi-select sync that changed the data without a re-render is correctly restored). All per-editor Enter/Escape handlers were removed in favor of the global `InputConfirm`; a lingering cancel flag that could starve the next Enter after an Escape (because the restoring change sometimes doesn't fire `change`) is cleared on the next tick. Escape is now **prioritized**: an open input field is restored first, then the operation-table selection is cleared, then the preset selection — one ESC cancels the innermost level only.

## Apply pipeline

- **Destination @2x + extension preserved.** Non-directory copy/tint destinations now re-attach the **source's `@2x` HD marker and extension** (`apply_source_suffix`), so a byte copy or re-encoded tint to a stem is no longer a useless extension-less file, and an HD source no longer silently drops to SD. Source has no `@2x` → target gets none; source has no extension → copy keeps the stem as-is, tint falls back to `.png` (needed for `image::save` format inference). Directory/empty destinations keep their existing behavior (full source name; tint empty-dest still overwrites the source in place).

## UX & polish

- **Scroll edge-fade layering.** The top/bottom fade overlays sit below the sticky header (header occludes their top edge) and above the table border/content, consistent across the ini / file / tint tabs.
- Group-header fill button reads the header's current (possibly edited) temp value, not the first member's stored value.
- tint destination multi-select now updates sibling input boxes live on commit (previously only the data synced; the UI caught up on save).

## Bug fixes

- ini value sync was effectively dead: it matched by literal key via a `_template` field that was never set, so perColumn columns (Colour0/Colour1…) never matched each other. Now matches by control type.
- "Skip the first item" when syncing into an expanded perColumn group: a group header and its first member both rendered a control with the first member's index, so `querySelector` updated the header instead of the member. `pickControl` now prefers the control not inside the collapsed header.
- ESC cancel no longer leaves the stored data out of sync with the restored input (text/number inputs stopped writing data per keystroke, mirroring file-copy), so a true cancel is a true cancel.
- Color box ESC restores both the text and the swatch.
