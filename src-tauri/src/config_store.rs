// Global app config (osu path, last skin, shortcut bindings, plus user prefs
// previously scattered across WebView2 localStorage).
// Stored as config.json in the OS *local* app-data dir — on Windows that's
// %LOCALAPPDATA%, so config.json sits next to the WebView2 EBWebView folder and
// all app data lives in one place. NOTE: app_data_dir() and app_config_dir()
// BOTH resolve to %APPDATA% (Roaming) on Windows via the dirs crate; only
// app_local_data_dir() is %LOCALAPPDATA% (where the WebView2 data lives).
// Earlier versions used app_config_dir / Roaming; migrate_to_data_dir relocates
// those. Hand-rolled (serde + std::fs) rather than pulling in a config crate,
// to keep the on-disk format stable.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub osu_path: Option<String>,
    #[serde(default)]
    pub last_skin: Option<String>,
    #[serde(default)]
    pub shortcut_bindings: serde_json::Value,
    // User prefs, formerly held in WebView2 localStorage and migrated here so all
    // settings live in config.json.
    #[serde(default)]
    pub mute_ini_comment_warn: bool,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub user_colors: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            osu_path: None,
            last_skin: None,
            shortcut_bindings: serde_json::json!({}),
            mute_ini_comment_warn: false,
            locale: None,
            user_colors: vec![],
        }
    }
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("config.json"))
}

// One-time move: older versions stored config.json in app_config_dir()
// (Roaming on Windows). Relocate it to app_local_data_dir() (Local, next to the
// WebView2 EBWebView folder) so all app data lives in one place. Idempotent:
// no-op once the new file exists. Non-fatal — a failure just retries next launch.
pub fn migrate_to_data_dir(app: &AppHandle) {
    let new_path = match config_path(app) {
        Some(p) => p,
        None => return,
    };
    // Already at the new location (or already migrated) — nothing to do.
    if new_path.exists() {
        return;
    }
    let old_dir = match app.path().app_config_dir().ok() {
        Some(d) => d,
        None => return,
    };
    let old_path = old_dir.join("config.json");
    if !old_path.exists() {
        return;
    }
    // Ensure the new parent exists (config_path already create_dir_all's it,
    // but be defensive).
    let _ = fs::create_dir_all(new_path.parent().unwrap_or(std::path::Path::new("")));
    // Move atomically: rename across the same volume is fine (both under AppData).
    // A cross-volume rename could fail on exotic setups; fall back to copy+delete.
    if fs::rename(&old_path, &new_path).is_err() {
        if fs::copy(&old_path, &new_path).is_ok() {
            let _ = fs::remove_file(&old_path);
        }
    }
    // Best-effort: remove the now-empty Roaming dir. remove_dir (not _all)
    // only succeeds on an empty dir, so we never clobber anything unexpected.
    let _ = fs::remove_dir(&old_dir);
}

pub fn load(app: &AppHandle) -> Config {
    let Some(p) = config_path(app) else { return Config::default() };
    match fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(app: &AppHandle, cfg: &Config) {
    let Some(p) = config_path(app) else { return };
    if let Ok(s) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(&p, s);
    }
}
