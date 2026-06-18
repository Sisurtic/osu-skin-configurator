// List installed skins under osu!/Skins. For each: folder name, has skin.ini,
// preset count (from config.osp in that skin dir), absolute path. Mirrors
// skin-scanner.js. Sort by name.

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
    // locale-sensitive sort is cosmetic; use plain sort for parity-ish
    out.sort_by(|a, b| a.name.cmp(&b.name));
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
