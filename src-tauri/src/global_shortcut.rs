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

/// What a global shortcut applies: a preset, or a table group (whose row
/// selection the backend resolves via apply_group). Group ids can collide with
/// preset ids, so the kind is tracked explicitly.
#[derive(Clone, Copy, Debug)]
pub enum Target { Preset(i64), Group(i64) }

#[derive(Default)]
pub struct State {
    /// accelerator (Tauri grammar) → targets (presets and/or groups) sharing it
    pub bindings: Mutex<HashMap<String, Vec<Target>>>,
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

    // accelerator (Tauri) -> targets (presets AND table groups)
    let mut map: HashMap<String, Vec<Target>> = HashMap::new();
    for p in &presets {
        let shortcut = p.get("meta").and_then(|m| m.get("shortcut")).and_then(|s| s.as_str()).unwrap_or("");
        if shortcut.is_empty() { continue; }
        let id = p.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        if let Some(acc) = convert_accelerator(shortcut) {
            map.entry(acc).or_default().push(Target::Preset(id));
        }
    }
    // Also register shortcuts bound to table groups (on_trigger applies the
    // group via apply_group, which reads the group's row selection from config).
    let groups = cfg.get("groups").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for g in &groups {
        let shortcut = g.get("shortcut").and_then(|s| s.as_str()).unwrap_or("");
        if shortcut.is_empty() { continue; }
        let gid = g.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        if let Some(acc) = convert_accelerator(shortcut) {
            map.entry(acc).or_default().push(Target::Group(gid));
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
    let targets = state.bindings.lock().unwrap().get(acc).cloned().unwrap_or_default();
    let Some(sp) = sp else { return };
    if targets.is_empty() { return; }

    // Apply each target: presets via apply_multiple_presets, groups via
    // apply_group (which resolves the group's per-row selection from config).
    let mut total_ini = 0i64;
    let mut total_files = 0i64;
    let mut total_tints = 0i64;
    let mut total_warnings = 0usize;
    let mut preset_ids: Vec<i64> = Vec::new();
    for t in &targets {
        if let Target::Group(gid) = t {
            if let Ok(v) = crate::preset_applier::apply_group(&sp, *gid, None) {
                total_ini += v.get("skinIniChanges").and_then(|x| x.as_i64()).unwrap_or(0);
                total_files += v.get("filesCopied").and_then(|x| x.as_i64()).unwrap_or(0)
                    + v.get("filesDeleted").and_then(|x| x.as_i64()).unwrap_or(0);
                total_tints += v.get("filesTinted").and_then(|x| x.as_i64()).unwrap_or(0);
                total_warnings += v.get("warnings").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
            }
        }
    }
    for t in &targets {
        if let Target::Preset(id) = t { preset_ids.push(*id); }
    }
    if !preset_ids.is_empty() {
        let r = crate::preset_applier::apply_multiple_presets(&sp, &preset_ids);
        total_ini += r.get("skinIniChanges").and_then(|x| x.as_i64()).unwrap_or(0);
        total_files += r.get("filesCopied").and_then(|x| x.as_i64()).unwrap_or(0)
            + r.get("filesDeleted").and_then(|x| x.as_i64()).unwrap_or(0);
        total_tints += r.get("filesTinted").and_then(|x| x.as_i64()).unwrap_or(0);
        total_warnings += r.get("warnings").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
    }
    let _ = app.emit("global-shortcut-applied", json!({
        "ini": total_ini, "files": total_files, "tints": total_tints, "warnings": total_warnings
    }));
}

/// Persist meta.shortcut on the given presets (or group.shortcut for table
/// groups), then re-register.
pub fn bind(app: &AppHandle, skin_path: &str, preset_ids: &[i64], accelerator: &str) -> bool {
    for id in preset_ids {
        // Try preset first (preset ids and group ids can overlap).
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
    // Empty accel = clear, always ok. Otherwise assume success — reload()
    // already attempted registration; is_registered would always return true
    // because reload just registered it (the old "conflict check" was a false
    // positive that made every bind report "shortcut taken").
    if accelerator.is_empty() { return true; }
    // Validate the accelerator is parseable (syntax check only).
    let acc = convert_accelerator(accelerator);
    acc.is_some()
}

pub fn unbind(app: &AppHandle, skin_path: &str, preset_ids: &[i64]) -> bool {
    for id in preset_ids {
        // Try preset first (preset ids and group ids can overlap).
        if let Some(mut preset) = crate::preset_manager::load_preset(skin_path, *id) {
            if let Some(meta) = preset.get_mut("meta").and_then(|m| m.as_object_mut()) {
                meta.remove("shortcut");
            }
            let _ = crate::preset_manager::save_preset(skin_path, Some(*id), &preset);
        } else {
            // Not a preset — try group (table group).
            let _ = crate::preset_manager::set_group_shortcut(skin_path, *id, "");
        }
    }
    reload(app, Some(skin_path.to_string()));
    true
}
