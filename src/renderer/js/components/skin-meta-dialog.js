// Skin metadata dialog: per-skin accent hue + two free-text lines.
//
// Opened by clicking the "current skin" name in the edit-mode sidebar header
// (app.js updateSkinHeader). Uses the standard centered .modal frame; the hue
// picker reuses color-picker's .cp-hue-track rainbow gradient with a small
// drag handle. Dragging live-applies the hue to the whole UI (window.applyAccent)
// so the user sees every accent consumer recolor in real time; cancel rolls
// back to the hue that was active when the dialog opened. Values persist into
// the skin's own config.osp via the skin_set_meta IPC.
(function () {
  const DEFAULT_HUE = 140; // lazer green, matches variables.css --accent
  let overlay = null;
  let onKey = null;

  function open() {
    if (overlay) return; // already open
    const skin = state.get('selectedSkin');
    if (!skin) return;
    const meta = state.get('skinMeta') || {};
    const initialHue = (meta.accentHue === null || meta.accentHue === undefined) ? DEFAULT_HUE : meta.accentHue;
    const t1 = meta.customText1 || '';
    const t2 = meta.customText2 || '';
    const link = meta.skinLink || '';

    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'skin-meta-dialog';
    overlay.innerHTML = `
      <div class="modal" style="min-width:420px;max-width:460px">
        <div class="modal__title">${i18n.t('skinMeta.title')}</div>
        <div class="modal__body">
          <div class="skin-meta__row">
            <label class="skin-meta__label">${i18n.t('skinMeta.hue')}</label>
            <div class="skin-meta__hue-wrap">
              <div class="skin-meta__hue-grid" id="skin-meta-hue-grid"></div>
            </div>
          </div>
          <div class="skin-meta__row">
            <label class="skin-meta__label">${i18n.t('skinMeta.text1')}</label>
            <input type="text" class="form-input skin-meta__text" id="skin-meta-text1" maxlength="200" value="${escapeAttr(t1)}">
          </div>
          <div class="skin-meta__row">
            <label class="skin-meta__label">${i18n.t('skinMeta.text2')}</label>
            <input type="text" class="form-input skin-meta__text" id="skin-meta-text2" maxlength="200" value="${escapeAttr(t2)}">
          </div>
          <div class="skin-meta__row">
            <label class="skin-meta__label">${i18n.t('skinMeta.link')}</label>
            <input type="text" class="form-input skin-meta__text" id="skin-meta-link" maxlength="500" placeholder="https://" value="${escapeAttr(link)}">
          </div>
        </div>
        <div class="modal__actions">
          <button class="btn btn--secondary btn--sm" data-act="cancel">${i18n.t('dialog.cancel')}</button>
          <button class="btn btn--primary btn--sm" data-act="save">${i18n.t('dialog.confirm')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Dashed hue row: 30 discrete segments (12° each) with gaps between them
    // (no continuous gradient). Supports drag across the row and click; both
    // snap to the nearest segment. The selected segment grows taller.
    const STEP = 12;
    const COUNT = 360 / STEP;
    const grid = overlay.querySelector('#skin-meta-hue-grid');
    let currentHue = snap(initialHue);

    function snap(h) { return (Math.round((((h % 360) + 360) % 360) / STEP) * STEP) % 360; }

    const segments = [];
    for (let i = 0; i < COUNT; i++) {
      const hue = i * STEP;
      const seg = document.createElement('div');
      seg.className = 'skin-meta__hue-seg';
      seg.style.background = `hsl(${hue}, 60%, 65%)`;
      seg.dataset.hue = hue;
      grid.appendChild(seg);
      segments.push(seg);
    }

    function setSelected(hue) {
      currentHue = hue;
      segments.forEach(s => {
        s.classList.toggle('is-selected', Number(s.dataset.hue) === hue);
      });
      if (typeof window.applyAccent === 'function') {
        window.applyAccent(hue === DEFAULT_HUE ? null : hue);
      }
    }
    setSelected(currentHue);

    // Snap a pointer x to the nearest segment's hue.
    const fromX = (clientX) => {
      const r = grid.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const idx = Math.min(COUNT - 1, Math.floor(pct * COUNT));
      return segments[idx].dataset.hue | 0;
    };
    // Drag anywhere on the row + click a segment — both snap.
    grid.addEventListener('mousedown', (e) => {
      const mv = (ev) => setSelected(fromX(ev.clientX));
      const up = () => {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
      setSelected(fromX(e.clientX));
      e.preventDefault();
    });

    function close() {
      if (onKey) document.removeEventListener('keydown', onKey);
      onKey = null;
      if (overlay) { overlay.remove(); overlay = null; }
    }

    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      // Roll back to the hue active when the dialog opened.
      if (typeof window.applyAccent === 'function') {
        window.applyAccent(initialHue === DEFAULT_HUE ? null : initialHue);
      }
      close();
    });

    overlay.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const text1 = overlay.querySelector('#skin-meta-text1').value;
      const text2 = overlay.querySelector('#skin-meta-text2').value;
      const linkVal = overlay.querySelector('#skin-meta-link').value.trim();
      const storeHue = currentHue === DEFAULT_HUE ? null : currentHue;
      const res = await api.setSkinMeta(skin, storeHue, text1, text2, linkVal);
      if (res && res.success) {
        state.set('skinMeta', { accentHue: storeHue, customText1: text1, customText2: text2, skinLink: linkVal });
        if (window.Toast) Toast.success(i18n.t('skinMeta.saved'));
        close();
      } else if (window.Toast) {
        Toast.error(i18n.t('skinMeta.saveFailed'));
      }
    });

    // Click outside the card cancels (roll back).
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        if (typeof window.applyAccent === 'function') {
          window.applyAccent(initialHue === DEFAULT_HUE ? null : initialHue);
        }
        close();
      }
    });

    onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (typeof window.applyAccent === 'function') {
          window.applyAccent(initialHue === DEFAULT_HUE ? null : initialHue);
        }
        close();
      } else if (e.key === 'Enter' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        overlay.querySelector('[data-act="save"]').click();
      }
    };
    document.addEventListener('keydown', onKey);
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.SkinMetaDialog = { open };
})();
