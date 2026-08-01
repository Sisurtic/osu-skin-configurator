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

## Fixes
- presetDirty cleared when deleting the edited preset/group.
- Tab labels shortened (INI/文件/图像).
- Window minWidth bumped to 1140 so columns aren't crushed.

## Refactor & Cleanup
- Shared `utils/edge-fade.js` (was inlined in 3 editors).
- Removed probe-based column-width pipelines (file-copy/ini) — single table + auto/fixed layout handles it.
- Sticky thead + drag auto-scroll in OpTable (container-level, 2× fade-height zones).
