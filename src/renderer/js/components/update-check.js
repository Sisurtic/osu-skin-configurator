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
     * Download the latest installer and launch it. Call when the user clicks
     * the update dot (or the info-dialog update button). Resolves to true on
     * success, false otherwise. Shows a spinning progress ring on the titlebar
     * dot while downloading (the yellow dot shrinks/fades out, the ring scales/
     * fades in and fills with progress).
     */
    async downloadAndRun() {
      // Ignore re-triggers while a download is already in flight — otherwise a
      // second click starts a parallel download, pops a second save dialog, and
      // the second call's "cancelled" mis-reports the first one's outcome.
      if (this._downloading) return false;
      if (!this.hasUpdate() && !this.lastResult) {
        // No cached result yet — check first.
        const r = await this.check();
        if (!r || !r.isUpdate) return false;
      }
      this._downloading = true;
      this._startRing();
      let result;
      try {
        result = await api.downloadAndRunLatestRelease();
      } catch (_) {
        this._stopRing();
        Toast.error(i18n.t('update.downloadFailed'));
        return false;
      }
      this._stopRing();
      // Cancelled (user dismissed the save dialog) — its own message, NOT the
      // "saved to <path>" success toast (data is the literal 'cancelled').
      if (result && result.success && result.data === 'cancelled') {
        Toast.info(i18n.t('update.downloadCancelled'));
        return false;
      }
      if (!result || !result.success) {
        Toast.error(i18n.t('update.downloadFailedDetail', { msg: (result && result.error) || '' }));
        return false;
      }
      Toast.success(i18n.t('update.downloaded', { name: result.data }));
      return true;
    },

    // ── Download progress ring ──
    // Circumference of the r=6 circle in the 16×16 viewBox: 2π·6 ≈ 37.699.
    _RING_C: 37.699,
    _progressUnlisten: null,
    _spinRAF: 0,
    _spinAngle: 0,
    _spinLastT: 0,
    _realRatio: 0,
    _displayRatio: 0,
    _ringShown: false,

    /** Start listening for download progress. The ring is NOT shown yet — it
     *  appears only when the first progress event arrives (i.e. the save dialog
     *  was dismissed and bytes actually started flowing), so the spinner isn't
     *  shown during the file-picker. */
    _startRing() {
      this._ringShown = false;
      this._setRingProgress(0);
      const T = window.__TAURI__;
      if (T && T.event && T.event.listen) {
        T.event.listen('update-download-progress', (e) => {
          const p = e && e.payload;
          if (!p) return;
          if (!this._ringShown) {
            // First byte — show the ring now (download truly started).
            this._ringShown = true;
            const dot = document.querySelector('.titlebar__dot');
            if (dot) dot.classList.add('titlebar__dot--downloading');
            this._startSpin();
          }
          if (p.done) { this._setRingProgress(1); return; }
          const ratio = p.total > 0 ? Math.min(1, p.downloaded / p.total) : 0;
          this._setRingProgress(ratio);
        }).then((un) => { this._progressUnlisten = un; }).catch(() => {});
      }
    },

    /** Spin the SVG via rAF (monotonic angle, ~340°/rev, eased). Each rev the
     *  arc BREATHES: extends from the real progress toward a full circle, then
     *  retracts back (from its head end) to the real progress. */
    _startSpin() {
      this._spinAngle = 0;
      this._displayRatio = 0;            // smoothed progress (color only)
      this._spinLastT = performance.now();
      const REV = 360;
      const DURATION = 1500;
      const ring = document.querySelector('.titlebar__ring');
      const head = document.querySelector('.titlebar__ring-head');
      const step = (now) => {
        const dt = now - this._spinLastT;
        this._spinLastT = now;
        // Smoothed progress drives ONLY the color (yellow→green), never the
        // arc length — the length is a fixed 0→full→0 breath independent of
        // progress, so progress jumps never disturb the animation.
        const k = 1 - Math.exp(-dt / 120);
        this._displayRatio += (this._realRatio - this._displayRatio) * k;
        if (head) head.setAttribute('stroke', this._progressColor(this._displayRatio));
        this._spinAngle += (dt / DURATION) * REV;
        if (ring) ring.style.transform = `rotate(${this._spinAngle}deg)`;
        const within = ((this._spinAngle % REV) + REV) % REV / REV;
        this._pulseHead(within);
        this._spinRAF = requestAnimationFrame(step);
      };
      this._spinRAF = requestAnimationFrame(step);
    },

    /** Store the real download progress; color updates next spin frame. */
    _setRingProgress(ratio) {
      this._realRatio = Math.max(0, Math.min(1, ratio));
    },

    /** Cancel an in-flight download (right-click on the dot). No-op if not
     *  downloading. */
    cancelDownload() {
      if (!this._downloading) return;
      const T = window.__TAURI__;
      if (T && T.core && T.core.invoke) {
        T.core.invoke('cancel_update_download').catch(() => {});
      }
    },

    /** Breathe the arc: head extends (within 0→0.5), tail retracts (0.5→1),
     *  full circle at the midpoint. Length does NOT depend on download
     *  progress — it's a pure 0→full→0 breath, so progress updates only change
     *  the color, never disturb the animation. */
    _pulseHead(within) {
      const head = document.querySelector('.titlebar__ring-head');
      if (!head) return;
      const w = Math.max(0, Math.min(1, within));
      const C = this._RING_C;
      let lenRatio, offset;
      if (w <= 0.5) {
        lenRatio = w * 2;            // 0 → full (head extends)
        offset = 0;
      } else {
        lenRatio = (1 - w) * 2;      // full → 0 (tail retracts)
        offset = -(C - lenRatio * C);
      }
      head.setAttribute('stroke-dasharray', `${lenRatio * C} ${C}`);
      head.setAttribute('stroke-dashoffset', String(offset));
    },

    /** Interpolate the ring color yellow→green by progress (0→1). */
    _progressColor(t) {
      const lerp = (a, b, k) => Math.round(a + (b - a) * k);
      // #e0a040 (224,160,64) → #36d399 (54,211,153)
      const r = lerp(0xe0, 0x36, t);
      const g = lerp(0xa0, 0xd3, t);
      const b = lerp(0x40, 0x99, t);
      return `rgb(${r},${g},${b})`;
    },

    /** Restore the yellow dot. */
    _stopRing() {
      this._downloading = false;
      if (this._spinRAF) { cancelAnimationFrame(this._spinRAF); this._spinRAF = 0; }
      const ring = document.querySelector('.titlebar__ring');
      if (ring) ring.style.transform = '';
      const dot = document.querySelector('.titlebar__dot');
      if (dot) dot.classList.remove('titlebar__dot--downloading');
      if (this._progressUnlisten) { try { this._progressUnlisten(); } catch (_) {} this._progressUnlisten = null; }
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
    // Right-click cancels an in-flight download.
    dot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      UpdateCheck.cancelDownload();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDot);
  } else {
    bindDot();
  }

  window.UpdateCheck = UpdateCheck;
})();
