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

## Fixes

- (none this release)

## Notes

- Older presets without the new `hueShift`/`satShift`/`lightShift` fields render identically (defaults = 0 → no shift).
