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
   * @param {{presetIds?: number[], groupIds?: number[]}} args
   */
  async function showMulti({ presetIds = [], groupIds = [], dirty = false } = {}) {
    if (document.querySelector('.modal-overlay')) return;
    const skin = state.get('selectedSkin');
    if (!skin || (presetIds.length === 0 && groupIds.length === 0)) {
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
    // Group apply units: read meta + actions from state.groups (already loaded).
    const groups = state.get('groups') || [];
    const collectApplyUnits = window.PresetSelector?.collectApplyUnits;
    // For each checkbox group, collect the actions of EVERY unit the backend
    // apply_group will apply: the root group + selected child groups (own
    // actions, from state.groups) + selected presets (loaded via loadPreset).
    // This makes the dialog's action counts match what actually gets applied.
    const groupDataList = [];
    for (const gid of groupIds) {
      const g = groups.find(x => x.id === gid) || {};
      const meta = { name: g.name || i18n.t('group.tableGroup') };
      const u = collectApplyUnits ? collectApplyUnits(gid) : { presetIds: new Set(), groupIds: new Set([gid]) };
      const applyCount = u.presetIds.size + u.groupIds.size;
      // Merge own actions of every group in the unit set (root + selected subs).
      const merged = { skinIni: [], fileCopies: [], fileDeletes: [], fileTints: [] };
      for (const sgid of u.groupIds) {
        const sg = groups.find(x => x.id === sgid);
        const sa = sg?.actions;
        if (sa) {
          if (Array.isArray(sa.skinIni)) merged.skinIni.push(...sa.skinIni);
          if (Array.isArray(sa.fileCopies)) merged.fileCopies.push(...sa.fileCopies);
          if (Array.isArray(sa.fileDeletes)) merged.fileDeletes.push(...sa.fileDeletes);
          if (Array.isArray(sa.fileTints)) merged.fileTints.push(...sa.fileTints);
        }
      }
      // Load each selected preset's actions and merge.
      for (const pid of u.presetIds) {
        const result = await api.loadPreset(skin, pid);
        if (result.success && result.data) {
          const pa = result.data.actions || {};
          if (Array.isArray(pa.skinIni)) merged.skinIni.push(...pa.skinIni);
          if (Array.isArray(pa.fileCopies)) merged.fileCopies.push(...pa.fileCopies);
          if (Array.isArray(pa.fileDeletes)) merged.fileDeletes.push(...pa.fileDeletes);
          if (Array.isArray(pa.fileTints)) merged.fileTints.push(...pa.fileTints);
        }
      }
      groupDataList.push({ id: gid, meta, actions: merged, isGroup: true, applyCount });
    }

    // Only abort if BOTH lists are empty: a group-only apply (no loose presets)
    // is valid — its preset data comes from state.groups via groupDataList, and
    // the backend apply_group loads the subtree. Aborting on empty presetDataList
    // alone made checkbox-group-only applies fail with "无法加载预设数据".
    if (presetDataList.length === 0 && groupDataList.length === 0) {
      Toast.error(i18n.t('apply.loadPresetFailed'));
      return;
    }

    // Combine actions
    let totalIniMod = 0, totalIniDel = 0, totalCopy = 0, totalDelete = 0, totalColor = 0, totalCrop = 0;
    const presetSummaries = [];
    const countActions = (a) => {
      const ini = a.skinIni || [];
      return {
        iniMod: ini.filter(e => !e._delete).length,
        iniDel: ini.filter(e => e._delete).length,
        copyCount: a.fileCopies?.length || 0,
        deleteCount: a.fileDeletes?.length || 0,
        colorCount: (a.fileTints || []).filter(t => t.tintEnabled).length,
        cropCount: (a.fileTints || []).filter(t => t.cropEnabled || t.darkenEnabled).length,
      };
    };
    for (const pd of presetDataList) {
      const c = countActions(pd.actions);
      totalIniMod += c.iniMod; totalIniDel += c.iniDel;
      totalCopy += c.copyCount; totalDelete += c.deleteCount;
      totalColor += c.colorCount; totalCrop += c.cropCount;
      presetSummaries.push({ name: pd.meta.name || i18n.t('preset.fallbackName', { id: pd.id }), ...c });
    }
    // Group apply units: gd.actions already merges every unit the backend will
    // apply (root + selected child groups + selected presets), so the counts
    // here reflect the actual application.
    for (const gd of groupDataList) {
      const c = countActions(gd.actions);
      totalIniMod += c.iniMod; totalIniDel += c.iniDel;
      totalCopy += c.copyCount; totalDelete += c.deleteCount;
      totalColor += c.colorCount; totalCrop += c.cropCount;
      presetSummaries.push({
        name: gd.meta.name + (gd.applyCount > 0 ? ` (${gd.applyCount})` : ''),
        ...c,
      });
    }
    const hasAny = totalIniMod > 0 || totalIniDel > 0 || totalCopy > 0 || totalDelete > 0 || totalColor > 0 || totalCrop > 0;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'apply-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__title">${i18n.t('apply.confirmTitle')}</div>
        <div class="modal__body">
          <p style="margin-bottom:8px">${i18n.t('apply.willApplyMulti', { count: presetDataList.length + groupDataList.length, name: escapeHtml(skin) })}</p>
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
          ${dirty ? `<p style="color:var(--warning);margin-top:8px;font-size:12px">${i18n.t('apply.saveFirst')}</p>` : ''}
        </div>
        <div class="modal__actions">
          ${dirty
            ? `<button class="btn btn--primary" data-apply="save">${i18n.t('apply.saveAndApply')}</button>
               <button class="btn btn--danger" data-apply="nosave">${i18n.t('apply.applyUnsaved')}</button>
               <button class="btn btn--secondary" id="apply-cancel">${i18n.t('dialog.cancel')}</button>`
            : `<button class="btn btn--primary" data-apply="plain">${i18n.t('apply.confirmApply')}</button>
               <button class="btn btn--secondary" id="apply-cancel">${i18n.t('dialog.cancel')}</button>`}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#apply-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    bindEsc();

    // Apply buttons (delegated by data-apply). In edit mode with unsaved edits
    // the actions are: save (save then apply) / nosave (apply the saved state
    // as-is) / cancel. Otherwise a plain apply / cancel.
    overlay.querySelectorAll('[data-apply]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.apply;
        // Save first if requested. On save failure, abort so nothing is applied
        // from a stale state; re-enable the buttons so the user can retry.
        if (mode === 'save') {
          if (window.PresetEditor && typeof window.PresetEditor.doSave === 'function') {
            const ok = await window.PresetEditor.doSave();
            if (!ok) return;
          }
        }
        // Disable all apply buttons + show "applying…" on the clicked one.
        overlay.querySelectorAll('[data-apply]').forEach(b => { b.disabled = true; });
        btn.textContent = i18n.t('apply.applying');

      // Apply loose presets first, then each active table group (group's own
      // actions + its subtree, applied once by the backend). The two sets are
      // disjoint by construction (loose excludes presets under active groups).
      let combined = null;
      let failed = null;
      if (presetIds.length > 0) {
        const r = await api.applyMultiplePresets(skin, presetIds);
        if (r.success) combined = r.data; else failed = r;
      }
      if (!failed) {
        // The backend apply_group recursively reads tableRowSelection +
        // tableExpandedChildren from config itself, applying the per-row selected
        // presets + selected child groups (mirroring collectApplyUnits). No need
        // to pass the selection here — pass null.
        for (const gid of groupIds) {
          const rg = await api.applyGroup(skin, gid, null);
          if (rg.success) {
            const d = rg.data;
            if (!combined) combined = d;
            else {
              // Merge counts + warnings.
              combined.skinIniChanges = (combined.skinIniChanges || 0) + (d.skinIniChanges || 0);
              combined.filesCopied = (combined.filesCopied || 0) + (d.filesCopied || 0);
              combined.filesDeleted = (combined.filesDeleted || 0) + (d.filesDeleted || 0);
              combined.filesTinted = (combined.filesTinted || 0) + (d.filesTinted || 0);
            }
          } else { failed = rg; break; }
        }
      }
      close();

      if (failed) {
        Toast.error(i18n.t('apply.applyFailed', { msg: failed.error || i18n.t('app.unknownError') }));
      } else {
        const d = combined || {};
        // Clear BOTH selection states atomically. setMultiple fires the
        // activePresets listener (→ render) only AFTER both are written, so the
        // re-render sees activeTableGroups already empty — otherwise the group
        // would briefly still look active (activeTableGroups has no render
        // listener of its own).
        state.setMultiple({ activePresets: {}, activeTableGroups: {} });
        if (typeof window.invalidateImageCaches === 'function') window.invalidateImageCaches();
        const sum = summaryText(d.skinIniChanges || 0, (d.filesCopied || 0) + (d.filesDeleted || 0), d.filesTinted || 0);
        Toast.success(`${i18n.t('apply.appliedPrefix')}<span style="font-size:11px;color:var(--text-muted)">[${sum}]</span>`);
        // "Apply without saving" applied the SAVED state; reload it into the
        // editor so the editor matches (discards the unsaved edits).
        if (mode === 'nosave' && window.PresetEditor && typeof window.PresetEditor.reloadCurrent === 'function') {
          await window.PresetEditor.reloadCurrent();
        }
      }
    });
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
