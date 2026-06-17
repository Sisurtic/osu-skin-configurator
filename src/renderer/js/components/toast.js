// Toast notification system
(function () {
  const container = document.getElementById('toast-container');
  let toastId = 0;

  window.Toast = {
    show(message, type = 'info', duration = 3500) {
      const id = ++toastId;
      const icon = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }[type] || 'ℹ';

      const el = document.createElement('div');
      el.className = `toast toast--${type}`;
      el.innerHTML = `
        <span class="toast__msg">${icon} ${message}</span>
        <span class="toast__close" data-id="${id}">×</span>
      `;

      el.querySelector('.toast__close').addEventListener('click', () => Toast.dismiss(el));
      container.appendChild(el);

      if (duration > 0) {
        setTimeout(() => Toast.dismiss(el), duration);
      }
      return id;
    },

    success(msg) { return this.show(msg, 'success'); },
    error(msg) { return this.show(msg, 'error', 6000); },
    warning(msg) { return this.show(msg, 'warning', 4500); },
    info(msg) { return this.show(msg, 'info'); },

    dismiss(el) {
      el.style.opacity = '0';
      el.style.transform = 'translateX(40px)';
      el.style.transition = 'all 0.2s ease';
      setTimeout(() => el.remove(), 200);
    },
  };
})();
