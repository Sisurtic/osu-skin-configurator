// Multi-select state & operations for edit-mode preset/group tree.
// Standalone module: owns the selection sets + anchor; preset-list.js passes
// in DOM-touching callbacks (refreshHighlights, getAllVisibleKeys) via init().
// This eliminates the duplicated/clearing-state logic that was scattered across
// click handlers, drag handlers, and operations in preset-list.js.
(function () {
  // ── Private state ──
  let presets = new Set();  // selected preset ids
  let groups = new Set();   // selected group ids
  let anchor = null;        // { kind:'preset'|'group', id } — Shift-range start

  // ── Callbacks (set by init) ──
  let _refreshHighlights = () => {};
  let _getAllVisibleKeys = () => [];

  function _sync() {
    state.set('multiSelectActive', size() > 1);
  }

  // ── Queries ──
  function presetIds() { return [...presets]; }
  function groupIds() { return [...groups]; }
  function has(kind, id) { return kind === 'preset' ? presets.has(id) : groups.has(id); }
  function size() { return presets.size + groups.size; }
  function isActive() { return size() > 1; }
  function isEmpty() { return size() === 0; }
  function anchorKey() { return anchor; }

  // ── Mutation ──

  // Ctrl-click: toggle one item in its respective set.
  function toggle(kind, id) {
    const set = kind === 'preset' ? presets : groups;
    if (set.has(id)) set.delete(id); else set.add(id);
    anchor = { kind, id };
    _afterChange();
  }

  // Shift-click: cross-type range from anchor to (kind,id) over getAllVisibleKeys.
  // If keepExisting (Ctrl+Shift), add to current selection; else replace.
  function setRangeFromAnchor(kind, id, keepExisting) {
    if (!anchor) { setSingle(kind, id); return; }
    const keys = _getAllVisibleKeys();
    const start = keys.findIndex(k => k.kind === anchor.kind && k.id === anchor.id);
    const end = keys.findIndex(k => k.kind === kind && k.id === id);
    if (start === -1 || end === -1) { _afterChange(); return; }
    const [lo, hi] = start < end ? [start, end] : [end, start];
    if (!keepExisting) { presets.clear(); groups.clear(); }
    for (let i = lo; i <= hi; i++) {
      const k = keys[i];
      if (k.kind === 'preset') presets.add(k.id); else groups.add(k.id);
    }
    _afterChange();
  }

  // Plain click: single-select (clears both sets, sets one, sets anchor).
  function setSingle(kind, id) {
    presets.clear();
    groups.clear();
    (kind === 'preset' ? presets : groups).add(id);
    anchor = { kind, id };
    _afterChange();
  }

  // Clear everything + sync state + refresh highlights.
  function clear() {
    presets.clear();
    groups.clear();
    anchor = null;
    _afterChange();
  }

  function _afterChange() {
    _sync();
    _refreshHighlights();
  }

  // ── Drag support ──

  // At dragstart: return the preset ids to drag (multi if applicable).
  function beginDragPresetIds(id) {
    return (presets.size > 1 && presets.has(id)) ? [...presets] : [id];
  }

  // At dragstart: return the group ids to drag (multi if applicable).
  function beginDragGroupIds(id) {
    return (groups.size > 1 && groups.has(id)) ? [...groups] : [id];
  }

  // At drop: resolve the dragged group ids from a snapshot primary id.
  function getDragGroupIds(primaryId) {
    return (groups.size > 1 && groups.has(primaryId)) ? [...new Set(groups)] : [primaryId];
  }

  // ── Pure helpers (no state dependency) ──

  // Filter group ids to only the outermost (drop any that are descendants of
  // another id in the list). Used by duplicate + delete to avoid double-acting
  // on a parent + its child.
  function outermostGroups(allGroups, ids) {
    return ids.filter(gid => !ids.some(other => other !== gid && isDescendantOf(allGroups, other, gid)));
  }

  // Is targetId a descendant of ancestorId in the group tree?
  function isDescendantOf(allGroups, ancestorId, targetId) {
    const groupMap = new Map(allGroups.map(g => [g.id, g]));
    function check(groupId) {
      const group = groupMap.get(groupId);
      if (!group || !group.children) return false;
      for (const child of group.children) {
        if (child.type === 'group') {
          if (child.id === targetId) return true;
          if (check(child.id)) return true;
        }
      }
      return false;
    }
    return check(ancestorId);
  }

  // Lowest common ancestor of a set of group ids (or null = root).
  // Builds ancestor chains for each id, returns the deepest shared ancestor.
  function commonAncestor(allGroups, groupIds) {
    const filtered = groupIds.filter(id => id !== null);
    if (filtered.length === 0) return null;
    if (filtered.length === 1) return filtered[0];
    const chains = filtered.map(id => _ancestorsOf(allGroups, id));
    // If any chain is empty (root-level), common ancestor is root (null).
    if (chains.some(c => c.length === 0)) return null;
    // Walk from the root (end of chain) to find the deepest shared prefix.
    let common = null;
    const minLen = Math.min(...chains.map(c => c.length));
    for (let i = 1; i <= minLen; i++) {
      const candidate = chains[0][chains[0].length - i];
      if (chains.every(c => c[c.length - i] === candidate)) {
        common = candidate;
      } else {
        break;
      }
    }
    return common;
  }

  // Return the ancestor chain of groupId from root → ... → groupId (inclusive).
  function _ancestorsOf(allGroups, groupId) {
    const groupMap = new Map(allGroups.map(g => [g.id, g]));
    // Find root-level groups (those not nested in another group).
    const childGroupIds = new Set();
    for (const g of allGroups) {
      if (g.children) for (const c of g.children) {
        if (c.type === 'group') childGroupIds.add(c.id);
      }
    }
    const roots = allGroups.filter(g => !childGroupIds.has(g.id));
    function findPath(parents, targetId, path) {
      for (const g of parents) {
        const newPath = [...path, g.id];
        if (g.id === targetId) return newPath;
        if (g.children) {
          const subs = g.children.filter(c => c.type === 'group').map(c => groupMap.get(c.id)).filter(Boolean);
          const found = findPath(subs, targetId, newPath);
          if (found) return found;
        }
      }
      return null;
    }
    return findPath(roots, groupId, []) || [];
  }

  // ── Init ──
  function init(opts) {
    if (opts.refreshHighlights) _refreshHighlights = opts.refreshHighlights;
    if (opts.getAllVisibleKeys) _getAllVisibleKeys = opts.getAllVisibleKeys;
  }

  window.Selection = {
    // queries
    presetIds, groupIds, has, size, isActive, isEmpty, anchorKey,
    // mutation
    toggle, setRangeFromAnchor, setSingle, clear,
    // drag
    beginDragPresetIds, beginDragGroupIds, getDragGroupIds,
    // helpers
    outermostGroups, isDescendantOf, commonAncestor,
    // init
    init,
  };
})();
