# Release v1.2.0

Relative to the v1.1.1 release. Covers all changes since the v1.1.1 version bump.

## Features

### Tint — new "色相偏移" (Hue Shift) blend mode
- **Hue Shift mode** added at the bottom of the HSL mode group. It works like a Photoshop Hue/Saturation adjustment layer: the pixel's own H/S/L are shifted by signed offsets, blended by the strength value (alpha).
  - Hue −180°..180°, Saturation −100%..100%, Lightness −100%..100%. Hue wraps; saturation/lightness clamp. The original pixel's S/L are otherwise preserved ("SB 用原来的").
  - When this mode is selected, clicking the color swatch opens a **new PS-style 4-slider picker** (Hue / Saturation / Lightness offsets + Opacity 0..100) instead of the normal palette picker.
- The hue-shift math is byte-identical across all three render paths: the WebGL live preview, the canvas2D fallback, and the Rust apply backend.

### Color picker
- **Tint-mode picker opacity is now 0..100** (display only; the stored alpha in the color string stays 0..255, so it remains the blend strength). The **ini** color picker is unchanged and still shows 0..255.

### Layer compositing editor (new "图层" tab)
- Stack multiple PNG layers into one composite output. Each layer has its own blend mode (full PS set incl. normal), opacity, exact toggle, and position (9-grid alignment + X/Y coordinates).
- **Canvas size** switchable per stack: bottom-layer size or max width × max height.
- **Per-layer properties flyout** (☰ button): opacity / 9-grid SVG alignment pad / coordinate X / coordinate Y. Wheel adjusts (1px normal, 10px shift).
- **Z-order** = list order (layers[0] = top). Drag to reorder; drag to delete zone. New layers appear at the top.
- **Composite preview** (canvas2D, centered fit). Rust `apply_layers` backend with pixel-vs-pixel blend compositing.
- Full action-category round-trip (fileLayers): store → save → load → apply → copy/paste.
- Apply dialog counts (groupLayer/itemLayer).

### Editor infrastructure
- **Single-table refactor**: tint/file/ini/layer editors merged their header + body tables into one (thead+tbody). Auto layout (layer) or fixed layout (tint/file/ini) per table. Sticky thead with outline-based edge coverage. Shared `utils/edge-fade.js`.
- **Edge-fade overlays** repositioned below the sticky thead.
- **Esc selection** fixed: now correctly clears after add (was blocked by empty selection set + focusable target check).
- **Switching skins** clears selection (selectedPreset/group → null, multi-select cleared).

### Pan/zoom preview engine (tint + layer)
- **TintTransform pan/zoom engine** replaces the old scroll model for the tint preview: fit=containment, viewport-clamped panning, virtualized slicing (whole-tile culling), guide windowing at the viewport level. Layer editor isolated behind `#tab-tint` scoping.
- **Layer composite preview** gains a pan/zoom image viewer (same engine family) for inspecting the stacked output.

### Update flow
- **Update check opens the external browser** to the release page instead of an in-app download + exe-replace flow (the bundled downloader was removed).

### Per-skin theming & metadata
- **Per-skin accent hue**: each skin can set its own accent color via a new dialog (opened from the edit-mode "current skin" name). The whole UI recolors live as you drag a dashed hue strip (12° steps); `--accent-hue` is the single source of truth, every accent shade derives from it, and `applyAccent()` only sets that one variable. Persists in the skin's own `config.osp`.
- **Two custom text lines + a link URL** per skin, shown as a right-aligned card in the use-mode preset header. When a link is set, the whole card is clickable (opens in the external browser via `tauri-plugin-opener`); the card's vertical bar highlights on hover.
- **Row-activation source highlighting**: the option that fires an activation binding (the one the user picked) is now visually marked (accent hue −20°) alongside the activated target. Tracked by option key so nested-table rowKey drift can't drop the highlight.
- **Skin-name settings button**: the edit-mode current-skin name is now a clickable button (hover highlight) that opens the metadata dialog; overflow shows a title tooltip.

### Color system & UI polish
- **All colors centralized in variables.css** as hsl; derived accent hues (`--group-tag` +60°, `--shortcut` +20°, `--source` −20°) follow the per-skin hue. Semantic colors tuned for higher saturation so they stay distinct from accent even on hue collision.
- **Skin list / hover square corners**; current-skin header matches the editor tab-bar height (`--tab-height`); op-table selected rows keep an accent tint on hover (`--accent-bg-hover`) instead of wiping to gray.
- **Toolbar path click opens the folder picker directly** (the intermediate "path is set" settings screen was removed).
- **Edit-mode tab bar: wheel cycles tabs** when hovered, stops at edges.

## Fixes
- presetDirty cleared when deleting the edited preset/group.
- Tab labels shortened (INI/文件/图像).
- Window minWidth bumped to 1140 so columns aren't crushed.
- **Layer transparent base** no longer tints translucent pixels black (alpha math fixed).
- **Layer dest path** normalized the same way as file-copy/tint (trailing-slash / case handling).
- **Layer re-source** opens in the layer's current source folder (was opening at root).
- **Apply dialog**: layer action counts fixed; duplicate preset/group now correctly located.
- **Color-picker trigger highlight** clears on internal close paths (Esc / outside-click) instead of sticking.
- **INI key cell**: shrunk the key-description font and added key/desc spacing so the two read as distinct.
- **Switching the osu! folder path now refreshes editors** (previously they kept showing the old path's skin data; the `osuPath` listener now resets `selectedSkin`, tripping the full clear branch).
- **Language switch no longer drops the selected skin** (`rerenderAll` re-fired `osuPath` unchanged → destructive reset ran; guarded with an equality check).
- **Language switch no longer reloads the skin list** — `rerenderAll` drops the `skins` re-fire and calls a new `SkinList.refreshLabels()` that updates only i18n text in place.
- **Skin metadata persistence**: `save_config` was hand-rolling the JSON and dropped the new `accentHue`/`customText1`/`customText2`/`skinLink` fields — now written; `scan_skin` no longer deletes `config.osp` when only metadata is set.
- **Sidebar divider**: removed the double 1px border between the current-skin header and presets (rendered as 2px).
- **Close button**: hover fill uses `--danger-important` (wins over decorum's injected `rgba(255,0,0,0.7) !important`); icon thickened via `-webkit-text-stroke` (icon fonts have no bold glyph).

## Refactor & Cleanup
- Shared `utils/edge-fade.js` (was inlined in 3 editors).
- Removed probe-based column-width pipelines (file-copy/ini) — single table + auto/fixed layout handles it.
- Sticky thead + drag auto-scroll in OpTable (container-level, 2× fade-height zones).
- **Operation lists migrated to CSS Grid** (`op-row`/`op-cell`), replacing the old `<table>` layout; toggle + row-highlight styles unified across editors.
