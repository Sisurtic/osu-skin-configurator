// Per-preset global shortcuts. Wraps tauri-plugin-global-shortcut with the
// app-specific layer: scan current skin's presets for meta.shortcut, register
// each distinct accelerator once, and on trigger → check osu! focus → apply
// matched presets → notify. Accelerator strings stored in Electron grammar are
// converted to Tauri grammar at registration time.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
pub struct State {
    /// accelerator (Tauri grammar) → preset ids that share it
    pub bindings: Mutex<HashMap<String, Vec<i64>>>,
    pub skin_path: Mutex<Option<String>>,
}

/// Convert an Electron-style accelerator ("Ctrl+Alt+Shift+A", "num1", "A",
/// "Space", "F1") to Tauri grammar ("Control+Alt+Shift+KeyA", "Numpad1",
/// "KeyA", "Space", "F1").
pub fn convert_accelerator(acc: &str) -> Option<String> {
    if acc.is_empty() { return None; }
    let parts: Vec<&str> = acc.split('+').map(|s| s.trim()).collect();
    let mut mods = Vec::new();
    let mut key: Option<String> = None;
    for p in &parts {
        let up = p.to_uppercase();
        match up.as_str() {
            "CTRL" | "CONTROL" => mods.push("Control"),
            "ALT" | "OPTION" => mods.push("Alt"),
            "SHIFT" => mods.push("Shift"),
            "CMD" | "META" | "SUPER" | "WIN" => mods.push("Super"),
            _ => {
                // convert the key token
                let conv = match up.as_str() {
                    "SPACE" => "Space".to_string(),
                    "ENTER" | "RETURN" => "Enter".to_string(),
                    "TAB" => "Tab".to_string(),
                    "ESC" | "ESCAPE" => "Escape".to_string(),
                    "UP" => "ArrowUp".to_string(),
                    "DOWN" => "ArrowDown".to_string(),
                    "LEFT" => "ArrowLeft".to_string(),
                    "RIGHT" => "ArrowRight".to_string(),
                    "BACKSPACE" => "Backspace".to_string(),
                    "DELETE" => "Delete".to_string(),
                    "INSERT" => "Insert".to_string(),
                    "HOME" => "Home".to_string(),
                    "END" => "End".to_string(),
                    "PAGEDOWN" => "PageDown".to_string(),
                    "PAGEUP" => "PageUp".to_string(),
                    s if s.starts_with("NUM") && s.len() == 4 => {
                        // num0..num9 -> Numpad0..9
                        format!("Numpad{}", &s[3..])
                    }
                    s if s.starts_with("F") && s[1..].chars().all(|c| c.is_ascii_digit()) && s.len() <= 3 => {
                        s.to_string()
                    }
                    s if s.len() == 1 => {
                        let c = s.chars().next().unwrap();
                        if c.is_ascii_digit() {
                            format!("Digit{}", c)
                        } else if c.is_ascii_alphabetic() {
                            format!("Key{}", c.to_uppercase())
                        } else {
                            return None;
                        }
                    }
                    _ => return None,
                };
                key = Some(conv);
            }
        }
    }
    let key = key?;
    let mut out = mods.join("+");
    if !out.is_empty() { out.push('+'); }
    out.push_str(&key);
    Some(out)
}

