// Preview image/video/sequence upload — click to pick
(function () {
  let getPreviewMeta, setPreviewMeta, skinNameFn, presetNameFn;
  let isActive = false;
  let dialogOpen = false;
  // A single module-level sequence timer. Using one shared timer (instead of a
  // WeakMap per <img>) guarantees that re-rendering — which replaces the <img> —
  // fully tears down the previous loop.
  let seqTimer = null;
  // View generation: bumped on every render(). Async loads (loadPreview /
  // startSequence) capture the value at start and bail after an await if a newer
  // render happened — so a slow sequence load can never write frames onto an
  // element that now belongs to a different preset (e.g. switched to an image).
  let viewGen = 0;

  function blockUI() {
    if (document.getElementById('dialog-block-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'dialog-block-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:not-allowed;background:transparent';
    document.body.appendChild(overlay);
  }
  function unblockUI() {
    const overlay = document.getElementById('dialog-block-overlay');
    if (overlay) overlay.remove();
  }

  function init(getter, setter, skin, preset) {
    getPreviewMeta = getter;
    setPreviewMeta = setter;
    skinNameFn = typeof skin === 'function' ? skin : () => skin;
    presetNameFn = typeof preset === 'function' ? preset : () => preset;
  }

  function render(container) {
    isActive = true;
    // Stop any running sequence timer from the previous render (the old <img>
    // is about to be replaced; without this its interval keeps firing).
    stopSequence();
    viewGen++;            // invalidate any in-flight sequence load from the prior view
    const meta = getPreviewMeta ? getPreviewMeta() : { path: null, kind: 'image' };

    container.innerHTML = `
      <div style="margin-bottom:8px">
        <h3 style="margin-bottom:2px;font-size:13px">${i18n.t('preview.heading')}</h3>
      </div>
      <div id="preview-content">
        ${renderContent(meta)}
      </div>
    `;

    bindEvents(container);
    if (!container._tabBound) {
      container._tabBound = true;
      container.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && container.contains(document.activeElement)) {
          const uploadZone = container.querySelector('#upload-zone');
          if (document.activeElement === uploadZone) {
            e.preventDefault();
            e.stopPropagation();
            doFileDialog();
          }
        }
      });
    }
    // Load preview asynchronously (image/sequence frames; video uses asset URL).
    loadPreview(meta);
  }

  function renderContent(meta) {
    const path = meta.path;
    if (path) {
      const isSeq = meta.kind === 'sequence';
      // Inline a cached dataURL so the <img> renders synchronously on insert
      // (no flash when switching presets). For sequences, use the first frame.
      const cacheKey = isSeq ? (meta.frames && meta.frames[0]) : path;
      const cachedUrl = (cacheKey && previewCache.has(cacheKey)) ? previewCache.get(cacheKey) : '';
      const mediaHtml = `<img id="preview-img" src="${cachedUrl}" class="upload-zone__preview" alt="${i18n.t('preview.alt')}" style="${cachedUrl ? '' : 'display:none;'}max-height:160px">`;
      const fpsRow = isSeq
        ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${i18n.t('preview.fpsLabel')} ${meta.fps || 12}</div>`
        : '';
      return `
        <div style="text-align:center">
          ${mediaHtml}
          <div id="preview-missing" style="display:none;color:var(--danger);font-size:12px;max-height:160px">${i18n.t('preview.previewMissing')}</div>
          <div style="font-size:11px;color:var(--text-muted);margin:4px 0">${escapeHtml(isSeq ? (meta.frames || []).length + ' frames' : path)}</div>
          ${fpsRow}
          <div style="margin-top:8px">
            <button class="btn btn--secondary btn--sm" id="btn-change-preview">${i18n.t('preview.change')}</button>
            ${isSeq ? `<button type="button" tabindex="0" class="btn btn--secondary btn--sm" id="btn-edit-fps" style="margin-left:8px">${i18n.t('preview.editFps')}</button>` : ''}
            <button class="btn btn--danger btn--sm" id="btn-remove-preview" style="margin-left:8px">${i18n.t('preview.remove')}</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="upload-zone" id="upload-zone" tabindex="0" style="padding:12px">
        <div style="font-size:24px;margin-bottom:4px">🖼</div>
        <div style="font-size:12px">${i18n.t('preview.pick')}</div>
      </div>
    `;
  }

  // Cache of previewPath → data URL (for images/sequence frames).
  const previewCache = new Map();
  function absFor(relPath) {
    // resolved lazily; caller passes skPath
    return null;
  }

  async function loadPreview(meta) {
    if (!meta || !meta.path) return;
    const myGen = viewGen; // bail if a newer render happened during the await below
    const skin = skinNameFn();
    const skPathResult = skin ? await api.getSkinPath(skin) : null;
    if (myGen !== viewGen) return; // superseded — don't write stale preview data
    const skPath = skPathResult && skPathResult.success ? skPathResult.data.replace(/\\/g, '/') : '';
    const abs = skPath ? skPath + '/' + meta.path : meta.path;

    if (meta.kind === 'sequence') {
      startSequence(meta, skPath);
      return;
    }
    // image / animated image
    const img = document.getElementById('preview-img');
    if (img && previewCache.has(meta.path)) {
      img.src = previewCache.get(meta.path);
      img.style.display = '';
      return;
    }
    const result = await api.getPreviewDataUrl(abs);
    if (myGen !== viewGen) return; // superseded — don't overwrite the new preview
    if (img && result.success && result.data) {
      previewCache.set(meta.path, result.data);
      img.src = result.data;
      img.style.display = '';
    } else {
      // File missing — hide the image and show the missing message.
      if (img) img.style.display = 'none';
      const miss = document.getElementById('preview-missing');
      if (miss) miss.style.display = '';
    }
  }

  // Sequence: show the first frame ASAP, then load the rest and start cycling.
  // viewGen (bumped by render()) guards every async boundary: if a newer render
  // happened while frames were loading (e.g. the user switched presets), the
  // stale load bails instead of writing frames onto the wrong element.
  async function startSequence(meta, skPath) {
    stopSequence();              // clear any prior loop (does NOT bump viewGen)
    const myGen = viewGen;
    const frames = meta.frames || [];
    if (!frames.length) return;
    const load1 = (f) => {
      if (previewCache.has(f)) return Promise.resolve(previewCache.get(f));
      const abs = skPath ? skPath + '/' + f : f;
      return api.getPreviewDataUrl(abs).then(r => {
        if (r.success && r.data) { previewCache.set(f, r.data); return r.data; }
        return null;
      });
    };
    // First frame immediately.
    const first = await load1(frames[0]);
    if (myGen !== viewGen || !first) return; // a newer render superseded us
    const img = document.getElementById('preview-img');
    if (!img) return;
    img.src = first;
    img.style.display = '';          // first load: the <img> started hidden (no cached URL)
    const miss = document.getElementById('preview-missing');
    if (miss) miss.style.display = 'none';
    // Remaining frames in parallel; start cycling once loaded.
    Promise.all(frames.slice(1).map(load1)).then(rest => {
      if (myGen !== viewGen) return; // superseded by a newer render / preset switch
      const urls = [first, ...rest.filter(Boolean)];
      if (urls.length < 2) return;
      let idx = 0;
      // Each tick: bail if a newer render happened, else write the next frame
      // onto the live <img>. viewGen stops the loop the moment the user switches
      // away (render() also calls stopSequence() as a backstop).
      const show = () => {
        if (myGen !== viewGen) { stopSequence(); return; }
        const el = document.getElementById('preview-img');
        if (!el) { stopSequence(); return; }
        el.src = urls[idx % urls.length]; idx++;
      };
      const fps = +meta.fps || 12;
      const interval = fps === -1 ? 1000 / urls.length : 1000 / Math.max(1, fps);
      stopSequence();
      seqTimer = setInterval(show, interval);
    });
  }
  function stopSequence() {
    if (seqTimer) { clearInterval(seqTimer); seqTimer = null; }
  }

  function bindEvents(container) {
    const btnUpload = container.querySelector('#upload-zone');
    const btnChange = container.querySelector('#btn-change-preview');
    const btnRemove = container.querySelector('#btn-remove-preview');
    const btnEditFps = container.querySelector('#btn-edit-fps');
    if (btnUpload) btnUpload.addEventListener('click', () => doFileDialog());
    if (btnChange) btnChange.addEventListener('click', () => doFileDialog());
    if (btnRemove) btnRemove.addEventListener('click', doRemove);
    if (btnEditFps) btnEditFps.addEventListener('click', doEditFps);
  }

  async function doEditFps() {
    const meta = getPreviewMeta ? getPreviewMeta() : {};
    const fps = await promptFps(meta.fps || 12);
    if (fps == null) return;
    // Keep the same frames, just update FPS.
    setPreviewMeta({ path: meta.path, kind: 'sequence', frames: meta.frames, fps });
    rerender();
  }

  async function doFileDialog() {
    if (dialogOpen) return;
    const skin = skinNameFn();
    if (!skin) {
      Toast.warning(i18n.t('preview.selectSkinFirst'));
      return;
    }
    dialogOpen = true;
    blockUI();
    const skPathResult = await api.getSkinPath(skin);
    const skPath = skPathResult.success ? skPathResult.data.replace(/\\/g, '/') : '';
    const defaultPath = skPath || '';
    const result = await api.selectFile([
      { name: i18n.t('preview.imageFilter'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'apng', 'bmp'] },
    ], defaultPath);
    dialogOpen = false;
    unblockUI();
    if (!result.success || !result.data || !result.data.length) return;
    const paths = result.data;
    // Resolve to skin-relative (normalize backslashes so the prefix check works
    // on Windows, where the dialog returns backslash paths).
    const toRel = (absPath) => {
      const norm = absPath.replace(/\\/g, '/');
      const sk = skPath.replace(/\\/g, '/');
      if (sk && norm.toLowerCase().startsWith(sk.toLowerCase())) {
        return norm.slice(sk.length).replace(/^[/\\]/, '');
      }
      return '';
    };
    const rels = paths.map(toRel).filter(Boolean);
    if (!rels.length) {
      Toast.warning(i18n.t('preview.outsideSkin'));
      return;
    }

    if (rels.length === 1) {
      setPreviewMeta({ path: rels[0], kind: 'image' });
    } else {
      // Multiple selection → image sequence. Ask for FPS.
      const fps = await promptFps();
      if (fps == null) { // cancelled
        rerender();
        return;
      }
      setPreviewMeta({ path: rels[0], kind: 'sequence', frames: rels, fps });
    }
    rerender();
  }

  // -1 means "play all frames within 1 second" (like osu!'s AnimationFramerate);
  // otherwise the value is a positive FPS.
  function normalizeFps(v) {
    const n = Math.floor(+v || 12);
    return n === -1 ? -1 : Math.max(1, n);
  }

  function promptFps(initial) {
    return new Promise(resolve => {
      if (document.querySelector('.modal-overlay')) { resolve(12); return; }
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="max-width:280px">
          <div class="modal__title">${i18n.t('preview.fpsTitle')}</div>
          <div class="modal__body">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:12px">${i18n.t('preview.fpsLabel')}</span>
              <input type="number" min="-1" step="1" value="${initial || 12}" data-forbidden="0" class="form-input" id="fps-input" style="width:80px">
            </div>
          </div>
          <div class="modal__actions">
            <button class="btn btn--primary" id="fps-ok">${i18n.t('dialog.confirm')}</button>
            <button class="btn btn--secondary" id="fps-cancel">${i18n.t('dialog.cancel')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#fps-input');
      input.focus(); input.select();
      // 0 is invalid (like osu!'s AnimationFramerate): clamp to -1 live.
      input.addEventListener('input', () => {
        const v = parseInt(input.value, 10);
        if (!isNaN(v) && v === 0) { input.value = '-1'; }
      });
      const finish = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(normalizeFps(+input.value || 12)); }
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      };
      overlay.querySelector('#fps-ok').addEventListener('click', () => finish(normalizeFps(+input.value || 12)));
      overlay.querySelector('#fps-cancel').addEventListener('click', () => finish(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
      document.addEventListener('keydown', onKey);
    });
  }

  function rerender() {
    // Stop any running sequence timer before re-rendering.
    stopSequence();
    const container = document.getElementById('preview-content');
    if (container) {
      const parent = container.parentElement;
      if (parent) render(parent);
    }
  }

  function doRemove() {
    stopSequence();
    const meta = getPreviewMeta ? getPreviewMeta() : {};
    if (meta.path && previewCache.has(meta.path)) previewCache.delete(meta.path);
    setPreviewMeta({ path: null, kind: 'image' });
    rerender();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function setActive(active) {
    isActive = active;
    if (!active) {
      stopSequence();
    }
  }

  window.PreviewUpload = { init, render, setActive, invalidateCache: () => previewCache.clear() };
})();
