const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const userDataPath = (() => {
  try { return app.getPath('userData'); } catch (_) { return path.join(process.env.APPDATA || '', 'osu-skin-configurator'); }
})();
const configPath = path.join(userDataPath, 'config.json');

const defaults = {
  osuPath: null,
  lastSkin: null,
  windowBounds: { width: 1280, height: 800 },
  shortcutBindings: {},
};

let config = { ...defaults };

function load() {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      config = { ...defaults, ...JSON.parse(raw) };
    }
  } catch (_) {
    config = { ...defaults };
  }
}

function save() {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (_) {
    // Silently fail — config is non-critical
  }
}

// Load on startup
load();

function getOsuPath() {
  return config.osuPath;
}

function setOsuPath(p) {
  config.osuPath = p;
  save();
}

function getLastSkin() {
  return config.lastSkin;
}

function setLastSkin(name) {
  config.lastSkin = name;
  save();
}

function getShortcutBindings() {
  return config.shortcutBindings || {};
}

function setShortcutBindings(bindings) {
  config.shortcutBindings = bindings;
  save();
}

module.exports = { getOsuPath, setOsuPath, getLastSkin, setLastSkin, getShortcutBindings, setShortcutBindings };
