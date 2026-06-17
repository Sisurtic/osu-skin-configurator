const fs = require('fs');
const path = require('path');

function autoDetectOsuPath() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'osu!'),
    'C:\\osu!',
    'D:\\osu!',
    'E:\\osu!',
    'F:\\osu!',
  ];

  for (const candidate of candidates) {
    const exePath = path.join(candidate, 'osu!.exe');
    try {
      if (fs.existsSync(exePath)) {
        return candidate;
      }
    } catch (_) {
      // Permission error or invalid path, skip
    }
  }

  return null;
}

function validateOsuPath(p) {
  if (!p) return false;
  try {
    return fs.existsSync(path.join(p, 'osu!.exe'));
  } catch (_) {
    return false;
  }
}

function getSkinsPath(osuPath) {
  return path.join(osuPath, 'Skins');
}

module.exports = { autoDetectOsuPath, validateOsuPath, getSkinsPath };
