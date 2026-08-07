// About / info dialog. Opens when the title bar title is clicked.
(function () {
  const overlay = document.getElementById('info-overlay');
  const closeBtn = document.getElementById('info-close');
  const titleEl = document.querySelector('.titlebar__title');
  const particlesEl = document.getElementById('info-particles');

  // ── Heartbeat playback ──
  // Clicking the logo plays the current skin's heartbeat audio (osu! plays
  // heartbeat.* on the menu when the skin provides it). If several formats of
  // the same name coexist, the first found in wav > mp3 > ogg order wins.
  // If the skin ships no heartbeat.* (checked flat, not in subfolders) we fall
  // back to the bundled osu-logo-heartbeat.wav so the click is never silent.
  //
  // Preload model: when the dialog opens we resolve the heartbeat URL, fetch +
  // decodeAudioData it once into hbBuffer. Every click then mints a fresh
  // AudioBufferSourceNode from that buffer — one-shot, so rapid clicks overlap
  // (each source is independent) with zero decode latency after the first open.
  // If preload hasn't finished (or failed) at click time, we fall back to a
  // one-shot <audio> element so the click is never silent.
  const HEARTBEAT_EXTS = ['.wav', '.mp3', '.ogg'];
  const FALLBACK_HEARTBEAT = 'assets/osu-logo-heartbeat.wav';
  let hbCtx = null;          // lazy AudioContext (decode + playback)
  let hbBuffer = null;       // decoded AudioBuffer, re-sourced per click
  let hbPreloading = false;  // a preload pass is in flight (dedup)

  function hbAudioCtx() {
    if (!hbCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) hbCtx = new Ctor();
    }
    return hbCtx;
  }

  // Resolve the heartbeat's web URL: skin heartbeat.* (asset: URL) in priority
  // order, else the bundled fallback. Returns { url } or null if it can't.
  async function resolveHeartbeatUrl() {
    const convert = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc;
    try {
      const skin = state.get('selectedSkin');
      if (skin && convert) {
        const sp = await api.getSkinPath(skin);
        if (sp && sp.success && sp.data) {
          const dir = sp.data.replace(/\\/g, '/').replace(/\/$/, '');
          for (const ext of HEARTBEAT_EXTS) {
            const abs = dir + '/heartbeat' + ext;
            const r = await tauriAPI.fileExists(abs);
            if (r && r.success && r.data) return { url: convert(abs) };
          }
        }
      }
    } catch (_) { /* fall through to bundled */ }
    return { url: FALLBACK_HEARTBEAT };
  }

  // Fetch + decode the heartbeat once so later clicks are latency-free. Safe to
  // call repeatedly; an in-flight pass is deduped and a finished buffer is kept.
  // No skin-change invalidation: the dialog is modal, so the skin can't change
  // between opens of the same dialog session.
  async function preloadHeartbeat() {
    if (hbBuffer || hbPreloading) return;
    hbPreloading = true;
    try {
      const ctx = hbAudioCtx();
      if (!ctx) return;
      const { url } = await resolveHeartbeatUrl();
      if (!url) return;
      const raw = await fetch(url).arrayBuffer();
      hbBuffer = await ctx.decodeAudioData(raw);
    } catch (_) { hbBuffer = null; }
    finally { hbPreloading = false; }
  }

  // Play a one-shot <audio> (fallback when no decoded buffer is ready).
  function playHeartbeatEl(url) {
    if (!url) return;
    const a = new Audio();
    a.preload = 'auto';
    a.src = url;
    a.addEventListener('ended', () => { a.src = ''; });
    a.addEventListener('error', () => { a.src = ''; });
    try { const p = a.play(); if (p && p.catch) p.catch(() => { a.src = ''; }); }
    catch (_) { a.src = ''; }
  }

  async function playHeartbeat() {
    // Fast path: decoded buffer ready → mint a fresh source (overlaps freely).
    const ctx = hbAudioCtx();
    if (hbBuffer && ctx) {
      try {
        if (ctx.state === 'suspended') await ctx.resume();
        const src = ctx.createBufferSource();
        src.buffer = hbBuffer;
        src.connect(ctx.destination);
        src.start();
        return;
      } catch (_) { /* fall through to element playback */ }
    }
    // Buffer not ready yet → resolve URL + play via <audio> (one-shot).
    const resolved = await resolveHeartbeatUrl();
    playHeartbeatEl(resolved && resolved.url);
    // Kick off preload in the background so subsequent clicks hit the fast path.
    preloadHeartbeat();
  }

  // ── MenuGlow color (for the logo ripple) ──
  // The ripple border uses the skin's [Colours] MenuGlow (osu! menu glow color)
  // when present; otherwise the CSS default (var(--accent-hover)). Cached per
  // skin name so repeated clicks don't re-read skin.ini. A skin switch produces
  // a new cache key, so stale entries simply never get hit.
  const menuGlowCache = new Map();   // skin name → 'rgb(r,g,b)' | null
  function parseMenuGlow(raw) {
    if (typeof raw !== 'string') return null;
    const parts = raw.split(',').map(s => parseInt(s.trim(), 10));
    if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return null;
    return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
  }
  async function menuGlowColor() {
    const skin = state.get('selectedSkin');
    if (!skin) return null;
    if (menuGlowCache.has(skin)) return menuGlowCache.get(skin);
    let color = null;
    try {
      const r = await api.readSkinIni(skin);
      const sections = (r && r.success && Array.isArray(r.data)) ? r.data : [];
      const colours = sections.find(s => s && s.section === 'Colours');
      if (colours && colours.keys && colours.keys.MenuGlow) {
        color = parseMenuGlow(colours.keys.MenuGlow);
      }
    } catch (_) { color = null; }
    menuGlowCache.set(skin, color);
    return color;
  }

  // Spawn rising triangle particles (osu!-style) inside the dialog background.
  function spawnParticles() {
    if (!particlesEl) return;
    particlesEl.innerHTML = '';
    // Equilateral triangles pointing up, fixed green, random size + opacity.
    const GREEN = 'var(--accent-hover)';
    const N = 42;
    for (let i = 0; i < N; i++) {
      const s = document.createElement('span');
      const size = 8 + Math.floor(Math.random() * 22);    // half base width
      const opacity = 0.015 + Math.random() * 0.025;
      const left = Math.random() * 100;
      const dur = 8 + Math.random() * 2;
      const delay = Math.random() * dur;
      s.style.left = left + '%';
      s.style.borderLeftWidth = size + 'px';
      s.style.borderRightWidth = size + 'px';
      s.style.borderBottomWidth = Math.round(size * 1.732) + 'px'; // equilateral height
      s.style.borderBottomColor = GREEN;
      s.style.animationDuration = dur + 's';
      s.style.animationDelay = (-delay) + 's';
      s.style.setProperty('--p-opacity', opacity.toFixed(2));
      particlesEl.appendChild(s);
    }
  }

  function open() {
    if (!overlay || !overlay.hidden) return;
    overlay.hidden = false;
    overlay.classList.remove('info-overlay--closing');
    spawnParticles();
    // Reflect any cached update result (from the startup check).
    reflectUpdateStatus();
    // Warm the MenuGlow cache so the first logo click's ripple is synchronous.
    menuGlowColor();
    // Preload + decode the heartbeat so the first click plays with no latency.
    preloadHeartbeat();
  }
  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.classList.add('info-overlay--closing');
    setTimeout(() => {
      overlay.hidden = true;
      overlay.classList.remove('info-overlay--closing');
    }, 200);
  }

  if (titleEl) {
    titleEl.style.cursor = 'pointer';
    // Open About on title click — but NOT when the click lands on the update
    // dot/ring (that's the update-download control, handled in update-check.js).
    titleEl.addEventListener('click', (e) => {
      if (e.target.closest('.titlebar__dot')) return;
      open();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', close);

  // Esc closes the dialog. Captured at the document level with stopImmediatePropagation
  // so the app's global Escape handlers (e.g. deselect skin in use mode) don't also fire.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.hidden) {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  }, true);

  // Logo click: bounce the logo + emit a ripple from the wrap center.
  // Each click triggers both animations once; they auto-remove when finished.
  const logoWrap = document.getElementById('info-logo-wrap');
  const logoEl = document.querySelector('.info-dialog__logo');
  if (logoWrap && logoEl) {
    // Prevent dragging the logo image.
    const logoImg = logoEl.querySelector('img');
    if (logoImg) {
      logoImg.draggable = false;
      logoImg.addEventListener('dragstart', (e) => e.preventDefault());
    }
    // When the bounce animation ends: if mouse still over, keep scale(1.12)
    // via inline; if mouse has left, play shrink transition.
    logoEl.addEventListener('animationend', () => {
      logoEl.classList.remove('is-bouncing');
      // Set inline to the animation's final scale so transition has a start.
      logoEl.style.transform = 'scale(1.12)';
      // If mouse has left, clear inline on next frame → transition shrinks.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!logoWrap.matches(':hover')) {
            logoEl.style.transform = '';
          }
        });
      });
    });
    logoWrap.addEventListener('animationend', (e) => {
      if (e.target.classList && e.target.classList.contains('info-dialog__ripple')) {
        e.target.remove();
      }
    });
    logoWrap.addEventListener('click', () => {
      // Play the current skin's heartbeat (osu! menu heartbeat.* convention).
      // Resolves wav > mp3 > ogg; falls back to the bundled heartbeat if absent.
      playHeartbeat();
      logoEl.style.transform = '';
      logoEl.classList.remove('is-bouncing');
      void logoEl.offsetWidth;
      logoEl.classList.add('is-bouncing');
      // Ripple: new element each click (parallel ripples). Border color uses
      // the skin's MenuGlow (cached → synchronous after the first read); if
      // absent/uncached yet, the CSS default (var(--accent-hover)) shows, and
      // the async read backfills the cache for the next click.
      const ripple = document.createElement('div');
      ripple.className = 'info-dialog__ripple';
      logoWrap.appendChild(ripple);
      const skin = state.get('selectedSkin');
      const cached = skin ? menuGlowCache.get(skin) : null;
      if (cached) ripple.style.borderColor = cached;
      void ripple.offsetWidth;
      ripple.style.animation = 'logoRipple 0.4s linear 1';
      ripple.addEventListener('animationend', () => ripple.remove());
      // Ensure the cache is warm for next time (no-op if already cached).
      if (skin && !menuGlowCache.has(skin)) {
        menuGlowColor().then(c => {
          if (c && ripple.isConnected) ripple.style.borderColor = c;
        });
      }
      // Easter eggs: each egg independently checked against its own chance;
      // only the FIRST hit is shown (at most one per click).
      const locale = (window.i18n && window.i18n.locale()) || 'zh-CN';
      const eggs = (window.__LOCALES__ && window.__LOCALES__[locale] && window.__LOCALES__[locale].easterEggs) || [];
      for (const egg of eggs) {
        if (typeof egg.chance === 'number' && Math.random() < egg.chance) {
          if (window.Toast) window.Toast.show(egg.text, 'info');
          break;
        }
      }
    });
    // On mouseleave: if animation is NOT running, shrink immediately.
    // If animation IS running, let it finish — animationend handles shrink.
    logoWrap.addEventListener('mouseleave', () => {
      if (!logoEl.classList.contains('is-bouncing')) {
        logoEl.style.transform = '';
      }
    });
  }
  if (overlay) {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  // External links open in the system browser (Tauri WebView2 swallows plain
  // target=_blank). Use the opener API if available, else fall back.
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      const a = e.target.closest('a[target="_blank"]');
      if (!a) return;
      e.preventDefault();
      const T = window.__TAURI__;
      if (T && T.opener && T.opener.openUrl) {
        T.opener.openUrl(a.href);
      } else if (T && T.core && T.core.invoke) {
        // no opener plugin; let WebView2 try
        window.open(a.href, '_blank');
      }
    });
  }

  // ── Update check (manual refresh in the about dialog) ──

  const updateBtn = document.getElementById('info-check-update');
  const updateStatus = document.getElementById('info-update-status');

  function setUpdateStatus(text, cls) {
    if (!updateStatus) return;
    updateStatus.textContent = text || '';
    updateStatus.className = 'info-dialog__update-status' + (cls ? ' info-dialog__update-status--' + cls : '');
  }

  // Show the cached update result; offer a one-click download/run if available.
  function reflectUpdateStatus() {
    if (!updateStatus) return;
    const uc = window.UpdateCheck;
    if (uc && uc.hasUpdate()) {
      const latest = uc.lastResult ? uc.lastResult.latestVersion : '';
      setUpdateStatus(i18n.t('info.updateAvailable', { ver: latest }), 'available');
      updateBtn.textContent = i18n.t('info.updateNow');
    } else {
      setUpdateStatus('');
      updateBtn.textContent = i18n.t('info.checkUpdate');
    }
  }

  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      const uc = window.UpdateCheck;
      if (!uc) return;
      // If we already know an update is available, the button acts as "update now".
      if (uc.hasUpdate()) {
        updateBtn.disabled = true;
        await uc.downloadAndRun();
        updateBtn.disabled = false;
        return;
      }
      // Otherwise: manual refresh.
      updateBtn.disabled = true;
      setUpdateStatus(i18n.t('info.checking'));
      try {
        const data = await uc.check();
        if (data && data.isUpdate) {
          reflectUpdateStatus();
        } else if (data) {
          setUpdateStatus(i18n.t('info.upToDate'));
        } else {
          setUpdateStatus(i18n.t('info.checkFailedRetry'), 'error');
        }
      } catch (_) {
        setUpdateStatus(i18n.t('info.checkFailed'), 'error');
      }
      updateBtn.disabled = false;
    });
  }

  window.InfoDialog = { open, close };
})();
