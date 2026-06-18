// Apply presets to a skin: merge skin.ini edits, copy/delete files inside the
// skin dir. Faithful port of preset-applier.js. SECURITY: double-gated path
// containment (reject '..' / absolute, then normalize + starts_with skin dir).
// Uses lexical normalization (not canonicalize) to match JS path.normalize and
// to work on not-yet-created destination dirs.

use indexmap::IndexMap;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn normalize_lexical(p: &str) -> String {
    // emulate Node path.normalize for our containment check: collapse separators,
    // resolve ".." and "." segments. Good enough for starts_with comparison.
    let mut segs: Vec<String> = Vec::new();
    let mut root = String::new();
    let p_norm_sep = p.replace('\\', "/");
    if p_norm_sep.starts_with('/') {
        root.push('/');
    } else if p_norm_sep.len() >= 2 {
        let b = p_norm_sep.as_bytes();
        if b[1] == b':' {
            root.push_str(&p_norm_sep[..2]);
            if p_norm_sep.len() > 2 && p_norm_sep.as_bytes()[2] == b'/' {
                root.push('/');
            }
        }
    }
    for part in p_norm_sep.split('/') {
        match part {
            "" | "." => {}
            ".." => { segs.pop(); }
            s => segs.push(s.to_string()),
        }
    }
    let joined = segs.join("/");
    if root.is_empty() {
        joined
    } else if root.ends_with('/') {
        format!("{}{}", root, joined)
    } else {
        if joined.is_empty() { root } else { format!("{}/{}", root, joined) }
    }
}

/// True if `dest` is within `skin_root` (lexical). Mirrors the JS check
/// `normalizedDest.startsWith(normalizedSkin + sep) || === normalizedSkin`.
fn is_within(dest: &str, skin_root: &str) -> bool {
    let n_dest = normalize_lexical(dest);
    let n_root = normalize_lexical(skin_root);
    if n_dest == n_root { return true; }
    let with_sep = if n_root.ends_with('/') || n_root.is_empty() {
        format!("{}{}", n_root, "")
    } else {
        format!("{}/", n_root)
    };
    // accept both '/' separator (our normalized form) — n_dest starts with n_root + "/"
    n_dest.starts_with(&with_sep)
}

fn is_absolute_js(p: &str) -> bool {
    let p2 = p.replace('\\', "/");
    p2.starts_with('/') || (p2.len() >= 2 && p2.as_bytes()[1] == b':')
}

fn apply_one_set(
    skin_path: &str,
    skin_ini_edits: &[Value],
    file_copies: &[Value],
    file_deletes: &[Value],
) -> Value {
    let mut warnings: Vec<String> = Vec::new();
    let mut skin_ini_changes = 0i64;
    let mut files_copied = 0i64;
    let mut files_deleted = 0i64;

    // skin.ini merge
    if !skin_ini_edits.is_empty() {
        let mut sections = crate::ini_reader::read_skin_ini(skin_path);
        let edits: Vec<crate::ini_reader::IniEdit> = skin_ini_edits.iter()
            .filter_map(|e| serde_json::from_value(e.clone()).ok())
            .collect();
        crate::ini_reader::merge_ini_edits(&mut sections, &edits);
        crate::ini_reader::write_skin_ini(skin_path, &sections);
        skin_ini_changes = skin_ini_edits.len() as i64;
    }

    // copies
    for copy in file_copies {
        let source = copy.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let source_name = Path::new(source).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let dest_rel = copy.get("destination").and_then(|v| v.as_str()).unwrap_or("");

        if dest_rel.contains("..") || is_absolute_js(dest_rel) {
            warnings.push(format!("跳过 \"{}\": 目标路径无效", source_name));
            continue;
        }
        let is_dir_only = dest_rel.is_empty() || dest_rel.ends_with('/') || dest_rel.ends_with('\\');
        let dest_path = if is_dir_only {
            PathBuf::from(skin_path).join(dest_rel).join(&source_name)
        } else {
            PathBuf::from(skin_path).join(dest_rel)
        };
        let dest_str = dest_path.to_string_lossy().to_string();
        if !is_within(&dest_str, skin_path) {
            warnings.push(format!("跳过 \"{}\": 目标路径超出皮肤目录", source_name));
            continue;
        }
        if let Some(parent) = dest_path.parent() {
            if !parent.exists() { let _ = std::fs::create_dir_all(parent); }
        }
        if Path::new(source).exists() {
            if std::fs::copy(source, &dest_path).is_ok() { files_copied += 1; }
        } else {
            warnings.push(format!("跳过 \"{}\": 源文件不存在", source_name));
        }
    }

    // deletes
    for del in file_deletes {
        let del_path = del.get("path").and_then(|v| v.as_str()).unwrap_or("");
        if del_path.contains("..") || is_absolute_js(del_path) {
            warnings.push(format!("跳过删除 \"{}\": 路径无效", del_path));
            continue;
        }
        let full = PathBuf::from(skin_path).join(del_path);
        let full_str = full.to_string_lossy().to_string();
        if !is_within(&full_str, skin_path) {
            warnings.push(format!("跳过删除 \"{}\": 路径超出皮肤目录", del_path));
            continue;
        }
        if full.exists() {
            if std::fs::remove_file(&full).is_ok() { files_deleted += 1; }
        } else {
            warnings.push(format!("跳过删除 \"{}\": 文件不存在", del_path));
        }
    }

    json!({
        "skinIniChanges": skin_ini_changes,
        "filesCopied": files_copied,
        "filesDeleted": files_deleted,
        "warnings": warnings,
    })
}

