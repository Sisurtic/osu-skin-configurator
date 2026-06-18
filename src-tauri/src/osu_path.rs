// Locate / validate the osu! install. Windows-only probes (osu! stable is
// Windows-only): %LOCALAPPDATA%\osu! then C:\..F:\ roots. Mirrors osu-path.js.

use std::path::PathBuf;

pub fn auto_detect() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(lad) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(lad).join("osu!"));
    }
    for letter in &['C', 'D', 'E', 'F'] {
        candidates.push(PathBuf::from(format!("{}:\\osu!", letter)));
    }
    for c in candidates {
        if c.join("osu!.exe").exists() {
            return c.to_str().map(|s| s.to_string());
        }
    }
    None
}

pub fn validate(p: &str) -> bool {
    std::path::Path::new(p).join("osu!.exe").exists()
}

pub fn get_skins_path(osu_path: &str) -> PathBuf {
    PathBuf::from(osu_path).join("Skins")
}

/// Resolve a skin name to its absolute path under osu!/Skins.
pub fn get_skin_path(osu_path: &str, skin_name: &str) -> PathBuf {
    get_skins_path(osu_path).join(skin_name)
}
