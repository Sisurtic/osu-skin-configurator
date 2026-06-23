// Cursor particle effect: green, very low-opacity, upward-floating equilateral
// triangles. Sparse and dreamy — if you blink you might miss them. Fast mouse
// movement produces fewer, more scattered particles so they don't block view.
(function () {
  let layer = null;
  let lastX = null, lastY = null, lastT = 0;
  let spawnAccum = 0;
  const GREEN = 'hsl(140, 60%, 75%)';
  const MAX_PARTICLES = 18;  // hard cap to prevent flooding

  function ensureLayer() {
    if (layer) return layer;
    layer = document.getElementById('cursor-particles');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'cursor-particles';
      layer.className = 'cursor-particles';
      document.body.appendChild(layer);
    }
    return layer;
  }

  function spawn(x, y) {
    const l = ensureLayer();
    if (!l) return;
    // Hard cap: don't spawn if too many alive.
    if (l.children.length >= MAX_PARTICLES) return;

    const s = document.createElement('span');
    // Wider size range for variety: some tiny, some medium.
    const size = 3 + Math.floor(Math.random() * 8);
    // Very low opacity — barely visible, "若隐若现".
    const opacity = (0.015 + Math.random() * 0.035).toFixed(3);
    // Random scatter around cursor, not exactly at cursor.
    const offsetX = (Math.random() - 0.5) * 30;
    const offsetY = (Math.random() - 0.5) * 20;
    // Random horizontal drift (can go either direction, wider range).
    const drift = (Math.random() - 0.5) * 50;
    // Variable rise distance.
    const rise = 15 + Math.random() * 30;
    // Longer lifespan for slow fade.
    const dur = 800 + Math.random() * 700;

    s.style.left = (x + offsetX - size) + 'px';
    s.style.top = (y + offsetY - Math.round(size * 1.732)) + 'px';
    s.style.borderLeftWidth = size + 'px';
    s.style.borderRightWidth = size + 'px';
    s.style.borderBottomWidth = Math.round(size * 1.732) + 'px';
    s.style.borderBottomColor = GREEN;
    s.style.setProperty('--cp-opacity', opacity);
    s.style.setProperty('--cp-rise', rise + 'px');
    s.style.setProperty('--cp-drift', drift + 'px');
    s.style.animationDuration = dur + 'ms';
    l.appendChild(s);
    setTimeout(() => { if (s.parentNode) s.parentNode.removeChild(s); }, dur + 60);
  }

  function onMouseMove(e) {
    const t = e.timeStamp;
    if (lastX === null) { lastX = e.clientX; lastY = e.clientY; lastT = t; return; }
    const dt = Math.max(1, t - lastT);
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    const speed = Math.sqrt(dx * dx + dy * dy) / dt;   // px per ms
    lastX = e.clientX; lastY = e.clientY; lastT = t;
    // Low spawn multiplier — most movement produces 0 particles, only sustained
    // or fast movement occasionally spawns one. Random threshold adds variety.
    spawnAccum += speed * 0.15;
    while (spawnAccum >= 1) {
      // 50% chance to actually spawn — adds sparseness and randomness.
      if (Math.random() < 0.5) spawn(e.clientX, e.clientY);
      spawnAccum -= 1;
    }
    if (spawnAccum > 2) spawnAccum = 2;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureLayer();
      document.addEventListener('mousemove', onMouseMove, { passive: true });
    });
  } else {
    ensureLayer();
    document.addEventListener('mousemove', onMouseMove, { passive: true });
  }
})();
