// Register .osp file association on Windows (portable app — no installer)
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const APP_EXE = 'osu-skin-configurator.exe';

function register() {
  if (process.platform !== 'win32') return;
  // Dev runs use node_modules/electron/dist/electron.exe as execPath — registering
  // that as the .osp handler is the bug. Only the packaged app should register.
  if (!app.isPackaged) return;

  try {
    // Resolve osp.ico path — in packaged app it's in resources/ (extraResources)
    let icoPath = path.join(path.dirname(process.execPath), 'resources', 'osp.ico');
    if (!fs.existsSync(icoPath)) {
      icoPath = path.join(__dirname, '..', '..', 'osp.ico');
    }
    if (!fs.existsSync(icoPath)) return;

    const exePath = process.execPath;

    // Check if already correctly registered (both icon and exe path must match)
    const existingIcon = regQuery(`HKCU\\Software\\Classes\\Applications\\${APP_EXE}\\DefaultIcon`, '/ve');
    const existingCmd = regQuery(`HKCU\\Software\\Classes\\Applications\\${APP_EXE}\\shell\\open\\command`, '/ve');
    if (existingIcon && existingIcon.includes(icoPath) && existingCmd && existingCmd.includes(exePath)) return;

    // 1. Clean old keys (ProgID + UserChoice) that may interfere
    const hkcr = 'HKCU\\Software\\Classes';
    const toDelete = [
      `${hkcr}\\.osp`,
      `${hkcr}\\OsuSkinPreset`,
      `${hkcr}\\Applications\\${APP_EXE}`,
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.osp`,
    ];
    for (const key of toDelete) {
      try { execSync(`reg delete "${key}" /f`, { timeout: 3000 }); } catch (_) { /* fine if missing */ }
    }

    // 2. Register application under Applications\ (Windows native "open with" path)
    regAdd(`${hkcr}\\Applications\\${APP_EXE}\\DefaultIcon`, '/ve', 'REG_SZ', icoPath);
    regAdd(`${hkcr}\\Applications\\${APP_EXE}\\shell\\open\\command`, '/ve', 'REG_SZ', `"${exePath}" "%1"`);

    // 3. Associate .osp with the application
    regAdd(`${hkcr}\\.osp`, '/ve', 'REG_SZ', `Applications\\${APP_EXE}`);
    regAdd(`${hkcr}\\.osp\\OpenWithProgids`, `Applications\\${APP_EXE}`, 'REG_SZ', '');

    refreshShell();
  } catch (e) {
    console.warn('Failed to register .osp file association:', e.message);
  }
}

function regQuery(key, valueName) {
  try {
    const result = execSync(`reg query "${key}" ${valueName}`, { timeout: 3000, encoding: 'utf-8' });
    return result;
  } catch (_) {
    return null;
  }
}

function regAdd(key, valueName, type, data) {
  execSync(`reg add "${key}" ${valueName} /t ${type} /d "${data}" /f`, { timeout: 3000 });
}

function refreshShell() {
  try { execSync('ie4uinit.exe -show', { timeout: 3000 }); } catch (_) {}
}

module.exports = { register };
