const fs = require('fs');
const path = require('path');
const { getSkinsPath } = require('./osu-path');

function scanSkins(osuPath) {
  const skinsPath = getSkinsPath(osuPath);
  if (!fs.existsSync(skinsPath)) {
    return [];
  }

  const entries = fs.readdirSync(skinsPath, { withFileTypes: true });
  return entries
    .filter(dirent => dirent.isDirectory())
    .map(dirent => {
      const skinPath = path.join(skinsPath, dirent.name);
      const hasSkinIni = fs.existsSync(path.join(skinPath, 'skin.ini'));
      const presetCount = countPresets(skinPath);
      return {
        name: dirent.name,
        hasSkinIni,
        presetCount,
        path: skinPath,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function countPresets(skinPath) {
  // Read from unified config.osp at skin root (zero-directory storage)
  const configPath = path.join(skinPath, 'config.osp');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return (config.presets || []).length;
    } catch (_) { /* corrupt config, return 0 */ }
  }
  return 0;
}

function getSkinPath(osuPath, skinName) {
  return path.join(getSkinsPath(osuPath), skinName);
}

module.exports = { scanSkins, getSkinPath };
