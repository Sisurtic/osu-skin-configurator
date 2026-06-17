// Detect whether osu! is the foreground window (Windows, via PowerShell).
const { execSync } = require('child_process');

// PowerShell script as base64 (UTF-16LE) to avoid all quote-escaping issues.
// Uses Win32 GetForegroundWindow + GetWindowThreadProcessId → process name.
const PS_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
'@
$h = [Win32]::GetForegroundWindow()
$procId = 0
[Win32]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
if ($procId) {
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc) { Write-Output $proc.ProcessName }
}
`;

function getEncodedCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

const ENCODED = getEncodedCommand(PS_SCRIPT);

/**
 * Returns the foreground window's process name (e.g. "osu!", "osu!lazer"), or empty.
 */
function getForegroundProcessName() {
  try {
    return execSync(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${ENCODED}`,
      { windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();
  } catch (e) {
    console.error('[foreground-detector] error:', e.message);
    return '';
  }
}

/**
 * Returns true if the current foreground window belongs to osu!.
 * Matches process names: "osu!", "osu!lazer", or anything starting with "osu".
 */
function isOsuFocused() {
  const name = getForegroundProcessName();
  if (name) console.log('[foreground-detector] foreground:', name);
  return name === 'osu!' || name === 'osu!lazer' || (name.toLowerCase().startsWith('osu') && name.length <= 12);
}

module.exports = { isOsuFocused, getForegroundProcessName };
