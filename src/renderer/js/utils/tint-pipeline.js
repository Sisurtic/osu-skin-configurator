// Shared tint (Stage-1) pipeline — pure functions reused by tint-editor.js and
// layer-editor.js. Holds the tint color math (solid-color blend + hue-shift),
// the GL/JS tinted-source builders, and the mode tables. The crop/darken stages
// stay private to tint-editor (layers don't use them).
//
// Exposed on window.TintPipeline. No state — every function is pure (takes its
// inputs, returns a value/canvas). The GL renderer is cached on a caller-supplied
// `host` canvas element (see buildTintedSource/getTintedSourceGL).
(function () {
  // Blend modes grouped like Photoshop's mode menu. The dropdown renders each
  // group's options separated by a disabled divider line (no group label).
  const MODE_GROUPS = [
    ['replace'],
    ['darken', 'multiply'],
    ['lighten', 'screen'],
    ['overlay', 'soft-light', 'hard-light'],
    ['difference', 'exclusion'],
    ['hue', 'saturation', 'color', 'luminosity', 'hue-shift'],
  ];

  // u_mode enum must match gl-preview.js applyTint: 0 multiply,1 screen,2 overlay,
  // 3 soft-light,4 hard-light,5 lighten,6 darken,7 difference,8 exclusion,
  // 9 hue,10 saturation,11 color,12 luminosity,13 hue-shift,14 replace.
  const TINT_MODE_IDX = { multiply: 0, screen: 1, overlay: 2, 'soft-light': 3, 'hard-light': 4, lighten: 5, darken: 6, difference: 7, exclusion: 8, hue: 9, saturation: 10, color: 11, luminosity: 12, 'hue-shift': 13, replace: 14 };

  // Base color for the hue-shift swatch preview: HSB(0°, 50%, 50%) = a dark red.
  // HSV(0, 0.5, 0.5) → rgb(128, 64, 64). Precomputed once.
  const HUE_SHIFT_BASE_RGB = [128, 64, 64];

  function colorToCss(c) {
    const p = (c || '255,255,255,255').split(',').map(n => parseInt(n.trim(), 10));
    const r = p[0] || 0, g = p[1] || 0, b = p[2] || 0, a = (p[3] !== undefined ? p[3] : 255) / 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  // RGB↔HSL helpers (inputs 0..255, HSL in 0..1 floats).
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    if (Math.abs(mx - mn) < 1e-9) return [0, 0, l];
    const d = mx - mn;
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hsl2rgb(h, s, l) {
    if (s < 1e-9) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2 = (t) => {
      let tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      if (tt < 1/6) return p + (q - p) * 6 * tt;
      if (tt < 0.5) return q;
      if (tt < 2/3) return p + (q - p) * (2/3 - tt) * 6;
      return p;
    };
    return [hue2(h + 1/3) * 255, hue2(h) * 255, hue2(h - 1/3) * 255];
  }
  // HSL component replacement: combine pixel + color channels per `which`
  // ('hue'|'saturation'|'color'|'luminosity'). Inputs/outputs are 0..255.
  function hslCombine(pr, pg, pb, cr, cg, cb, which) {
    const ph = rgb2hsl(pr, pg, pb);
    const ch = rgb2hsl(cr, cg, cb);
    let h, s, l;
    if (which === 'hue') { h = ch[0]; s = ph[1]; l = ph[2]; }
    else if (which === 'saturation') { h = ph[0]; s = ch[1]; l = ph[2]; }
    else if (which === 'color') { h = ch[0]; s = ch[1]; l = ph[2]; }
    else { h = ph[0]; s = ph[1]; l = ch[2]; } // luminosity
    const [r, g, b] = hsl2rgb(h, s, l);
    return [Math.round(r), Math.round(g), Math.round(b)];
  }

  // Apply the op's hue/sat/light shifts to the base color, return a CSS color.
  // Mirrors the apply math (H wraps mod 1; S/L clamp) so the swatch reads as the
  // actual result of the adjustment on the base red.
  function hueShiftPreviewCss(t) {
    const hsl = rgb2hsl(HUE_SHIFT_BASE_RGB[0], HUE_SHIFT_BASE_RGB[1], HUE_SHIFT_BASE_RGB[2]); // [0..1]
    const H = ((hsl[0] + (+(t && t.hueShift) || 0) / 360) % 1 + 1) % 1;
    const S = Math.min(1, Math.max(0, hsl[1] + (+(t && t.satShift) || 0) / 100));
    const L = Math.min(1, Math.max(0, hsl[2] + (+(t && t.lightShift) || 0) / 100));
    const [r, g, b] = hsl2rgb(H, S, L); // → 0..255
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  }

  function parseColorUniforms(c) {
    const p = (c || '255,255,255,255').split(',').map(n => parseInt(n.trim(), 10));
    const r = (p[0] || 0) / 255, g = (p[1] || 0) / 255, b = (p[2] || 0) / 255;
    const t = (p[3] !== undefined ? p[3] : 255) / 255;
    return { color: [r, g, b], t };
  }

  // The core tint (Stage-1) pixel transform. Applies a solid-color blend OR a
  // hue-shift self-adjustment to every non-transparent pixel of `src` (a canvas
  // or anything drawImage accepts), returns a NEW canvas. `op` carries the
  // hueShift/satShift/lightShift offsets (only read by the 'hue-shift' mode).
  function tintCanvas(src, color, mode, op) {
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, out.width, out.height);
    const d = data.data;
    const p = (color || '255,255,255,255').split(',').map(n => parseInt(n.trim(), 10));
    const cr = p[0] || 0, cg = p[1] || 0, cb = p[2] || 0;
    // The picker's alpha is the BLEND STRENGTH (how much of the tint applies),
    // NOT the output image opacity. alpha is preserved from the source pixel.
    const t = (p[3] !== undefined ? p[3] : 255) / 255;
    const lerp = (a, b) => a + (b - a) * t;
    for (let i = 0; i < d.length; i += 4) {
      const pa = d[i + 3];
      if (pa === 0) continue;
      const pr = d[i], pg = d[i + 1], pb = d[i + 2];
      let r, g, b;
      if (mode === 'multiply') { r = lerp(pr, pr * cr / 255); g = lerp(pg, pg * cg / 255); b = lerp(pb, pb * cb / 255); }
      else if (mode === 'screen') { r = lerp(pr, 255 - (255 - pr) * (255 - cr) / 255); g = lerp(pg, 255 - (255 - pg) * (255 - cg) / 255); b = lerp(pb, 255 - (255 - pb) * (255 - cb) / 255); }
      else if (mode === 'overlay') {
        const o = (pp, cc) => pp < 128 ? 2 * pp * cc / 255 : 255 - 2 * (255 - pp) * (255 - cc) / 255;
        r = lerp(pr, o(pr, cr)); g = lerp(pg, o(pg, cg)); b = lerp(pb, o(pb, cb));
      } else if (mode === 'darken') {
        r = lerp(pr, Math.min(pr, cr)); g = lerp(pg, Math.min(pg, cg)); b = lerp(pb, Math.min(pb, cb));
      } else if (mode === 'lighten') {
        r = lerp(pr, Math.max(pr, cr)); g = lerp(pg, Math.max(pg, cg)); b = lerp(pb, Math.max(pb, cb));
      } else if (mode === 'soft-light') {
        const sl = (a, c) => c <= 0.5 ? 2*a*c/255 + a*a/255*(1-2*c) : 2*a*(255-c)/255 + a*a/255*(2*c-1);
        r = lerp(pr, sl(pr, cr)); g = lerp(pg, sl(pg, cg)); b = lerp(pb, sl(pb, cb));
      } else if (mode === 'hard-light') {
        const hl = (a, c) => c <= 127 ? 2 * a * c / 255 : 255 - 2 * (255 - a) * (255 - c) / 255;
        r = lerp(pr, hl(pr, cr)); g = lerp(pg, hl(pg, cg)); b = lerp(pb, hl(pb, cb));
      } else if (mode === 'difference') {
        r = lerp(pr, Math.abs(pr - cr)); g = lerp(pg, Math.abs(pg - cg)); b = lerp(pb, Math.abs(pb - cb));
      } else if (mode === 'exclusion') {
        const ex = (a, c) => a + c - 2 * a * c / 255;
        r = lerp(pr, ex(pr, cr)); g = lerp(pg, ex(pg, cg)); b = lerp(pb, ex(pb, cb));
      } else if (mode === 'hue' || mode === 'saturation' || mode === 'color' || mode === 'luminosity') {
        const [nr, ng, nb] = hslCombine(pr, pg, pb, cr, cg, cb, mode);
        r = lerp(pr, nr); g = lerp(pg, ng); b = lerp(pb, nb);
      } else if (mode === 'hue-shift') {
        // PS Hue/Saturation adjustment: shift the pixel's own H/S/L by signed
        // offsets (hue ±180°, sat/light ±100%). hue wraps mod 1; sat/light clamp.
        const ph = rgb2hsl(pr, pg, pb); // [h,s,l] in 0..1
        const hShift = ((+(op && op.hueShift) || 0) / 360);
        const sShift = ((+(op && op.satShift) || 0) / 100);
        const lShift = ((+(op && op.lightShift) || 0) / 100);
        const H = ((ph[0] + hShift) % 1 + 1) % 1;
        const S = Math.min(1, Math.max(0, ph[1] + sShift));
        const L = Math.min(1, Math.max(0, ph[2] + lShift));
        const [nr, ng, nb] = hsl2rgb(H, S, L); // → 0..255
        r = lerp(pr, nr); g = lerp(pg, ng); b = lerp(pb, nb);
      } else { r = lerp(pr, cr); g = lerp(pg, cg); b = lerp(pb, cb); } // replace → solid color
      d[i] = Math.round(r); d[i + 1] = Math.round(g); d[i + 2] = Math.round(b);
      d[i + 3] = pa; // preserve source alpha
    }
    ctx.putImageData(data, 0, 0);
    return out;
  }

  // Lazily create / reuse an off-screen GlPreview renderer that rasterises the
  // tinted source. Cached on `host` keyed by srcKey (texture never re-uploaded
  // for the same source). Each call re-renders with the CURRENT t.color/mode —
  // a uniform update + one drawArrays — so color dragging is cheap.
  //
  // The GL canvas uses preserveDrawingBuffer:false (per gl-preview.js), so we
  // blit each render into a stable 2D result canvas before returning — that 2D
  // canvas is what callers sample via drawImage, and it stays valid across frames.
  function getTintedSourceGL(img, t, host) {
    const GlPreview = window.GlPreview;
    if (!GlPreview) return null;
    const srcW = img.naturalWidth, srcH = img.naturalHeight;
    if (!srcW || !srcH) return null;
    // GPU caps texture size; render at source resolution but clamp to the limit.
    const MAX = 16384;
    const scale = (srcW > MAX || srcH > MAX) ? Math.min(MAX / srcW, MAX / srcH) : 1;
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    // Reuse the off-screen GL canvas + renderer + 2D result canvas on the host;
    // rebuild if the source changed (different srcKey) or dims changed.
    let entry = host && host._tintGL;
    if (entry && (entry.srcKey !== t.source || entry.gl.width !== w || entry.gl.height !== h)) {
      // Source/dims changed: release the previous GL renderer before rebuilding.
      try { entry.renderer.destroy(); } catch (_) {}
      entry = null;
    }
    if (!entry) {
      try {
        const gl = document.createElement('canvas');
        gl.width = w; gl.height = h;
        const renderer = GlPreview.createRenderer(gl);
        if (!renderer) { if (host) host._tintGL = null; return null; }
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        entry = { srcKey: t.source, gl, renderer, out };
        if (host) host._tintGL = entry;
      } catch (_) { if (host) host._tintGL = null; return null; }
    }
    try {
      const tc = parseColorUniforms(t.color);
      entry.renderer.render({
        img, srcKey: t.source, srcW, srcH, outW: srcW, outH: srcH,
        tint: { on: true, color: tc.color, t: tc.t, mode: TINT_MODE_IDX[t.mode] || 0,
          hueShift: +t.hueShift || 0, satShift: +t.satShift || 0, lightShift: +t.lightShift || 0 },
        crop: { on: false }, darken: { on: false },
      });
      // Blit the (possibly volatile) GL backing into the stable 2D result canvas.
      entry.out.getContext('2d').clearRect(0, 0, w, h);
      entry.out.getContext('2d').drawImage(entry.gl, 0, 0);
      return entry.out;
    } catch (_) { return null; }
  }

  // Build the TINTED source canvas (Stage-1 result for one image). When tint is
  // on, prefer an OFF-SCREEN WebGL render (tint is the one stage GL does in O(1));
  // falls back to the JS tintCanvas loop if WebGL is unavailable. `host` is the
  // canvas element the GL renderer is cached on. Returns an un-tinted copy when
  // tint is off (so callers always get a drawable canvas).
  function buildTintedSource(img, t, host) {
    if (t.tintEnabled) {
      const gl = getTintedSourceGL(img, t, host);
      if (gl) return gl;
    }
    let canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    if (t.tintEnabled) canvas = tintCanvas(canvas, t.color, t.mode, t);
    return canvas;
  }

  // Signature of everything that affects the (tinted) source canvas EXCEPT the
  // tint COLOR — color is applied at paint time via the GL tint renderer (a
  // uniform update), so a color drag must NOT invalidate the cached source.
  function tintSourceSig(img, t) {
    return (img && img.naturalWidth) + 'x' + (img && img.naturalHeight) + '|' +
      (t.source || '') + '|' + (t.tintEnabled ? 1 : 0) + '|' + (t.mode || '');
  }

  window.TintPipeline = {
    MODE_GROUPS, TINT_MODE_IDX, HUE_SHIFT_BASE_RGB,
    colorToCss, hueShiftPreviewCss,
    rgb2hsl, hsl2rgb, hslCombine,
    parseColorUniforms, tintCanvas,
    getTintedSourceGL, buildTintedSource, tintSourceSig,
  };
})();
