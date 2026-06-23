// About / info dialog. Opens when the title bar title is clicked.
(function () {
  const overlay = document.getElementById('info-overlay');
  const closeBtn = document.getElementById('info-close');
  const titleEl = document.querySelector('.titlebar__title');
  const particlesEl = document.getElementById('info-particles');

  // Spawn rising triangle particles (osu!-style) inside the dialog background.
  function spawnParticles() {
    if (!particlesEl) return;
    particlesEl.innerHTML = '';
    // Equilateral triangles pointing up, fixed green, random size + opacity.
    const GREEN = 'hsl(140, 60%, 75%)';
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
    const v = document.getElementById('app-version');
    const target = document.getElementById('info-version');
    if (target) target.textContent = v ? v.textContent : '';
    overlay.hidden = false;
    overlay.classList.remove('info-overlay--closing');
    spawnParticles();
    // Reflect any cached update result (from the startup check).
    reflectUpdateStatus();
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
    titleEl.addEventListener('click', open);
  }
  if (closeBtn) closeBtn.addEventListener('click', close);

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
      logoEl.style.transform = '';
      logoEl.classList.remove('is-bouncing');
      void logoEl.offsetWidth;
      logoEl.classList.add('is-bouncing');
      // Ripple: new element each click (parallel ripples).
      const ripple = document.createElement('div');
      ripple.className = 'info-dialog__ripple';
      logoWrap.appendChild(ripple);
      void ripple.offsetWidth;
      ripple.style.animation = 'logoRipple 0.4s linear 1';
      ripple.addEventListener('animationend', () => ripple.remove());
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.hidden) {
      e.stopPropagation();
      close();
    }
  });

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
