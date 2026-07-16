// Input confirm module — adds Enter-to-blur and Escape-to-cancel to <input>
// elements (not <textarea> which allows multi-line). Used by the global
// keydown handler and by flyout components (color picker, etc.).
//
// Enter  → blur (commits the typed value via the 'change' event).
// Escape → RESTORE the value the field held when it was focused (the pre-edit
//          value, NOT the render-time value — multi-select may have changed it
//          since) and blur, WITHOUT committing/syncing. The blur still fires
//          'change', so editors detect the cancel via wasEscCancel(el) and skip
//          their normalize/sync logic for that one change.
(function () {
  function attach(el) {
    if (!el || el.tagName !== 'INPUT') return;
    // Remember the value at focus time — this is what ESC restores (the pre-edit
    // value, which may differ from the render-time defaultValue if a prior
    // multi-select sync updated the data without a re-render).
    el.addEventListener('focus', () => {
      el.dataset.preEditValue = el.value;
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Enter = "commit this value". blur fires 'change' only when the value
        // changed since focus; if it didn't change, dispatch change manually so
        // the editor still runs normalize + marks dirty + syncs (Enter must
        // always commit, even an unchanged value — unlike Escape which cancels).
        const unchanged = el.value === el.dataset.preEditValue;
        el.blur();
        if (unchanged) el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Restore the pre-edit value and flag this change as a cancel so editors
        // skip normalize + multi-select sync.
        if (el.dataset.preEditValue !== undefined) el.value = el.dataset.preEditValue;
        el.dataset.escCancel = '1';
        el.blur();
        // The blur may NOT fire 'change' (restoring to the focus-time value means
        // the value is unchanged since focus → no change event). If it doesn't,
        // the escCancel flag would linger and wrongly skip the NEXT commit (e.g.
        // the user's next Enter). Clear any unconsumed flag on the next tick so
        // it only ever applies to a change fired by THIS Escape.
        setTimeout(() => { delete el.dataset.escCancel; }, 0);
      }
    });
  }

  // Editors call this at the top of their 'change' handler; returns true (and
  // clears the flag) when the change was triggered by an Escape-cancel, so they
  // can skip normalize/sync and just keep the restored value.
  function wasEscCancel(el) {
    if (!el || el.dataset.escCancel !== '1') return false;
    delete el.dataset.escCancel;
    return true;
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

  window.InputConfirm = { attach, attachAll, observe, wasEscCancel };
})();
