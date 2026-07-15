// Source picker — click-to-repick a source image file for an operation row.
// Independent component, paralleling color-picker.js: each editor binds its
// thumbnail element via SourcePicker.attach; the component owns the trigger
// detection (only the <img> or the file-icon starts a pick), the file dialog,
// and path normalization (absolute skin path → skin-relative). The editor's
// onPick callback receives the normalized relative path and does its own data
// write / sync / render.
//
// Vanilla JS, no modules. window.SourcePicker = { attach, pick }.
(function () {
  // Default image filter for the open-file dialog.
  const DEFAULT_FILTERS = () => [
    { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'apng', 'bmp'] },
    { name: 'All', extensions: ['*'] },
  ];

  // Only a click on the <img> or the .file-thumb__icon starts a pick — NOT the
  // filename label or the surrounding whitespace (those are for row selection).
  function isPickTrigger(target) {
    if (!target) return false;
    if (target.tagName === 'IMG') return true;
    return target.classList && target.classList.contains('file-thumb__icon');
  }

  // Normalize an absolute/relative chosen path to skin-relative: if it's inside
  // the skin folder, strip the skin prefix; otherwise leave it as-is (relative
  // paths are returned unchanged). `skPath` is the absolute skin root (POSIX).
  function toSkinRelative(chosen, skPath) {
    let p = (chosen || '').replace(/\\/g, '/');
    if (skPath) {
      const skNorm = skPath.replace(/\/$/, '');
      if (p.toLowerCase().startsWith(skNorm.toLowerCase())) {
        p = p.slice(skNorm.length).replace(/^\//, '');
      }
    }
    return p;
  }

  // Open the file dialog and resolve to a skin-relative path, or null if the
  // user cancels. `opts`: { getSkinPath: async () => absSkinPath, filters? }.
  async function pick(opts) {
    const getSkinPath = (opts && opts.getSkinPath) || (async () => '');
    const filters = (opts && opts.filters) || DEFAULT_FILTERS();
    const skPath = (await getSkinPath() || '').replace(/\\/g, '/');
    const result = await api.selectFile(filters, skPath || undefined);
    if (!result || !result.success || !result.data || !result.data.length) return null;
    return toSkinRelative(result.data[0], skPath);
  }

  // Bind a thumbnail element so a click on its <img>/icon starts a pick and
  // calls onPick(relativePath, clickEvent). `opts`:
  //   getSkinPath: async () => absSkinPath   (required — skin root for normalization)
  //   filters?: dialog filter list (defaults to image + all)
  //   onPick(relativePath, e): editor callback (write data, sync, render)
  //   shouldPick?(e): extra gate (default: click target is img/icon)
  function attach(thumbEl, opts) {
    if (!thumbEl || !opts || typeof opts.onPick !== 'function') return;
    const shouldPick = opts.shouldPick || isPickTrigger;
    thumbEl.addEventListener('click', async (e) => {
      if (!shouldPick(e.target)) return;
      const rel = await pick(opts);
      if (rel == null) return;
      opts.onPick(rel, e);
    });
  }

  window.SourcePicker = { attach, pick };
})();
