// Preview image upload — click / drag-drop / clipboard paste
(function () {
  let getPreset, setPreviewDataUrl, skinNameFn, presetNameFn;
  let isActive = false;
  let dialogOpen = false;

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
    getPreset = getter;
    setPreviewDataUrl = setter;
    skinNameFn = typeof skin === 'function' ? skin : () => skin;
    presetNameFn = typeof preset === 'function' ? preset : () => preset;
  }

  function render(container) {
    isActive = true;
    const meta = getPreset ? getPreset() : {};
    const previewPath = meta._previewPath || meta.meta?.previewPath;

    container.innerHTML = `
      <div style="margin-bottom:8px">
        <h3 style="margin-bottom:2px;font-size:13px">${i18n.t('preview.heading')}</h3>
      </div>
      <div id="preview-content">
        ${renderContent(previewPath)}
      </div>
    `;

    bindEvents(container);
    // Keyboard handling for preview tab: Tab cycling + Space/Enter activation
    if (!container._tabBound) {
      container._tabBound = true;
      container.addEventListener('keydown', (e) => {
        // Space/Enter: activate upload zone (has tabindex, can be Tab-focused)
        if ((e.key === ' ' || e.key === 'Enter') && container.contains(document.activeElement)) {
          const activeEl = document.activeElement;
          const uploadZone = container.querySelector('#upload-zone');
          if (activeEl === uploadZone) {
            e.preventDefault();
            e.stopPropagation();
            doFileDialog();
            return;
          }
        }
        // Tab cycling is handled by the parent (preset-editor basic tab).
      });
    }
    // Load preview asynchronously
    if (previewPath) loadPreviewImage(previewPath);
  }

  function renderContent(previewPath) {
    if (previewPath) {
      return `
        <div style="text-align:center">
          <img id="preview-img" src="" class="upload-zone__preview" alt="${i18n.t('preview.alt')}" style="display:none;max-height:160px">
          <div style="font-size:11px;color:var(--text-muted);margin:4px 0">${escapeHtml(previewPath)}</div>
          <div style="margin-top:8px">
            <button class="btn btn--secondary btn--sm" id="btn-change-preview">${i18n.t('preview.change')}</button>
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

  // Cache of previewPath → data URL, so re-renders (e.g. on save) don't flash
  // the image blank while re-fetching.
  const previewCache = new Map();

  async function loadPreviewImage(imagePath) {
    if (!imagePath) return;
    const img = document.getElementById('preview-img');
    // Synchronous restore from cache to avoid a flash.
    if (img && previewCache.has(imagePath)) {
      img.src = previewCache.get(imagePath);
      img.style.display = '';
      return;
    }
    const result = await api.getPreviewDataUrl(imagePath);
    if (img && result.success && result.data) {
      previewCache.set(imagePath, result.data);
      img.src = result.data;
      img.style.display = '';
    }
  }

  function bindEvents(container) {
    const btnUpload = container.querySelector('#upload-zone');
    const btnChange = container.querySelector('#btn-change-preview');
    const btnRemove = container.querySelector('#btn-remove-preview');

    if (btnUpload) btnUpload.addEventListener('click', () => doFileDialog());
    if (btnChange) btnChange.addEventListener('click', () => doFileDialog());
    if (btnRemove) btnRemove.addEventListener('click', doRemove);
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
    const defaultPath = skPathResult.success ? skPathResult.data : '';
    const result = await api.selectFile([
      { name: i18n.t('preview.imageFilter'), extensions: ['png', 'jpg', 'jpeg', 'gif'] }
    ], defaultPath);
    dialogOpen = false;
    unblockUI();
    if (!result.success || !result.data || !result.data.length) return;
    const imagePath = result.data[0];
    setPreviewDataUrl(imagePath);
    Toast.info(i18n.t('preview.setToast'));
    const container = document.getElementById('preview-content');
    if (container) {
      const parent = container.parentElement;
      if (parent) render(parent);
    }
  }

  function doRemove() {
    // Clear cached preview for the old path so re-adding the same image
    // re-fetches instead of showing stale data.
    const meta = getPreset ? getPreset() : {};
    const oldPath = meta._previewPath || meta.meta?.previewPath;
    if (oldPath && previewCache.has(oldPath)) previewCache.delete(oldPath);
    setPreviewDataUrl(null);
    Toast.info(i18n.t('preview.removedToast'));
    const container = document.getElementById('preview-content');
    if (container) {
      const parent = container.parentElement;
      if (parent) render(parent);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Reset isActive when navigating away (called by preset-editor tab switching)
  function setActive(active) {
    isActive = active;
  }

  window.PreviewUpload = { init, render, setActive };
})();
