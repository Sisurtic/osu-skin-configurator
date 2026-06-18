// osu! Skin Configurator — Tauri v2 main library.
// Wires up plugins, the 31 #[tauri::command]s, single-instance, .osp argv
// handling, and lifecycle (global shortcut init/cleanup, file association).

mod config_store;
mod file_assoc;
mod foreground;
mod global_shortcut;
mod ini_reader;
mod osu_path;
mod preset_applier;
mod preset_manager;
mod skin_scanner;

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Pending .osp skin name from cold-start argv (drained one-shot by
/// app_get_open_file).
struct PendingOsp(Mutex<Option<String>>);

// ── helpers ──

fn wrap_ok(data: Value) -> Value { json!({ "success": true, "data": data }) }
fn wrap_err(msg: &str) -> Value { json!({ "success": false, "error": msg }) }

fn skin_path_from_name(app: &AppHandle, skin_name: &str) -> Result<String, String> {
    let cfg = config_store::load(app);
    let osu_path = cfg.osu_path.ok_or("未设置 osu! 路径")?;
    Ok(osu_path::get_skin_path(&osu_path, skin_name).to_string_lossy().to_string())
}

fn resolve_skin(app: &AppHandle, skin_name: &str) -> Result<String, Value> {
    skin_path_from_name(app, skin_name).map_err(|e| wrap_err(&e))
}

// ── osu commands ──

#[tauri::command]
fn osu_auto_detect(_app: AppHandle) -> Value {
    match osu_path::auto_detect() {
        Some(p) => wrap_ok(json!(p)),
        None => wrap_ok(Value::Null),
    }
}
#[tauri::command]
fn osu_get_path(app: AppHandle) -> Value {
    let cfg = config_store::load(&app);
    wrap_ok(json!(cfg.osu_path))
}
#[tauri::command]
fn osu_get_last_skin(app: AppHandle) -> Value {
    let cfg = config_store::load(&app);
    wrap_ok(json!(cfg.last_skin))
}
#[tauri::command]
fn osu_set_last_skin(app: AppHandle, skin_name: Option<String>) -> Value {
    let mut cfg = config_store::load(&app);
    cfg.last_skin = skin_name;
    config_store::save(&app, &cfg);
    wrap_ok(json!(true))
}
#[tauri::command]
fn osu_set_path(app: AppHandle, p: String) -> Value {
    let mut cfg = config_store::load(&app);
    cfg.osu_path = Some(p);
    config_store::save(&app, &cfg);
    wrap_ok(json!(true))
}

// ── skins ──

#[tauri::command]
fn skins_scan(app: AppHandle) -> Value {
    let cfg = config_store::load(&app);
    match cfg.osu_path {
        Some(p) => wrap_ok(json!(skin_scanner::scan_skins(&p))),
        None => wrap_ok(json!([])),
    }
}
#[tauri::command]
fn skins_read_ini(app: AppHandle, skin_name: String) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    let sections = ini_reader::read_skin_ini(&sp);
    let arr: Vec<Value> = sections.iter().map(|s| {
        let keys: serde_json::Map<String, Value> = s.keys.iter()
            .map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
        json!({ "section": s.section, "keys": keys })
    }).collect();
    wrap_ok(json!(arr))
}
#[tauri::command]
fn skins_get_path(app: AppHandle, skin_name: String) -> Value {
    match skin_path_from_name(&app, &skin_name) {
        Ok(p) => wrap_ok(json!(p)),
        Err(e) => wrap_err(&e),
    }
}

// ── presets ──

#[tauri::command]
fn presets_scan(app: AppHandle, skin_name: String) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    wrap_ok(preset_manager::scan_skin(&sp))
}
#[tauri::command]
fn presets_load(app: AppHandle, skin_name: String, preset_id: i64) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::load_preset(&sp, preset_id) {
        Some(p) => wrap_ok(p),
        None => wrap_ok(Value::Null),
    }
}
#[tauri::command]
fn presets_save(app: AppHandle, skin_name: String, preset_id: Option<i64>, data: Value) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::save_preset(&sp, preset_id, &data) {
        Ok(id) => {
            // mirror the Electron handler's setLastSkin side effect
            let mut cfg = config_store::load(&app);
            cfg.last_skin = Some(skin_name);
            config_store::save(&app, &cfg);
            wrap_ok(json!(id))
        }
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn presets_delete(app: AppHandle, skin_name: String, preset_id: i64) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    preset_manager::delete_preset(&sp, preset_id);
    wrap_ok(json!(true))
}
#[tauri::command]
fn presets_apply(app: AppHandle, skin_name: String, preset_id: i64) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_applier::apply_preset(&sp, preset_id) {
        Ok(r) => wrap_ok(r),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn presets_apply_multiple(app: AppHandle, skin_name: String, preset_ids: Vec<i64>) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    wrap_ok(preset_applier::apply_multiple_presets(&sp, &preset_ids))
}

// ── groups ──

