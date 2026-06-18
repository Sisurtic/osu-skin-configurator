// Global app config (osu path, last skin, window bounds, shortcut bindings).
// Stored as config.json in the OS app-config dir. Hand-rolled (serde + std::fs)
// to stay faithful to the original Electron config-store.js semantics.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowBounds {
    #[serde(default = "default_width")]
    pub width: f64,
    #[serde(default = "default_height")]
    pub height: f64,
}
fn default_width() -> f64 { 1280.0 }
fn default_height() -> f64 { 800.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub osu_path: Option<String>,
    #[serde(default)]
    pub last_skin: Option<String>,
    #[serde(default)]
    pub window_bounds: Option<WindowBounds>,
    #[serde(default)]
    pub shortcut_bindings: serde_json::Value,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            osu_path: None,
            last_skin: None,
            window_bounds: None,
            shortcut_bindings: serde_json::json!({}),
        }
    }
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("config.json"))
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
