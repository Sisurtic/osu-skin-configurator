// Simple reactive state store
class State {
  constructor() {
    this._data = {};
    this._listeners = new Map();
  }

  get(key) {
    return this._data[key];
  }

  set(key, value) {
    const prev = this._data[key];
    this._data[key] = value;
    const fns = this._listeners.get(key) || [];
    fns.forEach(fn => fn(value, prev));
  }

  setMultiple(updates) {
    const prevs = {};
    for (const key of Object.keys(updates)) {
      prevs[key] = this._data[key];
    }
    // Write all new values first
    for (const [key, value] of Object.entries(updates)) {
      this._data[key] = value;
    }
    // Then fire listeners — all keys are consistent
    for (const [key, value] of Object.entries(updates)) {
      const fns = this._listeners.get(key) || [];
      fns.forEach(fn => fn(value, prevs[key]));
    }
  }

  on(key, fn) {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, []);
    }
    this._listeners.get(key).push(fn);
  }

  off(key, fn) {
    const fns = this._listeners.get(key);
    if (fns) {
      this._listeners.set(key, fns.filter(f => f !== fn));
    }
  }
}

const state = new State();

// Initialize default state
state.set('osuPath', null);
state.set('skins', []);
state.set('selectedSkin', null);
state.set('presets', []);           // preset summary list from scan
state.set('groups', []);           // full group tree from scan
state.set('rootChildren', []);     // root-level children: [{type:'preset'|'group', id}]
state.set('selectedPreset', null); // number | '__new__' | null
state.set('currentView', 'welcome');
state.set('activePresets', {});    // { [groupId: number]: presetId[] }
state.set('activeTableGroups', {}); // { [gid]: true } table groups selected as self-apply units
state.set('tableExpandedChildren', {}); // { [parentGid]: Set<childGid> } expanded nested table groups
state.set('tableRowSelection', {});     // { [gid]: { [rowKey]: presetId | 'group:<id>' } }
state.set('appMode', 'use');
state.set('presetDirty', false);
