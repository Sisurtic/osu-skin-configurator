// Skin list sidebar component
(function () {
  const listEl = document.getElementById('skin-list');
  const searchInput = document.getElementById('skin-search');
  const countEl = document.getElementById('skin-count');
  let allSkins = [];
  // While true, the staggered enter animation is playing — skip DOM rebuilds so
  // the animated .skin-item elements aren't replaced mid-animation. Only the
  // active-selection class is updated during this window.
  let enterLocked = false;

  function render(skins, selectedSkin, animate = false) {
    // In edit mode, hide the skin list (only current skin is shown as a header)
    const skinSection = document.querySelector('.sidebar__section--skins');
    if (state.get('appMode') === 'edit') {
      if (skinSection) skinSection.style.display = 'none';
      return;
    }
    if (skinSection) skinSection.style.display = '';

    allSkins = skins || [];
    const query = ((searchInput && searchInput.value) || '').toLowerCase();
    const filtered = query
      ? allSkins.filter(s => s.name.toLowerCase().includes(query))
      : allSkins;

    countEl.textContent = allSkins.length > 0 ? `(${allSkins.length})` : '';

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding:20px">
          <div class="empty-state__icon">📁</div>
          <div class="empty-state__desc" style="font-size:12px">${query ? i18n.t('skinlist.noMatch') : i18n.t('skinlist.notFound')}</div>
        </div>
      `;
      return;
    }

    // During the enter animation, don't rebuild the DOM (that would replace the
    // animating elements). Only refresh the active-selection class in place.
    if (!animate && enterLocked) {
      listEl.querySelectorAll('.skin-item').forEach(item => {
        item.classList.toggle('skin-item--active', item.dataset.skin === selectedSkin);
      });
      return;
    }

    listEl.innerHTML = filtered.map((s, i) => `
      <div class="skin-item ${s.name === selectedSkin ? 'skin-item--active' : ''} ${animate ? 'skin-item--enter' : ''}" ${animate ? `style="animation-delay:${i * 20}ms"` : ''} data-skin="${escapeHtml(s.name)}" title="${escapeHtml(s.name)}">
        <span class="skin-item__icon">📁</span>
        <span class="skin-item__name">${escapeHtml(s.name)}</span>
        ${s.presetCount > 0 ? `<span class="skin-item__badge">${i18n.t('skinlist.presetCount', { count: s.presetCount })}</span>` : ''}
      </div>
    `).join('');

    // Lock DOM rebuilds while the staggered animation plays, then release.
    if (animate) {
      enterLocked = true;
      const totalMs = filtered.length * 20 + 700;
      setTimeout(() => { enterLocked = false; }, totalMs);
    }

    // Click handlers
    listEl.querySelectorAll('.skin-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.skin;
        state.set('selectedSkin', name);
        state.set('selectedPreset', null);
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Search filter
  searchInput.addEventListener('input', () => {
    render(allSkins, state.get('selectedSkin'));
  });

  // Listen for state changes
  state.on('skins', (skins) => {
    allSkins = skins || [];
    render(allSkins, state.get('selectedSkin'), true);
  });
  state.on('selectedSkin', (skinName) => render(allSkins, skinName));
  state.on('appMode', () => render(allSkins, state.get('selectedSkin')));
  // Keep preset count badge in sync when presets change
  state.on('presets', (presets) => {
    const skinName = state.get('selectedSkin');
    if (skinName && allSkins.length > 0) {
      const idx = allSkins.findIndex(s => s.name === skinName);
      if (idx >= 0) {
        const groups = state.get('groups') || [];
        const tableGroupCount = groups.filter(g => g.type === 'table').length;
        allSkins[idx] = { ...allSkins[idx], presetCount: (presets || []).length + tableGroupCount };
        render(allSkins, skinName);
      }
    }
  });

  // Replay the staggered enter animation (used after the window is ready,
  // because the initial skins render happens while body is still opacity:0
  // and its animation gets masked by the body fade-in).
  function replayEnter() {
    render(allSkins, state.get('selectedSkin'), true);
  }

  window.SkinList = { render, replayEnter };
})();
