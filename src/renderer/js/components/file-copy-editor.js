// File operations editor — copy & delete (unified table)
(function () {
  let getCopies, setCopies, getDeletes, setDeletes, skinName, presetName, skinPath;

  // Multi-select state (unified)
  let selectedIndices = new Set();
  let lastClickedIndex = null;
  let fileDialogOpen = false;

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

  function init(copiesGetter, copiesSetter, deletesGetter, deletesSetter, skin, preset, skPath) {
    getCopies = copiesGetter;
    setCopies = copiesSetter;
    getDeletes = deletesGetter;
    setDeletes = deletesSetter;
    skinName = typeof skin === 'function' ? skin : () => skin;
    presetName = typeof preset === 'function' ? preset : () => preset;
    skinPath = typeof skPath === 'function' ? skPath : () => skPath || null;
  }

  // ── Unified view-model helpers ──

  function buildFileOps() {
    const copies = getCopies ? getCopies() : [];
    const deletes = getDeletes ? getDeletes() : [];
    return [
      ...copies.map(c => ({ _type: 'copy', source: c.source, destination: c.destination })),
      ...deletes.map(d => ({ _type: 'delete', path: d.path })),
    ];
  }

  function applyFileOps(fileOps) {
    const copies = fileOps
      .filter(op => op._type === 'copy')
      .map(op => ({ source: op.source, destination: op.destination }));
    const deletes = fileOps
      .filter(op => op._type === 'delete')
      .map(op => ({ path: op.path }));
    setCopies(copies);
    setDeletes(deletes);
  }

  function render(container) {
    const fileOps = buildFileOps();

    // Reset selection
    selectedIndices = new Set();
    lastClickedIndex = null;

    container.innerHTML = `
      <div class="editor-sticky-header">
        <div style="padding-bottom:10px;border-bottom:1px solid var(--border)">
          <div style="margin-bottom:8px">
            <h3 style="margin-bottom:4px">文件操作</h3>
            <p style="font-size:12px;color:var(--text-muted)">选择替换文件并设定目标路径（在皮肤文件夹内），或标记要删除的文件</p>
          </div>

          <!-- Add buttons -->
          <div style="display:flex;gap:0;margin-bottom:8px">
            <div style="width:110px;flex-shrink:0;display:flex;gap:4px;padding-right:8px">
              <button class="btn btn--primary btn--sm" id="btn-add-file" style="font-size:11px;padding:4px 6px">＋ 复制</button>
              <button class="btn btn--danger btn--sm" id="btn-add-delete" style="font-size:11px;padding:4px 6px">＋ 删除</button>
            </div>
            <div style="flex:1;min-width:0"></div>
            <div style="flex:1;min-width:0"></div>
          </div>

          <!-- Delete drop zone -->
          <div class="editor-delete-zone" id="file-delete-zone"
               style="padding:8px;border:2px dashed var(--danger);border-radius:var(--radius);text-align:center;color:var(--danger);font-size:12px;opacity:0.5;transition:all 0.2s">
            拖拽操作到此处删除
          </div>
        </div>

        <!-- Fixed header table (thead only) — only show when there are operations -->
        ${fileOps.length > 0 ? `
        <div class="files-header-table" style="margin-top:6px">
          <div class="table-wrap">
            <table class="table">
              <colgroup>
                <col style="width:110px">
                <col style="min-width:200px">
                <col style="min-width:200px">
              </colgroup>
              <thead><tr><th>操作</th><th>文件</th><th>目标路径</th></tr></thead>
            </table>
          </div>
        </div>
        ` : ''}
      </div>

      <div class="files-table-body-scroll" id="files-table-body-scroll">
        ${renderFilesTableBody(fileOps)}
      </div>
    `;

    // Add copy file button
    const btnAddFile = container.querySelector('#btn-add-file');
    if (btnAddFile) btnAddFile.addEventListener('click', async () => {
      if (!skinName()) { Toast.warning('请先选择皮肤'); return; }
      if (fileDialogOpen) return;
      try {
        fileDialogOpen = true;
        blockUI();
        const defaultPath = await skinPath() || '';
        const result = await api.selectFile([
          { name: '所有文件', extensions: ['*'] }
        ], defaultPath);
        if (!result.success || !result.data || !result.data.length) return;

        const filePaths = result.data;
        const copies = getCopies ? [...getCopies()] : [];
        for (const filePath of filePaths) {
          copies.push({ source: filePath, destination: '' });
        }
        setCopies(copies);
        render(container);
      } finally {
        fileDialogOpen = false;
        unblockUI();
      }
    });

    // Add delete file button
    const btnAddDelete = container.querySelector('#btn-add-delete');
    if (btnAddDelete) btnAddDelete.addEventListener('click', async () => {
      if (!skinName()) { Toast.warning('请先选择皮肤'); return; }
      if (fileDialogOpen) return;
      try {
        fileDialogOpen = true;
        blockUI();
        const defaultPath = await skinPath() || '';
        const result = await api.selectFile([
          { name: '所有文件', extensions: ['*'] }
        ], defaultPath);
        if (!result.success || !result.data || !result.data.length) return;

        const filePaths = result.data;
        const skPath = await skinPath();
        const deletes = getDeletes ? [...getDeletes()] : [];
        for (const filePath of filePaths) {
          let relPath = filePath;
          if (skPath && filePath.toLowerCase().startsWith(skPath.toLowerCase())) {
            relPath = filePath.slice(skPath.length).replace(/^[/\\]/, '');
          } else {
            relPath = filePath.split(/[/\\]/).pop();
          }
          deletes.push({ path: relPath });
        }
        setDeletes(deletes);
        render(container);
      } finally {
        fileDialogOpen = false;
        unblockUI();
      }
    });

    // ── Bind row selection (unified) ──
    container.querySelectorAll('.file-op-row').forEach(row => {
      bindRowSelection(row, fileOps);
    });

    // Destination change handlers
    container.querySelectorAll('.copy-dest-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        const ops = buildFileOps();
        if (idx >= 0 && idx < ops.length && ops[idx]._type === 'copy') {
          ops[idx].destination = input.value;
          applyFileOps(ops);
        }
      });
    });

    // ── Tab cycling + container keyboard handling ──
    if (!container._ctrlABound) {
      container._ctrlABound = true;
      container.addEventListener('keydown', (e) => {
        // Tab: cycle focus among all focusable elements within the tab content
        if (e.key === 'Tab' && container.contains(document.activeElement)) {
          const focusable = container.querySelectorAll(
            'input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          const visible = Array.from(focusable).filter(el => el.offsetParent !== null);
          if (visible.length === 0) return;
          e.preventDefault();
          const cur = visible.indexOf(document.activeElement);
          const next = e.shiftKey
            ? (cur <= 0 ? visible.length - 1 : cur - 1)
            : (cur >= visible.length - 1 ? 0 : cur + 1);
          visible[next].focus();
        }
      });
    }

    // ── Load thumbnails for image files ──
    loadThumbnails();

    // ── Delete zone drop handler ──
    const deleteZone = container.querySelector('#file-delete-zone');
    if (deleteZone) {
      deleteZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        deleteZone.style.opacity = '1';
        deleteZone.style.background = 'rgba(224,85,85,0.1)';
      });
      deleteZone.addEventListener('dragleave', () => {
        deleteZone.style.opacity = '0.5';
        deleteZone.style.background = '';
      });
      deleteZone.addEventListener('drop', (e) => {
        e.preventDefault();
        deleteZone.style.opacity = '0.5';
        deleteZone.style.background = '';
        const raw = e.dataTransfer.getData('application/file-indices');
        if (!raw) return;
        try {
          const indices = JSON.parse(raw).sort((a, b) => b - a);
          const ops = buildFileOps();
          for (const i of indices) ops.splice(i, 1);
          applyFileOps(ops);
          Toast.info(`已删除 ${indices.length} 个文件操作`);
          render(container);
        } catch (_) { /* ignore malformed data */ }
      });
    }
  }

  function bindRowSelection(row, fileOps) {
    row.addEventListener('click', (e) => {
      if (e.target.closest('input, button')) return;
      const idx = parseInt(row.dataset.idx);
      if (isNaN(idx)) return;

      if (e.ctrlKey || e.metaKey) {
        if (selectedIndices.has(idx)) selectedIndices.delete(idx);
        else selectedIndices.add(idx);
        lastClickedIndex = idx;
      } else if (e.shiftKey && lastClickedIndex !== null) {
        const start = Math.min(lastClickedIndex, idx);
        const end = Math.max(lastClickedIndex, idx);
        if (!e.ctrlKey && !e.metaKey) selectedIndices.clear();
        for (let i = start; i <= end; i++) selectedIndices.add(i);
      } else {
        selectedIndices.clear();
        selectedIndices.add(idx);
        lastClickedIndex = idx;
      }
      updateAllHighlights();
    });

    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', (e) => {
      // Block drag while actively editing a value input in this row
      const activeEl = document.activeElement;
      if (activeEl && row.contains(activeEl) && activeEl.closest('input, select, textarea, button')) {
        e.preventDefault();
        return;
      }
      const idx = parseInt(row.dataset.idx);

      if (!selectedIndices.has(idx)) {
        selectedIndices.clear();
        selectedIndices.add(idx);
        lastClickedIndex = idx;
        updateAllHighlights();
      }

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/file-indices', JSON.stringify([...selectedIndices]));
      // Visual feedback
      document.querySelectorAll('.file-op-row').forEach(r => {
        const ri = parseInt(r.dataset.idx);
        if (selectedIndices.has(ri)) r.classList.add('row--dragging');
      });
    });

    row.addEventListener('dragend', () => {
      document.querySelectorAll('.file-op-row').forEach(r => r.classList.remove('row--dragging'));
    });
  }

  function updateAllHighlights() {
    document.querySelectorAll('.file-op-row').forEach(row => {
      const idx = parseInt(row.dataset.idx);
      row.classList.toggle('row--selected', selectedIndices.has(idx));
    });
  }

  function renderFilesTableBody(fileOps) {
    if (fileOps.length === 0) {
      return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">暂无文件操作，请从上方添加</div>`;
    }
    return `
      <div class="files-body-table">
        <div class="table-wrap">
          <table class="table">
            <colgroup>
              <col style="width:110px">
              <col style="min-width:200px">
              <col style="min-width:200px">
            </colgroup>
            <tbody>
            ${fileOps.map((op, i) => {
              if (op._type === 'copy') {
                return `<tr class="file-op-row" data-idx="${i}" data-type="copy">
                  <td><span class="tag tag--accent">复制</span></td>
                  <td><span class="file-thumb" data-path="${escapeHtml(op.source)}" style="display:inline-flex;align-items:center;gap:6px">📄 ${escapeHtml(pathBasename(op.source))}</span></td>
                  <td><input type="text" class="form-input copy-dest-input" data-idx="${i}" value="${escapeHtml(op.destination)}" placeholder="如: mania/ （留空为根目录）"></td>
                </tr>`;
              } else {
                return `<tr class="file-op-row file-delete-row" data-idx="${i}" data-type="delete" data-delpath="${escapeHtml(op.path)}">
                  <td><span class="tag tag--danger">删除</span></td>
                  <td><span class="file-thumb file-del-thumb" data-path="${escapeHtml(op.path)}" style="display:inline-flex;align-items:center;gap:6px">${escapeHtml(op.path)}</span></td>
                  <td style="color:var(--danger);font-size:12px">— 移除
                   —</td>
                </tr>`;
              }
            }).join('')}
          </tbody>
        </table>
      </div>
      </div>
    `;
  }

  const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);

  function pathBasename(p) {
    return p.split(/[/\\]/).pop() || p;
  }

  function isImagePath(p) {
    const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
    return IMG_EXTS.has(ext);
  }

  async function loadThumbnails() {
    const skPath = await skinPath() || '';
    const thumbs = document.querySelectorAll('.file-thumb[data-path]');
    for (const span of thumbs) {
      let p = span.dataset.path;
      // Delete items have relative paths, resolve with skin path
      if (span.classList.contains('file-del-thumb') && skPath) {
        const isAbs = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');
        if (!isAbs) {
          p = skPath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + p.replace(/\\/g, '/');
        }
      }
      if (!isImagePath(p)) continue;
      try {
        const result = await api.getPreviewDataUrl(p);
        if (result.success && result.data) {
          const label = span.classList.contains('file-del-thumb') ? span.dataset.path : pathBasename(span.dataset.path);
          span.innerHTML = `<img src="${result.data}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);flex-shrink:0"> ${escapeHtml(label)}`;
        }
      } catch (_) { /* skip failed thumbnails */ }
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ── Del key: delete selected file operation rows with confirmation ──
  async function deleteSelected() {
    if (selectedIndices.size === 0) return;

    const confirmed = await ApplyDialog.showConfirmDialog(
      `确定要删除选中的 ${selectedIndices.size} 个文件操作吗？`,
      [
        { label: `删除 (${selectedIndices.size})`, cls: 'btn--danger', value: 'delete' },
        { label: '取消', cls: 'btn--secondary', value: 'cancel' },
      ]
    );
    if (!confirmed || confirmed !== 'delete') return;

    const fileOps = buildFileOps();
    const sorted = [...selectedIndices].sort((a, b) => b - a);
    for (const i of sorted) fileOps.splice(i, 1);
    applyFileOps(fileOps);
    selectedIndices.clear();
    lastClickedIndex = null;
    Toast.info(`已删除 ${sorted.length} 个文件操作`);
    // Re-render current container
    const container = document.getElementById('tab-files');
    if (container && container.classList.contains('tab-content--active')) {
      render(container);
    }
  }

  window.FileCopyEditor = { init, render, deleteSelected };
})();