#[tauri::command]
fn groups_add(app: AppHandle, skin_name: String, name: String, parent_group_id: Option<i64>) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::add_group(&sp, &name, parent_group_id) {
        Ok(id) => wrap_ok(json!(id)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_remove(app: AppHandle, skin_name: String, group_id: i64) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::remove_group(&sp, group_id) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_rename(app: AppHandle, skin_name: String, group_id: i64, new_name: String) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::rename_group(&sp, group_id, &new_name) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_move_preset(app: AppHandle, skin_name: String, preset_id: i64, target_group_id: Option<i64>, index: Option<i64>) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::move_preset(&sp, preset_id, target_group_id, index) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_move(app: AppHandle, skin_name: String, group_id: i64, target_group_id: Option<i64>, index: Option<i64>) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::move_group(&sp, group_id, target_group_id, index) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_reorder(app: AppHandle, skin_name: String, parent_group_id: Option<i64>, child_order: Vec<i64>) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::reorder_children(&sp, parent_group_id, child_order) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_set_collapsed(app: AppHandle, skin_name: String, group_id: i64, collapsed: bool) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::set_group_collapsed(&sp, group_id, collapsed) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_delete_recursive(app: AppHandle, skin_name: String, group_id: i64) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::delete_group_recursive(&sp, group_id) {
        Ok(v) => wrap_ok(v),
        Err(e) => wrap_err(&e),
    }
}

// ── images ──

#[tauri::command]
fn image_get_preview(image_path: String) -> Value {
    match preset_manager::get_preview_data_url(&image_path) {
        Some(u) => wrap_ok(json!(u)),
        None => wrap_ok(Value::Null),
    }
}

// ── in-app shortcuts (keybind settings) ──

#[tauri::command]
fn shortcuts_load(app: AppHandle) -> Value {
    let cfg = config_store::load(&app);
    wrap_ok(cfg.shortcut_bindings)
}
#[tauri::command]
fn shortcuts_save(app: AppHandle, bindings: Value) -> Value {
    let mut cfg = config_store::load(&app);
    cfg.shortcut_bindings = bindings;
    config_store::save(&app, &cfg);
    wrap_ok(json!(true))
}

// ── global shortcuts (per-preset hotkeys) ──

#[tauri::command]
fn global_shortcuts_bind(app: AppHandle, skin_name: String, preset_ids: Vec<i64>, accelerator: String) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    if global_shortcut::bind(&app, &sp, &preset_ids, &accelerator) {
        wrap_ok(json!(true))
    } else {
        wrap_err("快捷键已被占用或无效")
    }
}
#[tauri::command]
fn global_shortcuts_unbind(app: AppHandle, skin_name: String, preset_ids: Vec<i64>) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    global_shortcut::unbind(&app, &sp, &preset_ids);
    wrap_ok(json!(true))
}
#[tauri::command]
fn global_shortcuts_reload(app: AppHandle, skin_name: Option<String>) -> Value {
    let sp = match skin_name {
        Some(s) => match resolve_skin(&app, &s) { Ok(p) => Some(p), Err(e) => return e },
        None => None,
    };
    global_shortcut::reload(&app, sp);
    wrap_ok(json!(true))
}

// ── app lifecycle ──

#[tauri::command]
fn app_get_open_file(app: AppHandle, pending: State<'_, PendingOsp>) -> Value {
    let mut g = pending.0.lock().unwrap();
    let v = g.take();
    let _ = &app;
    wrap_ok(json!(v))
}
#[tauri::command]
fn app_get_version(app: AppHandle) -> Value {
    let v = app.package_info().version.to_string();
    wrap_ok(json!(v))
}

// ── .osp argv parsing ──

fn skin_name_from_osp(arg: &str) -> Option<String> {
    let p = std::path::Path::new(arg);
    if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("osp")).unwrap_or(false) {
        // skin name = basename of parent dir (skins are folders containing config.osp)
        p.parent()?.file_name()?.to_str().map(|s| s.to_string())
    } else {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance MUST be first
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // second instance: look for an .osp in argv, emit open-osp-file
            for a in argv.iter().skip(1) {
                if let Some(name) = skin_name_from_osp(a) {
                    let _ = app.emit("open-osp-file", name);
                    break;
                }
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingOsp(Mutex::new(None)))
        .manage(global_shortcut::State::default())
        .setup(|app| {
            // cold-start .osp argv
            let mut found: Option<String> = None;
            for a in std::env::args().skip(1) {
                if let Some(name) = skin_name_from_osp(&a) { found = Some(name); break; }
            }
            if let Some(name) = found {
                let pending = app.state::<PendingOsp>();
                *pending.0.lock().unwrap() = Some(name);
            }
            // Defer non-critical startup work (global-shortcut registration scans
            // the skin dir; file_assoc writes registry + SHChangeNotify). Running
            // them synchronously here delays the window's first paint.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let cfg = config_store::load(&app_handle);
                if let Some(skin_name) = cfg.last_skin.clone() {
                    if let Some(osu) = cfg.osu_path.clone() {
                        let sp = osu_path::get_skin_path(&osu, &skin_name).to_string_lossy().to_string();
                        global_shortcut::reload(&app_handle, Some(sp));
                    }
                }
                file_assoc::register(&app_handle);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // cleanup global shortcuts on close
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                let _ = app.global_shortcut().unregister_all();
            }
        })
        .invoke_handler(tauri::generate_handler![
            osu_auto_detect, osu_get_path, osu_get_last_skin, osu_set_last_skin, osu_set_path,
            skins_scan, skins_read_ini, skins_get_path,
            presets_scan, presets_load, presets_save, presets_delete, presets_apply, presets_apply_multiple,
            groups_add, groups_remove, groups_rename, groups_move_preset, groups_move, groups_reorder, groups_set_collapsed, groups_delete_recursive,
            image_get_preview,
            shortcuts_load, shortcuts_save,
            global_shortcuts_bind, global_shortcuts_unbind, global_shortcuts_reload,
            app_get_open_file, app_get_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