pub fn apply_preset(skin_path: &str, preset_id: i64) -> Result<Value, String> {
    let preset = crate::preset_manager::load_preset(skin_path, preset_id)
        .ok_or_else(|| format!("预设不存在: {}", preset_id))?;
    let actions = preset.get("actions").cloned().unwrap_or_else(|| json!({}));
    let skin_ini = actions.get("skinIni").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let copies = actions.get("fileCopies").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let deletes = actions.get("fileDeletes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(apply_one_set(skin_path, &skin_ini, &copies, &deletes))
}

pub fn apply_multiple_presets(skin_path: &str, preset_ids: &[i64]) -> Value {
    let mut all_ini: Vec<Value> = Vec::new();
    let mut all_copies: Vec<Value> = Vec::new();
    let mut all_deletes: Vec<Value> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for id in preset_ids {
        match crate::preset_manager::load_preset(skin_path, *id) {
            Some(preset) => {
                let actions = preset.get("actions").cloned().unwrap_or_else(|| json!({}));
                if let Some(arr) = actions.get("fileCopies").and_then(|v| v.as_array()) {
                    all_copies.extend(arr.iter().cloned());
                }
                if let Some(arr) = actions.get("fileDeletes").and_then(|v| v.as_array()) {
                    all_deletes.extend(arr.iter().cloned());
                }
                if let Some(arr) = actions.get("skinIni").and_then(|v| v.as_array()) {
                    all_ini.extend(arr.iter().cloned());
                }
            }
            None => warnings.push(format!("预设不存在: {}", id)),
        }
    }

    // Dedup INI edits by section + maniaKeys + key, last-wins (preserve order of last occurrence)
    let mut merged_map: IndexMap<String, Value> = IndexMap::new();
    for edit in &all_ini {
        let section = edit.get("section").and_then(|v| v.as_str()).unwrap_or("");
        let mania_keys = edit.get("maniaKeys").map(|v| v.to_string()).unwrap_or_default();
        let key = edit.get("key").and_then(|v| v.as_str()).unwrap_or("");
        let k = format!("{}◆{}◆{}", section, mania_keys, key);
        merged_map.insert(k, edit.clone());
    }
    let merged_ini: Vec<Value> = merged_map.values().cloned().collect();

    let mut result = apply_one_set(skin_path, &merged_ini, &all_copies, &all_deletes);
    // prepend load warnings
    if let Some(obj) = result.as_object_mut() {
        if let Some(w) = obj.get_mut("warnings").and_then(|v| v.as_array_mut()) {
            let mut combined: Vec<Value> = warnings.into_iter().map(Value::from).collect();
            combined.append(w);
            obj.insert("warnings".to_string(), Value::Array(combined));
        }
    }
    result
}
