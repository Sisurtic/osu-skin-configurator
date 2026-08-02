// GitHub release update check.
//
// On startup (and via the info dialog's "检查更新" button) we ask the Rust
// backend whether a newer release exists on GitHub. If so, the title bar's
// left dot gains a gradient + breathing-glow animation; clicking it downloads
// the installer and runs it (in-place upgrade). Everything fails silent.
(function () {
  const UpdateCheck = {
    /** Latest check result, or null. { latestVersion, releaseUrl, isUpdate } */
    lastResult: null,

    /** Fire a (non-throwing) check and update the dot. Returns the result. */
    async check() {
      let result;
      try {
        result = await api.checkLatestRelease();
      } catch (_) {
        return null; // fail silent
      }
      if (!result || !result.success || !result.data) return null;
      this.lastResult = result.data;
      this._render();
      return result.data;
    },

    /** True if the last check found a newer version. */
    hasUpdate() {
      return !!(this.lastResult && this.lastResult.isUpdate);
    },

    /** Apply the dot animation state based on lastResult. */
    _render() {
      const dot = document.querySelector('.titlebar__dot');
      if (!dot) return;
      if (this.hasUpdate()) {
        dot.classList.add('titlebar__dot--update');
        dot.title = i18n.t('info.dotTooltip', { ver: this.lastResult.latestVersion });
      } else {
        dot.classList.remove('titlebar__dot--update');
        dot.title = '';
      }
    },

    /**
     * Open the Releases page in the browser so the user can download the update
     * manually (faster than in-app download for users behind slow GitHub access).
     */
    async downloadAndRun() {
      if (!this.hasUpdate() && !this.lastResult) {
        const r = await this.check();
        if (!r || !r.isUpdate) return false;
      }
      const url = this.lastResult && this.lastResult.releaseUrl;
      if (!url) { Toast.error(i18n.t('update.downloadFailed')); return false; }
      try {
        const T = window.__TAURI__;
        if (T && T.opener && T.opener.openUrl) await T.opener.openUrl(url);
        else window.open(url, '_blank');
        return true;
      } catch (_) {
        Toast.error(i18n.t('update.downloadFailed'));
        return false;
      }
    },

  };


  // Wire the dot click once the DOM is ready.
  function bindDot() {
    const dot = document.querySelector('.titlebar__dot');
    if (!dot || dot.dataset.updateBound) return;
    dot.dataset.updateBound = '1';
    dot.style.cursor = 'pointer';
    dot.addEventListener('click', async () => {
      if (!UpdateCheck.hasUpdate()) return;
      await UpdateCheck.downloadAndRun();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDot);
  } else {
    bindDot();
  }

  window.UpdateCheck = UpdateCheck;
})();
