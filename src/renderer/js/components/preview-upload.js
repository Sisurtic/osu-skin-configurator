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
      <div style="margin-bottom:16px">
        <h3 style="margin-bottom:4px">预览图片</h3>
        <p style="font-size:12px;color:var(--text-muted)">从当前皮肤目录选择预览图片</p>
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

        if (e.key !== 'Tab') return;
        const btns = [...container.querySelectorAll('#upload-zone, #btn-change-preview, #btn-remove-preview')]
          .filter(el => el && el.offsetParent !== null);
        if (btns.length === 0) return;
        const activeEl = document.activeElement;
        // Include if active element is one of these or inside the container
        const idx = btns.indexOf(activeEl);
        if (idx < 0 && !container.contains(activeEl)) return;
        e.preventDefault();
        const next = e.shiftKey
          ? (idx <= 0 ? btns.length - 1 : idx - 1)
          : (idx >= btns.length - 1 || idx < 0 ? 0 : idx + 1);
        btns[next].focus();
      });
    }
    // Load preview asynchronously
    if (previewPath) loadPreviewImage(previewPath);
  }

  function renderContent(previewPath) {
    if (previewPath) {
      return `
        <div style="text-align:center">
          <img id="preview-img" src="" class="upload-zone__preview" alt="预览图" style="display:none">
          <div style="font-size:12px;color:var(--text-muted);margin:8px 0">${escapeHtml(previewPath)}</div>
          <div style="margin-top:12px">
            <button class="btn btn--secondary btn--sm" id="btn-change-preview">🖼 更换图片</button>
            <button class="btn btn--danger btn--sm" id="btn-remove-preview" style="margin-left:8px">✕ 移除</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="upload-zone" id="upload-zone" tabindex="0">
        <div style="font-size:36px;margin-bottom:8px">🖼</div>
        <div>点击选择图片</div>
        <div style="font-size:11px;margin-top:4px">将从皮肤文件夹中选择图片</div>
      </div>
    `;
  }

  async function loadPreviewImage(imagePath) {
    if (!imagePath) return;
    const result = await api.getPreviewDataUrl(imagePath);
    const img = document.getElementById('preview-img');
    if (img && result.success && result.data) {
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
      Toast.warning('请先选择皮肤');
      return;
    }
    dialogOpen = true;
    blockUI();
    const skPathResult = await api.getSkinPath(skin);
    const defaultPath = skPathResult.success ? skPathResult.data : '';
    const result = await api.selectFile([
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif'] }
    ], defaultPath);
    dialogOpen = false;
    unblockUI();
    if (!result.success || !result.data || !result.data.length) return;
    const imagePath = result.data[0];
    setPreviewDataUrl(imagePath);
    Toast.info('预览图已设置');
    const container = document.getElementById('preview-content');
    if (container) {
      const parent = container.parentElement;
      if (parent) render(parent);
    }
  }

  function doRemove() {
    setPreviewDataUrl(null);
    Toast.info('预览图已移除');
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
