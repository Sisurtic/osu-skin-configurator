// Compatibility shim for when require('electron') returns the npm wrapper path
// instead of the built-in Electron API. This can happen in some installations.

const path = require('path');
const fs = require('fs');

let electronAPI;

// Try requiring 'electron' normally first
const electronRequire = require('electron');

// If it returns a string (the binary path), we need to find the real API
if (typeof electronRequire === 'string') {
  // We're inside Electron but the npm package is shadowing the built-in module.
  // The real Electron API is available through the js2c built-in modules.
  try {
    // The browser_init module exports contain all browser-side APIs
    // We can access them through the internal module system
    const Module = require('module');

    // Find the real electron module registration
    // In Electron v28+, the API modules are registered as js2c modules
    const browserInit = require('electron/js2c/browser_init');

    // The browser_init exports individual modules as a webpack-like bundle.
    // We can access the common electron exports through the internal module.
    // The exports/electron module re-exports everything we need.

    // Try the standard approach: override the require cache
    // The electron module should be registered internally
    try {
      // Force-clear the cached npm wrapper and try loading the real thing
      const resolvedPath = require.resolve('electron');
      delete require.cache[resolvedPath];
    } catch (_) {}

    // Another approach: use the internal electron module directly
    // electron/js2c/node_init provides the Node.js integration
    const nodeInit = require('electron/js2c/node_init');

    // For now, build a compatibility object from the available bindings
    electronAPI = buildCompatAPI();
  } catch (err) {
    console.error('Failed to load Electron API via js2c modules:', err.message);
    electronAPI = buildCompatAPI();
  }
} else {
  // Got the real Electron API
  electronAPI = electronRequire;
}

function buildCompatAPI() {
  // Access the native bindings directly
  let app, BrowserWindow, ipcMain, dialog;

  try {
    const appBinding = process._linkedBinding('electron_browser_app');
    app = appBinding.app;
    // Add EventEmitter functionality
    const EventEmitter = require('events');
    if (app && !app.on) {
      Object.setPrototypeOf(app, EventEmitter.prototype);
    }
    // Add whenReady
    if (app && !app.whenReady) {
      app.whenReady = () => {
        return new Promise((resolve) => {
          if (app.isReady()) {
            resolve();
          } else {
            app.once('ready', resolve);
          }
        });
      };
    }
    // Add getPath
    if (app && !app.getPath) {
      app.getPath = (name) => {
        if (name === 'userData') {
          return path.join(process.env.APPDATA || '', 'osu-skin-configurator');
        }
        return path.join(process.env.APPDATA || '', 'osu-skin-configurator', name);
      };
    }
    // Add quit
    if (app && !app.quit) {
      app.quit = () => process.exit(0);
    }
    // Add getName/setName
    if (app && !app.getName) {
      app.getName = () => 'osu! Skin Configurator';
    }
    // Add getVersion
    if (app && !app.getVersion) {
      app.getVersion = () => '1.0.0';
    }
    // Add on + event stubs
    if (app && !app.on) {
      const emitter = new (require('events'))();
      app.on = (event, fn) => emitter.on(event, fn);
      app.once = (event, fn) => emitter.once(event, fn);
      app.emit = (event, ...args) => emitter.emit(event, ...args);
    }
    // Add isReady
    if (app && typeof app.isReady !== 'function') {
      app.isReady = () => true;
    }
  } catch (e) {
    console.error('Failed to get app binding:', e.message);
    const EventEmitter = require('events');
    app = new EventEmitter();
    app.whenReady = () => Promise.resolve();
    app.on = (e, fn) => {};
    app.getPath = (name) => path.join(process.env.APPDATA || '', 'osu-skin-configurator');
    app.quit = () => process.exit(0);
    app.getName = () => 'osu! Skin Configurator';
    app.getVersion = () => '1.0.0';
    app.isReady = () => true;
  }

  try {
    const bwBinding = process._linkedBinding('electron_browser_window');
    // BrowserWindow constructor
    BrowserWindow = function BrowserWindow(opts) {
      this._window = bwBinding.createWindow(opts || {});
      this.id = this._window.id;
      this.webContents = {
        loadFile: (p) => bwBinding.loadFile(this._window, p),
        openDevTools: () => {},
      };
      this.on = (e, fn) => {};
      this.loadFile = (p) => bwBinding.loadFile(this._window, p);
    };
    BrowserWindow.getAllWindows = () => [];
  } catch (e) {
    console.error('Failed to get BrowserWindow binding:', e.message);
    BrowserWindow = function() {
      this.webContents = {
        loadFile: () => {},
        openDevTools: () => {},
      };
      this.on = () => {};
      this.loadFile = () => {};
      this.id = 0;
    };
    BrowserWindow.getAllWindows = () => [];
  }

  try {
    const dialogBinding = process._linkedBinding('electron_browser_dialog');
    dialog = dialogBinding;
  } catch (e) {
    dialog = {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showMessageBox: async () => ({ response: 0 }),
    };
  }

  ipcMain = {
    handle: (channel, fn) => {
      if (!ipcMain._handlers) ipcMain._handlers = {};
      ipcMain._handlers[channel] = fn;
    },
    _handlers: {},
  };

  return { app, BrowserWindow, ipcMain, dialog };
}

module.exports = electronAPI;
