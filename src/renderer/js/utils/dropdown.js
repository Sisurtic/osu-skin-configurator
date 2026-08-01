// dropdown.js — shared custom dropdown that visually replaces a native <select>.
//
// WHY: native <select> popups can't be styled (divider width, row spacing,
// popup direction are browser-controlled). This module overlays a custom
// button + popover on top of the select, while KEEPING the <select> as the
// hidden value source-of-truth — so all existing .value reads, programmatic
// `el.value = x; el.dispatchEvent(new Event('change'))` restores, and change
// handlers keep working unchanged.
//
// Usage:
//   Dropdown.enhance(selectEl)                // options read from the select's
//                                            // own <option>/<optgroup> each open
//   Dropdown.enhance(selectEl, { groups })   // explicit groups: [[v,label],...]
//                                            // entries (overrides the select's
//                                            // options; used by tint's MODE_GROUPS)
//
// Interaction: click trigger → popover (flips up if no room below); hover or
// arrow keys / mouse wheel move the highlight; Enter or click confirms; Esc,
// outside-click, or re-clicking the trigger closes. Confirming writes
// select.value + dispatches 'change'.

(function () {
  const OPEN_CLS = 'dd-trigger--open';

  function closeAll() {
    document.querySelectorAll('.dd-menu').forEach(m => {
      if (typeof m._cleanup === 'function') m._cleanup();
      m.remove();
    });
    document.querySelectorAll('.' + OPEN_CLS).forEach(t => t.classList.remove(OPEN_CLS));
  }

  // Build the popover DOM from either explicit groups or the select's own options.
  // Returns a flat list of {value,label} plus divider separators, as HTML + a
  // parallel values array (so highlight navigation can skip dividers).
  function buildItems(selectEl, groups) {
    const sep = `<div class="dd-menu__sep"></div>`;
    if (groups) {
      // groups: array of arrays of [value, label]. Each top-level entry is a
      // group; separators go between groups.
      const html = groups.map(g => g.map(([v, label]) => `<div class="dd-menu__item" data-value="${escAttr(v)}">${escHtml(label)}</div>`).join('')).join(sep);
      return html;
    }
    // Read the select's <option>s (honoring <optgroup> as implicit dividers).
    // Options with an empty value are skipped — they're a placeholder kept in
    // the select for empty-state semantics but shouldn't appear in the list.
    const kids = [...selectEl.children];
    const parts = [];
    let firstGroup = true;
    const pushOpt = (o) => {
      if (!o.value) return; // skip placeholder option
      parts.push(`<div class="dd-menu__item" data-value="${escAttr(o.value)}">${escHtml(o.textContent)}</div>`);
    };
    for (const k of kids) {
      if (k.tagName === 'OPTGROUP') {
        if (!firstGroup) parts.push(sep);
        firstGroup = false;
        for (const o of k.children) pushOpt(o);
      } else if (k.tagName === 'OPTION') {
        pushOpt(k);
      }
    }
    return parts.join('');
  }

  function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function escAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

  function syncTrigger(selectEl, trigger) {
    const v = selectEl.value;
    let label = v;
    if (selectEl._ddGroups) {
      for (const g of selectEl._ddGroups) {
        const hit = g.find(([vv]) => vv === v);
        if (hit) { label = hit[1]; break; }
      }
    } else {
      const opt = selectEl.querySelector(`option[value="${CSS.escape(v)}"]`);
      if (opt) label = opt.textContent;
    }
    const lab = trigger.querySelector('.dd-trigger__label');
    const empty = !v;
    if (lab) {
      lab.textContent = empty ? (selectEl._ddPlaceholder || '') : label;
      lab.style.opacity = empty ? '0.5' : '';
    }
    trigger.dataset.value = v;
  }

  function open(selectEl, trigger) {
    closeAll();
    trigger.classList.add(OPEN_CLS);
    const pop = document.createElement('div');
    pop.className = 'dd-menu';
    pop.innerHTML = buildItems(selectEl, selectEl._ddGroups);
    document.body.appendChild(pop);

    const current = selectEl.value;
    [...pop.querySelectorAll('.dd-menu__item')].forEach(it => {
      if (it.dataset.value === current) it.classList.add('is-selected');
    });

    // Anchor left-aligned with the trigger, width-matched. Flips ABOVE the
    // trigger when there isn't room below (e.g. rows near the bottom of the
    // list), so the menu never falls off-screen.
    function reposition() {
      const r = trigger.getBoundingClientRect();
      const ph = pop.offsetHeight || 0;
      const roomBelow = window.innerHeight - r.bottom;
      const above = roomBelow < ph + 8 && r.top > ph + 8;
      pop.style.top = above
        ? `${r.top + window.scrollY - ph - 2}px`
        : `${r.bottom + window.scrollY + 2}px`;
      pop.style.left = `${r.left + window.scrollX}px`;
      pop.style.width = `${r.width}px`;
      pop.style.boxSizing = 'border-box';
    }
    reposition();
    window.addEventListener('resize', reposition);

    const items = () => [...pop.querySelectorAll('.dd-menu__item')];
    function setHighlight(el) { items().forEach(i => i.classList.toggle('is-hover', i === el)); }
    function highlightNext(dir) {
      const arr = items();
      if (!arr.length) return;
      const idx = arr.findIndex(i => i.classList.contains('is-hover'));
      const start = idx < 0 ? (dir > 0 ? -1 : arr.length) : idx;
      let n = start + dir;
      if (n < 0) n = arr.length - 1;
      if (n >= arr.length) n = 0;
      setHighlight(arr[n]);
      arr[n].scrollIntoView({ block: 'nearest' });
    }
    function commit(value) {
      if (value === selectEl.value) { closeAll(); return; }
      selectEl.value = value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      closeAll();
    }
    pop.addEventListener('mouseover', e => {
      const it = e.target.closest('.dd-menu__item');
      setHighlight(it || null);
    });
    pop.addEventListener('click', e => {
      const it = e.target.closest('.dd-menu__item');
      if (it) commit(it.dataset.value);
    });
    // Wheel scrolls the menu list natively (no highlight cycling).
    function onKey(e) {
      // Let global shortcuts (Ctrl+E mode toggle, Ctrl+S save, 1-4 tab switch)
      // pass through, but close the dropdown so it doesn't linger after the
      // context changes.
      if (e.ctrlKey || e.metaKey) { closeAll(); return; }
      if (['1','2','3','4'].includes(e.key)) { closeAll(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); highlightNext(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlightNext(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const h = pop.querySelector('.dd-menu__item.is-hover') || pop.querySelector('.dd-menu__item.is-selected');
        if (h) commit(h.dataset.value);
      }
      else if (e.key === 'Escape') { e.preventDefault(); closeAll(); }
    }
    function onAway(e) {
      if (pop.contains(e.target) || e.target === trigger || trigger.contains(e.target)) return;
      closeAll();
    }
    document.addEventListener('keydown', onKey);
    setTimeout(() => document.addEventListener('mousedown', onAway), 0);
    pop._cleanup = () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onAway);
      window.removeEventListener('resize', reposition);
      trigger.classList.remove(OPEN_CLS);
    };
  }

  window.Dropdown = {
    // Turn a native <select> into a custom dropdown. The select stays in the DOM
    // as the hidden value SOT; a <button> trigger is inserted after it.
    // opts.groups: [[ [value,label], ... ], ...] — explicit grouped options
    // (overrides reading the select's <option>s). opts.wheelInline: when true,
    // hovering the trigger (menu closed) and scrolling cycles the value in place
    // (mirrors native <select> wheel behavior), without opening the popover.
    enhance(selectEl, opts = {}) {
      if (!selectEl || selectEl._ddEnhanced) return;
      selectEl._ddEnhanced = true;
      if (opts.groups) selectEl._ddGroups = opts.groups;
      if (opts.placeholder) selectEl._ddPlaceholder = opts.placeholder;

      // Read the select's ORIGINAL inline style BEFORE we mutate it below —
      // otherwise getAttribute('style') returns the already-hidden values.
      const origStyle = selectEl.getAttribute('style') || '';

      // Hide the native select (display:none — fully removes it from layout;
      // it still holds the value and dispatches change). display:none is safe in
      // table cells and flex parents alike, unlike absolute + 0-size.
      selectEl.hidden = true;
      selectEl.style.display = 'none';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'form-input dd-trigger' + (selectEl.className.includes('tint-mode') ? ' tint-mode' : '');
      // Carry over caller styling (flex, min-width, max-width) from the select.
      trigger.style.cssText = origStyle + ';display:flex;align-items:center;justify-content:space-between;gap:6px;text-align:left;cursor:pointer';
      trigger.innerHTML = `<span class="dd-trigger__label"></span><span class="dd-trigger__caret" style="font-size:10px;opacity:.6">▼</span>`;
      // Copy data-* that callers may read off the select (e.g. data-idx, data-group-header).
      for (const a of selectEl.attributes) {
        if (a.name.startsWith('data-')) trigger.setAttribute(a.name, a.value);
      }
      if (selectEl.disabled) trigger.disabled = true;
      selectEl.parentNode.insertBefore(trigger, selectEl.nextSibling);

      syncTrigger(selectEl, trigger);
      // Keep the trigger label in sync whenever the select's value changes
      // (including programmatic `select.value = x; dispatchEvent('change')`).
      selectEl.addEventListener('change', () => syncTrigger(selectEl, trigger));

      trigger.addEventListener('click', e => {
        e.preventDefault();
        if (document.querySelector('.dd-menu')) closeAll();
        else open(selectEl, trigger);
      });

      if (opts.wheelInline) {
        trigger.addEventListener('wheel', e => {
          if (document.querySelector('.dd-menu')) return; // popover handles wheel
          e.preventDefault();
          const vals = (selectEl._ddGroups ? selectEl._ddGroups.flat() :
            [...selectEl.querySelectorAll('option')].map(o => [o.value, o.textContent]));
          const cur = vals.findIndex(([v]) => v === selectEl.value);
          const dir = e.deltaY > 0 ? 1 : -1;
          let n = cur + dir;
          if (n < 0) n = vals.length - 1;
          if (n >= vals.length) n = 0;
          const v = vals[n][0];
          if (v !== selectEl.value) {
            selectEl.value = v;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, { passive: false });
      }
    },
    closeAll,
  };
})();
