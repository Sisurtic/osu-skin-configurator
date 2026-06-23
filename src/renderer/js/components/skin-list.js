// Skin list sidebar component
(function () {
  const listEl = document.getElementById('skin-list');
  const searchInput = document.getElementById('skin-search');
  const countEl = document.getElementById('skin-count');
  let allSkins = [];

  function render(skins, selectedSkin) {
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

    listEl.innerHTML = filtered.map(s => `
      <div class="skin-item ${s.name === selectedSkin ? 'skin-item--active' : ''}" data-skin="${escapeHtml(s.name)}" title="${escapeHtml(s.name)}">
        <span class="skin-item__icon">📁</span>
        <span class="skin-item__name">${escapeHtml(s.name)}</span>
        ${s.presetCount > 0 ? `<span class="skin-item__badge">${i18n.t('skinlist.presetCount', { count: s.presetCount })}</span>` : ''}
      </div>
    `).join('');

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
    render(allSkins, state.get('selectedSkin'));
  });
  state.on('selectedSkin', (skinName) => render(allSkins, skinName));
  state.on('appMode', () => render(allSkins, state.get('selectedSkin')));
  // Keep preset count badge in sync when presets change
  state.on('presets', (presets) => {
    const skinName = state.get('selectedSkin');
    if (skinName && allSkins.length > 0) {
      const idx = allSkins.findIndex(s => s.name === skinName);
      if (idx >= 0) {
        allSkins[idx] = { ...allSkins[idx], presetCount: (presets || []).length };
        render(allSkins, skinName);
      }
    }
  });

  window.SkinList = { render };
})();
