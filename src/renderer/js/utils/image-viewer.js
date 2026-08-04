// ImageViewer — a pan/zoom canvas viewer for the layer composite preview.
//
// Mounted into a container (e.g. #layer-preview) with a source canvas that
// already holds the composited pixels at its NATURAL resolution. The viewer
// never touches pixel data; it only places the canvas via CSS transform.
//
// Interactions:
//   • double-click    → cycle: custom → fit → actual(1:1) → fit → …
//   • wheel           → pan (default vertical; Ctrl = horizontal)
//   • Alt + wheel     → zoom around the cursor
//   • Shift + (any)   → 10× faster pan / zoom
//   • drag            → pan the view
//
// State survives across re-mount as long as the container element is the same
// (state is keyed on the container element via a WeakMap).
window.ImageViewer = (function () {
  const states = new WeakMap();

  function getSt(container) {
    let st = states.get(container);
    if (!st) {
      st = { scale: null, ox: 0, oy: 0, mode: 'fit', dragging: null };
      states.set(container, st);
    }
    return st;
  }

  function fitScale(canvas, container) {
    const cw = container.clientWidth, ch = container.clientHeight;
    if (!cw || !ch || !canvas.width || !canvas.height) return 1;
    return Math.min(cw / canvas.width, ch / canvas.height);
  }

  function badgeText(st) {
    if (st.mode === 'fit') return 'Fit';
    if (st.mode === 'actual') return '100%';
    return Math.round((st.scale || 1) * 100) + '%';
  }

  function apply(container, canvas, st) {
    const scale = st.scale != null ? st.scale : fitScale(canvas, container);
    const cw = container.clientWidth, ch = container.clientHeight;
    const dispW = canvas.width * scale, dispH = canvas.height * scale;
    canvas.style.position = 'absolute';
    canvas.style.left = (cw / 2 + st.ox - dispW / 2) + 'px';
    canvas.style.top = (ch / 2 + st.oy - dispH / 2) + 'px';
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = `scale(${scale})`;
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
    if (st.badge) st.badge.textContent = badgeText(st);
  }

  // PS-style clamp: the canvas can be dragged anywhere as long as part of it
  // still overlaps the viewport.
  function clampPan(container, canvas, scale, st) {
    if (!canvas.width || !canvas.height) return;
    const cw = container.clientWidth, ch = container.clientHeight;
    const iw = canvas.width * scale, ih = canvas.height * scale;
    const maxX = Math.max(0, (cw + iw) / 2 - 1);
    const maxY = Math.max(0, (ch + ih) / 2 - 1);
    st.ox = Math.max(-maxX, Math.min(maxX, st.ox));
    st.oy = Math.max(-maxY, Math.min(maxY, st.oy));
  }

  function mount(container, sourceCanvas) {
    if (!container || !sourceCanvas) return;
    const st = getSt(container);

    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    container.appendChild(sourceCanvas);
    if (!st.badge) {
      const badge = document.createElement('div');
      badge.className = 'iv-badge';
      st.badge = badge;
    }
    container.appendChild(st.badge);

    if (st.mode === 'fit' || st.scale == null) st.scale = null;
    const doFit = () => {
      if (st.mode === 'fit' || st.scale == null) st.scale = fitScale(sourceCanvas, container);
      clampPan(container, sourceCanvas, st.scale, st);
      apply(container, sourceCanvas, st);
    };
    doFit();
    requestAnimationFrame(doFit);

    const onWheel = (e) => {
      e.preventDefault();
      const shift = e.shiftKey ? 10 : 1;
      if (e.altKey) {
        const rect = container.getBoundingClientRect();
        const px = e.clientX - rect.left - rect.width / 2;
        const py = e.clientY - rect.top - rect.height / 2;
        const oldScale = st.scale;
        const halfW = sourceCanvas.width * oldScale / 2;
        const halfH = sourceCanvas.height * oldScale / 2;
        const imgX = (px - st.ox + halfW) / oldScale;
        const imgY = (py - st.oy + halfH) / oldScale;
        const factor = Math.exp(-e.deltaY * 0.0015 * shift);
        const ns = Math.max(0.02, Math.min(64, oldScale * factor));
        const newHalfW = sourceCanvas.width * ns / 2;
        const newHalfH = sourceCanvas.height * ns / 2;
        st.ox = px + newHalfW - imgX * ns;
        st.oy = py + newHalfH - imgY * ns;
        st.scale = ns;
        st.mode = 'custom';
      } else {
        // Natural-direction pan: scroll DOWN → content moves up → see lower
        // content; scroll RIGHT (Ctrl+wheel) → content moves left → see right.
        // (Matches browsers / PS; the sign flip vs the raw delta is because the
        // apply() offset is canvas-position, not viewport-position.)
        const step = 40 * shift;
        if (e.ctrlKey || e.metaKey) st.ox -= (e.deltaY > 0 ? step : -step);
        else st.oy -= (e.deltaY > 0 ? step : -step);
        clampPan(container, sourceCanvas, st.scale, st);
      }
      apply(container, sourceCanvas, st);
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    const onDblClick = () => {
      if (st.mode === 'fit') { st.mode = 'actual'; st.scale = 1; }
      else { st.mode = 'fit'; st.scale = fitScale(sourceCanvas, container); }
      st.ox = 0; st.oy = 0;
      clampPan(container, sourceCanvas, st.scale, st);
      apply(container, sourceCanvas, st);
    };
    container.addEventListener('dblclick', onDblClick);

    const onDown = (e) => {
      if (e.button !== 0) return;
      st.dragging = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy, moved: false };
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!st.dragging) return;
      if (!st.dragging.moved) {
        if (Math.abs(e.clientX - st.dragging.x) < 3 && Math.abs(e.clientY - st.dragging.y) < 3) return;
        st.dragging.moved = true;
      }
      st.ox = st.dragging.ox + (e.clientX - st.dragging.x);
      st.oy = st.dragging.oy + (e.clientY - st.dragging.y);
      clampPan(container, sourceCanvas, st.scale, st);
      apply(container, sourceCanvas, st);
    };
    const onUp = () => {
      if (!st.dragging) return;
      if (st.dragging.moved) st.mode = 'custom';
      st.dragging = null;
    };
    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function reset(container) {
    const st = states.get(container);
    if (st) { st.scale = null; st.ox = 0; st.oy = 0; st.mode = 'fit'; }
  }

  return { mount, reset };
})();
