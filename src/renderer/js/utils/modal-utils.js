// Shared helpers for the app's modal-overlay dialogs.
//
// bindOverlayDismiss: "click outside to close" that does NOT misfire when the
//   user drags a text selection from an input out onto the overlay (the old
//   `if (e.target === overlay) close()` fired on mouseup alone). We track the
//   mousedown target and only dismiss when BOTH mousedown and mouseup land on
//   the overlay itself — i.e. a real click on empty space.
//
// fadeOutOverlay: plays the `.modal-overlay--closing` fade-out animation, then
//   calls `done` (remove + resolve + side effects). Mirrors the info-dialog
//   `--closing` convention so every dialog opens/closes the same way. `done` is
//   deferred until the animation ends (with a fallback timer) so callers' await
//   resolves exactly when the dialog visually disappears.

(function () {
  function bindOverlayDismiss(overlay, onDismiss) {
    if (!overlay || typeof onDismiss !== 'function') return;
    let mouseDownOnOverlay = false;
    overlay.addEventListener('mousedown', (e) => {
      mouseDownOnOverlay = (e.target === overlay);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && mouseDownOnOverlay) {
        mouseDownOnOverlay = false;
        onDismiss();
      }
    });
  }

  function fadeOutOverlay(overlay, done) {
    if (!overlay) { if (done) done(); return; }
    overlay.classList.add('modal-overlay--closing');
    const finish = () => {
      overlay.classList.remove('modal-overlay--closing');
      if (done) done();
    };
    // animationend ties to the CSS duration; the 220ms timer is a fallback for
    // the rare case animationend doesn't fire (e.g. tab was backgrounded).
    let fired = false;
    const timer = setTimeout(() => {
      if (fired) return;
      fired = true;
      finish();
    }, 220);
    const handler = (e) => {
      if (e.target !== overlay) return;   // only the overlay's own animation
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      overlay.removeEventListener('animationend', handler);
      finish();
    };
    overlay.addEventListener('animationend', handler);
  }

  window.ModalUtils = { bindOverlayDismiss, fadeOutOverlay };
})();
