// Apply confirmation dialog — shows summary then applies
(function () {
  // Compact three-label summary, e.g. "INI 编辑×3, 文件移动×1, 图像编辑×2".
  // Used by both the per-preset cards and the success toast so they match.
  function summaryText(ini, file, tint) {
    const parts = [];
    if (ini > 0) parts.push(`${i18n.t('apply.groupIni')}×${ini}`);
    if (file > 0) parts.push(`${i18n.t('apply.groupFile')}×${file}`);
    if (tint > 0) parts.push(`${i18n.t('apply.groupTint')}×${tint}`);
    return parts.join(', ');
  }
  // A group block: a title bar with up to two counts laid out side by side
  // beneath it. Each count shows "<label> ×<n>". Only rendered if it has at
  // least one non-zero count.
  function group(title, items) {
    const cells = items.filter(it => it.show).map(it =>
      `<span style="flex:1;min-width:0">${i18n.t(it.key)} <strong>×${it.n}</strong></span>`).join('');
    if (!cells) return '';
    return `<div style="margin-bottom:8px"><div style="font-weight:600;margin-bottom:4px;padding-bottom:2px;border-bottom:1px solid var(--border)">${title}</div><div style="display:flex;gap:12px;line-height:1.7">${cells}</div></div>`;
  }

  function show() {
    if (document.querySelector('.modal-overlay')) return;
    const data = window.PresetEditor?.getCurrentEditData?.() || {};
    const meta = data.meta || {};
    const actions = data.actions || { skinIni: [], fileCopies: [], fileDeletes: [], fileTints: [] };
    const iniModifyCount = (actions.skinIni || []).filter(e => !e._delete).length;
    const iniDeleteCount = (actions.skinIni || []).filter(e => e._delete).length;
    const copyCount = actions.fileCopies?.length || 0;
    const deleteCount = actions.fileDeletes?.length || 0;
    const tints = actions.fileTints || [];
    const colorCount = tints.filter(t => t.tintEnabled).length;
    const cropCount = tints.filter(t => t.cropEnabled || t.darkenEnabled).length;
    const hasActions = iniModifyCount > 0 || iniDeleteCount > 0 || copyCount > 0 || deleteCount > 0 || colorCount > 0 || cropCount > 0;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'apply-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__title">${i18n.t('apply.confirmTitle')}</div>
        <div class="modal__body">
          <p style="margin-bottom:10px">${i18n.t('apply.willApplySingle', { name: escapeHtml(meta.name || i18n.t('apply.unnamed')) })}</p>
          ${group(i18n.t('apply.groupIni'), [
            { show: iniModifyCount > 0, key: 'apply.itemIniMod', n: iniModifyCount },
            { show: iniDeleteCount > 0, key: 'apply.itemIniDel', n: iniDeleteCount },
          ])}
          ${group(i18n.t('apply.groupFile'), [
            { show: copyCount > 0, key: 'apply.itemCopy', n: copyCount },
            { show: deleteCount > 0, key: 'apply.itemDelete', n: deleteCount },
          ])}
          ${group(i18n.t('apply.groupTint'), [
            { show: colorCount > 0, key: 'apply.itemColor', n: colorCount },
            { show: cropCount > 0, key: 'apply.itemCrop', n: cropCount },
          ])}
          ${!hasActions ? `<p style="color:var(--warning);margin-top:8px">${i18n.t('apply.noActions')}</p>` : ''}
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
    bindEsc();

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
        if (typeof window.invalidateImageCaches === 'function') window.invalidateImageCaches();
        const sum = summaryText(d.skinIniChanges || 0, (d.filesCopied || 0) + (d.filesDeleted || 0), d.filesTinted || 0);
        Toast.success(`${i18n.t('apply.appliedPrefix')}<span style="font-size:11px;color:var(--text-muted)">[${sum}]</span>`);
      } else {
        Toast.error(i18n.t('apply.applyFailed', { msg: result.error || i18n.t('app.unknownError') }));
      }
    });
  }

  // Esc closes whichever apply modal is open.
  let _escHandler = null;
  function bindEsc() {
    if (_escHandler) return;
    _escHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', _escHandler);
  }
  function close() {
    const overlay = document.getElementById('apply-modal');
    if (overlay) overlay.remove();
    if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
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
          actions: result.data.actions || { skinIni: [], fileCopies: [], fileDeletes: [], fileTints: [] },
        });
      }
    }

    if (presetDataList.length === 0) {
      Toast.error(i18n.t('apply.loadPresetFailed'));
      return;
    }

    // Combine actions
    let totalIniMod = 0, totalIniDel = 0, totalCopy = 0, totalDelete = 0, totalColor = 0, totalCrop = 0;
    const presetSummaries = [];
    for (const pd of presetDataList) {
      const ini = pd.actions.skinIni || [];
      const iniMod = ini.filter(e => !e._delete).length;
      const iniDel = ini.filter(e => e._delete).length;
      const copyCount = pd.actions.fileCopies?.length || 0;
      const deleteCount = pd.actions.fileDeletes?.length || 0;
      const ts = pd.actions.fileTints || [];
      const colorCount = ts.filter(t => t.tintEnabled).length;
      const cropCount = ts.filter(t => t.cropEnabled || t.darkenEnabled).length;
      totalIniMod += iniMod; totalIniDel += iniDel;
      totalCopy += copyCount; totalDelete += deleteCount;
      totalColor += colorCount; totalCrop += cropCount;
      presetSummaries.push({ name: pd.meta.name || i18n.t('preset.fallbackName', { id: pd.id }), iniMod, iniDel, copyCount, deleteCount, colorCount, cropCount });
    }
    const hasAny = totalIniMod > 0 || totalIniDel > 0 || totalCopy > 0 || totalDelete > 0 || totalColor > 0 || totalCrop > 0;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'apply-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__title">${i18n.t('apply.confirmTitle')}</div>
        <div class="modal__body">
          <p style="margin-bottom:8px">${i18n.t('apply.willApplyMulti', { count: presetDataList.length, name: escapeHtml(skin) })}</p>
          ${presetSummaries.map(ps => `
            <div style="padding:3px 2px">
              <strong>${escapeHtml(ps.name)}</strong>
              <span style="font-size:12px;color:var(--text-muted);margin-left:8px">
                ${(() => { const s = summaryText(ps.iniMod + ps.iniDel, ps.copyCount + ps.deleteCount, ps.colorCount + ps.cropCount); return s || i18n.t('apply.fragmentNone'); })()}
              </span>
            </div>
          `).join('')}
          <div style="margin-top:10px">
            ${group(i18n.t('apply.groupIni'), [
              { show: totalIniMod > 0, key: 'apply.itemIniMod', n: totalIniMod },
              { show: totalIniDel > 0, key: 'apply.itemIniDel', n: totalIniDel },
            ])}
            ${group(i18n.t('apply.groupFile'), [
              { show: totalCopy > 0, key: 'apply.itemCopy', n: totalCopy },
              { show: totalDelete > 0, key: 'apply.itemDelete', n: totalDelete },
            ])}
            ${group(i18n.t('apply.groupTint'), [
              { show: totalColor > 0, key: 'apply.itemColor', n: totalColor },
              { show: totalCrop > 0, key: 'apply.itemCrop', n: totalCrop },
            ])}
          </div>
          ${!hasAny ? `<p style="color:var(--warning);margin-top:8px">${i18n.t('apply.noActionsMulti')}</p>` : ''}
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
    bindEsc();

    overlay.querySelector('#apply-confirm').addEventListener('click', async () => {
      const btn = overlay.querySelector('#apply-confirm');
      btn.textContent = i18n.t('apply.applying');
      btn.disabled = true;

      const result = await api.applyMultiplePresets(skin, presetIds);
      close();

      if (result.success) {
        const d = result.data;
        state.set('activePresets', {});
        if (typeof window.invalidateImageCaches === 'function') window.invalidateImageCaches();
        const sum = summaryText(d.skinIniChanges || 0, (d.filesCopied || 0) + (d.filesDeleted || 0), d.filesTinted || 0);
        Toast.success(`${i18n.t('apply.appliedPrefix')}<span style="font-size:11px;color:var(--text-muted)">[${sum}]</span>`);
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

  window.ApplyDialog = { showMulti, showConfirmDialog };
})();
