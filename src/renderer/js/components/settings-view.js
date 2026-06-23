// Settings view: osu! path detection and manual browse
(function () {
  const viewEl = document.getElementById('view-settings');

  let autoDetectRunning = false;

  function render() {
    const osuPath = state.get('osuPath');
    if (osuPath) {
      autoDetectRunning = false;
      viewEl.innerHTML = `
        <div class="card">
          <div class="card__icon">✅</div>
          <h2 class="card__title">${i18n.t('settings.pathSet')}</h2>
          <p class="card__desc" style="word-break:break-all">${escapeHtml(osuPath)}</p>
          <div style="text-align:center">
            <button class="btn btn--secondary" id="btn-change-path">${i18n.t('settings.changePath')}</button>
          </div>
        </div>
      `;
      document.getElementById('btn-change-path').addEventListener('click', doBrowse);
    } else {
      viewEl.innerHTML = `
        <div class="card">
          <div class="card__icon">🔍</div>
          <h2 class="card__title">${i18n.t('settings.detecting')}</h2>
          <p class="card__desc">${i18n.t('settings.detectHint')}</p>
          <div style="text-align:center">
            <button class="btn btn--primary" id="btn-auto-detect">${i18n.t('settings.autoDetect')}</button>
            <button class="btn btn--secondary" id="btn-browse-path" style="margin-left:8px">${i18n.t('settings.browse')}</button>
          </div>
          <p id="detect-status" style="text-align:center;margin-top:12px;font-size:13px;color:var(--text-muted)"></p>
        </div>
      `;
      document.getElementById('btn-auto-detect').addEventListener('click', doAutoDetect);
      document.getElementById('btn-browse-path').addEventListener('click', doBrowse);
      // Auto-trigger detection when entering settings without a path
      if (!autoDetectRunning) {
        autoDetectRunning = true;
        doAutoDetect();
      }
    }
  }

  async function doAutoDetect() {
    const statusEl = document.getElementById('detect-status');
    if (statusEl) statusEl.textContent = i18n.t('settings.searching');
    const result = await api.autoDetectOsuPath();
    if (result.success && result.data) {
      await api.setOsuPath(result.data);
      state.set('osuPath', result.data);
      Toast.success(i18n.t('settings.detectedOk'));
    } else {
      if (statusEl) statusEl.textContent = i18n.t('settings.detectedFail');
      Toast.warning(i18n.t('settings.notFoundManual'));
    }
    autoDetectRunning = false;
  }

  async function doBrowse() {
    const result = await api.browseForOsuPath();
    if (result.success && result.data) {
      await api.setOsuPath(result.data);
      state.set('osuPath', result.data);
      Toast.success(i18n.t('settings.pathSetShort'));
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Listen for osuPath changes
  state.on('osuPath', () => render());

  // Expose render for init
  window.SettingsView = { render };
})();
