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

  // ── Mode-switch animation (use ↔ edit) ──
  // While true, sidebar section display is owned here; skin-list/preset-list/
  // updateSkinHeader skip their own display toggles.
  let modeTransitioning = false;
  const ALL_MODE_ANIM = [
    'mode-anim--exit-left', 'mode-anim--enter-right',
    'mode-anim--exit-right', 'mode-anim--enter-left',
    'mode-anim--exit-up', 'mode-anim--enter-down',
    'mode-anim--fade-out', 'mode-anim--fade-in',
  ];
  const MODE_PHASE = 200; // matches --mode-anim-dur (0.2s)
  const MODE_GAP = 40;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function clearAnim(el) { if (el) el.classList.remove(...ALL_MODE_ANIM); }
  function addAnim(el, cls) {
    if (!el) return;
    el.classList.remove(...ALL_MODE_ANIM);
    void el.offsetWidth;            // restart the animation
    el.classList.add(cls);
  }

  async function animateModeSwitch(newMode) {
    if (modeTransitioning) return;
    modeTransitioning = true;
    window._modeTransitioning = true;
    if (btnToggleMode) btnToggleMode.disabled = true;
    const toEdit = newMode === 'edit';
    const useLayer = document.getElementById('sidebar-layer-use');
    const editLayer = document.getElementById('sidebar-layer-edit');
    const viewSelector = document.getElementById('view-selector');
    const viewEditor = document.getElementById('view-editor');

    // Layer transition via keyframe animation classes (reliable start state,
    // unlike transitions). enterAnim plays the enter keyframe and ends with the
    // --active class so the layer stays visible.
    const LAYER_ANIM = ['sidebar__layer--enter-right', 'sidebar__layer--enter-left',
      'sidebar__layer--exit-left', 'sidebar__layer--exit-right'];
    function clearLayerAnim(el) { if (el) el.classList.remove(...LAYER_ANIM); }
    function layerAnim(el, cls) {
      if (!el) return;
      el.classList.remove(...LAYER_ANIM);
      void el.offsetWidth;
      el.classList.add(cls);
    }
    function enterLayer(el, cls) {
      if (!el) return;
      layerAnim(el, cls);
      setTimeout(() => { el.classList.add('sidebar__layer--active'); }, MODE_PHASE);
    }
    function exitLayer(el, cls) {
      if (!el) return;
      layerAnim(el, cls);
      // After the exit animation, hide via removing --active (the keyframe's
      // `both` fill holds opacity:0 until then).
      setTimeout(() => { el.classList.remove('sidebar__layer--active'); }, MODE_PHASE);
    }

    try {
      if (toEdit) {
        // use → edit: use-layer exits left + selector fades out (parallel);
        // AFTER they're gone, flip the mode (which fills the edit-layer + editor),
        // then animate the edit-layer in from the right + tabs down + content in.
        addAnim(viewSelector, 'mode-anim--fade-out');
        exitLayer(useLayer, 'sidebar__layer--exit-left');
        await sleep(MODE_PHASE);
        state.set('appMode', 'edit');   // fills edit-layer content + rebuilds editor
        enterLayer(editLayer, 'sidebar__layer--enter-right');
        const editorTabs = viewEditor?.querySelector('.tabs');
        const activeContent = viewEditor?.querySelector('.tab-content--active');
        addAnim(editorTabs, 'mode-anim--enter-down');
        addAnim(activeContent, 'mode-anim--fade-in');
        await sleep(MODE_PHASE);
      } else {
        // edit → use: edit-layer exits right + tabs up + content fades (parallel);
        // AFTER they're gone, flip the mode (fills the use-layer skin list),
        // then animate the use-layer in from the left + selector fades in.
        const editorTabs = viewEditor?.querySelector('.tabs');
        const activeContent = viewEditor?.querySelector('.tab-content--active');
        addAnim(editorTabs, 'mode-anim--exit-up');
        addAnim(activeContent, 'mode-anim--fade-out');
        exitLayer(editLayer, 'sidebar__layer--exit-right');
        await sleep(MODE_PHASE);
        state.set('appMode', 'use');    // fills use-layer skin list
        enterLayer(useLayer, 'sidebar__layer--enter-left');
        addAnim(viewSelector, 'mode-anim--fade-in');
        await sleep(MODE_PHASE);
      }
      // Cleanup animation classes.
      [viewSelector,
       viewEditor?.querySelector('.tabs'),
       viewEditor?.querySelector('.tab-content--active')].forEach(clearAnim);
      [useLayer, editLayer].forEach(clearLayerAnim);
    } finally {
      modeTransitioning = false;
      window._modeTransitioning = false;
      if (btnToggleMode) btnToggleMode.disabled = false;
    }
  }

  // Set which sidebar layer is active for a mode (called on init + appMode change).
  function setSidebarLayer(mode) {
    const useLayer = document.getElementById('sidebar-layer-use');
    const editLayer = document.getElementById('sidebar-layer-edit');
    const edit = mode === 'edit';
    if (useLayer) useLayer.classList.toggle('sidebar__layer--active', !edit);
    if (editLayer) editLayer.classList.toggle('sidebar__layer--active', edit);
  }

  // ── Init sequence ──

  async function init() {
    state.set('_initializing', true);

    // Disable the browser/webview native input-history autofill for every text
    // input/textarea (existing + dynamically created).
    const disableAutofill = (root) => {
      root.querySelectorAll('input[type="text"], input:not([type]), textarea, input[type="search"]').forEach(el => {
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('spellcheck', 'false');
      });
    };
    disableAutofill(document);
    // Remove ALL non-editor elements from the Tab sequence — only the editor
    // (#view-editor), modal dialogs, and shortcut recorder retain Tab cycling.
    document.querySelectorAll('button, a, input, select, textarea, [tabindex="0"]').forEach(el => {
      if (el.closest('#view-editor') || el.closest('.modal-overlay') || el.closest('#shortcut-recorder')) return;
      el.setAttribute('tabindex', '-1');
    });
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(muts => {
        for (const m of muts) m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('input,textarea')) disableAutofill(n.parentElement || document);
          else if (n.querySelectorAll) disableAutofill(n);
        });
      }).observe(document.body, { childList: true, subtree: true });
    }

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

      // Global shortcut applied a preset from outside the window — image files
      // may have changed, so drop all cached images, show a toast + play a sound.
      api.onGlobalShortcutApplied((payload) => {
        if (typeof window.invalidateImageCaches === 'function') window.invalidateImageCaches();
        const p = payload && payload.payload ? payload.payload : payload;
        const ini = p.ini || 0, files = p.files || 0, tints = p.tints || 0;
        if (ini > 0 || files > 0 || tints > 0) {
          const parts = [];
          if (ini > 0) parts.push(`${i18n.t('apply.groupIni')}×${ini}`);
          if (files > 0) parts.push(`${i18n.t('apply.groupFile')}×${files}`);
          if (tints > 0) parts.push(`${i18n.t('apply.groupTint')}×${tints}`);
          const sum = parts.join(' ');
          Toast.success(`${i18n.t('apply.appliedPrefix')}<span style="font-size:11px;color:var(--text-muted)">[${sum}]</span>`);
          try { new Audio('assets/meow.wav').play(); } catch (e) {}
        } else if (p.warnings > 0) {
          Toast.warning(i18n.t('apply.applyFailed', { msg: '' }));
        }
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
        // Version now lives in the About dialog (titlebar shows window controls).
        const versionEl = document.getElementById('info-version');
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
            rootChildren: presetsResult.data.rootChildren || [],
            tableExpandedChildren: presetsResult.data.tableExpandedChildren || {},
            tableRowSelection: presetsResult.data.tableRowSelection || {},
            tableActivations: presetsResult.data.tableActivations || {},
          });
        }
      }
    } catch (err) {
      if (window.Toast && typeof window.Toast.error === 'function') {
        window.Toast.error(i18n.t('app.initFailed', { msg: (err && (err.message || String(err)) || i18n.t('app.unknownError')) }));
      }
    } finally {
      state.set('_initializing', false);
      renderCurrentView();
      setSidebarLayer(state.get('appMode'));
      // Defer the fade-in to the next frame so renderCurrentView's layout
      // settles before transitioning opacity (avoids a flash of reflowed content).
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.body.classList.add('is-ready');
        // Equivalent to the language-switch path: after layout has settled
        // (container has a real width), re-render once so layoutColumns in the
        // INI / file-move editors applies column widths correctly on the very
        // first view — no need to resize/switch presets first.
        rerenderAll();
        // Now that the body is visible, replay the skin-list staggered enter
        // (the initial render happened while body was opacity:0, masked by
        // the body fade-in). Defer one frame so rerenderAll's DOM settles first.
        requestAnimationFrame(() => {
          if (window.SkinList && typeof window.SkinList.replayEnter === 'function') {
            window.SkinList.replayEnter();
          }
        });

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
    const keys = ['skins', 'osuPath', 'presetDirty', 'activePresets', 'activeTableGroups',
                  'presets', 'groups', 'rootChildren'];
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

    updateWelcomeContent(osuPath);

    if (!osuPath) {
      switchView('welcome');
      playEnterAnim(viewWelcome, 'main-content--enter');
      ensureSkinListRendered();
      return;
    }

    if (appMode === 'edit') {
      if (selectedPreset || selectedSkin) {
        // With a skin selected, show the editor view even when no preset is
        // chosen — the editor renders its empty/hint state in that case.
        switchView('editor');
        if (window.PresetEditor && typeof window.PresetEditor.render === 'function') {
          window.PresetEditor.render();
        }
      } else {
        switchView('welcome');
        playEnterAnim(viewWelcome, 'main-content--enter');
      }
    } else {
      ensureSkinListRendered();
      if (selectedSkin) {
        switchView('selector');
        PresetSelector.render();
      } else {
        switchView('welcome');
        playEnterAnim(viewWelcome, 'main-content--enter');
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

  // Play a one-shot enter animation (e.g. main-content--enter) on an element,
  // removing the class on animationend so it doesn't replay when the element
  // later toggles display:none → flex (which restarts lingering animations).
  // Dedup: if the same element already has the class (animation in flight),
  // don't restart it — avoids a double play when multiple state changes fire.
  function playEnterAnim(el, cls) {
    if (!el) return;
    if (el.classList.contains(cls)) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }

  // Scale-fade an element out, resolving on animationend. The exit class is
  // KEPT (animation fill: both) so the element stays at opacity:0 until the
  // caller swaps content and triggers the enter animation.
  function playExitAnim(el, cls) {
    return new Promise(resolve => {
      if (!el) { resolve(); return; }
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
      const done = () => resolve();
      el.addEventListener('animationend', done, { once: true });
      setTimeout(done, 400);   // safety timeout
    });
  }

  state.on('selectedSkin', async (skinName) => {
    // Different skins can share the same relative image paths (e.g. cursor.png)
    // with different contents — drop all cached images so the new skin reads fresh.
    if (typeof window.invalidateImageCaches === 'function') window.invalidateImageCaches();
    if (!skinName) {
      state.set('presets', []);
      state.set('groups', []);
      state.set('rootChildren', []);
      state.set('activePresets', {});
    state.set('activeTableGroups', {});
    state.set('tableExpandedChildren', {});
    state.set('tableRowSelection', {});
    state.set('tableActivations', {});
      updateToolbarButtons();
      renderCurrentView();
      return;
    }
    // Persist the selected skin so the next launch restores it.
    api.setLastSkin(skinName);
    // Re-register global shortcuts for the new skin
    api.reloadGlobalShortcuts(skinName);
    if (!state.get('_initializing')) {
      const main = document.querySelector('.main-content');
      // Fade the old content out while the new skin's data loads (parallel).
      const exitPromise = playExitAnim(main, 'main-content--exit');
      const result = await api.scanPresets(skinName);
      await exitPromise;   // make sure the fade-out finished before swapping
      if (result.success) {
        // Atomically set the new data AND clear the previous skin's selection
        // so the selector re-renders ONCE with the new data (no flash of the
        // old/empty state from intermediate clears).
        state.setMultiple({
          presets: result.data.presets,
          groups: result.data.groups,
          rootChildren: result.data.rootChildren || [],
          tableExpandedChildren: result.data.tableExpandedChildren || {},
          tableRowSelection: result.data.tableRowSelection || {},
          tableActivations: result.data.tableActivations || {},
          activePresets: {},
          activeTableGroups: {},
        });
      }
      if (main) main.classList.remove('main-content--exit');
      playEnterAnim(main, 'main-content--enter');
    }
    updateToolbarButtons();
  });

  state.on('selectedPreset', (presetId) => {
    // Only switch the view here; the preset-editor's own selectedPreset
    // listener does the render + enter animation (calling renderCurrentView
    // too would render with stale editData mid-async-load → double anim).
    if (state.get('appMode') === 'edit') {
      switchView('editor');
    } else if (state.get('selectedSkin')) {
      // Use mode + a skin is selected → make sure we're on the selector view.
      // Don't call full renderCurrentView (it would render the selector with
      // not-yet-loaded skin data when switching skins → flash of empty state).
      switchView('selector');
    }
  });

  state.on('appMode', (mode) => {
    if (mode === 'edit') {
      // Clear use-mode state to avoid stale IDs after editing
      state.set('activePresets', {});
    state.set('activeTableGroups', {});
    }
    updateModeButton();
    updateSkinHeader();
    updateToolbarButtons();

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.classList.toggle('sidebar--edit', mode === 'edit');
    }

    if (mode === 'edit') {
      // No auto-__new__ here: with a skin selected but no preset chosen, the
      // editor shows its empty/hint state. The New Preset button/Ctrl+N set
      // '__new__' explicitly when the user wants a form.
    }

    renderCurrentView();
  });

  state.on('presetDirty', () => {
    updateToolbarButtons();
  });

  state.on('activePresets', () => {
    updateToolbarButtons();
  });
  state.on('activeTableGroups', () => {
    updateToolbarButtons();
  });

  // ── Toolbar button event handlers ──
  // Blur after click so the toolbar buttons don't retain focus (they have
  // tabindex=-1 but mouse click still focuses them in WebView2).

  btnSettings.addEventListener('click', () => {
    showShortcutsDialog();
    btnSettings.blur();
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
      langBtn.blur();
    });
    // Close when clicking elsewhere
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#lang-switch')) {
        langMenu.classList.remove('lang-switch__menu--open');
      }
    });
  }

  btnRescan.addEventListener('click', () => { actionRefresh(); btnRescan.blur(); });

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
          return;
        }
      } else if (choice === 'discard') {
        // Just clear dirty — the mode switch will change the view; no need to
        // rebuild the editor (resetNew would interfere with the view switch).
        state.set('presetDirty', false);
      }
    }
    await animateModeSwitch(newMode);
  });

  btnApplyPreset.addEventListener('click', () => { actionApply(); });

  // ── Shared action functions ──
  // Single source of truth for each toolbar action. Both the toolbar button
  // and its keyboard shortcut call these so behavior never diverges.

  async function actionRefresh() {
    if (state.get('appMode') === 'edit') return;
    if (typeof window.invalidateImageCaches === 'function') window.invalidateImageCaches();
    // Fade out the selector while reloading, then fade back in.
    const viewSelector = document.getElementById('view-selector');
    if (viewSelector && state.get('appMode') === 'use') {
      await playExitAnim(viewSelector, 'main-content--exit');
    }
    await scanSkins();
    const skin = state.get('selectedSkin');
    if (skin) {
      const result = await api.scanPresets(skin);
      if (result.success) {
        state.setMultiple({
          presets: result.data.presets,
          groups: result.data.groups,
          rootChildren: result.data.rootChildren || [],
          tableExpandedChildren: result.data.tableExpandedChildren || {},
          tableRowSelection: result.data.tableRowSelection || {},
          tableActivations: result.data.tableActivations || {},
        });
      }
    }
    Toast.info(i18n.t('toast.skinsRefreshed'));
    if (viewSelector && state.get('appMode') === 'use') {
      viewSelector.classList.remove('main-content--exit');
      playEnterAnim(viewSelector, 'main-content--enter');
    }
  }

  function actionApply() {
    const mode = state.get('appMode');
    if (mode === 'use') {
      const active = state.get('activePresets') || {};
      const atg = state.get('activeTableGroups') || {};
      const activeGroupIds = Object.keys(atg).filter(k => atg[k]).map(Number);
      // The backend apply_group recursively applies each active table group's
      // selected presets (per row) + selected child groups. Collect every preset
      // id those groups will apply, so the loose list excludes them (no double
      // application). Presets in the subtree but NOT selected stay loose.
      const collectApplyUnits = window.PresetSelector?.collectApplyUnits;
      const covered = new Set();
      if (collectApplyUnits) {
        for (const gid of activeGroupIds) {
          const u = collectApplyUnits(gid);
          for (const id of u.presetIds) covered.add(id);
        }
      }
      const loosePresetIds = [].concat(...Object.values(active).filter(a => Array.isArray(a)))
        .filter(id => !covered.has(id));
      if (loosePresetIds.length === 0 && activeGroupIds.length === 0) {
        Toast.warning(i18n.t('toast.selectPresetFirst'));
        return;
      }
      ApplyDialog.showMulti({ presetIds: loosePresetIds, groupIds: activeGroupIds });
    } else {
      // Edit mode: apply the currently selected (saved) preset, OR a selected
      // checkbox-group's own actions only (not its subtree). Pass dirty so the
      // apply dialog can offer "save before applying" inline (no separate prompt).
      const dirty = !!state.get('presetDirty');
      const preset = state.get('selectedPreset');
      const selGroup = state.get('selectedGroup');
      if (selGroup != null) {
        const groups = state.get('groups') || [];
        const g = groups.find(x => x.id === selGroup);
        if (g && g.type === 'table') {
          ApplyDialog.showMulti({ groupIds: [selGroup], dirty });
          return;
        }
      }
      if (!preset || preset === '__new__') {
        Toast.warning(i18n.t('toast.selectPresetFirst'));
        return;
      }
      ApplyDialog.showMulti({ presetIds: [preset], dirty });
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

  // Clear every module's in-memory image cache so the next render re-reads
  // fresh bytes from disk. Called after applying a preset (which may copy,
  // delete, or image-edit files) so the UI no longer shows stale images.
  window.invalidateImageCaches = function () {
    ['PresetSelector', 'PreviewUpload', 'FileCopyEditor', 'TintEditor'].forEach(name => {
      const m = window[name];
      if (m && typeof m.invalidateCache === 'function') m.invalidateCache();
    });
  };

  function updateModeButton() {
    const mode = state.get('appMode');
    // The button shows the mode you'll switch TO (not the current one).
    btnToggleMode.textContent = mode === 'use' ? i18n.t('mode.edit') : i18n.t('mode.use');
    btnToggleMode.title = mode === 'use' ? i18n.t('mode.switchToEdit') : i18n.t('mode.switchToUse');
  }

  function updateToolbarButtons() {
    const mode = state.get('appMode');
    const preset = state.get('selectedPreset');
    const isNew = preset === '__new__';
    const skin = state.get('selectedSkin');

    if (mode === 'edit') {
      const selGroup = state.get('selectedGroup');
      const groups = state.get('groups') || [];
      const selGroupIsTable = selGroup != null && (groups.find(g => g.id === selGroup) || {}).type === 'table';
      btnApplyPreset.disabled = (!preset || isNew) && !selGroupIsTable;
      btnApplyPreset.textContent = i18n.t('toolbar.apply');
    } else {
      const active = state.get('activePresets') || {};
      const atg = state.get('activeTableGroups') || {};
      const atgKeys = new Set(Object.keys(atg).filter(k => atg[k]));
      const collectApplyUnits = window.PresetSelector?.collectApplyUnits;
      // Count apply units with the SAME recursion the backend apply_group uses
      // (collectApplyUnits). A table group = 1 + per-row selections (preset=1,
      // child group recurses). Plain preset groups just count selected ids.
      let total = 0;
      for (const k of Object.keys(active)) {
        if (atgKeys.has(k)) {
          if (!collectApplyUnits) continue;
          const u = collectApplyUnits(Number(k));
          total += u.presetIds.size + u.groupIds.size;
        } else {
          const arr = active[k];
          if (Array.isArray(arr)) total += new Set(arr).size;
        }
      }
      btnApplyPreset.disabled = !skin || total === 0;
      btnApplyPreset.textContent = total > 0 ? i18n.t('toolbar.applyCount', { count: total }) : i18n.t('toolbar.apply');
    }
    btnToggleMode.disabled = !skin;
    // Rescan is use-mode only (editing assumes a stable skin on disk).
    if (btnRescan) btnRescan.disabled = (mode === 'edit' || !skin);
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
  // Two views: 'program' (in-app shortcuts) and 'global' (OS-level per-preset
  // shortcuts for the current skin). Clicking the title toggles between them.
  let shortcutsRecording = null;

  function showShortcutsDialog() {
    if (document.querySelector('.modal-overlay')) return;

    // View + selection state (closure-scoped so both recorders share it).
    // Default to the global view only when there ARE bound global shortcuts;
    // otherwise stay on program view and hide the global view entirely.
    let view = (getGlobalRows().length > 0) ? 'global' : 'program';
    let globalSelected = new Set();  // keys "preset:<id>" / "group:<id>"
    let globalAnchor = -1;           // row index of the Shift-range anchor (-1 = none)
    let globalRecording = false;     // true while the global recorder captures

    // Edge-fade overlays over the table viewport — same logic/visuals as the
    // editor op-list (tint-editor setupEdgeFade): JS-driven divs that fade in
    // only when the content scrolls past that edge. Reuses the .scroll-edge-fade
    // CSS. The fades are appended to the stable .modal (not #shortcuts-body),
    // because each view render rebuilds the body's innerHTML and would otherwise
    // destroy them; `scrollEl` is the freshly-rendered .table-wrap, so re-binding
    // every render re-attaches the scroll listener to the live scroller.
    let fadeHost = null, fadeTop = null, fadeBot = null, fadeObserver = null;
    function setupEdgeFade(scrollEl) {
      fadeHost = fadeHost || overlay.querySelector('.modal');
      if (!fadeHost || !scrollEl) return;
      fadeHost.style.position = 'relative';
      const bg = 'var(--bg-secondary)';
      if (!fadeTop) {
        fadeTop = document.createElement('div');
        fadeTop.className = 'scroll-edge-fade scroll-edge-fade--top';
        fadeTop.style.background = `linear-gradient(to bottom, ${bg} 0%, transparent 100%)`;
        fadeBot = document.createElement('div');
        fadeBot.className = 'scroll-edge-fade scroll-edge-fade--bottom';
        fadeBot.style.background = `linear-gradient(to top, ${bg} 0%, transparent 100%)`;
        fadeHost.appendChild(fadeTop);
        fadeHost.appendChild(fadeBot);
      }
      const updateFade = () => {
        const r = scrollEl.getBoundingClientRect();
        const cr = fadeHost.getBoundingClientRect();
        if (r.height === 0) { fadeTop.style.opacity = '0'; fadeBot.style.opacity = '0'; return; }
        fadeTop.style.top = (r.top - cr.top) + 'px';
        fadeBot.style.bottom = (cr.bottom - r.bottom) + 'px';
        const canScroll = scrollEl.scrollHeight > scrollEl.clientHeight + 2;
        fadeTop.style.opacity = (canScroll && scrollEl.scrollTop > 2) ? '1' : '0';
        fadeBot.style.opacity = (canScroll && scrollEl.scrollTop + scrollEl.clientHeight < scrollEl.scrollHeight - 2) ? '1' : '0';
      };
      scrollEl.addEventListener('scroll', updateFade, { passive: true });
      if (fadeObserver) fadeObserver.disconnect();
      if (typeof ResizeObserver !== 'undefined') { fadeObserver = new ResizeObserver(updateFade); fadeObserver.observe(scrollEl); }
      requestAnimationFrame(updateFade);
      setTimeout(updateFade, 300);
    }

    // ── Program-shortcut view ──
    // Rebuilds the body (mirrors renderGlobalView) so toggling back from the
    // global view always restores the program table, even after renderGlobalView
    // replaced the body's innerHTML.
    function renderProgramView() {
      const body = document.getElementById('shortcuts-body');
      if (!body) return;
      body.innerHTML = `
        <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${i18n.t('dialog.shortcutsDesc')}</p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th class="col-shortcut">${i18n.t('dialog.colShortcut')}</th><th>${i18n.t('dialog.colAction')}</th><th>${i18n.t('dialog.colModes')}</th></tr></thead>
            <tbody id="shortcuts-tbody"></tbody>
          </table>
        </div>`;
      renderRows();
      renderActions();
      setupEdgeFade(body.querySelector('.table-wrap'));
    }

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
          <td class="col-shortcut"><code style="background:var(--bg-tertiary);padding:2px 8px;border-radius:var(--radius-sm);font-size:12px;color:var(--accent);white-space:nowrap">${escapeHtml(s.key)}</code></td>
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
          if (globalRecording) cancelGlobalRecording();
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
          code.style.background = 'var(--bg-tertiary)';
          code.style.fontWeight = '700';
        });
      });
    }

    function cancelRecording() {
      if (!shortcutsRecording) return;
      const { row } = shortcutsRecording;
      row.classList.remove('row--selected');
      const code = row.querySelector('code');
      code.style.color = 'var(--accent)';
      code.style.background = 'var(--bg-tertiary)';
      code.style.fontWeight = '';
      const list = Shortcuts.getAll();
      const item = list.find(s => s.id === shortcutsRecording.id);
      code.textContent = item ? item.key : '';
      shortcutsRecording = null;
    }

    function applyRecording(keyStr) {
      if (!shortcutsRecording) return;
      const { id, row } = shortcutsRecording;
      // Reject combos already bound to a DIFFERENT program action (keeps the
      // recorder open so the user can try another combo).
      const norm = (s) => s.split('+').map(p => p.trim()).sort().join('+');
      const target = norm(keyStr);
      const clash = Shortcuts.getAll().find(s => s.id !== id && norm(s.key) === target);
      if (clash) {
        Toast.warning(i18n.t('dialog.shortcutTaken', { action: clash.desc }));
        return;
      }
      Shortcuts.setBinding(id, keyStr);
      row.classList.remove('row--selected');
      const code = row.querySelector('code');
      code.textContent = keyStr;
      code.style.color = 'var(--accent)';
      code.style.background = 'var(--bg-tertiary)';
      code.style.fontWeight = '';
      shortcutsRecording = null;
    }

    // ── Global-shortcut view ──
    // Build the list of bound presets/groups for the current skin. Each entry:
    // { key: "preset:1"|"group:2", name, type ('preset'|'group'), shortcut }
    // For presets, `name` is prefixed with the group path (ancestor group names
    // joined by ' / '), mirroring the use-mode preset tree location.
    function presetGroupPath(presetId, groups) {
      const byId = new Map(groups.map(g => [g.id, g]));
      // DFS the group forest; return the ancestor chain (root→inner) whose last
      // group directly contains presetId.
      function search(groupId, chain) {
        const g = byId.get(groupId);
        if (!g || !g.children) return null;
        for (const c of g.children) {
          if (c.type === 'preset' && c.id === presetId) return chain;
          if (c.type === 'group') {
            const found = search(c.id, [...chain, c.id]);
            if (found) return found;
          }
        }
        return null;
      }
      for (const g of groups) {
        const chain = search(g.id, [g.id]);
        if (chain) return chain.map(id => (byId.get(id) || {}).name).filter(Boolean).join(' / ');
      }
      return '';  // not in any group (root-level / orphan)
    }
    // Ancestor path of a group (root→parent, EXCLUDING the group itself), joined
    // by ' / '. Empty if the group is at the root level.
    function groupAncestorPath(groupId, groups) {
      const byId = new Map(groups.map(g => [g.id, g]));
      function search(curId, chain) {
        const g = byId.get(curId);
        if (!g || !g.children) return null;
        for (const c of g.children) {
          if (c.type === 'group') {
            if (c.id === groupId) return chain;
            const found = search(c.id, [...chain, c.id]);
            if (found) return found;
          }
        }
        return null;
      }
      for (const g of groups) {
        const chain = search(g.id, [g.id]);
        if (chain) return chain.map(id => (byId.get(id) || {}).name).filter(Boolean).join(' / ');
      }
      return '';
    }
    function getGlobalRows() {
      const presets = state.get('presets') || [];
      const groups = state.get('groups') || [];
      const rows = [];
      for (const p of presets) {
        const sc = p && p.meta && p.meta.shortcut;
        if (sc) {
          const path = presetGroupPath(p.id, groups);
          const baseName = (p.meta && p.meta.name) || i18n.t('preset.fallbackName', { id: p.id });
          rows.push({
            key: 'preset:' + p.id,
            name: path ? `${path} / ${baseName}` : baseName,
            type: 'preset', shortcut: sc,
          });
        }
      }
      for (const g of groups) {
        // Only table/checkbox groups can have a global shortcut (plain groups
        // can't bind one), so any group row here is a table group.
        if (g && g.shortcut) {
          const path = groupAncestorPath(g.id, groups);
          const baseName = g.name || i18n.t('dialog.globalTypeTable');
          rows.push({
            key: 'group:' + g.id,
            name: path ? `${path} / ${baseName}` : baseName,
            type: 'group', shortcut: g.shortcut,
          });
        }
      }
      return rows;
    }

    function renderGlobalView() {
      const body = document.getElementById('shortcuts-body');
      if (!body) return;
      const skin = state.get('selectedSkin');
      const rows = skin ? getGlobalRows() : [];

      let tableHtml;
      if (!skin) {
        tableHtml = `<p style="font-size:12px;color:var(--text-muted);padding:12px 0">${escapeHtml(i18n.t('dialog.globalNoSkin'))}</p>`;
      } else if (rows.length === 0) {
        tableHtml = `<p style="font-size:12px;color:var(--text-muted);padding:12px 0">${escapeHtml(i18n.t('dialog.globalEmpty'))}</p>`;
      } else {
        tableHtml = `
          <div class="table-wrap">
            <table class="table">
              <thead><tr>
                <th class="col-shortcut">${i18n.t('dialog.colShortcut')}</th>
                <th class="col-name">${i18n.t('dialog.colName')}</th>
                <th>${i18n.t('dialog.colType')}</th>
              </tr></thead>
              <tbody id="shortcuts-tbody-global">
                ${rows.map((r, i) => `
                  <tr class="shortcut-row${globalSelected.has(r.key) ? ' row--selected' : ''}" data-sel-key="${escapeHtml(r.key)}" data-row-index="${i}">
                    <td class="col-shortcut"><code style="background:var(--bg-tertiary);padding:2px 8px;border-radius:var(--radius-sm);font-size:12px;color:#ffe600;white-space:nowrap">${escapeHtml(r.shortcut)}</code></td>
                    <td class="col-name" style="font-size:12px;color:var(--text-secondary)">${escapeHtml(r.name)}</td>
                    <td style="font-size:11px;color:var(--text-muted)">${escapeHtml(r.type === 'group' ? i18n.t('dialog.globalTypeTable') : i18n.t('dialog.globalTypePreset'))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`;
      }

      body.innerHTML = `
        <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${i18n.t('dialog.shortcutsDesc')}</p>
        ${tableHtml}
      `;

      // Wire row selection: click = single, Ctrl/Cmd+click = toggle,
      // Shift+click = range from anchor — same model as the edit-mode op list.
      const allKeys = rows.map(r => r.key);
      const tbody = document.getElementById('shortcuts-tbody-global');
      if (tbody) {
        tbody.querySelectorAll('.shortcut-row').forEach(row => {
          row.style.cursor = 'pointer';
          row.addEventListener('click', (e) => {
            if (globalRecording) cancelGlobalRecording();
            applyGlobalSel(row.dataset.selKey, {
              additive: e.ctrlKey || e.metaKey,
              range: e.shiftKey,
            }, allKeys);
          });
        });
      }
      renderActions();
      setupEdgeFade(body.querySelector('.table-wrap'));
    }

    // Render the footer actions for the current view. Program view keeps the
    // Reset + Close buttons; global view adds Rebind (warning) + Delete at the
    // right edge, plus a selection-count label.
    function renderActions() {
      const actions = overlay.querySelector('.modal__actions');
      if (!actions) return;
      const count = globalSelected.size;
      if (view === 'program') {
        actions.innerHTML = `
          <button class="btn btn--secondary btn--sm" id="shortcuts-reset">${i18n.t('dialog.resetDefault')}</button>
          <button class="btn btn--primary btn--sm" id="shortcuts-close">${i18n.t('dialog.close')}</button>`;
        const resetBtn = document.getElementById('shortcuts-reset');
        if (resetBtn) resetBtn.addEventListener('click', () => {
          Shortcuts.init({});
          state.set('shortcutBindings', {});
          if (shortcutsRecording) cancelRecording();
          renderRows();
        });
      } else {
        actions.innerHTML = `
          <span class="shortcuts-toolbar__count">${i18n.t('dialog.globalSelectedCount', { count })}</span>
          <button class="btn btn--warning btn--sm" id="global-rebind" ${count < 1 ? 'disabled' : ''}>${i18n.t('dialog.globalRebind')}</button>
          <button class="btn btn--danger btn--sm" id="global-clear" ${count < 1 ? 'disabled' : ''}>${i18n.t('dialog.globalClear')}</button>
          <button class="btn btn--primary btn--sm" id="shortcuts-close">${i18n.t('dialog.close')}</button>`;
        const rebindBtn = document.getElementById('global-rebind');
        const clearBtn = document.getElementById('global-clear');
        if (rebindBtn) rebindBtn.addEventListener('click', startGlobalRecording);
        if (clearBtn) clearBtn.addEventListener('click', clearGlobalShortcuts);
      }
      // Re-wire the Close button (its DOM node is recreated each render).
      const closeBtn = document.getElementById('shortcuts-close');
      if (closeBtn) closeBtn.addEventListener('click', close);
    }

    // Selection mirrors the edit-mode operation list (op-table createOpSelection):
    // plain click = single-select (clears rest, sets anchor), Ctrl/Cmd+click =
    // toggle one, Shift+click = range from anchor to this row. `allKeys` is the
    // visible row order (preset:<id> / group:<id>) used to resolve ranges.
    function applyGlobalSel(key, { additive, range }, allKeys) {
      const idx = allKeys.indexOf(key);
      if (range && globalAnchor !== -1 && idx !== -1) {
        const lo = Math.min(globalAnchor, idx);
        const hi = Math.max(globalAnchor, idx);
        if (!additive) globalSelected = new Set();
        for (let i = lo; i <= hi; i++) globalSelected.add(allKeys[i]);
        // anchor unchanged (Shift extends from the anchor)
      } else if (additive) {
        if (globalSelected.has(key)) globalSelected.delete(key);
        else globalSelected.add(key);
        globalAnchor = idx === -1 ? globalAnchor : idx;
      } else {
        globalSelected = new Set([key]);
        globalAnchor = idx === -1 ? -1 : idx;
      }
      // Update selection classes IN PLACE (don't rebuild the table) so the
      // scroll position and row focus are preserved — rebuilding caused a
      // visible "relocate" jump on each click.
      const tbody = document.getElementById('shortcuts-tbody-global');
      if (tbody) {
        tbody.querySelectorAll('.shortcut-row').forEach(row => {
          row.classList.toggle('row--selected', globalSelected.has(row.dataset.selKey));
        });
      }
      renderActions();
    }

    function startGlobalRecording() {
      if (globalSelected.size < 1) return;
      if (shortcutsRecording) cancelRecording();
      const skin = state.get('selectedSkin');
      if (!skin) { Toast.warning(i18n.t('dialog.globalNoSkin')); return; }
      globalRecording = true;
      // Temporarily unregister OS shortcuts so the OS doesn't swallow the combo
      // before the renderer keydown sees it.
      try { api.reloadGlobalShortcuts(null); } catch (e) { /* best-effort */ }
      // Pulse the shortcut cell of each selected row.
      const tbody = document.getElementById('shortcuts-tbody-global');
      if (tbody) {
        tbody.querySelectorAll('.shortcut-row').forEach(row => {
          if (!globalSelected.has(row.dataset.selKey)) return;
          const code = row.querySelector('code');
          if (code) {
            code.textContent = i18n.t('dialog.pressNewKey');
            code.style.color = 'var(--danger)';
            code.style.background = 'var(--bg-tertiary)';
            code.style.fontWeight = '700';
          }
        });
      }
      // Flip the footer actions into capture mode (Cancel replaces Rebind/Delete).
      const actions = overlay.querySelector('.modal__actions');
      if (actions) {
        actions.innerHTML = `
          <span class="shortcuts-toolbar__count">${i18n.t('dialog.globalSelectedCount', { count: globalSelected.size })}</span>
          <button class="btn btn--secondary btn--sm" id="global-cancel">${i18n.t('dialog.cancel')}</button>
          <button class="btn btn--primary btn--sm" id="shortcuts-close">${i18n.t('dialog.close')}</button>`;
        const cancelBtn = document.getElementById('global-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => cancelGlobalRecording());
        const closeBtn = document.getElementById('shortcuts-close');
        if (closeBtn) closeBtn.addEventListener('click', close);
      }
    }

    function cancelGlobalRecording() {
      if (!globalRecording) return;
      globalRecording = false;
      const skin = state.get('selectedSkin');
      if (skin) { try { api.reloadGlobalShortcuts(skin); } catch (e) { /* best-effort */ } }
      renderGlobalView();
    }

    async function bindGlobalShortcut(accelerator) {
      const skin = state.get('selectedSkin');
      if (!skin) { cancelGlobalRecording(); return; }
      // Conflict with a program shortcut → warn, keep recording.
      const appKeys = new Set((window.Shortcuts.getAll ? window.Shortcuts.getAll() : []).map(s => s.key).filter(Boolean));
      if (appKeys.has(accelerator)) {
        Toast.warning(i18n.t('selector.shortcutConflict'));
        return;
      }
      const ids = [...globalSelected];
      const presetIds = ids.filter(k => k.startsWith('preset:')).map(k => parseInt(k.split(':')[1], 10));
      const groupIds = ids.filter(k => k.startsWith('group:')).map(k => parseInt(k.split(':')[1], 10));
      try {
        // Single batched bind: persists all presets + groups in one pass and
        // re-registers once (was: N reloads — one per preset/group — plus a
        // redundant rescan + reload at the end).
        const bindResult = await api.bindGlobalShortcutBatch(skin, presetIds, groupIds, accelerator);
        if (bindResult && !bindResult.success) { Toast.error((bindResult.error) || i18n.t('selector.bindFailed')); }
        Toast.success(i18n.t('selector.bound', { acc: accelerator, count: ids.length }));
        const scan = await api.scanPresets(skin);
        if (scan && scan.success) {
          state.set('presets', scan.data.presets);
          state.set('groups', scan.data.groups);
        }
      } catch (e) {
        Toast.error((e && e.message) || i18n.t('selector.bindFailed'));
      }
      globalRecording = false; // already re-registered above
      globalSelected = new Set();
      globalAnchor = -1;
      renderGlobalView();
    }

    async function clearGlobalShortcuts() {
      const skin = state.get('selectedSkin');
      if (!skin) { Toast.warning(i18n.t('dialog.globalNoSkin')); return; }
      const ids = [...globalSelected];
      const presetIds = ids.filter(k => k.startsWith('preset:')).map(k => parseInt(k.split(':')[1], 10));
      const groupIds = ids.filter(k => k.startsWith('group:')).map(k => parseInt(k.split(':')[1], 10));
      try {
        // Batched clear: empty accelerator clears all selected presets + groups
        // in one pass, re-registering once (was: N reloads).
        await api.bindGlobalShortcutBatch(skin, presetIds, groupIds, '');
        Toast.success(i18n.t('selector.cleared'));
        const scan = await api.scanPresets(skin);
        if (scan && scan.success) {
          state.set('presets', scan.data.presets);
          state.set('groups', scan.data.groups);
        }
      } catch (e) {
        Toast.error((e && e.message) || i18n.t('selector.clearFailed'));
      }
      globalSelected = new Set();
      globalAnchor = -1;
      // If no global shortcuts remain, switch to (and lock on) the program view.
      if (getGlobalRows().length === 0) { setView('program'); renderTitle(); }
      else renderGlobalView();
    }

    // ── Title toggle + view switch ──
    // The title is a click-toggle only when global shortcuts exist; otherwise
    // the global view is hidden and the title is a plain (non-clickable) label.
    function renderTitle() {
      const titleEl = document.getElementById('shortcuts-title');
      if (!titleEl) return;
      const hasGlobal = getGlobalRows().length > 0;
      titleEl.classList.toggle('modal__title--toggle', hasGlobal);
      if (!hasGlobal) {
        titleEl.innerHTML = i18n.t('dialog.shortcutsTitle');
        return;
      }
      const isProgram = view === 'program';
      titleEl.innerHTML = `${isProgram ? i18n.t('dialog.shortcutsTitle') : i18n.t('dialog.shortcutsTitleGlobal')}<span class="modal__title-hint">${i18n.t('dialog.clickToSwitch')}</span>`;
    }

    function setView(v) {
      if (v === view) return;
      if (globalRecording) cancelGlobalRecording();
      if (shortcutsRecording) cancelRecording();
      globalSelected = new Set();
      globalAnchor = -1;
      const from = view;
      view = v;
      renderTitle();
      // Slide transition (mirrors the skin-list / mode-switch animation):
      // global→program: global exits left, program enters left.
      // program→global: program exits right, global enters right.
      const body = document.getElementById('shortcuts-body');
      const ANIM = ['mode-anim--exit-left', 'mode-anim--enter-left', 'mode-anim--exit-right', 'mode-anim--enter-right'];
      const PHASE = 200; // matches --mode-anim-dur (0.2s)
      const toProgram = v === 'program';
      const exitCls = toProgram ? 'mode-anim--exit-left' : 'mode-anim--exit-right';
      const enterCls = toProgram ? 'mode-anim--enter-right' : 'mode-anim--enter-left';
      if (!body) {
        if (v === 'program') renderProgramView();
        else renderGlobalView();
        return;
      }
      body.classList.remove(...ANIM);
      void body.offsetWidth;
      body.classList.add(exitCls);
      setTimeout(() => {
        body.classList.remove(exitCls);
        if (v === 'program') renderProgramView();
        else renderGlobalView();
        void body.offsetWidth;
        body.classList.add(enterCls);
        setTimeout(() => body.classList.remove(enterCls), PHASE);
      }, PHASE);
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'shortcuts-dialog';
    overlay.innerHTML = `
      <div class="modal" style="min-width:480px;max-width:620px">
        <div class="modal__title modal__title--toggle" id="shortcuts-title"></div>
        <div class="modal__body" id="shortcuts-body"></div>
        <div class="modal__actions"></div>
      </div>
    `;

    // close + onKey must be defined BEFORE the views render: renderProgramView/
    // renderGlobalView → renderActions() binds the Close button to `close`, and
    // onKey is referenced inside close(). Declaring them up front avoids the
    // const temporal-dead-zone ReferenceError that otherwise broke closing.
    const close = async () => {
      // Cancel any active recorder first so OS shortcuts get re-registered.
      if (globalRecording) {
        globalRecording = false;
        const skin = state.get('selectedSkin');
        if (skin) { try { api.reloadGlobalShortcuts(skin); } catch (e) { /* best-effort */ } }
      }
      shortcutsRecording = null;
      const raw = Shortcuts.getRawBindings();
      await api.saveShortcuts(raw);
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };

    // Unified keydown: route to whichever recorder is active.
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (globalRecording) { e.preventDefault(); cancelGlobalRecording(); return; }
        if (shortcutsRecording) { e.preventDefault(); cancelRecording(); return; }
        close();
        return;
      }
      if (globalRecording) {
        e.preventDefault();
        e.stopPropagation();
        const acc = window.Shortcuts.keyToAccelerator(e);
        if (acc) bindGlobalShortcut(acc);
        return;
      }
      if (shortcutsRecording) {
        e.preventDefault();
        e.stopPropagation();
        const keyStr = Shortcuts.keyToString(e);
        if (keyStr) applyRecording(keyStr);
      }
    };

    document.body.appendChild(overlay);
    renderTitle();
    if (view === 'program') renderProgramView();
    else renderGlobalView();

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('#shortcuts-title').addEventListener('click', () => {
      // Only toggle when global shortcuts exist (otherwise the global view is hidden).
      if (getGlobalRows().length === 0) return;
      setView(view === 'program' ? 'global' : 'program');
    });
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

  // Suppress WebView2/Edge built-in shortcuts that conflict with app shortcuts.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); }
  }, true);

  // ── Esc/Enter confirm: delegate to InputConfirm module ──
  // Replaces the hardcoded global handler. Enter blurs <input> (not textarea);
  // Escape blurs any focused element in edit mode.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.key !== 'Enter') return;
    const isModal = !!document.querySelector('.modal-overlay') || !document.getElementById('info-overlay')?.hidden;
    if (isModal) return;
    // Color picker popover: close on ESC/Enter regardless of focus.
    if (document.querySelector('.cp-popover')) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (window.ColorPicker && typeof window.ColorPicker.closeAll === 'function') window.ColorPicker.closeAll();
      return;
    }
    const activeEl = document.activeElement;
    if (!activeEl || activeEl === document.body) return;
    if (e.key === 'Enter') {
      if (activeEl.tagName !== 'INPUT') return;
      e.preventDefault();
      activeEl.blur();
    } else {
      // <input> Escape (restore + cancel) is handled by InputConfirm; skip here.
      if (activeEl.tagName === 'INPUT') return;
      if (state.get('appMode') === 'edit') { e.preventDefault(); activeEl.blur(); }
    }
  });

  // Auto-attach Enter/Escape confirm to all current + future inputs.
  if (window.InputConfirm && typeof window.InputConfirm.observe === 'function') {
    window.InputConfirm.observe();
  }

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
    const _info = document.getElementById('info-overlay');
    const isModal = !!document.querySelector('.modal-overlay') || (_rec && _rec.style.display !== 'none') || (_info && !_info.hidden);

    // Escape clears the current selection (single or multi) in edit mode.
    // Escape clears the current selection (single or multi) in edit mode — but
    // ONLY when the keydown's target was NOT a focusable element (so a focused
    // input/button keeps its own Escape behavior: the dedicated blur handler at
    // the top blurs the field; the selection is cleared only on a subsequent
    // Escape when nothing is focused). Prompt to save unsaved edits before
    // discarding the selection.
    const escTargetIsFocusable = e.target && e.target !== document.body
      && e.target.matches && e.target.matches('input, textarea, select, button, [contenteditable], [tabindex]');
    // Don't clear selection while a color picker popover is open.
    if (e.key === 'Escape' && state.get('appMode') === 'edit' && !isModal && !escTargetIsFocusable && !document.querySelector('.cp-popover')) {
      // First ESC: clear the active operation-table selection (ini/file/tint
      // rows), if any. Only when none is selected does ESC proceed to clear the
      // preset selection — so a single ESC cancels the innermost selection first.
      const activeTabEl = document.querySelector('.tab-content--active');
      const editorFor = (id, name) => id && document.getElementById(id) === activeTabEl ? window[name] : null;
      const ed = editorFor('tab-ini', 'IniEditor') || editorFor('tab-files', 'FileCopyEditor') || editorFor('tab-tint', 'TintEditor');
      if (ed && typeof ed.hasSelection === 'function' && ed.hasSelection()) {
        if (typeof ed.clearSelection === 'function') ed.clearSelection();
        return;
      }
      // Next: clear activation-binding selection (innermost after op-tables).
      if (window.ActivationBinding && window.ActivationBinding.hasSelection()) {
        window.ActivationBinding.clearSelection();
        return;
      }
      const proceed = async () => {
        if (window.PresetList && typeof window.PresetList.confirmSwitchIfDirty === 'function') {
          if (!await window.PresetList.confirmSwitchIfDirty()) return;
        }
        if (window.PresetList && typeof window.PresetList.clearSelection === 'function') {
          window.PresetList.clearSelection();
        }
      };
      proceed();
      return;
    }
    // Use mode: Escape is layered — cancel right-click (shortcut) selection
    // first, then clear preset/checkbox-group selection, then deselect the skin.
    if (e.key === 'Escape' && state.get('appMode') === 'use' && !isModal && !escTargetIsFocusable && !document.querySelector('.cp-popover')) {
      // 1. Right-click shortcut selection (or active recorder).
      if (window.PresetSelector && typeof window.PresetSelector.hasShortcutSelection === 'function' && window.PresetSelector.hasShortcutSelection()) {
        if (typeof window.PresetSelector.clearShortcutSelection === 'function') window.PresetSelector.clearShortcutSelection();
        return;
      }
      // 2. Preset / checkbox-group selection.
      const ap = state.get('activePresets') || {};
      const atg = state.get('activeTableGroups') || {};
      const hasSel = Object.keys(ap).length > 0 || Object.keys(atg).length > 0;
      if (hasSel) {
        state.setMultiple({ activePresets: {}, activeTableGroups: {} });
      } else {
        // 3. Deselect the skin (back to welcome/selector).
        api.setLastSkin(null);
        state.set('selectedSkin', null);
      }
      return;
    }

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
          // Use mode: Tab is disabled (no cycling outside editor/modal).
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
      // Number-key tab switching only when the editor is actually usable:
      // not multi-select, not the empty/no-selection state, not a plain group.
      if (state.get('multiSelectActive')) return;
      const sp = state.get('selectedPreset');
      const sg = state.get('selectedGroup');
      if (sp == null && sg == null) return; // empty state — tabs disabled
      if (sg != null) {
        const g = (state.get('groups') || []).find(x => x.id === sg);
        if (g && g.type !== 'table') return;
      }
      const tabs = ['basic', 'ini', 'files', 'tint'];
      const idx = parseInt(e.key) - 1;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('tab-content--active'));
      const targetTab = document.querySelector(`.tab[data-tab="${tabs[idx]}"]`);
      const targetEl = document.getElementById(`tab-${tabs[idx]}`);
      if (targetTab) targetTab.classList.add('tab--active');
      if (targetEl) {
        targetEl.classList.add('tab-content--active');
        // Scale-fade the newly shown content in + move the sliding underline.
        targetEl.classList.remove('main-content--enter');
        void targetEl.offsetWidth;
        targetEl.classList.add('main-content--enter');
        targetEl.addEventListener('animationend', () => targetEl.classList.remove('main-content--enter'), { once: true });
      }
      if (window.PresetEditor && typeof window.PresetEditor.moveTabIndicator === 'function') {
        window.PresetEditor.moveTabIndicator(targetTab);
      }
      if (tabs[idx] === 'tint' && window.TintEditor && window.TintEditor.layoutColumns) {
        window.TintEditor.layoutColumns(targetEl);
      }
    }

    const action = Shortcuts.matchAction(e);
    // While the shortcut recorder is open, suppress ALL program shortcuts so
    // the recorded combo can't accidentally trigger one (e.g. Ctrl+E toggle).
    // Exception: Space/Enter on a focused button must still activate it.
    if (action) {
      const _recEl = document.getElementById('shortcut-recorder');
      const recorderOpen = _recEl && _recEl.style.display !== 'none';
      const activatingButton = isButton && (e.key === ' ' || e.key === 'Enter');
      if (recorderOpen && !activatingButton) {
        e.preventDefault();
        return;
      }
    }
    if (!action) return;
    // Disable custom shortcuts while any modal/dialog overlay is open
    if (isModal) return;
    // Disable all action shortcuts when no skin is selected
    if (!state.get('selectedSkin')) return;

    const shortcutDef = Shortcuts.getAll().find(s => s.id === action);
    if (shortcutDef && shortcutDef.modes && !shortcutDef.modes.includes(state.get('appMode'))) return;

    switch (action) {
      case 'save':
        // Skip when there's nothing to save. Group mode: only when dirty.
        // Preset mode: dirty OR new preset (allow continuous saving).
        if (state.get('selectedGroup') != null) {
          if (!state.get('presetDirty')) break;
        } else {
          if (!state.get('presetDirty') && state.get('selectedPreset') !== '__new__') break;
        }
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

      case 'new-table-group':
        if (state.get('appMode') !== 'edit') break;
        e.preventDefault();
        {
          document.getElementById('btn-new-table-group')?.click();
        }
        break;

      case 'copy-item':
        if (state.get('appMode') !== 'edit') break;
        if (isInput) break;
        e.preventDefault();
        if (window.PresetList && typeof window.PresetList.duplicateSelected === 'function') {
          window.PresetList.duplicateSelected();
        }
        break;

      case 'copy-actions':
        if (state.get('appMode') !== 'edit') break;
        // Only copy when NOT focused in an input (let native text copy work in
        // inputs) AND when rows are actually selected. copyActions returns true
        // when it copied; otherwise fall through (no preventDefault) so the
        // browser's default is untouched.
        if (isInput) break;
        if (window.PresetEditor && typeof window.PresetEditor.copyActions === 'function') {
          if (window.PresetEditor.copyActions()) e.preventDefault();
        }
        break;

      case 'paste-actions':
        if (state.get('appMode') !== 'edit') break;
        // Only paste when NOT focused in an input — let native text paste work
        // in inputs.
        if (isInput) break;
        e.preventDefault();
        if (window.PresetEditor && typeof window.PresetEditor.pasteActions === 'function') {
          window.PresetEditor.pasteActions();
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
  // (Only the app-level native menu is suppressed here.) Preset rows in
  // preset-selector.js attach their own contextmenu handler + preventDefault;
  // preventDefault is idempotent and we do NOT stopPropagation, so those custom
  // right-click flows (shortcut binding) keep working.
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // ── Boot ──
  init();
})();
