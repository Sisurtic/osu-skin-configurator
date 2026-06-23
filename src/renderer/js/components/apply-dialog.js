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
        <div class="modal__title">${i18n.t('apply.confirmTitle')}</div>
        <div class="modal__body">
          <p style="margin-bottom:8px">${i18n.t('apply.willApplySingle', { name: escapeHtml(meta.name || i18n.t('apply.unnamed')) })}</p>
          <ul style="padding-left:20px;line-height:1.8">
            ${iniCount > 0 ? `<li>${i18n.t('apply.iniCount', { n: `<strong>${iniCount}</strong>` })}</li>` : ''}
            ${copyCount > 0 ? `<li>${i18n.t('apply.copyCount', { n: `<strong>${copyCount}</strong>` })}</li>` : ''}
            ${deleteCount > 0 ? `<li>${i18n.t('apply.deleteCount', { n: `<strong>${deleteCount}</strong>` })}</li>` : ''}
          </ul>
          ${iniCount === 0 && copyCount === 0 && deleteCount === 0 ? `<p style="color:var(--warning);margin-top:8px">${i18n.t('apply.noActions')}</p>` : ''}
        </div>
        <div class="modal__actions">
          <button class="btn btn--primary" id="apply-confirm">${i18n.t('apply.confirmApply')}</button>
          <button class="btn btn--secondary" id="apply-cancel">${i18n.t('dialog.cancel')}</button>
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
      btn.textContent = i18n.t('apply.applying');
      btn.disabled = true;

      const skin = state.get('selectedSkin');
      const preset = state.get('selectedPreset');

      if (!skin || !preset || preset === '__new__') {
        Toast.error(i18n.t('apply.noSkinOrPreset'));
        close();
        return;
      }

      const result = await api.applyPreset(skin, preset);
      close();

      if (result.success) {
        const d = result.data;
        state.set('activePresets', {});
        Toast.success(i18n.t('apply.appliedSingle', { ini: d.skinIniChanges || 0, copy: d.filesCopied || 0 }));
      } else {
        Toast.error(i18n.t('apply.applyFailed', { msg: result.error || i18n.t('app.unknownError') }));
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
      Toast.error(i18n.t('apply.noSkinOrPreset'));
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
      Toast.error(i18n.t('apply.loadPresetFailed'));
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
      presetSummaries.push({ name: pd.meta.name || i18n.t('preset.fallbackName', { id: pd.id }), iniCount, copyCount, deleteCount });
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'apply-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__title">${i18n.t('apply.confirmTitle')}</div>
        <div class="modal__body">
          <p style="margin-bottom:8px">${i18n.t('apply.willApplyMulti', { count: presetDataList.length, name: escapeHtml(skin) })}</p>
          ${presetSummaries.map(ps => `
            <div style="margin-bottom:6px;padding:8px;background:var(--bg-muted);border-radius:var(--radius)">
              <strong>${escapeHtml(ps.name)}</strong>
              <span style="font-size:12px;color:var(--text-muted);margin-left:8px">
                ${ps.iniCount > 0 ? `INI×${ps.iniCount} ` : ''}
                ${ps.copyCount > 0 ? i18n.t('apply.fragmentCopy', { n: ps.copyCount }) + ' ' : ''}
                ${ps.deleteCount > 0 ? i18n.t('apply.fragmentDelete', { n: ps.deleteCount }) + ' ' : ''}
                ${ps.iniCount === 0 && ps.copyCount === 0 && ps.deleteCount === 0 ? i18n.t('apply.fragmentNone') : ''}
              </span>
            </div>
          `).join('')}
          <ul style="padding-left:20px;line-height:1.8;margin-top:8px">
            ${totalIni > 0 ? `<li>${i18n.t('apply.totalIni', { n: `<strong>${totalIni}</strong>` })}</li>` : ''}
            ${totalCopy > 0 ? `<li>${i18n.t('apply.totalCopy', { n: `<strong>${totalCopy}</strong>` })}</li>` : ''}
            ${totalDelete > 0 ? `<li>${i18n.t('apply.totalDelete', { n: `<strong>${totalDelete}</strong>` })}</li>` : ''}
          </ul>
          ${totalIni === 0 && totalCopy === 0 && totalDelete === 0 ? `<p style="color:var(--warning);margin-top:8px">${i18n.t('apply.noActionsMulti')}</p>` : ''}
          <p style="font-size:11px;color:var(--text-muted);margin-top:8px">${i18n.t('apply.dedupHint')}</p>
        </div>
        <div class="modal__actions">
          <button class="btn btn--primary" id="apply-confirm">${i18n.t('apply.confirmApply')}</button>
          <button class="btn btn--secondary" id="apply-cancel">${i18n.t('dialog.cancel')}</button>
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
      btn.textContent = i18n.t('apply.applying');
      btn.disabled = true;

      const result = await api.applyMultiplePresets(skin, presetIds);
      close();

      if (result.success) {
        const d = result.data;
        state.set('activePresets', {});
        Toast.success(i18n.t('apply.appliedMulti', { ini: d.skinIniChanges || 0, copy: d.filesCopied || 0, del: d.filesDeleted || 0 }));
      } else {
        Toast.error(i18n.t('apply.applyFailed', { msg: result.error || i18n.t('app.unknownError') }));
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
          <div class="modal__title">${i18n.t('dialog.confirm')}</div>
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
