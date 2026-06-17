// Apply confirmation dialog — shows summary then applies
(function () {
  function show() {
    if (document.querySelector('.modal-overlay')) return;
    const data = window.PresetEditor?.getCurrentEditData?.() || {};
    const meta = data.meta || {};
    const actions = data.actions || { skinIni: [], fileCopies: [], fileDeletes: [] };
    const iniCount = actions.skinIni?.length || 0;
    const copyCount = actions.fileCopies?.length || 0;
    const deleteCount = actions.fileDeletes?.length || 0;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'apply-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__title">确认应用预设</div>
        <div class="modal__body">
          <p style="margin-bottom:8px">将应用预设 <strong>"${escapeHtml(meta.name || '未命名')}"</strong>：</p>
          <ul style="padding-left:20px;line-height:1.8">
            ${iniCount > 0 ? `<li>修改 skin.ini 中 <strong>${iniCount}</strong> 个设置项</li>` : ''}
            ${copyCount > 0 ? `<li>复制 <strong>${copyCount}</strong> 个文件到皮肤目录</li>` : ''}
            ${deleteCount > 0 ? `<li>删除皮肤中 <strong>${deleteCount}</strong> 个文件</li>` : ''}
          </ul>
          ${iniCount === 0 && copyCount === 0 && deleteCount === 0 ? '<p style="color:var(--warning);margin-top:8px">⚠ 此预设没有任何操作</p>' : ''}
        </div>
        <div class="modal__actions">
          <button class="btn btn--primary" id="apply-confirm">确认应用</button>
          <button class="btn btn--secondary" id="apply-cancel">取消</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#apply-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#apply-confirm').addEventListener('click', async () => {
      const btn = overlay.querySelector('#apply-confirm');
      btn.textContent = '正在应用…';
      btn.disabled = true;

      const skin = state.get('selectedSkin');
      const preset = state.get('selectedPreset');

      if (!skin || !preset || preset === '__new__') {
        Toast.error('未选择皮肤或预设');
        close();
        return;
      }

      const result = await api.applyPreset(skin, preset);
      close();

      if (result.success) {
        const d = result.data;
        state.set('activePresets', {});
        Toast.success(`预设已应用! 修改 ${d.skinIniChanges || 0} 个设置，复制 ${d.filesCopied || 0} 个文件`);
      } else {
        Toast.error('应用失败: ' + (result.error || '未知错误'));
      }
    });
  }

  function close() {
    const overlay = document.getElementById('apply-modal');
    if (overlay) overlay.remove();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /**
   * Show multi-preset apply dialog from use mode.
   * @param {number[]} presetIds - selected preset ids to apply
   */
  async function showMulti(presetIds) {
    if (document.querySelector('.modal-overlay')) return;
    const skin = state.get('selectedSkin');
    if (!skin || !presetIds || presetIds.length === 0) {
      Toast.error('未选择皮肤或预设');
      return;
    }

    // Load all selected presets
    const presetDataList = [];
    for (const id of presetIds) {
      const result = await api.loadPreset(skin, id);
      if (result.success && result.data) {
        presetDataList.push({
          id,
          meta: result.data.meta || {},
          actions: result.data.actions || { skinIni: [], fileCopies: [], fileDeletes: [] },
        });
      }
    }

    if (presetDataList.length === 0) {
      Toast.error('无法加载预设数据');
      return;
    }

    // Combine actions
    let totalIni = 0, totalCopy = 0, totalDelete = 0;
    const presetSummaries = [];
    for (const pd of presetDataList) {
      const iniCount = pd.actions.skinIni?.length || 0;
      const copyCount = pd.actions.fileCopies?.length || 0;
      const deleteCount = pd.actions.fileDeletes?.length || 0;
      totalIni += iniCount;
      totalCopy += copyCount;
      totalDelete += deleteCount;
      presetSummaries.push({ name: pd.meta.name || ('预设 ' + pd.id), iniCount, copyCount, deleteCount });
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'apply-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__title">确认应用预设</div>
        <div class="modal__body">
          <p style="margin-bottom:8px">将应用 <strong>${presetDataList.length}</strong> 个预设到皮肤 <strong>"${escapeHtml(skin)}"</strong>：</p>
          ${presetSummaries.map(ps => `
            <div style="margin-bottom:6px;padding:8px;background:var(--bg-muted);border-radius:var(--radius)">
              <strong>${escapeHtml(ps.name)}</strong>
              <span style="font-size:12px;color:var(--text-muted);margin-left:8px">
                ${ps.iniCount > 0 ? `INI×${ps.iniCount} ` : ''}
                ${ps.copyCount > 0 ? `复制×${ps.copyCount} ` : ''}
                ${ps.deleteCount > 0 ? `删除×${ps.deleteCount} ` : ''}
                ${ps.iniCount === 0 && ps.copyCount === 0 && ps.deleteCount === 0 ? '无操作' : ''}
              </span>
            </div>
          `).join('')}
          <ul style="padding-left:20px;line-height:1.8;margin-top:8px">
            ${totalIni > 0 ? `<li>合计修改 skin.ini 中 <strong>${totalIni}</strong> 个设置项</li>` : ''}
            ${totalCopy > 0 ? `<li>合计复制 <strong>${totalCopy}</strong> 个文件到皮肤目录</li>` : ''}
            ${totalDelete > 0 ? `<li>合计删除皮肤中 <strong>${totalDelete}</strong> 个文件</li>` : ''}
          </ul>
          ${totalIni === 0 && totalCopy === 0 && totalDelete === 0 ? '<p style="color:var(--warning);margin-top:8px">⚠ 所选预设没有任何操作</p>' : ''}
          <p style="font-size:11px;color:var(--text-muted);margin-top:8px">⚠ 相同 INI 字段的修改以后应用的预设为准</p>
        </div>
        <div class="modal__actions">
          <button class="btn btn--primary" id="apply-confirm">确认应用</button>
          <button class="btn btn--secondary" id="apply-cancel">取消</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#apply-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#apply-confirm').addEventListener('click', async () => {
      const btn = overlay.querySelector('#apply-confirm');
      btn.textContent = '正在应用…';
      btn.disabled = true;

      const result = await api.applyMultiplePresets(skin, presetIds);
      close();

      if (result.success) {
        const d = result.data;
        state.set('activePresets', {});
        Toast.success(`预设已应用! 修改 ${d.skinIniChanges || 0} 个设置，复制 ${d.filesCopied || 0} 个文件，删除 ${d.filesDeleted || 0} 个文件`);
      } else {
        Toast.error('应用失败: ' + (result.error || '未知错误'));
      }
    });
  }

  /**
   * Show a styled confirm dialog with customizable buttons.
   */
  function showConfirmDialog(message, options) {
    return new Promise((resolve) => {
      if (document.querySelector('.modal-overlay')) return resolve(null);
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'confirm-dialog';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal__title">确认</div>
          <div class="modal__body">
            <p style="white-space:pre-line">${message}</p>
          </div>
          <div class="modal__actions">
            ${options.map(opt =>
              `<button class="btn ${opt.cls || 'btn--secondary'} btn--sm" data-value="${opt.value}">${escapeHtml(opt.label)}</button>`
            ).join('')}
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      overlay.querySelectorAll('.modal__actions button').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.remove();
          resolve(btn.dataset.value);
        });
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(null);
        }
      });

      const onKey = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', onKey);
          overlay.remove();
          resolve(null);
        }
        if (e.key === 'Enter') {
          document.removeEventListener('keydown', onKey);
          overlay.remove();
          resolve(options[0].value);
        }
      };
      document.addEventListener('keydown', onKey);
    });
  }

  window.ApplyDialog = { show, showMulti, showConfirmDialog };
})();
