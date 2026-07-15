// Input confirm module — adds Enter-to-blur and Escape-to-blur to <input>
// elements (not <textarea> which allows multi-line). Used by the global
// keydown handler and by flyout components (color picker, etc.).
(function () {
  function attach(el) {
    if (!el || el.tagName !== 'INPUT') return;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        el.blur();
      }
    });
  }

  function attachAll(root) {
    if (!root) root = document;
    root.querySelectorAll('input').forEach(attach);
  }

  // Attach to all current + future inputs via MutationObserver.
  function observe(root) {
    if (!root) root = document.body;
    attachAll(root);
    if (typeof MutationObserver === 'undefined') return;
    new MutationObserver(muts => {
      for (const m of muts) {
        m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'INPUT') attach(n);
          else if (n.querySelectorAll) n.querySelectorAll('input').forEach(attach);
        });
      }
    }).observe(root, { childList: true, subtree: true });
  }

  window.InputConfirm = { attach, attachAll, observe };
})();
