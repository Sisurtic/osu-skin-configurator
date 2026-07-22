// Runtime .osp file association (Windows). Portable apps can't rely on the
// NSIS installer's bundle.fileAssociations, so we self-register HKCU keys at
// startup (mirrors register-file-assoc.js). Only runs when packaged.

use tauri::AppHandle;

#[cfg(windows)]
pub fn register(app: &AppHandle) {
    use winreg::enums::*;
    use winreg::RegKey;

    if !app.package_info().version.to_string().is_empty() {
        // packaged; proceed
    }
    // osp.ico is embedded at compile time; write it to a temp file for the
    // registry (registry DefaultIcon must point to a file path).
    const OSP_ICO: &[u8] = include_bytes!("../icons/osp.ico");
    let ico_temp = std::env::temp_dir().join("osu-skin-configurator-osp.ico");
    if std::fs::write(&ico_temp, OSP_ICO).is_err() { return; }
    let exe_path = match std::env::current_exe() { Ok(e) => e, Err(_) => return };

    let exe_str = exe_path.to_string_lossy().to_string();
    let ico_str = ico_temp.to_string_lossy().to_string();
    // Derive the ProgID exe name from the running binary so a renamed/rebundled
    // exe keeps its .osp association consistent with the open command.
    let app_exe = exe_path.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()).unwrap_or_else(|| "osu-skin-configurator.exe".to_string());

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let classes = hkcu.open_subkey_with_flags("Software\\Classes", KEY_SET_VALUE | KEY_READ).unwrap_or_else(|_| {
        hkcu.create_subkey("Software\\Classes").unwrap().0
    });

    // Clean stale keys first (idempotent re-register)
    for sub in [
        ".osp",
        "OsuSkinPreset",
        &format!("Applications\\{}", app_exe),
    ] {
        let _ = classes.delete_subkey_all(sub);
    }
    // Clean FileExts\.osp (Windows-cached UserChoice etc.)
    if let Ok(explorer) = hkcu.open_subkey_with_flags(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.osp",
        KEY_SET_VALUE,
    ) {
        let _ = explorer.delete_value("UserChoice"); // may fail (hash-protected); ignore
    }
    let _ = hkcu.delete_subkey_all("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.osp");

    // Re-register
    let _ = (|| -> std::io::Result<()> {
        // Applications\<exe>\DefaultIcon
        let app_key = classes.create_subkey(format!("Applications\\{}", app_exe))?.0;
        let default_icon = app_key.create_subkey("DefaultIcon")?.0;
        default_icon.set_value("", &ico_str)?;
        // shell\open\command
        let open_cmd = app_key.create_subkey("shell")?.0.create_subkey("open")?.0.create_subkey("command")?.0;
        open_cmd.set_value("", &format!("\"{}\" \"%1\"", exe_str))?;

        // .osp -> Applications\<exe>
        let osp = classes.create_subkey(".osp")?.0;
        osp.set_value("", &format!("Applications\\{}", app_exe))?;
        let open_with = osp.create_subkey("OpenWithProgids")?.0;
        let _ = open_with.set_value(format!("Applications\\{}", app_exe), &"");
        Ok(())
    })();

    // Refresh shell icons/associations
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()); }
    }
}

#[cfg(not(windows))]
pub fn register(_app: &AppHandle) {}
