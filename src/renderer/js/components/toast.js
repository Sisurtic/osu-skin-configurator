// Toast notification system
(function () {
  const container = document.getElementById('toast-container');
  let toastId = 0;

  // Coalesce rapid repeats: the last toast per type is tracked; a follow-up
  // `show` of the same type within its lifetime UPDATES that toast in place
  // (new text + reset timer) instead of stacking a new one. Prevents toast spam
  // from continuous edits (e.g. dragging a slider syncs every frame).
  const lastByType = {};
  window.Toast = {
    show(message, type = 'info', duration = 3500, onClick) {
      const icon = { success: '✓', error: '✕', warning: '⚠' }[type] || '';

      // Reuse the last toast of this type if it's still alive (no new element,
      // no stack-up). onClick toasts (e.g. apply-warning details) always get a
      // fresh element — they're one-shot, not coalesced.
      if (!onClick && lastByType[type] && lastByType[type].el.parentNode && !lastByType[type].el._dismissing) {
        const rec = lastByType[type];
        rec.el.querySelector('.toast__msg').innerHTML = `${icon} ${message}`;
        clearTimeout(rec.timer);
        if (duration > 0) rec.timer = setTimeout(() => Toast.dismiss(rec.el, false), duration);
        return rec.id;
      }

      const id = ++toastId;
      const el = document.createElement('div');
      el.className = `toast toast--${type}`;
      el.innerHTML = `
        <span class="toast__msg">${icon} ${message}</span>
      `;
      el.addEventListener('click', () => {
        if (onClick) onClick();
        else Toast.dismiss(el, true);
      });
      container.appendChild(el);

      let timer = null;
      if (duration > 0) {
        timer = setTimeout(() => Toast.dismiss(el, false), duration);
      }
      if (!onClick) lastByType[type] = { el, timer, id };
      return id;
    },

    success(msg, onClick) { return this.show(msg, 'success', 3500, onClick); },
    error(msg, onClick) { return this.show(msg, 'error', 6000, onClick); },
    warning(msg, onClick) { return this.show(msg, 'warning', 4500, onClick); },
    info(msg, onClick) { return this.show(msg, 'info', 3500, onClick); },

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
