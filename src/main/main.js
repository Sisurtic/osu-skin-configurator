const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const { getOsuPath, getLastSkin } = require('./config-store');
const { getSkinPath } = require('./skin-scanner');
const { register: registerFileAssoc } = require('./register-file-assoc');
const globalShortcutManager = require('./global-shortcut-manager');

let mainWindow = null;
let pendingOspSkin = null;

// ── Parse .osp file from command line (first instance) ──
const ospArg = process.argv.find(arg => arg.toLowerCase().endsWith('.osp'));
if (ospArg) {
  pendingOspSkin = path.basename(path.dirname(path.resolve(ospArg)));
}

// ── Single instance lock ──
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Focus existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }

    // Parse .osp from command line of the second instance
    const ospPath = commandLine.find(arg => arg.toLowerCase().endsWith('.osp'));
    if (ospPath) {
      const skinName = path.basename(path.dirname(path.resolve(ospPath)));
      if (mainWindow) {
        mainWindow.webContents.send('open-osp-file', skinName);
      }
    }
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      title: 'osu! Skin Configurator',
      backgroundColor: '#1a1a1a',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    // Register F12 / Ctrl+Shift+I to toggle DevTools (without a menu bar)
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerIpcHandlers();

    // Handle renderer polling for initial .osp file arg
    ipcMain.handle('app:get-open-file', () => {
      const skin = pendingOspSkin;
      pendingOspSkin = null;
      return skin || null;
    });

    // App version
    ipcMain.handle('app:get-version', () => {
      try {
        return { success: true, data: app.getVersion() };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    registerFileAssoc();
    createWindow();

    // Register global shortcuts for the last-used skin (if any)
    try {
      const osuPath = getOsuPath();
      const lastSkin = getLastSkin();
      if (osuPath && lastSkin) {
        const skinPath = getSkinPath(osuPath, lastSkin);
        if (skinPath) globalShortcutManager.init(skinPath);
      }
    } catch (e) { /* ignore init failure */ }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  try { globalShortcutManager.destroy(); } catch (e) { /* noop */ }
});

module.exports = { createWindow };
