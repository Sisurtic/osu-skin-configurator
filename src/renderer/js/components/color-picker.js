// Color picker — modern color selection with palette, sliders, eyedropper, and multi-format input
(function () {
  // Parse any color format to { r, g, b, a (0-255) }
  function parseColor(str) {
    if (!str || typeof str !== 'string') return { r: 0, g: 0, b: 0, a: 255 };
    str = str.trim();
    // CSS named colors (common subset)
    const NAMED = {
      black:'0,0,0', white:'255,255,255', red:'255,0,0', lime:'0,255,0', blue:'0,0,255',
      yellow:'255,255,0', cyan:'0,255,255', magenta:'255,0,255', silver:'192,192,192',
      gray:'128,128,128', maroon:'128,0,0', olive:'128,128,0', green:'0,128,0',
      purple:'128,0,128', teal:'0,128,128', navy:'0,0,128', orange:'255,165,0',
      pink:'255,192,203', transparent:'0,0,0,0',
    };
    if (NAMED[str.toLowerCase()]) {
      const p = NAMED[str.toLowerCase()].split(',').map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p[3] !== undefined ? p[3] : 255 };
    }
    // hex
    if (str[0] === '#') {
      let h = str.slice(1);
      if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      if (h.length === 4) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]+h[3]+h[3];
      if (h.length >= 6) {
        return {
          r: parseInt(h.slice(0,2), 16),
          g: parseInt(h.slice(2,4), 16),
          b: parseInt(h.slice(4,6), 16),
          a: h.length >= 8 ? parseInt(h.slice(6,8), 16) : 255,
        };
      }
    }
    // rgba() / rgb()
    const mRgba = str.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
    if (mRgba) {
      return {
        r: parseInt(mRgba[1]),
        g: parseInt(mRgba[2]),
        b: parseInt(mRgba[3]),
        a: mRgba[4] !== undefined ? Math.round(parseFloat(mRgba[4]) * (parseFloat(mRgba[4]) <= 1 ? 255 : 1)) : 255,
      };
    }
    // hsl() / hsla()
    const mHsl = str.match(/hsla?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)/i);
    if (mHsl) {
      const h = parseFloat(mHsl[1]) / 360;
      const s = parseFloat(mHsl[2]) / 100;
      const l = parseFloat(mHsl[3]) / 100;
      const rgb = hslToRgb(h, s, l);
      return { ...rgb, a: mHsl[4] !== undefined ? Math.round(parseFloat(mHsl[4]) * 255) : 255 };
    }
    // raw R,G,B or R,G,B,A
    const parts = str.split(',').map(Number);
    if (parts.length === 3 && parts.every(n => !isNaN(n) && n <= 255)) {
      return { r: parts[0], g: parts[1], b: parts[2], a: 255 };
    }
    if (parts.length === 4 && parts.every(n => !isNaN(n) && n <= 255)) {
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] };
    }
    return { r: 0, g: 0, b: 0, a: 255 };
  }

  // h ∈ [0,1), s,v ∈ [0,1] → {r,g,b} 0-255
  function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  // {r,g,b} 0-255 → {h deg, s %, v %} (rounded to int)
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
        case g: h = ((b - r) / d + 2); break;
        default: h = ((r - g) / d + 4); break;
      }
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), v: Math.round(v * 100) };
  }

  // Used only by parseColor() to interpret the hsl(...) literal
  function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  // ── sRGB ↔ CIELab (D50) ──
  // Standard sRGB → Lab: gamma-decode sRGB → linear RGB → XYZ (D50 adapted) → Lab.
  function rgbToLab(r, g, b) {
    const dec = c => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
    let rl = dec(r), gl = dec(g), bl = dec(b);
    // sRGB (D65) → XYZ (D50) via the standard Bradford-adapted matrix.
    const x = (rl * 0.4360747 + gl * 0.3850649 + bl * 0.1430804) / 0.96422;
    const y = (rl * 0.2225045 + gl * 0.7168786 + bl * 0.0606169) / 1.0;
    const z = (rl * 0.0139322 + gl * 0.0971045 + bl * 0.7141733) / 0.82521;
    const f = t => t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116;
    const fx = f(x), fy = f(y), fz = f(z);
    return {
      l: Math.round(116 * fy - 16),
      a: Math.round((fx - fy) * 500),
      b: Math.round((fy - fz) * 200),
    };
  }
  function labToRgb(l, a, b) {
    const fy = (l + 16) / 116;
    const fx = a / 500 + fy;
    const fz = fy - b / 200;
    const inv = f => {
      const f3 = f * f * f;
      return f3 > 0.008856 ? f3 : (116 * f - 16) / 903.3;
    };
    const x = inv(fx) * 0.96422, y = inv(fy) * 1.0, z = inv(fz) * 0.82521;
    // XYZ (D50) → linear sRGB (D65) via the inverse adapted matrix.
    const rl = x * 3.1338561 + y * -1.6168667 + z * -0.4906146;
    const gl = x * -0.9787684 + y * 1.9161415 + z * 0.0334540;
    const bl = x * 0.0719453 + y * -0.2289914 + z * 1.4056023;
    const enc = c => {
      c = Math.max(0, Math.min(1, c));
      return c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
    };
    return { r: Math.round(enc(rl) * 255), g: Math.round(enc(gl) * 255), b: Math.round(enc(bl) * 255) };
  }

  function formatOutput(c, type) {
    return type === 'rgba'
      ? `${c.r},${c.g},${c.b},${c.a}`
      : `${c.r},${c.g},${c.b}`;
  }

  function colorToHex(c) {
    const hex = (n) => n.toString(16).padStart(2, '0');
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}${c.a < 255 ? hex(c.a) : ''}`;
  }

  const PRESETS = [
    '#ffffff','#cccccc','#999999','#666666','#333333','#000000',
    '#ff9999','#ff5050','#e60000','#990000',
    '#ffcc99','#ffaa33','#e67300','#994c00',
    '#ffff99','#ffff33','#e6e600','#999900',
    '#ccff99','#99ee55','#33cc11','#559900',
    '#99ffee','#33ffcc','#00cc99','#00664d',
    '#99ddff','#33aaff','#0066ff','#003399',
    '#cc99ff','#9933ff','#6611cc','#440088',
    '#ffb3d9','#ff66b3','#e6008a','#990052',
  ];

  // User-saved colors persisted to localStorage (survive restarts).
  const USER_COLORS_KEY = 'osu-skin-configurator/user-colors';
  function getUserColors() {
    try { return JSON.parse(localStorage.getItem(USER_COLORS_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function saveUserColors(arr) {
    try { localStorage.setItem(USER_COLORS_KEY, JSON.stringify(arr)); } catch (_) {}
  }
  // Tooltip text (i18n if available, else Chinese fallback). Resolved lazily at
  // render time so it follows the active language (the IIFE may load before i18n).
  const T = (k, fb) => (typeof window !== 'undefined' && window.i18n && window.i18n.t ? (window.i18n.t(k, {}) || fb) : fb);
  const T_ADD = () => T('colorPicker.addColor', '将当前颜色加入预设');
  const T_DEL = () => T('colorPicker.deleteColor', '右键删除该颜色');

  function attach(triggerEl, opts) {
    const type = opts.type || 'rgb';
    let current = parseColor(opts.value);
    if (type === 'rgb') current.a = 255;

    // Toggle: if this same trigger's popover is already open, just close it
    // (don't reopen). A different trigger closes the old one and opens new.
    if (document.querySelector('.cp-popover')) {
      const sameTrigger = activeTrigger === triggerEl;
      closeAll();
      if (sameTrigger) return;
    }

    function closePopover() {
      // Move focus to body BEFORE removing the popover, so the browser doesn't
      // restore focus to the trigger element.
      if (document.body) document.body.focus();
      popover.remove();
      activeTrigger = null;
      activeForward = null;
      _activeClose = null;
      if (onMove) { document.removeEventListener('mousemove', onMove); }
      if (onUp) { document.removeEventListener('mouseup', onUp); }
      if (unlistenWin) { try { unlistenWin(); } catch (_) {} unlistenWin = null; }
      window.removeEventListener('resize', reposition);
      document.removeEventListener('keydown', onKeydown, true);
      if (opts.onClose) opts.onClose();
    }
    _activeClose = closePopover; // register for module-level closeAll()

    const popover = document.createElement('div');
    popover.className = 'cp-popover';
    popover.tabIndex = -1; // focusable so key events land here (1/2/3 mode switch)
    popover.innerHTML = `
      <div class="cp-palette-wrap">
        <canvas class="cp-palette" width="120" height="120"></canvas>
        <div class="cp-palette-cursor" style="position:absolute;width:8px;height:8px;border:2px solid #fff;border-radius:50%;pointer-events:none;box-shadow:0 0 2px rgba(0,0,0,.5);transform:translate(-50%,-50%)"></div>
      </div>
      <div class="cp-input-row">
        <div class="cp-mode-tags">
          <button type="button" class="cp-mode-tag is-active" data-mode="hsv">HSV</button>
          <button type="button" class="cp-mode-tag" data-mode="rgb">RGB</button>
          <button type="button" class="cp-mode-tag" data-mode="lab">Lab</button>
          <input type="text" class="form-input cp-hex-input" autocomplete="off" spellcheck="false">
        </div>
        <div class="cp-comp-sliders"></div>
      </div>
      <div class="cp-presets">
        ${PRESETS.map(hex => `<span class="cp-preset-swatch" style="background:${hex}" data-hex="${hex}"></span>`).join('')}
        ${getUserColors().map(hex => `<span class="cp-preset-swatch cp-preset-swatch--user" style="background:${hex}" data-hex="${hex}" title="${T_DEL()}"></span>`).join('')}
        <button type="button" class="cp-add-color" title="${T_ADD()}"></button>
      </div>
    `;

    document.body.appendChild(popover);

    // Elements
    const paletteCanvas = popover.querySelector('.cp-palette');
    const paletteCtx = paletteCanvas.getContext('2d');
    const paletteCursor = popover.querySelector('.cp-palette-cursor');
    const compSliders = popover.querySelector('.cp-comp-sliders');
    const hexInput = popover.querySelector('.cp-hex-input');
    const modeTags = popover.querySelectorAll('.cp-mode-tag');
    // Active color-entry mode: 'hsv' | 'rgb' | 'lab' | 'hex'.
    let mode = 'hsv';
    // Which channel is active (selected) within the current mode — drives the
    // palette's two axes (the other two channels) and label highlight.
    let activeChannel = 0;
    // Per-mode component caches: store the last HSV/Lab representation so editing
    // ONE channel doesn't round-trip through RGB and drift the other two (e.g.
    // changing S must not perturb H/V). Refreshed whenever current changes via a
    // non-slider path (palette drag, hex input, mode switch, external input).
    let hsvCache = rgbToHsv(current.r, current.g, current.b);
    let labCache = rgbToLab(current.r, current.g, current.b);
    function refreshCaches() {
      hsvCache = rgbToHsv(current.r, current.g, current.b);
      labCache = rgbToLab(current.r, current.g, current.b);
    }

    let draggingPalette = false;

    const hsv = rgbToHsv(current.r, current.g, current.b);

    // Sync point: every external mutation (palette drag, hex input, preset
    // click, applyValue) calls this to refresh the per-mode caches. Slider edits
    // bypass it (they set the cache directly so editing one channel doesn't
    // round-trip-drift the others).
    function refreshHueFromCurrent() {
      refreshCaches();
    }

    // Draw the palette as a 2-axis gradient: X = one channel (left=min→right=max),
    // Y = another (top=max→bottom=min). Each pixel's color is computed by setting
    // those two channels to the pixel's coordinates (the active channel keeps its
    // current value) and converting back to RGB. Done via ImageData for speed.
    function drawPalette() {
      const w = paletteCanvas.width;
      const h = paletteCanvas.height;
      const axes = paletteAxes();
      const xCh = axes.x, yCh = axes.y;
      const img = paletteCtx.createImageData(w, h);
      const data = img.data;
      const xRange = xCh.max - xCh.min;
      const yRange = yCh.max - yCh.min;
      for (let py = 0; py < h; py++) {
        const yVal = yCh.max - (py / (h - 1)) * yRange;
        for (let px = 0; px < w; px++) {
          const xVal = xCh.min + (px / (w - 1)) * xRange;
          const c = axes.at(xVal, yVal);
          const idx = (py * w + px) * 4;
          data[idx] = c.r; data[idx + 1] = c.g; data[idx + 2] = c.b; data[idx + 3] = 255;
        }
      }
      paletteCtx.putImageData(img, 0, 0);
    }

    // Position the cursor at the current color's (x,y) channel values.
    function updatePaletteCursor() {
      const w = paletteCanvas.clientWidth;
      const h = paletteCanvas.clientHeight;
      const { x: xCh, y: yCh } = paletteAxes();
      const xPct = (xCh.get() - xCh.min) / (xCh.max - xCh.min);
      const yPct = (yCh.get() - yCh.min) / (yCh.max - yCh.min);
      paletteCursor.style.left = (xPct * w) + 'px';
      paletteCursor.style.top = ((1 - yPct) * h) + 'px';
    }

    function updateAllUI(silent) {
      drawPalette();
      updatePaletteCursor();
      renderCompSliders();
      syncHexInput();
      // Update trigger swatch
      triggerEl.style.background = type === 'rgba'
        ? `rgba(${current.r},${current.g},${current.b},${current.a/255})`
        : `rgb(${current.r},${current.g},${current.b})`;
      // silent = forwarded from an external input that already owns iniEdits → skip onChange echo
      if (!silent && opts.onChange) opts.onChange(formatOutput(current, type));
    }

    // ── Component sliders (R/G/B or H/S/V or H/S/L, + A for rgba) ──
    // Each mode defines 3 channels: { key, label, max, get(rgb)->value,
    // set(rgb, value)->rgb, gradient(rgb)->css }.
    function channelsFor(m) {
      if (m === 'hsv') {
        const toHsv = () => rgbToHsv(current.r, current.g, current.b);
        const fromHsv = (h, s, v) => { const o = hsvToRgb(h / 360, s / 100, v / 100); return { r: o.r, g: o.g, b: o.b }; };
        return [
          { key: 'h', label: 'H', max: 360, get: () => hsvCache.h, set: v => { hsvCache = { h: v, s: hsvCache.s, v: hsvCache.v }; return fromHsv(v, hsvCache.s, hsvCache.v); },
            grad: () => 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' },
          { key: 's', label: 'S', max: 100, get: () => hsvCache.s, set: v => { hsvCache = { h: hsvCache.h, s: v, v: hsvCache.v }; return fromHsv(hsvCache.h, v, hsvCache.v); },
            grad: () => { const a = hsvToRgb(hsvCache.h / 360, 0, hsvCache.v / 100), b = hsvToRgb(hsvCache.h / 360, 1, hsvCache.v / 100); return `linear-gradient(to right, rgb(${a.r},${a.g},${a.b}), rgb(${b.r},${b.g},${b.b}))`; } },
          { key: 'v', label: 'V', max: 100, get: () => hsvCache.v, set: v => { hsvCache = { h: hsvCache.h, s: hsvCache.s, v }; return fromHsv(hsvCache.h, hsvCache.s, v); },
            grad: () => { const a = hsvToRgb(hsvCache.h / 360, hsvCache.s / 100, 0), b = hsvToRgb(hsvCache.h / 360, hsvCache.s / 100, 1); return `linear-gradient(to right, rgb(${a.r},${a.g},${a.b}), rgb(${b.r},${b.g},${b.b}))`; } },
        ];
      }
      if (m === 'lab') {
        const fromLab = (l, a, b) => labToRgb(l, a, b);
        return [
          { key: 'l', label: 'L', min: 0, max: 100, get: () => labCache.l, set: v => { labCache = { l: v, a: labCache.a, b: labCache.b }; return fromLab(v, labCache.a, labCache.b); },
            grad: () => { const lo = fromLab(0, labCache.a, labCache.b), hi = fromLab(100, labCache.a, labCache.b); return `linear-gradient(to right, rgb(${lo.r},${lo.g},${lo.b}), rgb(${hi.r},${hi.g},${hi.b}))`; } },
          { key: 'a', label: 'a', min: -128, max: 127, get: () => labCache.a, set: v => { labCache = { l: labCache.l, a: v, b: labCache.b }; return fromLab(labCache.l, v, labCache.b); },
            grad: () => { const lo = fromLab(labCache.l, -128, labCache.b), hi = fromLab(labCache.l, 127, labCache.b); return `linear-gradient(to right, rgb(${lo.r},${lo.g},${lo.b}), rgb(${hi.r},${hi.g},${hi.b}))`; } },
          { key: 'b', label: 'b', min: -128, max: 127, get: () => labCache.b, set: v => { labCache = { l: labCache.l, a: labCache.a, b: v }; return fromLab(labCache.l, labCache.a, v); },
            grad: () => { const lo = fromLab(labCache.l, labCache.a, -128), hi = fromLab(labCache.l, labCache.a, 127); return `linear-gradient(to right, rgb(${lo.r},${lo.g},${lo.b}), rgb(${hi.r},${hi.g},${hi.b}))`; } },
        ];
      }
      // rgb
      return [
        { key: 'r', label: 'R', min: 0, max: 255, get: () => current.r, set: v => ({ r: v, g: current.g, b: current.b }),
          grad: () => `linear-gradient(to right, rgb(0,${current.g},${current.b}), rgb(255,${current.g},${current.b}))` },
        { key: 'g', label: 'G', min: 0, max: 255, get: () => current.g, set: v => ({ r: current.r, g: v, b: current.b }),
          grad: () => `linear-gradient(to right, rgb(${current.r},0,${current.b}), rgb(${current.r},255,${current.b}))` },
        { key: 'b', label: 'B', min: 0, max: 255, get: () => current.b, set: v => ({ r: current.r, g: current.g, b: v }),
          grad: () => `linear-gradient(to right, rgb(${current.r},${current.g},0), rgb(${current.r},${current.g},255))` },
      ];
    }

    // The two palette axes when `activeChannel` is selected in the current mode,
    // plus `at(xVal, yVal)` that returns the RGB for a given (x,y) WITHOUT
    // touching current (the active channel keeps its current value). This keeps
    // pixel drawing correct (no current pollution between axes) and fast (one
    // conversion per pixel instead of nested sets each re-deriving HSV/Lab).
    function paletteAxes() {
      const ch = channelsFor(mode);
      const cur = { r: current.r, g: current.g, b: current.b };
      const hsv = hsvCache;
      const lab = labCache;
      // helpers scoped to the mode + active channel
      if (mode === 'hsv') {
        const h = hsv.h, s = hsv.s, v = hsv.v;
        if (activeChannel === 0) return { x: { min: 0, max: 100, get: () => s }, y: { min: 0, max: 100, get: () => v }, at: (xv, yv) => hsvToRgb(h / 360, xv / 100, yv / 100) };
        if (activeChannel === 1) return { x: { min: 0, max: 360, get: () => h }, y: { min: 0, max: 100, get: () => v }, at: (xv, yv) => hsvToRgb(xv / 360, s / 100, yv / 100) };
        return { x: { min: 0, max: 360, get: () => h }, y: { min: 0, max: 100, get: () => s }, at: (xv, yv) => hsvToRgb(xv / 360, yv / 100, v / 100) };
      }
      if (mode === 'lab') {
        const L = lab.l, A = lab.a, B = lab.b;
        if (activeChannel === 0) return { x: { min: -128, max: 127, get: () => A }, y: { min: -128, max: 127, get: () => B }, at: (xv, yv) => labToRgb(L, xv, yv) };
        if (activeChannel === 1) return { x: { min: 0, max: 100, get: () => L }, y: { min: -128, max: 127, get: () => B }, at: (xv, yv) => labToRgb(xv, A, yv) };
        return { x: { min: 0, max: 100, get: () => L }, y: { min: -128, max: 127, get: () => A }, at: (xv, yv) => labToRgb(xv, yv, B) };
      }
      // rgb (default)
      if (activeChannel === 0) return { x: { min: 0, max: 255, get: () => cur.g }, y: { min: 0, max: 255, get: () => cur.b }, at: (xv, yv) => ({ r: cur.r, g: xv, b: yv }) };
      if (activeChannel === 1) return { x: { min: 0, max: 255, get: () => cur.r }, y: { min: 0, max: 255, get: () => cur.b }, at: (xv, yv) => ({ r: xv, g: cur.g, b: yv }) };
      return { x: { min: 0, max: 255, get: () => cur.r }, y: { min: 0, max: 255, get: () => cur.g }, at: (xv, yv) => ({ r: xv, g: yv, b: cur.b }) };
    }

    // Build/refresh the component slider rows. Called on every current/mode change.
    function renderCompSliders() {
      const channels = channelsFor(mode);
      const rows = type === 'rgba' ? [...channels, {
        key: 'a', label: 'A', max: 255, get: () => current.a, set: v => ({ r: current.r, g: current.g, b: current.b, a: v }),
        grad: () => `linear-gradient(to right, rgba(${current.r},${current.g},${current.b},0), rgba(${current.r},${current.g},${current.b},1))`,
      }] : channels;
      // Rebuild DOM only when the channel set changes (mode switch); otherwise
      // just update positions/gradients/values in place (keeps focus).
      const existing = compSliders.querySelectorAll('.cp-comp-row');
      const needRebuild = existing.length !== rows.length || [...existing].some((el, i) => el.dataset.ch !== rows[i].key);
      if (needRebuild) {
        compSliders.innerHTML = rows.map((ch, i) => `
          <div class="cp-comp-row" data-ch="${ch.key}" data-idx="${i}">
            <span class="cp-comp-label" data-idx="${i}">${ch.label}</span>
            <div class="cp-comp-track" data-idx="${i}"><div class="cp-comp-thumb"></div></div>
            <input type="number" class="form-input cp-num-input" min="${ch.min != null ? ch.min : 0}" max="${ch.max}" step="1" data-ch="${ch.key}" data-idx="${i}">
          </div>`).join('');
        rows.forEach(ch => bindCompSlider(ch));
        // Click label / focus input / mousedown track selects that channel
        // (drives the palette's two axes + label highlight).
        compSliders.querySelectorAll('[data-idx]').forEach(el => {
          const ev = el.tagName === 'INPUT' ? 'focus' : 'mousedown';
          el.addEventListener(ev, () => selectChannel(parseInt(el.dataset.idx, 10)));
        });
      }
      // Update positions, gradients, number values, highlight.
      rows.forEach((ch, i) => {
        const row = compSliders.querySelector(`.cp-comp-row[data-ch="${ch.key}"]`);
        if (!row) return;
        const lo = ch.min != null ? ch.min : 0;
        const v = Math.max(lo, Math.min(ch.max, ch.get()));
        const pct = (v - lo) / (ch.max - lo);
        // Thumb edges hug the track's inner walls (box-sizing: border-box;
        // thumb is 10px wide, no border).
        row.querySelector('.cp-comp-thumb').style.left = `calc(${pct} * (100% - 10px))`;
        row.querySelector('.cp-comp-thumb').style.transform = 'translateY(-50%)';
        // Thumb fill = the current color, so each slider shows what its value
        // resolves to; a light ring separates it from same-colored track stops.
        const curCss = type === 'rgba'
          ? `rgba(${current.r},${current.g},${current.b},${current.a/255})`
          : `rgb(${current.r},${current.g},${current.b})`;
        row.querySelector('.cp-comp-thumb').style.background = curCss;
        row.querySelector('.cp-comp-track').style.background = ch.grad();
        const inp = row.querySelector('.cp-num-input');
        if (inp !== document.activeElement) inp.value = Math.round(v);
        // Highlight the active channel's label (the one whose axes drive palette).
        const isActive = i === activeChannel && i < channelsFor(mode).length;
        row.querySelector('.cp-comp-label').classList.toggle('is-active', isActive);
      });
    }

    // Selecting a channel (via label/track/input focus) re-points the palette's
    // two axes at the other two channels and highlights the label.
    function selectChannel(idx) {
      // Alpha is not a palette channel — never select it.
      if (idx >= channelsFor(mode).length) return;
      if (idx === activeChannel) return;
      activeChannel = idx;
      drawPalette();
      updatePaletteCursor();
      // Refresh label highlight only (cheap; avoids full slider rebuild).
      compSliders.querySelectorAll('.cp-comp-label').forEach((el, i) => {
        el.classList.toggle('is-active', i === activeChannel);
      });
    }

    function bindCompSlider(ch) {
      const row = compSliders.querySelector(`.cp-comp-row[data-ch="${ch.key}"]`);
      if (!row) return;
      const track = row.querySelector('.cp-comp-track');
      const thumb = row.querySelector('.cp-comp-thumb');
      const inp = row.querySelector('.cp-num-input');
      function commit(rawVal) {
        let v = Math.round(Number(rawVal));
        if (isNaN(v)) return;
        const lo = ch.min != null ? ch.min : 0;
        v = Math.max(lo, Math.min(ch.max, v));
        const next = ch.set(v);
        current.r = next.r; current.g = next.g; current.b = next.b;
        if (type === 'rgba' && next.a !== undefined) current.a = next.a;
        // Don't refreshHueFromCurrent here: the slider's set already updated the
        // HSV/Lab cache, and re-deriving from current would round-trip-drift the
        // other channels.
        updateAllUI();
      }
      function fromX(clientX) {
        const r = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        const lo = ch.min != null ? ch.min : 0;
        return lo + pct * (ch.max - lo);
      }
      // Register move/up on mousedown and clean up on mouseup — registering
      // once at bind time would leave them removed after the first drag.
      track.addEventListener('mousedown', e => {
        // Blur any focused input so its value commits + the next Enter closes.
        const ae = document.activeElement;
        if (ae && ae.tagName === 'INPUT' && ae !== inp) ae.blur();
        const onMove = ev => commit(fromX(ev.clientX));
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        commit(fromX(e.clientX));
        e.preventDefault();
      });
      inp.addEventListener('input', () => commit(inp.value));
      // WebView2's number-input wheel changes the value WITHOUT firing 'input'.
      // Treat hover-wheel as selecting this channel (palette axes follow) +
      // focusing the input + syncing the value.
      inp.addEventListener('wheel', () => {
        const idx = parseInt(row.dataset.idx, 10);
        if (idx < channelsFor(mode).length) selectChannel(idx);
        inp.focus();
        setTimeout(() => commit(inp.value), 0);
      });
    }

    // Mode tags: click one to switch mode (RGB / HSB / Lab / HEX).
    function setActiveMode(m) {
      mode = m;
      activeChannel = 0;
      modeTags.forEach(t => t.classList.toggle('is-active', t.dataset.mode === m));
      drawPalette();
      updatePaletteCursor();
      renderCompSliders();
    }
    modeTags.forEach(t => t.addEventListener('click', () => setActiveMode(t.dataset.mode)));

    // HEX input: parse #RRGGBB / #RRGGBBAA; echo current as hex when not focused.
    function syncHexInput() {
      if (hexInput === document.activeElement) return;
      hexInput.value = colorToHex(current);
    }
    hexInput.addEventListener('input', () => {
      const c = parseColor(hexInput.value.trim());
      current.r = c.r; current.g = c.g; current.b = c.b;
      if (type === 'rgba' && c.a !== undefined) current.a = c.a;
      refreshHueFromCurrent();
      updateAllUI(true);
      if (opts.onChange) opts.onChange(formatOutput(current, type));
    });

    function setFromPalette(x, y, rect) {
      const w = rect.width;
      const h = rect.height;
      const axes = paletteAxes();
      const xCh = axes.x, yCh = axes.y;
      // X: left=min→right=max; Y: top=max→bottom=min.
      const xVal = xCh.min + Math.max(0, Math.min(1, x / w)) * (xCh.max - xCh.min);
      const yVal = yCh.max - Math.max(0, Math.min(1, y / h)) * (yCh.max - yCh.min);
      // Compute the resulting RGB directly (active channel keeps current value).
      const c = axes.at(xVal, yVal);
      current.r = Math.round(c.r); current.g = Math.round(c.g); current.b = Math.round(c.b);
      refreshCaches();
      drawPalette();
      updatePaletteCursor();
      renderCompSliders();
      syncHexInput();
      triggerEl.style.background = type === 'rgba'
        ? `rgba(${current.r},${current.g},${current.b},${current.a/255})`
        : `rgb(${current.r},${current.g},${current.b})`;
      if (opts.onChange) opts.onChange(formatOutput(current, type));
    }

    // Initial draw
    drawPalette();
    updatePaletteCursor();
    renderCompSliders();
    syncHexInput();
    // Position after content has rendered so offsetHeight is accurate (the
    // initial reposition() that ran before append measured an empty popover).
    reposition();
    // Focus the popover itself (not an input) so 1/2/3 switch modes directly,
    // and the trigger loses focus (no lingering highlight).
    popover.focus();

    // Palette events
    paletteCanvas.addEventListener('mousedown', (e) => {
      draggingPalette = true;
      const rect = paletteCanvas.getBoundingClientRect();
      setFromPalette(e.clientX - rect.left, e.clientY - rect.top, rect);
    });

    // Global mouse move/up. Stored so closePopover can remove them (otherwise
    // every open leaks two document-level listeners + their closure).
    const onMove = (e) => {
      if (draggingPalette) {
        const rect = paletteCanvas.getBoundingClientRect();
        setFromPalette(
          Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
          Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
          rect
        );
      }
    };
    const onUp = () => {
      draggingPalette = false;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    // Preset swatches
    popover.querySelectorAll('.cp-preset-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        const c = parseColor(sw.dataset.hex);
        current.r = c.r; current.g = c.g; current.b = c.b;
        if (type === 'rgb') current.a = 255;
        refreshHueFromCurrent();
        updateAllUI();
      });
    });
    // Right-click a USER swatch to remove it from the saved set.
    popover.querySelectorAll('.cp-preset-swatch--user').forEach(sw => {
      sw.addEventListener('contextmenu', e => {
        e.preventDefault();
        const hex = sw.dataset.hex;
        saveUserColors(getUserColors().filter(c => c !== hex));
        sw.remove();
      });
    });
    // "+" button: save the current color as a user preset.
    const addBtn = popover.querySelector('.cp-add-color');
    if (addBtn) addBtn.addEventListener('click', () => {
      const hex = colorToHex(current);
      const arr = getUserColors();
      if (!arr.includes(hex)) {
        arr.push(hex);
        saveUserColors(arr);
        // Re-render the swatches region (cheap: rebuild innerHTML + rebind).
        renderPresets();
      }
    });
    function renderPresets() {
      const box = popover.querySelector('.cp-presets');
      if (!box) return;
      box.innerHTML =
        PRESETS.map(hex => `<span class="cp-preset-swatch" style="background:${hex}" data-hex="${hex}"></span>`).join('') +
        getUserColors().map(hex => `<span class="cp-preset-swatch cp-preset-swatch--user" style="background:${hex}" data-hex="${hex}" title="${T_DEL()}"></span>`).join('') +
        `<button type="button" class="cp-add-color" title="${T_ADD()}"></button>`;
      // Rebind click + contextmenu on the fresh nodes.
      box.querySelectorAll('.cp-preset-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          const c = parseColor(sw.dataset.hex);
          current.r = c.r; current.g = c.g; current.b = c.b;
          if (type === 'rgb') current.a = 255;
          refreshHueFromCurrent();
          updateAllUI();
        });
      });
      box.querySelectorAll('.cp-preset-swatch--user').forEach(sw => {
        sw.addEventListener('contextmenu', e => {
          e.preventDefault();
          saveUserColors(getUserColors().filter(c => c !== sw.dataset.hex));
          sw.remove();
        });
      });
      const nb = box.querySelector('.cp-add-color');
      if (nb) nb.addEventListener('click', () => {
        const hex = colorToHex(current);
        const a = getUserColors();
        if (!a.includes(hex)) { a.push(hex); saveUserColors(a); renderPresets(); }
      });
    }

    // Text input
    let lastValid = formatOutput(current, type);
    // Shared helper: is `value` an incomplete token that parseColor would misread as black?
    function isIncompleteBlack(value) {
      const raw = (value || '').trim();
      if (!raw) return false;
      const parsed = parseColor(raw);
      if (!(parsed.r === 0 && parsed.g === 0 && parsed.b === 0)) return false;
      const isBlackLiteral = /^(0,0,0(,0)?|#0{3,8}|black|rgba?\(\s*0\s*,\s*0\s*,\s*0\b|hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*0%\b)/i.test(raw);
      return !isBlackLiteral;
    }
    function applyValue(value, silent) {
      const parsed = parseColor(value);
      current.r = parsed.r; current.g = parsed.g; current.b = parsed.b;
      if (type === 'rgb') current.a = 255; else current.a = parsed.a;
      refreshHueFromCurrent();
      lastValid = formatOutput(current, type);
      updateAllUI(silent);
    }
    // Register this popover as active so an external input (INI row's color box) can
    // forward typed values into it. silent=true skips onChange (the caller owns iniEdits).
    activeTrigger = triggerEl;
    activeForward = function (value) {
      if (isIncompleteBlack(value)) return; // incomplete typing — leave picker alone
      applyValue(value, true);
    };
    // The popover is a self-contained unit: intercept keydown at the document
    // level (capture) so it works regardless of where focus is (popover, trigger,
    // or body). Without this, keys pressed while focus is outside the popover
    // would reach the global shortcut handler and switch tabs/mode under the
    // open picker.
    const onKeydown = (e) => {
      // Ctrl+E (toggle-mode) closes the picker and passes through so the mode
      // can switch. Other Ctrl combos (Ctrl+S save, Ctrl+A/C/V in the hex box)
      // pass through WITHOUT closing — they're valid within the picker.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'e') {
        closeAll();
        return;
      }
      // Let all other Ctrl/Cmd shortcuts pass through untouched.
      if (e.ctrlKey || e.metaKey) return;
      // Let only Enter/Escape close; stop everything else from leaking out.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePopover();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        // First Enter commits the focused input (blur → input/change fires,
        // syncing the value); a second Enter (no input focused) closes the popover.
        const ae = document.activeElement;
        if (ae && ae.tagName === 'INPUT' && popover.contains(ae)) {
          ae.blur();
        } else {
          closePopover();
        }
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        // 1/2/3 switch entry mode (HSV / RGB / Lab — the tag order). Only when
        // no text input is focused, so typing digits in the hex/number boxes works.
        const ae = document.activeElement;
        const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
        if (!typing) {
          e.preventDefault();
          e.stopPropagation();
          const modes = ['hsv', 'rgb', 'lab'];
          setActiveMode(modes[parseInt(e.key, 10) - 1]);
        }
      } else {
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKeydown, true);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('mousedown', function onOutside(e) {
        if (!popover.contains(e.target) && e.target !== triggerEl) {
          closePopover();
          document.removeEventListener('mousedown', onOutside);
        }
      });
    }, 0);

    // Re-anchor the popover when the OS window moves/resizes — keep it glued to
    // its trigger instead of drifting away (or closing, which interrupted edits).
    let unlistenWin = null;
    try {
      const T = window.__TAURI__;
      if (T && T.window) {
        const win = T.window.getCurrentWindow();
        let done = 0;
        const finish = () => { if (done++) return; reposition(); };
        Promise.all([win.onMoved(finish), win.onResized(finish)]).then(fns => {
          unlistenWin = () => { fns.forEach(f => { try { f(); } catch (_) {} }); };
        });
      }
    } catch (_) { /* Tauri unavailable — ignore */ }
    // Fallback: webview-level resize (covers window resize even if the Tauri
    // window events above don't fire in this build).
    window.addEventListener('resize', reposition);
    function reposition() {
      if (!popover.parentNode) return;
      const r = triggerEl.getBoundingClientRect();
      const pw = popover.offsetWidth, ph = popover.offsetHeight;
      // Right edge flush with the trigger's left edge; top aligned with the
      // trigger. Only clamp the bottom (shift up if it would overflow).
      const left = r.left - pw - 6;
      let top = r.top;
      if (top + ph > window.innerHeight - 20) top = window.innerHeight - ph - 20;
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
    }
  }

  // Currently-open popover, keyed by its trigger element. forwardInput lets an
  // external input box (e.g. the INI row's color value box) push a value into the
  // open picker without re-firing onChange (avoids an echo loop back into that box).
  let activeTrigger = null;
  let activeForward = null;
  let _activeClose = null; // bound closePopover of the currently-open popover

  function forwardInput(trigger, value) {
    if (trigger && trigger === activeTrigger && typeof activeForward === 'function') {
      activeForward(value);
    }
  }

  window.ColorPicker = { attach, forwardInput, parseColor, formatOutput, closeAll };
  // Close any open popover (called by the global ESC/Enter handler).
  function closeAll() {
    if (typeof _activeClose === 'function') _activeClose();
  }
})();
