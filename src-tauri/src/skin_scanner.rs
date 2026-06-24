// List installed skins under osu!/Skins. For each: folder name, has skin.ini,
// preset count (from config.osp in that skin dir), absolute path.
// Sort using Windows natural sort (StrCmpLogicalW) to match osu! + Explorer.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkinInfo {
    pub name: String,
    #[serde(rename = "hasSkinIni")]
    pub has_skin_ini: bool,
    #[serde(rename = "presetCount")]
    pub preset_count: i64,
    pub path: String,
}

/// Compare two strings using Windows natural sort (StrCmpLogicalW), matching
/// osu! and Windows Explorer ordering. Falls back to byte sort on non-Windows.
#[cfg(windows)]
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;
    type StrCmpLogicalW = unsafe extern "system" fn(*const u16, *const u16) -> i32;
    static CMP: std::sync::OnceLock<Option<StrCmpLogicalW>> = std::sync::OnceLock::new();
    let func = *CMP.get_or_init(|| {
        // Dynamically load StrCmpLogicalW from shlwapi.dll (avoid hard dep).
        extern "system" {
            fn LoadLibraryW(name: *const u16) -> *mut std::ffi::c_void;
            fn GetProcAddress(h: *mut std::ffi::c_void, name: *const u8) -> *mut std::ffi::c_void;
        }
        let dll: Vec<u16> = "shlwapi.dll\0".encode_utf16().collect();
        let h = unsafe { LoadLibraryW(dll.as_ptr()) };
        if h.is_null() { return None; }
        let proc = b"StrCmpLogicalW\0";
        let f = unsafe { GetProcAddress(h, proc.as_ptr()) };
        if f.is_null() { return None; }
        Some(unsafe { std::mem::transmute::<*mut std::ffi::c_void, StrCmpLogicalW>(f) })
    });
    match func {
        Some(f) => {
            let wa: Vec<u16> = OsStr::new(a).encode_wide().chain(std::iter::once(0)).collect();
            let wb: Vec<u16> = OsStr::new(b).encode_wide().chain(std::iter::once(0)).collect();
            let r = unsafe { f(wa.as_ptr(), wb.as_ptr()) };
            r.cmp(&0)
        }
        None => a.cmp(b),
    }
}

#[cfg(not(windows))]
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.cmp(b)
}

pub fn scan_skins(osu_path: &str) -> Vec<SkinInfo> {
    let skins_dir = crate::osu_path::get_skins_path(osu_path);
    let mut out: Vec<SkinInfo> = Vec::new();
    let Ok(rd) = std::fs::read_dir(&skins_dir) else { return out };
    for entry in rd.flatten() {
        let ft = match entry.file_type() { Ok(t) => t, Err(_) => continue };
        if !ft.is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        let dir = entry.path();
        let has_skin_ini = dir.join("skin.ini").exists();
        let preset_count = count_presets(&dir);
        let path = dir.to_string_lossy().to_string();
        out.push(SkinInfo { name, has_skin_ini, preset_count, path });
    }
    out.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    out
}

/// Count presets by parsing config.osp JSON in the skin dir. Returns 0 on any
/// error (missing/corrupt file), matching the JS try/catch.
pub fn count_presets(skin_dir: &Path) -> i64 {
    let cfg = skin_dir.join("config.osp");
    let Ok(txt) = std::fs::read_to_string(&cfg) else { return 0 };
    let v: serde_json::Value = match serde_json::from_str(&txt) { Ok(v) => v, Err(_) => return 0 };
    v.get("presets")
        .and_then(|p| p.as_array())
        .map(|a| a.len() as i64)
        .unwrap_or(0)
}
