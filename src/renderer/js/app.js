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

    // Reveal the window now that the webview has loaded (window starts hidden
    // in tauri.conf.json to avoid a white frame before WebView2 paints).
    try {
      const T = window.__TAURI__;
      if (T && T.window) T.window.getCurrentWindow().show();
    } catch (_) { /* ignore — window may already be visible */ }

    // Load locale dictionaries from the backend (auto-discovered from the
    // bundled locales folder), then apply the active locale to static HTML.
    try {
      const locRes = await api.listLocales();
      if (locRes && locRes.success && locRes.data) i18n.load(locRes.data);
    } catch (_) { /* fall back to keys/raw */ }
    i18n.applyLocale();

    // Register the full re-render hook so language switches update everything
    // in one frame (no reload).
    i18n.onRerender(rerenderAll);

    try {
      state.set('appMode', 'use');

      api.onOpenOspFile((skinName) => {
        state.set('selectedSkin', skinName);
        state.set('appMode', 'use');
      });

      // Parallelize independent IPC calls to cut cold-start wait — these fan
      // out together instead of awaiting one-by-one.
      const [versionResult, shortcutsResult, pathResult, openFileResult] = await Promise.all([
        api.getAppVersion(),
        api.loadShortcuts(),
        api.getOsuPath(),
        api.getOpenFileArg(),
      ]);

      if (versionResult.success && versionResult.data) {
        const versionEl = document.getElementById('app-version');
        if (versionEl) versionEl.textContent = 'v' + versionResult.data;
      }

      // Non-blocking update check — fire and forget so cold start is never
      // delayed by a network round-trip. Fails silent offline.
      if (window.UpdateCheck) UpdateCheck.check().catch(() => {});

      if (shortcutsResult.success && shortcutsResult.data) {
        Shortcuts.init(shortcutsResult.data);
        state.set('shortcutBindings', shortcutsResult.data);
      }

      toolbarPath.style.cursor = 'pointer';
      toolbarPath.title = i18n.t('app.clickToSetPath');
      toolbarPath.addEventListener('click', () => {
        switchView('settings');
        SettingsView.render();
      });

      // 1. osu! path
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
          toolbarPath.textContent = i18n.t('app.pathUnsetClickHint');
        }
      }

      // 2. If osu! path is set, scan skins
      const osuPath = state.get('osuPath');
      if (osuPath) {
        await scanSkins();
      }

      // 3. Restore last skin (openFileArg takes priority; it was fetched above)
      const openFileSkin = (openFileResult && openFileResult.success) ? openFileResult.data : null;
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
      console.error('init failed:', err);
      if (window.Toast && typeof window.Toast.error === 'function') {
        window.Toast.error(i18n.t('app.initFailed', { msg: (err && (err.message || String(err)) || i18n.t('app.unknownError')) }));
      }
    } finally {
      state.set('_initializing', false);
      renderCurrentView();
      // Defer the fade-in to the next frame so renderCurrentView's layout
      // settles before transitioning opacity (avoids a flash of reflowed content).
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.body.classList.add('is-ready');
        // Equivalent to the language-switch path: after layout has settled
        // (container has a real width), re-render once so layoutColumns in the
        // INI / file-move editors applies column widths correctly on the very
        // first view — no need to resize/switch presets first.
        rerenderAll();

        // First-launch warning: INI editing removes comments.
        if (typeof localStorage !== 'undefined') {
          try {
            if (!localStorage.getItem('ini-comment-warn-dismissed')) {
              showIniCommentWarning();
            }
          } catch (_) { /* ignore */ }
        }
      }));
    }
  }

  async function showIniCommentWarning() {
    const msg = i18n.t('warn.iniCommentLoss');
    if (!msg || msg === 'warn.iniCommentLoss') return;
    try {
      await ApplyDialog.showConfirmDialog(msg, [
        { label: i18n.t('dialog.iKnow'), cls: 'btn--primary', value: 'ok' },
      ]);
    } catch (_) { /* ignore */ }
    try { localStorage.setItem('ini-comment-warn-dismissed', '1'); } catch (_) {}
  }

  // Force every component to re-render (used after a language switch so all
  // dynamically-rendered text updates in one frame, without a reload).
  //
  // IMPORTANT: we deliberately do NOT re-fire `selectedPreset` or `appMode`.
  // Those listeners reload the preset from disk and would discard unsaved form
  // edits. Instead we re-render the current view (PresetEditor.render reads
  // from in-memory editData, so form values are preserved; only labels
  // re-translate) and re-fire only display-only keys.
  function rerenderAll() {
    i18n.applyStatic();
    const keys = ['skins', 'osuPath', 'presetDirty', 'activePresets',
                  'presets', 'groups', 'rootGroupIds'];
    const updates = {};
    for (const k of keys) {
      const v = state.get(k);
      updates[k] = Array.isArray(v) ? [...v]
        : (v && typeof v === 'object') ? { ...v }
        : v;
    }
    state.setMultiple(updates);
    renderCurrentView();
    // Re-apply locale to toolbar button labels (mode + apply) which aren't
    // covered by state subscriptions.
    updateModeButton();
    updateToolbarButtons();
    if (window.SkinList && typeof window.SkinList.render === 'function') {
      window.SkinList.render(state.get('skins') || [], state.get('selectedSkin'));
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
      welcomeTitle.textContent = i18n.t('welcome.title');
      welcomeCard.textContent = i18n.t('welcome.setPathFirst');
    } else {
      const skins = state.get('skins') || [];
      if (skins.length === 0) {
        welcomeTitle.textContent = i18n.t('welcome.noSkinsTitle');
        welcomeCard.textContent = i18n.t('welcome.noSkinsDesc');
      } else {
        welcomeTitle.textContent = i18n.t('welcome.title');
        welcomeCard.textContent = i18n.t('welcome.descSelect');
      }
    }
  }

  // ── State change listeners ──

  state.on('skins', () => {
    renderCurrentView();
  });

  state.on('osuPath', (p) => {
    toolbarPath.textContent = p || i18n.t('app.pathUnsetClickHint');
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
    // Persist the selected skin so the next launch restores it.
    api.setLastSkin(skinName);
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

  // ── Language switcher ──
  // Builds the dropdown from i18n.available() (auto-discovers any registered
  // locale) and switches via i18n.setLocale (persists + reloads).
  const langBtn = document.getElementById('btn-lang');
  const langMenu = document.getElementById('lang-menu');
  function buildLangMenu() {
    if (!langMenu) return;
    const current = i18n.locale();
    const tags = i18n.available();
    langMenu.innerHTML = tags.map(tag => {
      const isCur = tag === current;
      return `<div class="lang-switch__item ${isCur ? 'lang-switch__item--current' : ''}" data-locale="${tag}">${i18n.labelFor(tag)}${isCur ? ' ✓' : ''}</div>`;
    }).join('');
    langMenu.querySelectorAll('.lang-switch__item').forEach(item => {
      item.addEventListener('click', () => {
        langMenu.classList.remove('lang-switch__menu--open');
        i18n.setLocale(item.dataset.locale);
      });
    });
  }
  if (langBtn && langMenu) {
    langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      buildLangMenu();
      langMenu.classList.toggle('lang-switch__menu--open');
    });
    // Close when clicking elsewhere
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#lang-switch')) {
        langMenu.classList.remove('lang-switch__menu--open');
      }
    });
  }

  btnRescan.addEventListener('click', () => { actionRefresh(); });

  btnToggleMode.addEventListener('click', async () => {
    if (!state.get('selectedSkin')) return;
    const currentMode = state.get('appMode');
    const newMode = currentMode === 'use' ? 'edit' : 'use';
    if (currentMode === 'edit' && newMode === 'use' && state.get('presetDirty')) {
      const choice = await ApplyDialog.showConfirmDialog(
        i18n.t('dialog.unsavedSwitch'),
        [
          { label: i18n.t('dialog.saveAndSwitch'), cls: 'btn--primary', value: 'save' },
          { label: i18n.t('dialog.discard'), cls: 'btn--danger', value: 'discard' },
          { label: i18n.t('dialog.cancel'), cls: 'btn--secondary', value: 'cancel' },
        ]
      );
      if (!choice || choice === 'cancel') return;
      if (choice === 'save') {
        // Save must succeed before switching; a failure (empty name, API error,
        // or thrown exception) aborts the switch.
        try {
          if (window.PresetEditor && typeof window.PresetEditor.doSave === 'function') {
            const ok = await window.PresetEditor.doSave();
            if (!ok) return;
          }
        } catch (e) {
          console.error('save before mode switch failed:', e);
          return;
        }
      } else if (choice === 'discard') {
        // Just clear dirty — the mode switch will change the view; no need to
        // rebuild the editor (resetNew would interfere with the view switch).
        state.set('presetDirty', false);
      }
    }
    state.set('appMode', newMode);
  });

  btnApplyPreset.addEventListener('click', () => { actionApply(); });

  // ── Shared action functions ──
  // Single source of truth for each toolbar action. Both the toolbar button
  // and its keyboard shortcut call these so behavior never diverges.

  async function actionRefresh() {
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
    Toast.info(i18n.t('toast.skinsRefreshed'));
  }

  function actionApply() {
    const mode = state.get('appMode');
    if (mode === 'use') {
      const active = state.get('activePresets') || {};
      const ids = [].concat(...Object.values(active).filter(a => Array.isArray(a)));
      if (ids.length === 0) {
        Toast.warning(i18n.t('toast.selectPresetFirst'));
        return;
      }
      ApplyDialog.showMulti(ids);
    } else {
      ApplyDialog.show();
    }
  }

  function actionNewPreset() {
    const skin = state.get('selectedSkin');
    if (!skin) { Toast.warning(i18n.t('toast.selectSkinFirst')); return; }
    // Delegate to the sidebar button so confirmSwitchIfDirty + resetNew logic
    // is shared (same pattern as toggle-mode → btnToggleMode.click()).
    const btn = document.getElementById('btn-new-preset-sidebar');
    if (btn) { btn.click(); return; }
    // Fallback if button not found.
    if (window.PresetList && typeof window.PresetList.clearSelection === 'function') {
      window.PresetList.clearSelection();
    }
    state.set('selectedPreset', '__new__');
    if (window.PresetEditor && typeof window.PresetEditor.resetNew === 'function') {
      window.PresetEditor.resetNew();
    }
    Toast.info(i18n.t('toast.newPreset'));
  }

  // ── Helper functions ──

  function updateModeButton() {
    const mode = state.get('appMode');
    btnToggleMode.textContent = mode === 'use' ? i18n.t('mode.use') : i18n.t('mode.edit');
    btnToggleMode.title = mode === 'use' ? i18n.t('mode.switchToEdit') : i18n.t('mode.switchToUse');
  }

  function updateToolbarButtons() {
    const mode = state.get('appMode');
    const preset = state.get('selectedPreset');
    const isNew = preset === '__new__';
    const skin = state.get('selectedSkin');

    if (mode === 'edit') {
      btnApplyPreset.disabled = isNew || !preset;
      btnApplyPreset.textContent = i18n.t('toolbar.apply');
    } else {
      const active = state.get('activePresets') || {};
      const ids = [].concat(...Object.values(active).filter(a => Array.isArray(a)));
      btnApplyPreset.disabled = !skin || ids.length === 0;
      btnApplyPreset.textContent = ids.length > 0 ? i18n.t('toolbar.applyCount', { count: ids.length }) : i18n.t('toolbar.apply');
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
        const modeLabel = (s.modes && s.modes.length === 2) ? i18n.t('mode.labelBoth')
          : (s.modes && s.modes[0] === 'edit') ? i18n.t('mode.labelEdit')
          : i18n.t('mode.labelUse');
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
          code.textContent = i18n.t('dialog.pressNewKey');
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
        <div class="modal__title">${i18n.t('dialog.shortcutsTitle')}</div>
        <div class="modal__body">
          <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${i18n.t('dialog.shortcutsDesc')}</p>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>${i18n.t('dialog.colShortcut')}</th><th>${i18n.t('dialog.colAction')}</th><th>${i18n.t('dialog.colModes')}</th></tr></thead>
              <tbody id="shortcuts-tbody">
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal__actions">
          <button class="btn btn--secondary btn--sm" id="shortcuts-reset">${i18n.t('dialog.resetDefault')}</button>
          <button class="btn btn--primary btn--sm" id="shortcuts-close">${i18n.t('dialog.close')}</button>
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

  // ── Global wheel handler for number inputs (hover-to-scroll, no focus needed) ──
  document.addEventListener('wheel', (e) => {
    const target = e.target.closest('input[type="number"]');
    if (!target) return;
    e.preventDefault();
    const step = parseFloat(target.step) || 1;
    let delta = e.deltaY > 0 ? -step : step;
    if (e.shiftKey) delta *= 10;
    if (e.ctrlKey) delta *= 0.1;
    let newVal = (parseFloat(target.value) || 0) + delta;
    // Round to step precision to avoid floating-point artifacts (e.g. 0.30000000000000004).
    const decimals = (String(step).split('.')[1] || '').length;
    if (decimals > 0) newVal = parseFloat(newVal.toFixed(decimals));
    const min = target.min !== '' ? parseFloat(target.min) : -Infinity;
    const max = target.max !== '' ? parseFloat(target.max) : Infinity;
    newVal = Math.max(min, Math.min(max, newVal));
    // Skip forbidden values (e.g. AnimationFramerate forbids 0): keep stepping
    // in the same direction until we land on a permitted value.
    const forbiddenRaw = target.dataset.forbidden;
    if (forbiddenRaw) {
      const forbidden = forbiddenRaw.split(',').map(Number);
      let guard = 0;
      while (forbidden.includes(newVal) && guard < 10) {
        newVal = Math.max(min, Math.min(max, newVal + delta));
        guard++;
      }
    }
    target.value = newVal;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }, { passive: false });

  // ── Wheel over a <select> changes its selection (hover-to-scroll, no click needed) ──
  document.addEventListener('wheel', (e) => {
    const sel = e.target.closest('select');
    if (!sel || sel.disabled) return;
    e.preventDefault();
    const opts = sel.options;
    if (!opts.length) return;
    let idx = sel.selectedIndex;
    idx += e.deltaY > 0 ? 1 : -1;
    if (idx < 0) idx = 0;
    if (idx > opts.length - 1) idx = opts.length - 1;
    if (idx !== sel.selectedIndex) {
      sel.selectedIndex = idx;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
    // Swallow a BARE Alt keydown: on Windows/WebView2, pressing Alt alone
    // activates the window's system menu bar, which steals mouse tracking and
    // stops mousemove events (so cursor particles freeze) until Alt is pressed
    // again. preventDefault here keeps the webview's mouse tracking intact.
    // Alt combos (Alt+key) are unaffected — the menu only activates on lone Alt.
    if (e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
      e.preventDefault();
    }
    // Suppress the webview's native find-in-page (Ctrl+F).
    if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
    }
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

    if (e.key >= '1' && e.key <= '3' && !isInput && !isModal && state.get('appMode') === 'edit') {
      const tabs = ['basic', 'ini', 'files'];
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
    // Disable all action shortcuts when no skin is selected
    if (!state.get('selectedSkin')) return;

    const shortcutDef = Shortcuts.getAll().find(s => s.id === action);
    if (shortcutDef && shortcutDef.modes && !shortcutDef.modes.includes(state.get('appMode'))) return;

    switch (action) {
      case 'save':
        // Skip when there's nothing to save, UNLESS it's a new preset (allow
        // continuous saving of a new preset without editing between saves).
        if (!state.get('presetDirty') && state.get('selectedPreset') !== '__new__') break;
        e.preventDefault();
        if (window.PresetEditor && typeof window.PresetEditor.doSave === 'function') {
          window.PresetEditor.doSave();
        }
        break;

      case 'new-preset':
        if (state.get('appMode') !== 'edit') break;
        e.preventDefault();
        actionNewPreset();
        break;

      case 'new-group':
        if (state.get('appMode') !== 'edit') break;
        e.preventDefault();
        {
          const skin = state.get('selectedSkin');
          if (!skin) { Toast.warning(i18n.t('toast.selectSkinFirst')); break; }
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
        actionApply();
        break;

      case 'refresh':
        e.preventDefault();
        actionRefresh();
        break;

      case 'toggle-mode':
        if (isInput || isModal) break;
        e.preventDefault();
        if (!btnToggleMode.disabled) btnToggleMode.click();
        break;
    }
  });

  // ── Suppress WebView2's default native context menu ──
  // (The Electron→Tauri rewrite never ported the suppression.) Preset rows in
  // preset-selector.js attach their own contextmenu handler + preventDefault;
  // preventDefault is idempotent and we do NOT stopPropagation, so those custom
  // right-click flows (shortcut binding) keep working.
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // ── Boot ──
  init();
})();
