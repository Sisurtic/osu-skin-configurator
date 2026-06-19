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

  // Logo hover: bounce the logo (stops at the cycle boundary where scale==1)
  // and emit an independent ripple from the wrap center.
  const logoWrap = document.getElementById('info-logo-wrap');
  const logoEl = document.querySelector('.info-dialog__logo');
  const rippleEl = document.querySelector('.info-dialog__ripple');
  if (logoWrap && logoEl) {
    let bounceStopping = false;
    let rippleStopping = false;
    const onIter = () => {
      // Each iteration boundary is at scale(1) — safe to stop here.
      if (bounceStopping) {
        logoEl.classList.remove('is-bouncing');
        logoEl.removeEventListener('animationiteration', onIter);
        bounceStopping = false;
      }
    };
    const start = () => {
      bounceStopping = false;
      rippleStopping = false;
      logoEl.classList.add('is-bouncing');
      logoWrap.classList.add('is-rippling');
      logoEl.addEventListener('animationiteration', onIter);
      rippleEl.addEventListener('animationiteration', onRippleIter);
    };
    const stop = () => {
      // Both animations finish their current cycle before stopping.
      bounceStopping = true;
      rippleStopping = true;
    };
    const onRippleIter = () => {
      // Each iteration boundary is a full fade-out — safe to stop here.
      if (rippleStopping) {
        logoWrap.classList.remove('is-rippling');
        rippleEl.removeEventListener('animationiteration', onRippleIter);
        rippleStopping = false;
      }
    };
    logoWrap.addEventListener('mouseenter', start);
    logoWrap.addEventListener('mouseleave', stop);
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
      setUpdateStatus(`发现新版本 ${latest}，点击更新将下载并运行安装程序`, 'available');
      updateBtn.textContent = '立即更新';
    } else {
      setUpdateStatus('');
      updateBtn.textContent = '检查更新';
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
      setUpdateStatus('检查中…');
      try {
        const data = await uc.check();
        if (data && data.isUpdate) {
          reflectUpdateStatus();
        } else if (data) {
          setUpdateStatus('已是最新版本');
        } else {
          setUpdateStatus('检查失败，请稍后再试', 'error');
        }
      } catch (_) {
        setUpdateStatus('检查失败', 'error');
      }
      updateBtn.disabled = false;
    });
  }

  window.InfoDialog = { open, close };
})();
