// Toast notification system
(function () {
  const container = document.getElementById('toast-container');
  let toastId = 0;

  window.Toast = {
    show(message, type = 'info', duration = 3500) {
      const id = ++toastId;
      const icon = { success: '✓', error: '✕', warning: '⚠' }[type] || '';

      const el = document.createElement('div');
      el.className = `toast toast--${type}`;
      el.innerHTML = `
        <span class="toast__msg">${icon} ${message}</span>
      `;
      // Click anywhere on the toast to dismiss it manually (parabolic toss).
      el.addEventListener('click', () => Toast.dismiss(el, true));
      container.appendChild(el);

      if (duration > 0) {
        setTimeout(() => Toast.dismiss(el, false), duration);
      }
      return id;
    },

    success(msg) { return this.show(msg, 'success'); },
    error(msg) { return this.show(msg, 'error', 6000); },
    warning(msg) { return this.show(msg, 'warning', 4500); },
    info(msg) { return this.show(msg, 'info'); },

    // Auto-dismiss (manual=false): simple fade-out to the right.
    // Manual dismiss (manual=true): a smooth parabolic toss computed per-frame
    // via rAF — rises to the upper-left, crests, then falls off the lower-left.
    dismiss(el, manual) {
      if (!el || !el.parentNode) return;
      if (el._dismissing) return;
      el._dismissing = true;
      el.style.pointerEvents = 'none';
      if (!manual) {
        el.style.opacity = '0';
        el.style.transform = 'translateX(40px)';
        el.style.transition = 'all 0.2s ease';
        setTimeout(() => el.remove(), 200);
        return;
      }
      const duration = 600;
      const start = performance.now();
      const xEnd = -180, yEnd = 90, yPeak = -90; // arc: rise then fall
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        // x: steady move left. y: a clean parabola through (0,0)→(0.5,peak)→(1,end).
        const x = xEnd * t;
        const y = 4 * yPeak * t * (1 - t) + yEnd * t * t;
        const rot = -14 * t;
        el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
        el.style.opacity = String(1 - t * t);
        if (t < 1) requestAnimationFrame(step);
        else el.remove();
      };
      requestAnimationFrame(step);
    },
  };
})();
