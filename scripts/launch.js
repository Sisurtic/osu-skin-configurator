// Launcher: spawns Electron with ELECTRON_RUN_AS_NODE unset
// This works around the env var being set in the parent environment

const { spawn } = require('child_process');
const path = require('path');

// Remove the problematic env var
delete process.env.ELECTRON_RUN_AS_NODE;

// Find the electron binary
const electronPath = require('electron');

// Pass through any extra args (like --dev)
const args = ['.', ...process.argv.slice(2)];

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: process.env,
  windowsHide: false,
});

child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code || 0);
});

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
});
