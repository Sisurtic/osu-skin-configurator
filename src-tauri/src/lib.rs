// osu! Skin Configurator — Tauri v2 main library.
// Wires up plugins, the 31 #[tauri::command]s, single-instance, .osp argv
// handling, and lifecycle (global shortcut init/cleanup, file association).

mod config_store;
mod file_assoc;
mod foreground;
mod global_shortcut;
mod i18n;
mod ini_reader;
mod osu_path;
mod preset_applier;
mod preset_manager;
mod skin_scanner;

use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_decorum::WebviewWindowExt; // custom titlebar helpers (hide native decoration, keep native resize frame)
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Set by `cancel_update_download` to abort the in-flight download stream.
static DOWNLOAD_CANCEL: AtomicBool = AtomicBool::new(false);

/// Pending .osp skin name from cold-start argv (drained one-shot by
/// app_get_open_file).
struct PendingOsp(Mutex<Option<String>>);

// ── helpers ──

fn wrap_ok(data: Value) -> Value { json!({ "success": true, "data": data }) }
fn wrap_err(msg: &str) -> Value { json!({ "success": false, "error": msg }) }

fn skin_path_from_name(app: &AppHandle, skin_name: &str) -> Result<String, String> {
    let cfg = config_store::load(app);
    let osu_path = cfg.osu_path.ok_or_else(|| i18n::t("err.osu_path_unset", &[]))?;
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
fn presets_delete_multiple(app: AppHandle, skin_name: String, preset_ids: Vec<i64>) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    let removed = preset_manager::delete_presets(&sp, &preset_ids);
    wrap_ok(json!(removed))
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
fn groups_add(app: AppHandle, skin_name: String, name: String, parent_group_id: Option<i64>, kind: Option<String>) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    let k = kind.unwrap_or_default();
    match preset_manager::add_group(&sp, &name, parent_group_id, &k) {
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
fn groups_reorder(app: AppHandle, skin_name: String, parent_group_id: Option<i64>, child_order: Vec<preset_manager::ChildRef>) -> Value {
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
fn groups_set_shortcut(app: AppHandle, skin_name: String, group_id: i64, shortcut: String) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::set_group_shortcut(&sp, group_id, &shortcut) {
        Ok(_) => {
            // Re-register global shortcuts so the new binding takes effect immediately.
            let _ = global_shortcut::reload(&app, Some(sp));
            wrap_ok(json!(true))
        }
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_set_description(app: AppHandle, skin_name: String, group_id: i64, description: String) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::set_group_description(&sp, group_id, &description) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_set_preview(
    app: AppHandle,
    skin_name: String,
    group_id: i64,
    path: Option<String>,
    kind: Option<String>,
    frames: Option<Vec<String>>,
    fps: Option<i64>,
) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    let fps_i32 = fps.and_then(|v| i32::try_from(v).ok());
    match preset_manager::set_group_preview(&sp, group_id, path.as_deref(), kind.as_deref(), frames, fps_i32) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_set_actions(app: AppHandle, skin_name: String, group_id: i64, actions: Value) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::set_group_actions(&sp, group_id, &actions) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_apply(app: AppHandle, skin_name: String, group_id: i64) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_applier::apply_group(&sp, group_id) {
        Ok(r) => wrap_ok(r),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn groups_flatten_subgroups(app: AppHandle, skin_name: String, group_id: i64) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::flatten_group_subgroups(&sp, group_id) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}
#[tauri::command]
fn set_table_state(app: AppHandle, skin_name: String, expanded: Value, row_selection: Value) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::set_table_state(&sp, &expanded, &row_selection) {
        Ok(_) => wrap_ok(json!(true)),
        Err(e) => wrap_err(&e),
    }
}

#[tauri::command]
fn groups_set_collapsed_batch(app: AppHandle, skin_name: String, group_ids: Vec<i64>, collapsed: bool) -> Value {
    let sp = match resolve_skin(&app, &skin_name) { Ok(s) => s, Err(e) => return e };
    match preset_manager::set_groups_collapsed_batch(&sp, &group_ids, collapsed) {
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
        wrap_err(&i18n::t("err.shortcut_taken", &[]))
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

// ── locales (embedded at compile time) ──
//
// Locale JSON files are embedded into the binary via include_str!, so the exe
// is fully self-contained — no external files needed. To add a language, add
// its const below + its entry in EMBEDDED_LOCALES.

const LOC_ZH_CN: &str = include_str!("../../src/renderer/js/locales/zh-CN.json");
const LOC_EN: &str = include_str!("../../src/renderer/js/locales/en.json");
const LOC_ZH_TW: &str = include_str!("../../src/renderer/js/locales/zh-TW.json");
const LOC_JA: &str = include_str!("../../src/renderer/js/locales/ja.json");
const LOC_KO_KR: &str = include_str!("../../src/renderer/js/locales/ko-KR.json");
const LOC_RU_RU: &str = include_str!("../../src/renderer/js/locales/ru-RU.json");

fn embedded_locales() -> Vec<(&'static str, &'static str)> {
    vec![
        ("en", LOC_EN),
        ("ja", LOC_JA),
        ("ko-KR", LOC_KO_KR),
        ("ru-RU", LOC_RU_RU),
        ("zh-CN", LOC_ZH_CN),
        ("zh-TW", LOC_ZH_TW),
    ]
}

#[tauri::command]
fn locales_list() -> Value {
    let raw = embedded_locales();
    let mut entries: Vec<(String, Value)> = Vec::new();
    for (tag, json_str) in &raw {
        match serde_json::from_str::<Value>(json_str) {
            Ok(v) => entries.push((tag.to_string(), v)),
            Err(_) => continue,
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let tags: Vec<Value> = entries.iter().map(|(t, _)| json!(t)).collect();
    let map = entries.into_iter().map(|(t, v)| (t, v)).collect::<serde_json::Map<_, _>>();
    wrap_ok(json!({ "tags": tags, "dicts": Value::Object(map) }))
}

// ── update check (GitHub releases) ──
//
// Checks the latest GitHub release and, on user action, downloads the
// installer asset and runs it (the installer replaces the app in place).
// All failure modes are silent (offline / rate-limited / parse error) —
// "no update found" simply leaves the UI unchanged.

const GH_API_LATEST: &str = "https://api.github.com/repos/Sisurtic/osu-skin-configurator/releases/latest";

#[derive(serde::Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}
#[derive(serde::Deserialize)]
struct GhRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    assets: Vec<GhAsset>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    latest_version: String,
    release_url: String,
    is_update: bool,
}

/// Parse "v1.2.3" or "1.2.3" into (major, minor, patch); unparseable → 0.
fn parse_semver(s: &str) -> (u32, u32, u32) {
    let s = s.trim().trim_start_matches('v');
    let mut it = s.split('.').map(|p| p.trim().trim_end_matches(|c: char| !c.is_ascii_digit()).parse::<u32>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

fn gh_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("osu-skin-configurator-updater")
        // Only the CONNECT phase gets a short timeout; the body read must be
        // allowed to take as long as the download needs (release exe ~5MB over a
        // slow link can exceed 10s). A whole-request timeout aborts streaming
        // mid-download → a truncated file + "download read failed".
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("client build failed: {}", e))
}

/// Fetch the latest release and compare to the running version.
#[tauri::command]
async fn check_latest_release(app: AppHandle) -> Value {
    let current = app.package_info().version.to_string();
    let client = match gh_client() { Ok(c) => c, Err(e) => return wrap_err(&e) };
    let resp = match client.get(GH_API_LATEST).header("Accept", "application/vnd.github+json").send().await {
        Ok(r) => r,
        Err(_) => return wrap_err("network error"),
    };
    if !resp.status().is_success() {
        return wrap_err("github request failed");
    }
    let body: GhRelease = match resp.json().await {
        Ok(b) => b,
        Err(_) => return wrap_err("parse error"),
    };
    let is_update = parse_semver(&body.tag_name) > parse_semver(&current);
    wrap_ok(json!(UpdateInfo {
        latest_version: body.tag_name,
        release_url: body.html_url,
        is_update,
    }))
}

/// Download the latest release's exe to a user-chosen path (save dialog).
/// Does NOT auto-launch — the user replaces the old exe manually.
#[tauri::command]
async fn download_and_run_latest_release(app: AppHandle) -> Value {
    let client = match gh_client() { Ok(c) => c, Err(e) => return wrap_err(&e) };

    let resp = match client.get(GH_API_LATEST).header("Accept", "application/vnd.github+json").send().await {
        Ok(r) => r,
        Err(_) => return wrap_err("network error"),
    };
    if !resp.status().is_success() {
        return wrap_err("github request failed");
    }
    let release: GhRelease = match resp.json().await {
        Ok(b) => b,
        Err(_) => return wrap_err("parse error"),
    };

    // Prefer a Windows exe asset; fall back to the first asset.
    let asset = release.assets.iter()
        .find(|a| {
            let n = a.name.to_ascii_lowercase();
            n.ends_with(".exe")
        })
        .or_else(|| release.assets.first());
    let asset = match asset {
        Some(a) => a,
        None => return wrap_err("no installer asset found"),
    };

    // Ask the user where to save via a file dialog.
    use tauri_plugin_dialog::DialogExt;
    let dest = match app.dialog().file()
        .set_file_name(&asset.name)
        .add_filter("Executable", &["exe"])
        .blocking_save_file()
    {
        Some(p) => match p.as_path() {
            Some(path) => path.to_path_buf(),
            None => return wrap_err("invalid path"),
        },
        None => return wrap_ok(json!("cancelled")),
    };

    // Stream the download to disk, emitting progress events so the UI can show
    // a progress bar. Falls back to a single write if streaming fails.
    let dl_resp = match client.get(&asset.browser_download_url).send().await {
        Ok(r) => r,
        Err(_) => return wrap_err("download failed"),
    };
    let total = dl_resp.content_length().unwrap_or(0); // 0 = unknown
    let mut file = match std::fs::File::create(&dest) {
        Ok(f) => f,
        Err(_) => return wrap_err("write failed"),
    };
    use std::io::Write;
    let mut downloaded: u64 = 0;
    let mut streamed_ok = true;
    let mut cancelled = false;
    DOWNLOAD_CANCEL.store(false, Ordering::SeqCst);
    let mut stream = dl_resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        if DOWNLOAD_CANCEL.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        match chunk {
            Ok(bytes) => {
                if file.write_all(&bytes).is_err() {
                    streamed_ok = false;
                    break;
                }
                downloaded = downloaded.saturating_add(bytes.len() as u64);
                let _ = app.emit("update-download-progress", json!({
                    "downloaded": downloaded,
                    "total": total,
                }));
            }
            Err(_) => { streamed_ok = false; break; }
        }
    }
    if cancelled {
        drop(file);
        let _ = std::fs::remove_file(&dest);   // delete the partial download
        return wrap_ok(json!("cancelled"));
    }
    if streamed_ok {
        let _ = app.emit("update-download-progress", json!({ "done": true, "downloaded": downloaded, "total": total }));
        return wrap_ok(json!(dest.to_string_lossy().to_string()));
    }
    // Fallback: streaming failed mid-way — re-fetch and write in one shot.
    drop(file);
    let content = match client.get(&asset.browser_download_url).send().await {
        Ok(r) => match r.bytes().await { Ok(b) => b, Err(_) => return wrap_err("download read failed") },
        Err(_) => return wrap_err("download failed"),
    };
    if std::fs::write(&dest, &content).is_err() {
        return wrap_err("write failed");
    }
    wrap_ok(json!(dest.to_string_lossy().to_string()))
}

/// Cancel an in-flight update download (the stream loop checks DOWNLOAD_CANCEL).
#[tauri::command]
fn cancel_update_download() -> Value {
    DOWNLOAD_CANCEL.store(true, Ordering::SeqCst);
    wrap_ok(json!(true))
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
    i18n::init();
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
        .plugin(tauri_plugin_decorum::init())
        // Disable default webview/browser shortcuts (Ctrl+F find, Ctrl+P print,
        // F3, Ctrl+J downloads, etc.) at the webview layer where JS
        // preventDefault can't reach. Keep RELOAD (F5/Ctrl+R) and DEV_TOOLS
        // (F12) so reload/devtools stay available for development.
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(
                    tauri_plugin_prevent_default::Flags::all()
                        .difference(tauri_plugin_prevent_default::Flags::RELOAD | tauri_plugin_prevent_default::Flags::DEV_TOOLS),
                )
                .build(),
        )
        .manage(PendingOsp(Mutex::new(None)))
        .manage(global_shortcut::State::default())
        .setup(|app| {
            // Custom titlebar: on Windows this hides the native decoration and
            // injects custom window-control buttons (decorum-tb-*), while KEEPING
            // the native resize frame — so edge-drag resizing stays smooth
            // (OS-driven WS_THICKFRAME), unlike a decorations:false window whose
            // JS resize loop makes the right edge flicker when dragging the left.
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.create_overlay_titlebar();
            }
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
            presets_scan, presets_load, presets_save, presets_delete, presets_delete_multiple, presets_apply, presets_apply_multiple,
            groups_add, groups_remove, groups_rename, groups_move_preset, groups_move, groups_reorder, groups_set_collapsed, groups_set_collapsed_batch, groups_delete_recursive, groups_set_shortcut, groups_set_description, groups_set_preview, groups_set_actions, groups_apply, groups_flatten_subgroups, set_table_state,
            image_get_preview,
            shortcuts_load, shortcuts_save,
            global_shortcuts_bind, global_shortcuts_unbind, global_shortcuts_reload,
            app_get_open_file, app_get_version, check_latest_release, download_and_run_latest_release, cancel_update_download, locales_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
