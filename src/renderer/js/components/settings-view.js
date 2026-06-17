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
          <h2 class="card__title">osu! 路径已设置</h2>
          <p class="card__desc" style="word-break:break-all">${escapeHtml(osuPath)}</p>
          <div style="text-align:center">
            <button class="btn btn--secondary" id="btn-change-path">🔄 更换路径</button>
          </div>
        </div>
      `;
      document.getElementById('btn-change-path').addEventListener('click', doBrowse);
    } else {
      viewEl.innerHTML = `
        <div class="card">
          <div class="card__icon">🔍</div>
          <h2 class="card__title">正在检测 osu! 安装路径…</h2>
          <p class="card__desc">如果未自动检测到，请手动选择 osu! 安装目录</p>
          <div style="text-align:center">
            <button class="btn btn--primary" id="btn-auto-detect">🔍 自动检测</button>
            <button class="btn btn--secondary" id="btn-browse-path" style="margin-left:8px">📂 手动浏览</button>
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
    if (statusEl) statusEl.textContent = '正在搜索…';
    const result = await api.autoDetectOsuPath();
    if (result.success && result.data) {
      await api.setOsuPath(result.data);
      state.set('osuPath', result.data);
      Toast.success('已自动检测到 osu! 路径');
    } else {
      if (statusEl) statusEl.textContent = '未找到，请手动浏览选择';
      Toast.warning('未找到 osu! 安装路径，请手动选择');
    }
    autoDetectRunning = false;
  }

  async function doBrowse() {
    const result = await api.browseForOsuPath();
    if (result.success && result.data) {
      await api.setOsuPath(result.data);
      state.set('osuPath', result.data);
      Toast.success('osu! 路径已设置');
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
