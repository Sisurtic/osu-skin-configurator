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

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
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
    '#ff6666','#ff0000','#cc0000','#990000',
    '#ffb366','#ff8800','#cc6600','#ffcc66','#ffaa00',
    '#ffff66','#ffff00','#cccc00','#aacc00',
    '#66ff66','#00ff00','#00cc00','#009900',
    '#66ffff','#00ffff','#00cccc','#009999',
    '#66b3ff','#0088ff','#0000ff','#0000cc',
    '#cc66ff','#9900ff','#6600cc','#cc66cc',
    '#ff99cc','#ff66aa','#ff3388','#cc0066',
  ];

  function attach(triggerEl, opts) {
    const type = opts.type || 'rgb';
    let current = parseColor(opts.value);
    if (type === 'rgb') current.a = 255;

    // Create popover if not already open
    if (document.querySelector('.cp-popover')) {
      document.querySelector('.cp-popover').remove();
    }

    const popover = document.createElement('div');
    popover.className = 'cp-popover';
    popover.innerHTML = `
      <div class="cp-palette-wrap">
        <canvas class="cp-palette" width="200" height="150"></canvas>
        <div class="cp-palette-cursor" style="position:absolute;width:8px;height:8px;border:2px solid #fff;border-radius:50%;pointer-events:none;box-shadow:0 0 2px rgba(0,0,0,.5);transform:translate(-50%,-50%)"></div>
      </div>
      <div class="cp-sliders">
        <div class="cp-slider-row">
          <span class="cp-slider-label">H</span>
          <div class="cp-slider-track cp-hue-track">
            <div class="cp-slider-thumb" style="position:absolute;width:12px;height:12px;border:2px solid #fff;border-radius:50%;top:-3px;box-shadow:0 0 2px rgba(0,0,0,.5);transform:translateX(-50%)"></div>
          </div>
        </div>
        ${type === 'rgba' ? `
        <div class="cp-slider-row">
          <span class="cp-slider-label">A</span>
          <div class="cp-slider-track cp-alpha-track">
            <div class="cp-slider-thumb" style="position:absolute;width:12px;height:12px;border:2px solid #fff;border-radius:50%;top:-3px;box-shadow:0 0 2px rgba(0,0,0,.5);transform:translateX(-50%)"></div>
          </div>
        </div>` : ''}
      </div>
      <div class="cp-presets">
        ${PRESETS.map(hex => `<span class="cp-preset-swatch" style="background:${hex}" data-hex="${hex}"></span>`).join('')}
      </div>
      <div class="cp-input-row">
        <input type="text" class="form-input cp-text-input" value="${formatOutput(current, type)}" style="flex:1;min-width:0;font-size:12px">
      </div>
    `;

    document.body.appendChild(popover);

    // Position popover
    const triggerRect = triggerEl.getBoundingClientRect();
    const popWidth = 220;
    let left = triggerRect.left;
    let top = triggerRect.bottom + 4;
    if (left + popWidth > window.innerWidth - 8) left = window.innerWidth - popWidth - 8;
    if (top + 380 > window.innerHeight) top = triggerRect.top - 380 - 4;
    popover.style.left = Math.max(4, left) + 'px';
    popover.style.top = Math.max(4, top) + 'px';

    // Elements
    const paletteCanvas = popover.querySelector('.cp-palette');
    const paletteCtx = paletteCanvas.getContext('2d');
    const paletteCursor = popover.querySelector('.cp-palette-cursor');
    const hueTrack = popover.querySelector('.cp-hue-track');
    const hueThumb = hueTrack.querySelector('.cp-slider-thumb');
    const textInput = popover.querySelector('.cp-text-input');

    let alphaTrack, alphaThumb;
    if (type === 'rgba') {
      alphaTrack = popover.querySelector('.cp-alpha-track');
      alphaThumb = alphaTrack.querySelector('.cp-slider-thumb');
    }

    let draggingPalette = false;
    let draggingHue = false;
    let draggingAlpha = false;

    const hsl = rgbToHsl(current.r, current.g, current.b);

    function drawPalette(hue) {
      const w = paletteCanvas.width;
      const h = paletteCanvas.height;
      // Fill with hue
      paletteCtx.fillStyle = `hsl(${hue}, 100%, 50%)`;
      paletteCtx.fillRect(0, 0, w, h);
      // White gradient (left to right)
      const gradW = paletteCtx.createLinearGradient(0, 0, w, 0);
      gradW.addColorStop(0, 'rgba(255,255,255,1)');
      gradW.addColorStop(1, 'rgba(255,255,255,0)');
      paletteCtx.fillStyle = gradW;
      paletteCtx.fillRect(0, 0, w, h);
      // Black gradient (top to bottom)
      const gradB = paletteCtx.createLinearGradient(0, 0, 0, h);
      gradB.addColorStop(0, 'rgba(0,0,0,0)');
      gradB.addColorStop(1, 'rgba(0,0,0,1)');
      paletteCtx.fillStyle = gradB;
      paletteCtx.fillRect(0, 0, w, h);
    }

    function updatePaletteCursor(sat, lit) {
      const x = (sat / 100) * paletteCanvas.width;
      const y = ((100 - lit) / 100) * paletteCanvas.height;
      paletteCursor.style.left = x + 'px';
      paletteCursor.style.top = y + 'px';
    }

    function updateHueThumb(h) {
      const pct = h / 360;
      const trackW = hueTrack.clientWidth;
      hueThumb.style.left = (pct * trackW) + 'px';
    }

    function updateAlphaThumb(a) {
      if (!alphaTrack) return;
      const pct = a / 255;
      alphaThumb.style.left = (pct * alphaTrack.clientWidth) + 'px';
    }

    function updateAllUI() {
      const hsl2 = rgbToHsl(current.r, current.g, current.b);
      drawPalette(hsl2.h);
      updatePaletteCursor(hsl2.s, hsl2.l);
      updateHueThumb(hsl2.h);
      if (type === 'rgba') {
        updateAlphaThumb(current.a);
        updateAlphaTrackBg();
      }
      textInput.value = formatOutput(current, type);
      // Update trigger swatch
      triggerEl.style.background = type === 'rgba'
        ? `rgba(${current.r},${current.g},${current.b},${current.a/255})`
        : `rgb(${current.r},${current.g},${current.b})`;
      if (opts.onChange) opts.onChange(formatOutput(current, type));
    }

    function updateAlphaTrackBg() {
      if (!alphaTrack) return;
      alphaTrack.style.background = `linear-gradient(to right, rgba(${current.r},${current.g},${current.b},0), rgba(${current.r},${current.g},${current.b},1))`;
    }

    function setFromPalette(x, y) {
      const w = paletteCanvas.width;
      const h = paletteCanvas.height;
      const sat = Math.max(0, Math.min(100, (x / w) * 100));
      const lit = 100 - Math.max(0, Math.min(100, (y / h) * 100));
      const curHsl = rgbToHsl(current.r, current.g, current.b);
      const rgb = hslToRgb(curHsl.h / 360, sat / 100, lit / 100);
      current.r = rgb.r;
      current.g = rgb.g;
      current.b = rgb.b;
      updateAllUI();
    }

    function setHueFromPos(x) {
      const pct = Math.max(0, Math.min(1, x / hueTrack.clientWidth));
      const h = Math.round(pct * 360);
      const curHsl = rgbToHsl(current.r, current.g, current.b);
      const rgb = hslToRgb(h / 360, curHsl.s / 100, curHsl.l / 100);
      current.r = rgb.r;
      current.g = rgb.g;
      current.b = rgb.b;
      updateAllUI();
    }

    function setAlphaFromPos(x) {
      if (!alphaTrack) return;
      const pct = Math.max(0, Math.min(1, x / alphaTrack.clientWidth));
      current.a = Math.round(pct * 255);
      updateAllUI();
    }

    // Initial draw
    drawPalette(hsl.h);
    updatePaletteCursor(hsl.s, hsl.l);
    updateHueThumb(hsl.h);
    if (type === 'rgba') {
      updateAlphaThumb(current.a);
      updateAlphaTrackBg();
    }

    // Palette events
    paletteCanvas.addEventListener('mousedown', (e) => {
      draggingPalette = true;
      const rect = paletteCanvas.getBoundingClientRect();
      setFromPalette(e.clientX - rect.left, e.clientY - rect.top);
    });

    // Hue slider events
    hueThumb.addEventListener('mousedown', (e) => {
      draggingHue = true;
      e.preventDefault();
    });
    hueTrack.addEventListener('mousedown', (e) => {
      if (e.target === hueThumb) return;
      draggingHue = true;
      setHueFromPos(e.offsetX);
      e.preventDefault();
    });

    // Alpha slider events
    if (type === 'rgba') {
      alphaThumb.addEventListener('mousedown', (e) => {
        draggingAlpha = true;
        e.preventDefault();
      });
      alphaTrack.addEventListener('mousedown', (e) => {
        if (e.target === alphaThumb) return;
        draggingAlpha = true;
        setAlphaFromPos(e.offsetX);
        e.preventDefault();
      });
    }

    // Global mouse move/up
    document.addEventListener('mousemove', (e) => {
      if (draggingPalette) {
        const rect = paletteCanvas.getBoundingClientRect();
        setFromPalette(
          Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
          Math.max(0, Math.min(rect.height, e.clientY - rect.top))
        );
      }
      if (draggingHue) {
        const rect = hueTrack.getBoundingClientRect();
        setHueFromPos(Math.max(0, Math.min(rect.width, e.clientX - rect.left)));
      }
      if (draggingAlpha) {
        const rect = alphaTrack.getBoundingClientRect();
        setAlphaFromPos(Math.max(0, Math.min(rect.width, e.clientX - rect.left)));
      }
    });

    document.addEventListener('mouseup', () => {
      draggingPalette = false;
      draggingHue = false;
      draggingAlpha = false;
    });

    // Preset swatches
    popover.querySelectorAll('.cp-preset-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        const c = parseColor(sw.dataset.hex);
        current.r = c.r; current.g = c.g; current.b = c.b;
        if (type === 'rgb') current.a = 255;
        updateAllUI();
      });
    });

    // Text input
    textInput.addEventListener('input', () => {
      const parsed = parseColor(textInput.value);
      current.r = parsed.r; current.g = parsed.g; current.b = parsed.b;
      if (type === 'rgb') current.a = 255; else current.a = parsed.a;
      updateAllUI();
    });
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { popover.remove(); }
      if (e.key === 'Enter') { popover.remove(); }
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('mousedown', function closePopover(e) {
        if (!popover.contains(e.target) && e.target !== triggerEl) {
          popover.remove();
          document.removeEventListener('mousedown', closePopover);
        }
      });
    }, 0);
  }

  window.ColorPicker = { attach };
})();
