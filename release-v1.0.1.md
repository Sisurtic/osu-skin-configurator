# v1.0.1

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
