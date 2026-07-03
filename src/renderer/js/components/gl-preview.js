// WebGL preview renderer for the image-edit (tint) tab.
// Renders tint → crop → darken in a single fragment-shader pass on the GPU so
// live color dragging stays smooth even on large @2x images.
//
// The math mirrors src-tauri/src/preset_applier.rs exactly (the final apply
// path): 5 blend modes, HSL hue-shift, blend strength = color alpha/255, source
// alpha preserved, transparent pixels skipped, crop nearest-neighbour, darken
// over-composite. Only the PREVIEW uses this; apply still runs the Rust backend.
(function () {
  // Full-screen triangle pair (two tris covering clip space -1..1), uv 0..1.
  const VERT = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      v_uv.y = 1.0 - v_uv.y; // flip Y so texture rows match pixel rows (top=0)
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const FRAG = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_src;
    uniform vec2 u_srcSize;   // source px (w,h)
    uniform vec2 u_outSize;   // output px (w,h)
    // tint
    uniform int  u_tintOn;
    uniform vec3 u_color;     // 0..1
    uniform float u_t;        // blend strength = colorAlpha/255
    uniform int  u_mode;      // 0 multiply,1 screen,2 overlay,3 hue,4 replace
    // crop
    uniform int  u_cropOn;
    uniform float u_tailH;    // px
    uniform float u_blank;    // px
    uniform float u_outH;     // px (output height of crop)
    uniform int  u_tile;      // 0 stretch, 1 tile
    uniform int  u_tileDir;   // 0 down, 1 up
    // darken
    uniform int  u_darkenOn;
    uniform float u_shift;    // px
    uniform float u_dalpha;   // 0..1

    const float EPS = 1e-9;

    vec3 rgb2hsl(vec3 c) {
      float mx = max(c.r, max(c.g, c.b));
      float mn = min(c.r, min(c.g, c.b));
      float l = (mx + mn) * 0.5;
      if (abs(mx - mn) < EPS) return vec3(0.0, 0.0, l);
      float d = mx - mn;
      float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
      float h = 0.0;
      if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
      else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      return vec3(h / 6.0, s, l);
    }
    float hueTo(float p, float q, float t) {
      if (t < 0.0) t += 1.0;
      if (t > 1.0) t -= 1.0;
      if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
      if (t < 0.5) return q;
      if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
      return p;
    }
    vec3 hsl2rgb(float h, float s, float l) {
      if (s < EPS) return vec3(l, l, l);
      float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
      float p = 2.0 * l - q;
      return vec3(hueTo(p, q, h + 1.0/3.0), hueTo(p, q, h), hueTo(p, q, h - 1.0/3.0));
    }

    // tint one rgb (0..1) per the active mode, then lerp by u_t.
    vec3 applyTint(vec3 px) {
      vec3 b = px;
      if (u_mode == 0) { b = px * u_color; }                       // multiply
      else if (u_mode == 1) { b = vec3(1.0) - (vec3(1.0) - px) * (vec3(1.0) - u_color); } // screen
      else if (u_mode == 2) {                                       // overlay
        b = vec3(
          px.r < 0.5 ? 2.0 * px.r * u_color.r : 1.0 - 2.0 * (1.0 - px.r) * (1.0 - u_color.r),
          px.g < 0.5 ? 2.0 * px.g * u_color.g : 1.0 - 2.0 * (1.0 - px.g) * (1.0 - u_color.g),
          px.b < 0.5 ? 2.0 * px.b * u_color.b : 1.0 - 2.0 * (1.0 - px.b) * (1.0 - u_color.b)
        );
      } else if (u_mode == 3) {                                    // hue shift
        vec3 ph = rgb2hsl(px);
        vec3 ch = rgb2hsl(u_color);
        b = hsl2rgb(ch.x, ph.y, ph.z);
      } else { b = u_color; }                                      // replace
      return mix(px, b, u_t);
    }

    // Map an output pixel row (px) → source row (px) following crop geometry.
    // Returns -1.0 for the transparent blank region.
    float cropSrcRow(float outY) {
      float tailH = clamp(u_tailH, 0.0, u_srcSize.y);
      float bodySrcH = u_srcSize.y - tailH;
      float y0 = u_blank + tailH;          // body starts here in output
      if (outY < u_blank) return -1.0;     // blank → transparent
      if (outY < y0) return outY - u_blank; // tail: 1:1 from source top
      // body region: from y0 .. u_outH
      float remain = u_outH - y0;
      if (remain <= 0.0 || bodySrcH <= 0.0) return -1.0;
      float intoBody = outY - y0;          // px below y0
      if (u_tile == 1) {
        if (u_tileDir == 1) {
          // tile up: tiles repeat from the bottom edge upward
          float fromBottom = u_outH - outY; // distance above bottom
          float m = mod(fromBottom, bodySrcH);
          return u_srcSize.y - m;           // walk up the source body
        }
        return tailH + mod(intoBody, bodySrcH);
      }
      // stretch: map linearly into the body source range (bilinear filtering
      // on the sampler does the smoothing; no floor/nearest).
      float srcRow = tailH + intoBody * (bodySrcH / remain);
      return srcRow;
    }

    void main() {
      // Map fragment uv into the FULL (unclamped) output space — the canvas may
      // be rendered at a smaller physical size to stay under the WebGL texture /
      // canvas limit, but the crop geometry (blank/tail/body regions) is defined
      // over the real output height.
      float fullH = u_cropOn == 1 ? u_outH : u_srcSize.y;
      float outY = v_uv.y * fullH;
      // 1. determine source row (crop geometry, or identity)
      float sy;
      if (u_cropOn == 1) {
        sy = cropSrcRow(outY);
        if (sy < 0.0) { gl_FragColor = vec4(0.0); return; } // blank → transparent
      } else {
        sy = outY;
        if (sy >= u_srcSize.y) sy = u_srcSize.y - 1.0;
      }
      float sx = v_uv.x * u_srcSize.x;
      vec2 srcUv = (vec2(sx, sy) + 0.5) / u_srcSize;

      // 2. tint
      vec4 base = texture2D(u_src, srcUv);
      if (base.a == 0.0) { gl_FragColor = vec4(0.0); return; }
      if (u_tintOn == 1) {
        base.rgb = applyTint(base.rgb);
      }

      // 3. darken: ghost (translucent, at outY) under opaque (at outY - shift).
      // darken operates on the POST-cROP canvas, so the opaque copy samples the
      // crop-mapped row for output row (outY - shift) — NOT sy - shift (crop is
      // non-linear across blank/tail/body regions). Ghost keeps straight RGB,
      // only its alpha is scaled (matches backend scale_alpha + over-composite).
      if (u_darkenOn == 1 && u_shift > 0.0) {
        float ghostA = base.a * u_dalpha;
        float opaqueOutY = outY - u_shift;         // output row of the shifted copy
        float opSy = u_cropOn == 1 ? cropSrcRow(opaqueOutY) : opaqueOutY;
        if (opSy >= 0.0 && opSy < u_srcSize.y) {
          vec2 opUv = (vec2(sx, opSy) + 0.5) / u_srcSize;
          vec4 opaquePx = texture2D(u_src, opUv);
          if (opaquePx.a > 0.0 && u_tintOn == 1) opaquePx.rgb = applyTint(opaquePx.rgb);
          // over-composite opaque (top, straight) over ghost (bottom, straight).
          float aOut = opaquePx.a + ghostA * (1.0 - opaquePx.a);
          vec3 rgbOut = opaquePx.rgb * opaquePx.a + base.rgb * ghostA * (1.0 - opaquePx.a);
          gl_FragColor = aOut > 0.0 ? vec4(rgbOut / aOut, aOut) : vec4(0.0);
          return;
        }
        // opaque copy moved off the top (or into blank) → only ghost shows.
        gl_FragColor = vec4(base.rgb, ghostA);
        return;
      }

      gl_FragColor = base;
    }
  `;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader compile: ' + log);
    }
    return sh;
  }

  function createRenderer(canvas) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: false })
      || canvas.getContext('experimental-webgl');
    if (!gl) return null;

    // WebGL caps texture size and canvas drawing-buffer size (commonly 16384).
    // We clamp to the GPU's reported limit so very tall crop outputs (cropC
    // default 32768) and huge @2x sources still render — the shader maps
    // fragments into the full output space via u_outH, so a clamped canvas is
    // just a smaller-resolution rendering.
    const MAX = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 16384;

    let program, quad, loc = {}, tex, texKey = null, texW = 0, texH = 0;

    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('link: ' + gl.getProgramInfoLog(program));
      }
      gl.useProgram(program);

      // Full-screen quad: two triangles.
      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
      ]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(program, 'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      const U = ['u_srcSize','u_outSize','u_tintOn','u_color','u_t','u_mode',
        'u_cropOn','u_tailH','u_blank','u_outH','u_tile','u_tileDir',
        'u_darkenOn','u_shift','u_dalpha'];
      for (const u of U) loc[u] = gl.getUniformLocation(program, u);

      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } catch (e) {
      return null;
    }

    function uploadSource(img) {
      // Downsample sources larger than MAX so the texture fits the GPU limit.
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      const scale = (w > MAX || h > MAX) ? Math.min(MAX / w, MAX / h) : 1;
      let src = img;
      if (scale < 1) {
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        tmp.getContext('2d').imageSmoothingEnabled = false;
        tmp.getContext('2d').drawImage(img, 0, 0, w, h);
        src = tmp;
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      texW = w; texH = h;
    }

    // opts: { img, srcW, srcH, outW, outH, tint{on,color[3],t,mode}, crop{on,tailH,blank,outH,tile,tileDir}, darken{on,shift,alpha} }
    function render(opts) {
      // Upload source only when it changes (caller passes a key) — sets texW/texH.
      if (opts.srcKey !== texKey) {
        uploadSource(opts.img);
        texKey = opts.srcKey;
      }
      // u_srcSize = the actually-uploaded (possibly downsampled) texture dims.
      gl.uniform2f(loc.u_srcSize, texW, texH);
      // Crop params are in real source pixels; if the source was downsampled for
      // the texture, scale them to match the uploaded resolution.
      const srcScale = (opts.srcW && texW) ? texW / opts.srcW : 1;

      // Canvas physical size: clamp EACH dimension independently to MAX. A very
      // tall crop output (cropC) must not drag the width down with it — clamping
      // width would lose horizontal resolution and look blurry/blocky. CSS
      // aspect-ratio (set below) restores the correct display proportions.
      const fullW = Math.max(1, Math.round(opts.outW));
      const fullH = Math.max(1, Math.round(opts.outH));
      const cw = Math.min(fullW, MAX);
      const ch = Math.min(fullH, MAX);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw; canvas.height = ch;
      }
      // Display size: the canvas's intrinsic width is its drawing-buffer width
      // (= fullW when not clamped). aspect-ratio drives the height from the FULL
      // logical dims so proportions are correct even when the buffer was clamped
      // (height-only). We DON'T force style.width — that would fight max-height
      // in full-fit mode and break double-click zoom. Only override it when the
      // drawing-buffer width was clamped below the real width (huge source).
      canvas.style.height = '';
      canvas.style.aspectRatio = `${fullW} / ${fullH}`;
      canvas.style.width = (cw < fullW) ? (fullW + 'px') : '';
      gl.viewport(0, 0, canvas.width, canvas.height);
      // u_outSize = the full (unclamped) logical output dims — the shader uses
      // these to map fragment uvs into the full output space.
      gl.uniform2f(loc.u_outSize, fullW, fullH);

      const tint = opts.tint || {};
      gl.uniform1i(loc.u_tintOn, tint.on ? 1 : 0);
      gl.uniform3fv(loc.u_color, tint.color || [1, 1, 1]);
      gl.uniform1f(loc.u_t, tint.t != null ? tint.t : 1);
      gl.uniform1i(loc.u_mode, tint.mode || 0);

      const crop = opts.crop || {};
      gl.uniform1i(loc.u_cropOn, crop.on ? 1 : 0);
      gl.uniform1f(loc.u_tailH, (crop.tailH || 0) * srcScale);
      gl.uniform1f(loc.u_blank, (crop.blank || 0) * srcScale);
      gl.uniform1f(loc.u_outH, crop.outH ? crop.outH * srcScale : fullH);
      gl.uniform1i(loc.u_tile, crop.tile ? 1 : 0);
      gl.uniform1i(loc.u_tileDir, crop.tileDir === 'up' ? 1 : 0);

      const darken = opts.darken || {};
      gl.uniform1i(loc.u_darkenOn, darken.on ? 1 : 0);
      gl.uniform1f(loc.u_shift, (darken.shift || 0) * srcScale);
      gl.uniform1f(loc.u_dalpha, darken.alpha != null ? darken.alpha : 0);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function destroy() {
      try {
        gl.deleteTexture(tex);
        gl.deleteBuffer(quad);
        gl.deleteProgram(program);
      } catch (_) { /* ignore */ }
      texKey = null;
    }

    return { render, destroy, gl };
  }

  window.GlPreview = { createRenderer };
})();
