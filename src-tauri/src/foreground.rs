// Detect whether osu! is the foreground window (Windows). A direct Win32 call,
// much faster than spawning powershell.exe per trigger. No Tauri plugin exists
// for this, hence the custom module.

#[cfg(windows)]
pub fn is_osu_focused() -> bool {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid as *mut u32);
        if pid == 0 {
            return false;
        }
        if let Some(n) = process_name(pid) {
            let lower = n.to_lowercase();
            if lower.starts_with("osu") && n.len() <= 12 {
                return true;
            }
        }
        false
    }
}

#[cfg(windows)]
fn process_name(pid: u32) -> Option<String> {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_all();
    let p = sys.process(sysinfo::Pid::from_u32(pid))?;
    Some(p.name().to_string_lossy().to_string())
}

#[cfg(not(windows))]
pub fn is_osu_focused() -> bool { false }
