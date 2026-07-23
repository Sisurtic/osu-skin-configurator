// Source picker — opens the file dialog and returns skin-relative paths for
// re-sourcing operation rows. Each editor binds its own thumbnail click handler
// (img/icon only) and calls SourcePicker.pickMulti; the component owns the
// dialog + path normalization (absolute skin path → skin-relative).
//
// Vanilla JS, no modules. window.SourcePicker = { pickMulti }.
(function () {
  // Default image filter for the open-file dialog.
  const DEFAULT_FILTERS = () => [
    { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'apng', 'bmp'] },
    { name: 'All', extensions: ['*'] },
  ];

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

  // Open the file dialog (multi-select) and resolve to ALL chosen paths
  // (skin-relative), or [] on cancel. `opts`:
  //   getSkinPath: async () => absSkinPath   (skin root for normalization)
  //   filters?: dialog filter list (defaults to image + all)
  //   currentSource?: skin-relative path — its directory becomes the dialog's
  //     initial folder (falls back to the skin root).
  async function pickMulti(opts) {
    const getSkinPath = (opts && opts.getSkinPath) || (async () => '');
    const filters = (opts && opts.filters) || DEFAULT_FILTERS();
    const skPath = (await getSkinPath() || '').replace(/\\/g, '/');
    let defaultPath = skPath || undefined;
    const cur = opts && opts.currentSource;
    if (cur && skPath) {
      const abs = cur.replace(/\\/g, '/');
      const isAbs = /^[a-zA-Z]:[\\/]/.test(abs) || abs.startsWith('/');
      const full = isAbs ? abs : (skPath.replace(/\/$/, '') + '/' + abs);
      const lastSep = Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'));
      const dir = lastSep > 0 ? full.substring(0, lastSep) : full;
      defaultPath = dir;
    }
    const result = await api.selectFile(filters, defaultPath);
    if (!result || !result.success || !result.data || !result.data.length) return [];
    return result.data.map(p => toSkinRelative(p, skPath)).filter(Boolean);
  }

  window.SourcePicker = { pickMulti };
})();
