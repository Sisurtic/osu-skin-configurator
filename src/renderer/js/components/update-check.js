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
        dot.title = i18n.t('info.dotTooltip', { ver: this.lastResult.latest_version });
      } else {
        dot.classList.remove('titlebar__dot--update');
        dot.title = '';
      }
    },

    /**
     * Download the latest installer and launch it. Call when the user clicks
     * the update dot (or the info-dialog update button). Resolves to true on
     * success, false otherwise.
     */
    async downloadAndRun() {
      if (!this.hasUpdate() && !this.lastResult) {
        // No cached result yet — check first.
        const r = await this.check();
        if (!r || !r.isUpdate) return false;
      }
      let result;
      try {
        result = await api.downloadAndRunLatestRelease();
      } catch (_) {
        Toast.error(i18n.t('update.downloadFailed'));
        return false;
      }
      if (!result || !result.success) {
        if (result && result.data === 'cancelled') return false;
        Toast.error(i18n.t('update.downloadFailedDetail', { msg: (result && result.error) || '' }));
        return false;
      }
      Toast.success(i18n.t('update.downloaded', { name: result.data }));
      return true;
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