pub fn reload(app: &AppHandle, skin_path: Option<String>) {
    let gs = app.global_shortcut();
    // unregister all
    let _ = gs.unregister_all();
    let state = app.state::<State>();
    *state.skin_path.lock().unwrap() = skin_path.clone();
    state.bindings.lock().unwrap().clear();

    let Some(sp) = skin_path else { return };
    let cfg = crate::preset_manager::scan_skin(&sp);
    let presets = cfg.get("presets").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    // accelerator (Tauri) -> preset ids
    let mut map: HashMap<String, Vec<i64>> = HashMap::new();
    for p in &presets {
        let shortcut = p.get("meta").and_then(|m| m.get("shortcut")).and_then(|s| s.as_str()).unwrap_or("");
        if shortcut.is_empty() { continue; }
        let id = p.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        if let Some(acc) = convert_accelerator(shortcut) {
            map.entry(acc).or_default().push(id);
        }
    }

    // register each
    for (acc, ids) in &map {
        match acc.parse::<Shortcut>() {
            Ok(shortcut) => {
                let acc_owned = acc.clone();
                let res = gs.on_shortcut(shortcut, move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Released { return; }
                    on_trigger(app, &acc_owned);
                });
                if res.is_ok() {
                    // store after successful registration
                    let st = app.state::<State>();
                    st.bindings.lock().unwrap().insert(acc.clone(), ids.clone());
                }
            }
            Err(_) => { /* skip unparseable */ }
        }
    }
}

fn on_trigger(app: &AppHandle, acc: &str) {
    if !crate::foreground::is_osu_focused() { return; }
    let state = app.state::<State>();
    let sp = state.skin_path.lock().unwrap().clone();
    let ids = state.bindings.lock().unwrap().get(acc).cloned().unwrap_or_default();
    let Some(sp) = sp else { return };
    if ids.is_empty() { return; }

    // apply
    let result = crate::preset_applier::apply_multiple_presets(&sp, &ids);
    let warnings = result.get("warnings").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);

    // collect names for the notification
    let cfg = crate::preset_manager::scan_skin(&sp);
    let presets = cfg.get("presets").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let names: Vec<String> = presets.iter()
        .filter_map(|p| {
            let id = p.get("id").and_then(|v| v.as_i64())?;
            if ids.contains(&id) {
                Some(p.get("meta").and_then(|m| m.get("name")).and_then(|n| n.as_str()).map(|s| s.to_string()).unwrap_or_else(|| crate::i18n::t("preset.fallback_name", &[("id", &id.to_string())])))
            } else { None }
        })
        .collect();

    let title = crate::i18n::t("notify.applied_title", &[]);
    let joined = names.join("、");
    let body = if warnings > 0 {
        crate::i18n::t("notify.applied_body_warn", &[("count", &names.len().to_string()), ("names", &joined), ("warn", &warnings.to_string())])
    } else {
        crate::i18n::t("notify.applied_body", &[("names", &joined)])
    };
    let _ = app.notification().builder().title(title).body(body).show();
    let _ = app.emit("global-shortcut-applied", json!({"ids": ids}));
}

/// Persist meta.shortcut on the given presets, then re-register.
pub fn bind(app: &AppHandle, skin_path: &str, preset_ids: &[i64], accelerator: &str) -> bool {
    for id in preset_ids {
        if let Some(mut preset) = crate::preset_manager::load_preset(skin_path, *id) {
            if let Some(meta) = preset.get_mut("meta").and_then(|m| m.as_object_mut()) {
                if accelerator.is_empty() {
                    meta.remove("shortcut");
                } else {
                    meta.insert("shortcut".to_string(), Value::String(accelerator.to_string()));
                }
            }
            let _ = crate::preset_manager::save_preset(skin_path, Some(*id), &preset);
        }
    }
    reload(app, Some(skin_path.to_string()));
    // verify registration (conflict check): empty accel = clear, always ok
    if accelerator.is_empty() { return true; }
    let acc = convert_accelerator(accelerator);
    if let Some(a) = acc {
        match a.parse::<Shortcut>() {
            Ok(s) => app.global_shortcut().is_registered(s),
            Err(_) => false,
        }
    } else {
        false
    }
}

pub fn unbind(app: &AppHandle, skin_path: &str, preset_ids: &[i64]) -> bool {
    for id in preset_ids {
        if let Some(mut preset) = crate::preset_manager::load_preset(skin_path, *id) {
            if let Some(meta) = preset.get_mut("meta").and_then(|m| m.as_object_mut()) {
                meta.remove("shortcut");
            }
            let _ = crate::preset_manager::save_preset(skin_path, Some(*id), &preset);
        }
    }
    reload(app, Some(skin_path.to_string()));
    true
}
