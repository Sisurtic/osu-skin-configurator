// App bootstrap — initializes everything and manages view navigation
(function () {
  const toolbarPath = document.getElementById('toolbar-path');
  const btnSettings = document.getElementById('btn-settings');
  const btnRescan = document.getElementById('btn-rescan');

  const btnApplyPreset = document.getElementById('btn-apply-preset');
  const btnToggleMode = document.getElementById('btn-toggle-mode');

  const viewSettings = document.getElementById('view-settings');
  const viewWelcome = document.getElementById('view-welcome');
  const viewEditor = document.getElementById('view-editor');
  const viewSelector = document.getElementById('view-selector');

  function switchView(viewId) {
    [viewSettings, viewWelcome, viewEditor, viewSelector].forEach(v => {
      if (v) v.classList.remove('view--active');
    });
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('view--active');
    state.set('currentView', viewId);
  }

  // ── Init sequence ──

  async function init() {
    state.set('_initializing', true);

    try {
      state.set('appMode', 'use');

      api.onOpenOspFile((skinName) => {
        state.set('selectedSkin', skinName);
        state.set('appMode', 'use');
      });

      const versionResult = await api.getAppVersion();
      if (versionResult.success && versionResult.data) {
        const versionEl = document.getElementById('app-version');
        if (versionEl) versionEl.textContent = 'v' + versionResult.data;
      }

      const shortcutsResult = await api.loadShortcuts();
      if (shortcutsResult.success && shortcutsResult.data) {
        Shortcuts.init(shortcutsResult.data);
        state.set('shortcutBindings', shortcutsResult.data);
      }

      toolbarPath.style.cursor = 'pointer';
      toolbarPath.title = '点击设置 osu! 路径';
      toolbarPath.addEventListener('click', () => {
        switchView('settings');
        SettingsView.render();
      });

      // 1. Check saved osu! path
      const pathResult = await api.getOsuPath();
      if (pathResult.success && pathResult.data) {
        state.set('osuPath', pathResult.data);
        toolbarPath.textContent = pathResult.data;
      } else {
        const detectResult = await api.autoDetectOsuPath();
        if (detectResult.success && detectResult.data) {
          await api.setOsuPath(detectResult.data);
          state.set('osuPath', detectResult.data);
          toolbarPath.textContent = detectResult.data;
        } else {
          toolbarPath.textContent = '未设置 osu! 路径 — 点击此处设置';
        }
      }

      // 2. If osu! path is set, scan skins
      const osuPath = state.get('osuPath');
      if (osuPath) {
        await scanSkins();
      }

      // 3. Restore last skin
      const openFileSkin = await api.getOpenFileArg();
      if (openFileSkin) {
        state.set('selectedSkin', openFileSkin);
        state.set('appMode', 'use');
      } else if (!state.get('selectedSkin')) {
        const lastSkinResult = await api.getLastSkin();
        if (lastSkinResult.success && lastSkinResult.data) {
          const skins = state.get('skins') || [];
          if (skins.some(s => s.name === lastSkinResult.data)) {
            state.set('selectedSkin', lastSkinResult.data);
          }
        }
      }

      // 4. Load preset data
      const skin = state.get('selectedSkin');
      if (skin) {
        const presetsResult = await api.scanPresets(skin);
        if (presetsResult.success) {
          state.setMultiple({
            presets: presetsResult.data.presets,
            groups: presetsResult.data.groups,
            rootGroupIds: presetsResult.data.rootGroupIds,
          });
        }
      }
    } catch (err) {
      if (window.Toast && typeof window.Toast.error === 'function') {
        window.Toast.error('应用初始化失败，请刷新页面重试');
      }
    } finally {
      state.set('_initializing', false);
      renderCurrentView();
    }
  }

  async function scanSkins() {
    const result = await api.scanSkins();
    if (result.success) {
      state.set('skins', result.data);
    }
  }

  function renderCurrentView() {
    if (state.get('_initializing')) return;

    const osuPath = state.get('osuPath');
    const selectedSkin = state.get('selectedSkin');
    const selectedPreset = state.get('selectedPreset');
    const appMode = state.get('appMode');
    const welcomeDismissed = state.get('_welcomeDismissed');

    updateWelcomeContent(osuPath);

    if (!osuPath) {
      switchView('welcome');
      ensureSkinListRendered();
      return;
    }

    if (appMode === 'edit') {
      if (selectedPreset) {
        switchView('editor');
        if (window.PresetEditor && typeof window.PresetEditor.render === 'function') {
          window.PresetEditor.render();
        }
      } else if (selectedSkin) {
        state.set('selectedPreset', '__new__');
        return;
      } else {
        switchView(welcomeDismissed ? 'selector' : 'welcome');
      }
    } else {
      ensureSkinListRendered();
      if (selectedSkin) {
        switchView('selector');
        PresetSelector.render();
      } else if (welcomeDismissed) {
        switchView('selector');
      } else {
        switchView('welcome');
      }
    }

    updateSkinHeader();
  }

  function ensureSkinListRendered() {
    if (window.SkinList && typeof window.SkinList.render === 'function') {
      window.SkinList.render(state.get('skins') || [], state.get('selectedSkin'));
    }
  }

  function updateWelcomeContent(osuPath) {
    if (!viewWelcome) return;
    const welcomeCard = viewWelcome.querySelector('.card__desc');
    const welcomeTitle = viewWelcome.querySelector('.card__title');
    if (!welcomeCard || !welcomeTitle) return;

    if (!osuPath) {
      welcomeTitle.textContent = '欢迎使用 osu! Skin Configurator';
      welcomeCard.textContent = '请先设置 osu! 安装路径，点击皮肤列表右侧按钮';
    } else {
      const skins = state.get('skins') || [];
      if (skins.length === 0) {
        welcomeTitle.textContent = '未找到皮肤';
        welcomeCard.textContent = 'Skins 文件夹为空或不存在，请检查 osu! 路径设置';
      } else {
        welcomeTitle.textContent = '欢迎使用 osu! Skin Configurator';
        welcomeCard.textContent = '从左侧选择一个皮肤以查看和管理预设';
      }
    }
  }

  // ── State change listeners ──

  state.on('skins', () => {
    renderCurrentView();
  });

  state.on('osuPath', (p) => {
    toolbarPath.textContent = p || '未设置 osu! 路径 — 点击此处设置';
    if (p) {
      if (!state.get('_initializing')) scanSkins();
      if (state.get('currentView') === 'settings') {
        switchView('welcome');
      }
    }
    renderCurrentView();
  });

  state.on('selectedSkin', async (skinName) => {
    if (!skinName) {
      state.set('presets', []);
      state.set('groups', []);
      state.set('rootGroupIds', []);
      state.set('activePresets', {});
      updateToolbarButtons();
      renderCurrentView();
      return;
    }
    state.set('_welcomeDismissed', true);
    // Clear any preset selection from the previous skin (ids are skin-specific)
    state.set('activePresets', {});
    // Re-register global shortcuts for the new skin
    api.reloadGlobalShortcuts(skinName);
    if (!state.get('_initializing')) {
      const result = await api.scanPresets(skinName);
      if (result.success) {
        state.setMultiple({
          presets: result.data.presets,
          groups: result.data.groups,
          rootGroupIds: result.data.rootGroupIds,
        });
      }
    }
    updateToolbarButtons();
  });

  state.on('selectedPreset', (presetId) => {
    renderCurrentView();
  });

  state.on('appMode', (mode) => {
    if (mode === 'edit') {
      // Clear use-mode state to avoid stale IDs after editing
      state.set('activePresets', {});
    }
    updateModeButton();
    updateSkinHeader();
    updateToolbarButtons();

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.classList.toggle('sidebar--edit', mode === 'edit');
    }

    if (mode === 'edit') {
      const presets = state.get('presets') || [];
      const skin = state.get('selectedSkin');
      if (skin && presets.length === 0 && !state.get('selectedPreset')) {
        state.set('selectedPreset', '__new__');
      }
    }

    renderCurrentView();
  });

  state.on('presetDirty', () => {
    updateToolbarButtons();
  });

  state.on('activePresets', () => {
    updateToolbarButtons();
  });

  // ── Toolbar button event handlers ──

  btnSettings.addEventListener('click', () => {
    showShortcutsDialog();
  });

  btnRescan.addEventListener('click', async () => {
    await scanSkins();
    const skin = state.get('selectedSkin');
    if (skin) {
      const result = await api.scanPresets(skin);
      if (result.success) {
        state.setMultiple({
          presets: result.data.presets,
          groups: result.data.groups,
          rootGroupIds: result.data.rootGroupIds,
        });
      }
    }
    Toast.info('皮肤列表已刷新');
  });

  btnToggleMode.addEventListener('click', async () => {
    const currentMode = state.get('appMode');
    const newMode = currentMode === 'use' ? 'edit' : 'use';
    if (currentMode === 'edit' && newMode === 'use' && state.get('presetDirty')) {
      const choice = await ApplyDialog.showConfirmDialog(
        '当前预设尚未保存，是否保存后切换？',
        [
          { label: '保存并切换', cls: 'btn--primary', value: 'save' },
          { label: '不保存', cls: 'btn--danger', value: 'discard' },
          { label: '取消', cls: 'btn--secondary', value: 'cancel' },
        ]
      );
      if (!choice || choice === 'cancel') return;
      if (choice === 'save') {
        if (window.PresetEditor && typeof window.PresetEditor.doSave === 'function') {
          await window.PresetEditor.doSave();
        }
      } else if (choice === 'discard') {
        // Discard unsaved edits: clear the form to a fresh state so stale
        // dirty data doesn't persist into the next edit session.
        if (window.PresetEditor && typeof window.PresetEditor.resetNew === 'function') {
          window.PresetEditor.resetNew();
        } else {
          state.set('presetDirty', false);
        }
      }
    }
    state.set('appMode', newMode);
  });

  btnApplyPreset.addEventListener('click', () => {
    const mode = state.get('appMode');
    if (mode === 'use') {
      const active = state.get('activePresets') || {};
      const ids = [].concat(...Object.values(active).filter(a => Array.isArray(a)));
      if (ids.length === 0) {
        Toast.warning('请先在左侧选择要应用的预设');
        return;
      }
      ApplyDialog.showMulti(ids);
    } else {
      ApplyDialog.show();
    }
  });

  // ── Helper functions ──

  function updateModeButton() {
    const mode = state.get('appMode');
    btnToggleMode.textContent = mode === 'use' ? '✏️ 编辑模式' : '👁️ 使用模式';
    btnToggleMode.title = mode === 'use' ? '切换到编辑模式' : '切换到使用模式';
  }

  function updateToolbarButtons() {
    const mode = state.get('appMode');
    const preset = state.get('selectedPreset');
    const isNew = preset === '__new__';
    const skin = state.get('selectedSkin');

    if (mode === 'edit') {
      btnApplyPreset.disabled = isNew || !preset;
      btnApplyPreset.textContent = '▶ 应用';
    } else {
      const active = state.get('activePresets') || {};
      const ids = [].concat(...Object.values(active).filter(a => Array.isArray(a)));
      btnApplyPreset.disabled = !skin || ids.length === 0;
      btnApplyPreset.textContent = ids.length > 0 ? `▶ 应用 (${ids.length})` : '▶ 应用';
    }
    btnToggleMode.disabled = !skin;
  }

  function updateSkinHeader() {
    const headerSection = document.getElementById('skin-header-section');
    const headerName = document.getElementById('skin-header-name');
    if (!headerSection || !headerName) return;
    const appMode = state.get('appMode');
    const selectedSkin = state.get('selectedSkin');

    if (appMode === 'edit' && selectedSkin) {
      headerSection.style.display = '';
      headerName.textContent = selectedSkin;
    } else {
      headerSection.style.display = 'none';
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ── Keyboard shortcuts dialog ──
  let shortcutsRecording = null;

  function showShortcutsDialog() {
    if (document.querySelector('.modal-overlay')) return;
    const shortcuts = Shortcuts.getAll();

    function renderRows() {
      const tbody = document.getElementById('shortcuts-tbody');
      if (!tbody) return;
      const list = Shortcuts.getAll();
      tbody.innerHTML = list.map(s => {
        const modeLabel = (s.modes && s.modes.length === 2) ? '使用 / 编辑'
          : (s.modes && s.modes[0] === 'edit') ? '编辑'
          : '使用';
        return `
        <tr class="shortcut-row" data-id="${escapeHtml(s.id)}">
          <td><code style="background:var(--bg-tertiary);padding:2px 8px;border-radius:var(--radius-sm);font-size:12px;color:var(--accent);white-space:nowrap">${escapeHtml(s.key)}</code></td>
          <td style="font-size:12px;color:var(--text-secondary)">${escapeHtml(s.desc)}</td>
          <td style="font-size:11px;color:var(--text-muted)">${escapeHtml(modeLabel)}</td>
        </tr>
      `}).join('');
      bindRowClicks();
    }

    function bindRowClicks() {
      const tbody = document.getElementById('shortcuts-tbody');
      if (!tbody) return;
      tbody.querySelectorAll('.shortcut-row').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
          if (shortcutsRecording && shortcutsRecording.id === row.dataset.id) {
            cancelRecording();
            return;
          }
          if (shortcutsRecording) cancelRecording();
          const id = row.dataset.id;
          shortcutsRecording = { id, row };
          row.classList.add('row--selected');
          const code = row.querySelector('code');
          code.textContent = '按下新快捷键…';
          code.style.color = 'var(--danger)';
          code.style.animation = 'pulse 1s infinite';
        });
      });
    }

    function cancelRecording() {
      if (!shortcutsRecording) return;
      const { row } = shortcutsRecording;
      row.classList.remove('row--selected');
      const code = row.querySelector('code');
      code.style.color = 'var(--accent)';
      code.style.animation = '';
      const list = Shortcuts.getAll();
      const item = list.find(s => s.id === shortcutsRecording.id);
      code.textContent = item ? item.key : '';
      shortcutsRecording = null;
    }

    function applyRecording(keyStr) {
      if (!shortcutsRecording) return;
      const { id, row } = shortcutsRecording;
      Shortcuts.setBinding(id, keyStr);
      row.classList.remove('row--selected');
      const code = row.querySelector('code');
      code.textContent = keyStr;
      code.style.color = 'var(--accent)';
      code.style.animation = '';
      shortcutsRecording = null;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'shortcuts-dialog';
    overlay.innerHTML = `
      <div class="modal" style="min-width:420px;max-width:520px">
        <div class="modal__title">键盘快捷键</div>
        <div class="modal__body">
          <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">点击任意行可重新绑定快捷键，按下新组合键即可完成修改。</p>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>快捷键</th><th>功能</th><th>适用模式</th></tr></thead>
              <tbody id="shortcuts-tbody">
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal__actions">
          <button class="btn btn--secondary btn--sm" id="shortcuts-reset">恢复默认</button>
          <button class="btn btn--primary btn--sm" id="shortcuts-close">关闭</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    renderRows();

    const close = async () => {
      const raw = Shortcuts.getRawBindings();
      await api.saveShortcuts(raw);
      shortcutsRecording = null;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };

    overlay.querySelector('#shortcuts-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#shortcuts-reset').addEventListener('click', () => {
      Shortcuts.init({});
      state.set('shortcutBindings', {});
      if (shortcutsRecording) cancelRecording();
      renderRows();
    });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (shortcutsRecording) {
          e.preventDefault();
          cancelRecording();
          return;
        }
        close();
        return;
      }
      if (shortcutsRecording) {
        e.preventDefault();
        e.stopPropagation();
        const keyStr = Shortcuts.keyToString(e);
        if (keyStr) {
          applyRecording(keyStr);
        }
      }
    };
    document.addEventListener('keydown', onKey);
  }

  // ── Global wheel handler for number inputs ──
  document.addEventListener('wheel', (e) => {
    const target = e.target.closest('input[type="number"]');
    if (!target || document.activeElement !== target) return;
    e.preventDefault();
    const step = parseFloat(target.step) || 1;
    let delta = e.deltaY > 0 ? -step : step;
    if (e.shiftKey) delta *= 10;
    if (e.ctrlKey) delta *= 0.1;
    const newVal = (parseFloat(target.value) || 0) + delta;
    const min = target.min !== '' ? parseFloat(target.min) : -Infinity;
    const max = target.max !== '' ? parseFloat(target.max) : Infinity;
    target.value = Math.max(min, Math.min(max, newVal));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }, { passive: false });

  // ── Esc key: blur focused element in edit mode ──
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const activeEl = document.activeElement;
    if (!activeEl || activeEl === document.body) return;
    const isModal = !!document.querySelector('.modal-overlay');
    if (isModal) return;
    if (state.get('appMode') === 'edit') {
      e.preventDefault();
      activeEl.blur();
    }
  });

  // ── Global keydown handler for number inputs (Shift+Arrow = 10x) ──
  document.addEventListener('keydown', (e) => {
    if (!(e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    const target = e.target.closest('input[type="number"]');
    if (!target || document.activeElement !== target) return;
    e.preventDefault();
    const step = parseFloat(target.step) || 1;
    let delta = e.key === 'ArrowUp' ? step : -step;
    if (e.shiftKey) delta *= 10;
    if (e.ctrlKey) delta *= 0.1;
    const newVal = (parseFloat(target.value) || 0) + delta;
    const min = target.min !== '' ? parseFloat(target.min) : -Infinity;
    const max = target.max !== '' ? parseFloat(target.max) : Infinity;
    target.value = Math.max(min, Math.min(max, newVal));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', async (e) => {
    const activeEl = document.activeElement;
    const isInput = activeEl && activeEl.closest('input, textarea, select, [contenteditable]');
    const isButton = activeEl && activeEl.closest('button');
    const _rec = document.getElementById('shortcut-recorder');
    const isModal = !!document.querySelector('.modal-overlay') || (_rec && _rec.style.display !== 'none');

    if (e.key === 'Tab') {
      if (isModal) {
        e.preventDefault();
        const modal = document.querySelector('.modal-overlay .modal');
        if (modal) {
          const focusable = modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
          const els = Array.from(focusable).filter(el => el.offsetParent !== null);
          if (els.length > 0) {
            const current = els.indexOf(document.activeElement);
            if (e.shiftKey) {
              const next = current <= 0 ? els.length - 1 : current - 1;
              els[next].focus();
            } else {
              const next = current >= els.length - 1 ? 0 : current + 1;
              els[next].focus();
            }
          }
        }
      } else if (!isInput) {
        const editorVisible = document.getElementById('view-editor')?.classList.contains('view--active');
        const noFocus = !activeEl || activeEl === document.body;
        if (editorVisible && noFocus) {
          e.preventDefault();
          const activeTab = document.querySelector('.tab-content--active');
          if (activeTab) {
            const first = activeTab.querySelector(
              'input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (first) first.focus();
          }
        } else if (!editorVisible) {
          e.preventDefault();
        }
      }
    }

    if (e.key === ' ' && !isInput && !isModal && !isButton) {
      e.preventDefault();
    }

    if (e.key === 'Enter' && !isInput && !isModal && !isButton) {
      e.preventDefault();
    }

    if (e.key >= '1' && e.key <= '4' && !isInput && !isModal && state.get('appMode') === 'edit') {
      const tabs = ['basic', 'ini', 'files', 'preview'];
      const idx = parseInt(e.key) - 1;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('tab-content--active'));
      const targetTab = document.querySelector(`.tab[data-tab="${tabs[idx]}"]`);
      const targetEl = document.getElementById(`tab-${tabs[idx]}`);
      if (targetTab) targetTab.classList.add('tab--active');
      if (targetEl) targetEl.classList.add('tab-content--active');
    }

    const action = Shortcuts.matchAction(e);
    if (!action) return;
    // Disable custom shortcuts while any modal/dialog overlay is open
    if (isModal) return;

    const shortcutDef = Shortcuts.getAll().find(s => s.id === action);
    if (shortcutDef && shortcutDef.modes && !shortcutDef.modes.includes(state.get('appMode'))) return;

    switch (action) {
      case 'save':
        e.preventDefault();
        if (window.PresetEditor && typeof window.PresetEditor.doSave === 'function') {
          window.PresetEditor.doSave();
        }
        break;

      case 'new-preset':
        if (state.get('appMode') !== 'edit') break;
        e.preventDefault();
        {
          const skin = state.get('selectedSkin');
          if (!skin) { Toast.warning('请先选择皮肤'); break; }
          state.set('selectedPreset', '__new__');
          // Force a fresh form even when already in __new__ (re-clicking 新建预设)
          if (window.PresetEditor && typeof window.PresetEditor.resetNew === 'function') {
            window.PresetEditor.resetNew();
          }
          Toast.info('新建预设');
        }
        break;

      case 'new-group':
        if (state.get('appMode') !== 'edit') break;
        e.preventDefault();
        {
          const skin = state.get('selectedSkin');
          if (!skin) { Toast.warning('请先选择皮肤'); break; }
          if (window.PresetList && typeof window.PresetList.createGroupWithSelected === 'function') {
            window.PresetList.createGroupWithSelected();
          }
        }
        break;

      case 'copy-preset':
        if (state.get('appMode') !== 'edit') break;
        if (isInput) break;
        e.preventDefault();
        if (window.PresetList && typeof window.PresetList.copySelected === 'function') {
          window.PresetList.copySelected();
        }
        break;

      case 'apply':
        if (isInput || isModal || isButton) break;
        e.preventDefault();
        {
          const mode = state.get('appMode');
          if (mode === 'use') {
            const active = state.get('activePresets') || {};
            const ids = [].concat(...Object.values(active).filter(a => Array.isArray(a)));
            if (ids.length > 0) {
              ApplyDialog.showMulti(ids);
            } else {
              Toast.warning('请先在左侧选择要应用的预设');
            }
          }
        }
        break;

      case 'refresh':
        if (isInput) break;
        e.preventDefault();
        scanSkins();
        {
          const skin = state.get('selectedSkin');
          if (skin) {
            const result = await api.scanPresets(skin);
            if (result.success) {
              state.setMultiple({
                presets: result.data.presets,
                groups: result.data.groups,
                rootGroupIds: result.data.rootGroupIds,
              });
            }
          }
        }
        Toast.info('皮肤列表已刷新');
        break;

      case 'toggle-mode':
        if (isInput || isModal) break;
        e.preventDefault();
        if (!btnToggleMode.disabled) btnToggleMode.click();
        break;
    }
  });

  // ── Boot ──
  init();
})();
