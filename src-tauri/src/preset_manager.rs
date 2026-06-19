// Per-skin preset+group tree, stored as config.osp JSON inside each skin dir.
// Faithful port of preset-manager.js. The tree model (presets + groups with
// children[{type,id}] + rootGroupIds) and compact_ids are load-bearing.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

const CONFIG_FILENAME: &str = "config.osp";

// ── Data model ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChildRef {
    #[serde(rename = "type")]
    pub kind: String, // "preset" | "group"
    pub id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub children: Vec<ChildRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(rename = "nextPresetId", default = "d1")]
    pub next_preset_id: i64,
    #[serde(rename = "nextGroupId", default = "d1")]
    pub next_group_id: i64,
    #[serde(rename = "rootGroupIds", default)]
    pub root_group_ids: Vec<i64>,
    #[serde(default)]
    pub groups: Vec<Group>,
    #[serde(default)]
    pub presets: Vec<Value>,
}

fn d1() -> i64 { 1 }

impl Config {
    fn empty() -> Self {
        Config { next_preset_id: 1, next_group_id: 1, root_group_ids: vec![], groups: vec![], presets: vec![] }
    }
}

fn config_path(skin_path: &str) -> std::path::PathBuf {
    Path::new(skin_path).join(CONFIG_FILENAME)
}

fn load_config(skin_path: &str) -> Config {
    let p = config_path(skin_path);
    if !p.exists() { return Config::empty(); }
    let raw = match fs::read_to_string(&p) { Ok(s) => s, Err(_) => return Config::empty() };
    let v: Value = match serde_json::from_str(&raw) { Ok(v) => v, Err(_) => return Config::empty() };
    // Detect old format: needs rootGroupIds or groups
    if v.get("rootGroupIds").is_none() && v.get("groups").is_none() {
        return Config::empty();
    }
    // Normalize presets (ensure meta/actions)
    let presets = v.get("presets")
        .and_then(|p| p.as_array())
        .map(|arr| arr.iter().map(|p| {
            let id = p.get("id").cloned().unwrap_or(json!(0));
            let meta = p.get("meta").cloned().unwrap_or_else(|| json!({"name": format!("预设 {}", id), "description": "", "previewPath": ""}));
            let actions = p.get("actions").cloned().unwrap_or_else(|| json!({"skinIni": [], "fileCopies": [], "fileDeletes": []}));
            json!({"id": id, "meta": meta, "actions": actions})
        }).collect::<Vec<_>>())
        .unwrap_or_default();
    Config {
        next_preset_id: v.get("nextPresetId").and_then(|x| x.as_i64()).unwrap_or(1),
        next_group_id: v.get("nextGroupId").and_then(|x| x.as_i64()).unwrap_or(1),
        root_group_ids: v.get("rootGroupIds").and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_i64()).collect()).unwrap_or_default(),
        groups: v.get("groups").and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|g| serde_json::from_value(g.clone()).ok()).collect()).unwrap_or_default(),
        presets,
    }
}

fn save_config(skin_path: &str, cfg: &Config) {
    let p = config_path(skin_path);
    let v = json!({
        "nextPresetId": cfg.next_preset_id,
        "nextGroupId": cfg.next_group_id,
        "rootGroupIds": cfg.root_group_ids,
        "groups": cfg.groups,
        "presets": cfg.presets,
    });
    if let Ok(s) = serde_json::to_string_pretty(&v) {
        let _ = fs::write(&p, s);
    }
}

// ── Tree helpers ──

fn find_group_mut<'a>(cfg: &'a mut Config, group_id: i64) -> Option<usize> {
    cfg.groups.iter().position(|g| g.id == group_id)
}

fn remove_from_parent(cfg: &mut Config, child_id: i64, kind: &str) -> bool {
    if kind == "group" {
        if let Some(pos) = cfg.root_group_ids.iter().position(|x| *x == child_id) {
            cfg.root_group_ids.remove(pos);
            return true;
        }
    }
    for g in &mut cfg.groups {
        if let Some(pos) = g.children.iter().position(|c| c.kind == kind && c.id == child_id) {
            g.children.remove(pos);
            return true;
        }
    }
    false
}

fn insert_into_parent(cfg: &mut Config, child_id: i64, kind: &str, parent_group_id: Option<i64>, index: Option<i64>) -> Result<(), String> {
    if kind == "preset" && parent_group_id.is_none() {
        return Err("预设不能放置在根层级".to_string());
    }
    match parent_group_id {
        None => {
            let len = cfg.root_group_ids.len() as i64;
            let i = index.filter(|x| *x >= 0).unwrap_or(len) as usize;
            let i = i.min(cfg.root_group_ids.len());
            cfg.root_group_ids.insert(i, child_id);
        }
        Some(pid) => {
            let gi = find_group_mut(cfg, pid).ok_or_else(|| format!("目标分组不存在: {}", pid))?;
            let len = cfg.groups[gi].children.len() as i64;
            let i = index.filter(|x| *x >= 0).unwrap_or(len) as usize;
            let i = i.min(cfg.groups[gi].children.len());
            cfg.groups[gi].children.insert(i, ChildRef { kind: kind.to_string(), id: child_id });
        }
    }
    Ok(())
}

// ── ID compaction ──

pub fn compact_ids(cfg: &mut Config) {
    // presets: sort by id, reassign 1..N
    let mut preset_id_map: HashMap<i64, i64> = HashMap::new();
    cfg.presets.sort_by(|a, b| {
        let ai = a.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let bi = b.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        ai.cmp(&bi)
    });
    for (i, p) in cfg.presets.iter_mut().enumerate() {
        let new_id = (i + 1) as i64;
        if let Some(old) = p.get("id").and_then(|v| v.as_i64()) {
            preset_id_map.insert(old, new_id);
        }
        if let Some(obj) = p.as_object_mut() {
            obj.insert("id".to_string(), json!(new_id));
        }
    }
    // groups: sort by id, reassign 1..N
    let mut group_id_map: HashMap<i64, i64> = HashMap::new();
    cfg.groups.sort_by(|a, b| a.id.cmp(&b.id));
    for (i, g) in cfg.groups.iter_mut().enumerate() {
        let new_id = (i + 1) as i64;
        group_id_map.insert(g.id, new_id);
        g.id = new_id;
    }
    // remap children refs
    for g in &mut cfg.groups {
        for c in &mut g.children {
            if c.kind == "preset" {
                c.id = *preset_id_map.get(&c.id).unwrap_or(&c.id);
            } else if c.kind == "group" {
                c.id = *group_id_map.get(&c.id).unwrap_or(&c.id);
            }
        }
    }
    cfg.root_group_ids = cfg.root_group_ids.iter()
        .map(|id| *group_id_map.get(id).unwrap_or(id))
        .collect();
    cfg.next_preset_id = cfg.presets.len() as i64 + 1;
    cfg.next_group_id = cfg.groups.len() as i64 + 1;
}

// ── Scan ──

pub fn scan_skin(skin_path: &str) -> Value {
    let cfg = load_config(skin_path);
    // Self-clean: if both presets and groups are empty, the config.osp is a
    // dead husk left by a full deletion — remove it so the skin folder is clean.
    if cfg.presets.is_empty() && cfg.groups.is_empty() {
        let _ = fs::remove_file(config_path(skin_path));
    }
    let preset_summaries: Vec<Value> = cfg.presets.iter().map(|p| {
        let id = p.get("id").cloned().unwrap_or(json!(0));
        let meta = p.get("meta").cloned().unwrap_or_else(|| json!({"name": format!("预设 {}", id)}));
        let preview_path = meta.get("previewPath").and_then(|v| v.as_str()).unwrap_or("");
        let has_preview = !preview_path.is_empty() && Path::new(preview_path).exists();
        let actions = p.get("actions");
        let skin_ini_count = actions.and_then(|a| a.get("skinIni")).and_then(|a| a.as_array()).map(|a| a.len()).unwrap_or(0);
        let file_copy_count = actions.and_then(|a| a.get("fileCopies")).and_then(|a| a.as_array()).map(|a| a.len()).unwrap_or(0);
        json!({
            "id": id,
            "meta": meta,
            "hasPreview": has_preview,
            "skinIniCount": skin_ini_count as i64,
            "fileCopyCount": file_copy_count as i64,
        })
    }).collect();
    json!({
        "presets": preset_summaries,
        "groups": cfg.groups,
        "rootGroupIds": cfg.root_group_ids,
        "nextPresetId": cfg.next_preset_id,
        "nextGroupId": cfg.next_group_id,
    })
}

pub fn load_preset(skin_path: &str, preset_id: i64) -> Option<Value> {
    let cfg = load_config(skin_path);
    cfg.presets.into_iter().find(|p| p.get("id").and_then(|v| v.as_i64()) == Some(preset_id))
}

pub fn save_preset(skin_path: &str, preset_id: Option<i64>, data: &Value) -> Result<i64, String> {
    let mut cfg = load_config(skin_path);
    let id = match preset_id {
        Some(id) => id,
        None => {
            let id = cfg.next_preset_id;
            cfg.next_preset_id += 1;
            id
        }
    };
    let entry = json!({
        "id": id,
        "meta": data.get("meta").cloned().unwrap_or_else(|| json!({"name": format!("预设 {}", id), "description": "", "previewPath": ""})),
        "actions": data.get("actions").cloned().unwrap_or_else(|| json!({"skinIni": [], "fileCopies": [], "fileDeletes": []})),
    });
    if let Some(pos) = cfg.presets.iter().position(|p| p.get("id").and_then(|v| v.as_i64()) == Some(id)) {
        cfg.presets[pos] = entry;
    } else {
        cfg.presets.push(entry);
    }
    save_config(skin_path, &cfg);
    Ok(id)
}

pub fn delete_preset(skin_path: &str, preset_id: i64) {
    let mut cfg = load_config(skin_path);
    cfg.presets.retain(|p| p.get("id").and_then(|v| v.as_i64()) != Some(preset_id));
    remove_from_parent(&mut cfg, preset_id, "preset");
    compact_ids(&mut cfg);
    save_or_prune(skin_path, &cfg);
}

/// Delete many presets in one pass. MUST be used for multi-select deletion:
/// compact_ids() re-numbers every preset id after each delete, so deleting one
/// at a time with stale ids silently misses half of them.
pub fn delete_presets(skin_path: &str, preset_ids: &[i64]) -> usize {
    if preset_ids.is_empty() {
        return 0;
    }
    let mut cfg = load_config(skin_path);
    let to_delete: HashSet<i64> = preset_ids.iter().copied().collect();
    cfg.presets.retain(|p| {
        let id = p.get("id").and_then(|v| v.as_i64());
        id.map_or(true, |id| !to_delete.contains(&id))
    });
    let mut removed = 0;
    for id in preset_ids {
        if remove_from_parent(&mut cfg, *id, "preset") {
            removed += 1;
        }
    }
    compact_ids(&mut cfg);
    save_or_prune(skin_path, &cfg);
    removed
}

/// Persist config, OR — if every preset (and group) is gone — delete config.osp
/// so the skin folder is clean again rather than holding an empty tree.
fn save_or_prune(skin_path: &str, cfg: &Config) {
    if cfg.presets.is_empty() && cfg.groups.is_empty() {
        let _ = fs::remove_file(config_path(skin_path));
    } else {
        save_config(skin_path, cfg);
    }
}

// ── Group CRUD ──

pub fn add_group(skin_path: &str, name: &str, parent_group_id: Option<i64>) -> Result<i64, String> {
    let mut cfg = load_config(skin_path);
    let id = cfg.next_group_id;
    cfg.next_group_id += 1;
    cfg.groups.push(Group {
        id,
        name: if name.is_empty() { "新分组".to_string() } else { name.to_string() },
        collapsed: false,
        children: vec![],
    });
    insert_into_parent(&mut cfg, id, "group", parent_group_id, None)?;
    save_config(skin_path, &cfg);
    Ok(id)
}

pub fn remove_group(skin_path: &str, group_id: i64) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let gi = find_group_mut(&mut cfg, group_id).ok_or_else(|| format!("分组不存在: {}", group_id))?;
    if !cfg.groups[gi].children.is_empty() {
        return Err("分组非空，无法删除".to_string());
    }
    remove_from_parent(&mut cfg, group_id, "group");
    cfg.groups.retain(|g| g.id != group_id);
    compact_ids(&mut cfg);
    save_config(skin_path, &cfg);
    Ok(())
}

pub fn rename_group(skin_path: &str, group_id: i64, new_name: &str) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let gi = find_group_mut(&mut cfg, group_id).ok_or_else(|| format!("分组不存在: {}", group_id))?;
    cfg.groups[gi].name = if new_name.is_empty() { "未命名".to_string() } else { new_name.to_string() };
    save_config(skin_path, &cfg);
    Ok(())
}

// ── Movement ──

pub fn move_preset(skin_path: &str, preset_id: i64, target_group_id: Option<i64>, index: Option<i64>) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    if !cfg.presets.iter().any(|p| p.get("id").and_then(|v| v.as_i64()) == Some(preset_id)) {
        return Err(format!("预设不存在: {}", preset_id));
    }
    if let Some(tg) = target_group_id {
        if find_group_mut(&mut cfg, tg).is_none() {
            return Err(format!("目标分组不存在: {}", tg));
        }
    }
    remove_from_parent(&mut cfg, preset_id, "preset");
    if let Some(tg) = target_group_id {
        insert_into_parent(&mut cfg, preset_id, "preset", Some(tg), index)?;
    }
    save_config(skin_path, &cfg);
    Ok(())
}

pub fn move_group(skin_path: &str, group_id: i64, target_group_id: Option<i64>, index: Option<i64>) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    if find_group_mut(&mut cfg, group_id).is_none() {
        return Err(format!("分组不存在: {}", group_id));
    }
    if let Some(tg) = target_group_id {
        if group_id == tg { return Err("不能将分组移动到自身内部".to_string()); }
        if is_descendant(&cfg, group_id, tg) {
            return Err("不能将分组移动到其子分组内部".to_string());
        }
    }
    remove_from_parent(&mut cfg, group_id, "group");
    insert_into_parent(&mut cfg, group_id, "group", target_group_id, index)?;
    save_config(skin_path, &cfg);
    Ok(())
}

fn is_descendant(cfg: &Config, ancestor_id: i64, group_id: i64) -> bool {
    let gi = match cfg.groups.iter().position(|g| g.id == ancestor_id) { Some(i) => i, None => return false };
    for c in &cfg.groups[gi].children {
        if c.kind == "group" {
            if c.id == group_id { return true; }
            if is_descendant(cfg, c.id, group_id) { return true; }
        }
    }
    false
}

pub fn reorder_children(skin_path: &str, parent_group_id: Option<i64>, child_order: Vec<i64>) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    match parent_group_id {
        None => { cfg.root_group_ids = child_order; }
        Some(pid) => {
            let gi = find_group_mut(&mut cfg, pid).ok_or_else(|| format!("分组不存在: {}", pid))?;
            let order_map: HashMap<i64, usize> = child_order.iter().enumerate().map(|(i, id)| (*id, i)).collect();
            cfg.groups[gi].children.sort_by(|a, b| {
                let ai = order_map.get(&a.id).copied().unwrap_or(usize::MAX);
                let bi = order_map.get(&b.id).copied().unwrap_or(usize::MAX);
                ai.cmp(&bi)
            });
        }
    }
    save_config(skin_path, &cfg);
    Ok(())
}

pub fn set_group_collapsed(skin_path: &str, group_id: i64, collapsed: bool) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let gi = find_group_mut(&mut cfg, group_id).ok_or_else(|| format!("分组不存在: {}", group_id))?;
    cfg.groups[gi].collapsed = collapsed;
    save_config(skin_path, &cfg);
    Ok(())
}

pub fn delete_group_recursive(skin_path: &str, group_id: i64) -> Result<Value, String> {
    let mut cfg = load_config(skin_path);
    let root_gi = find_group_mut(&mut cfg, group_id).ok_or_else(|| format!("分组不存在: {}", group_id))?;
    let mut preset_ids: HashSet<i64> = HashSet::new();
    let mut group_ids: HashSet<i64> = HashSet::new();
    fn collect(cfg: &Config, gid: i64, preset_ids: &mut HashSet<i64>, group_ids: &mut HashSet<i64>) {
        group_ids.insert(gid);
        let gi = match cfg.groups.iter().position(|g| g.id == gid) { Some(i) => i, None => return };
        for c in &cfg.groups[gi].children {
            match c.kind.as_str() {
                "preset" => { preset_ids.insert(c.id); }
                "group" => { collect(cfg, c.id, preset_ids, group_ids); }
                _ => {}
            }
        }
    }
    // borrow trick: clone root group subtree? collect needs &cfg while we read root_gi index
    let _ = root_gi;
    collect(&cfg, group_id, &mut preset_ids, &mut group_ids);

    let deleted_preset_ids: Vec<i64> = preset_ids.iter().copied().collect();
    let deleted_group_ids: Vec<i64> = group_ids.iter().copied().collect();

    cfg.presets.retain(|p| p.get("id").and_then(|v| v.as_i64()).map_or(true, |id| !preset_ids.contains(&id)));
    cfg.groups.retain(|g| !group_ids.contains(&g.id));
    remove_from_parent(&mut cfg, group_id, "group");
    cfg.root_group_ids.retain(|id| !group_ids.contains(id));

    compact_ids(&mut cfg);
    save_config(skin_path, &cfg);
    Ok(json!({
        "deletedPresets": deleted_preset_ids.len() as i64,
        "deletedGroups": deleted_group_ids.len() as i64,
        "deletedPresetIds": deleted_preset_ids,
        "deletedGroupIds": deleted_group_ids,
    }))
}

// ── Preview ──

pub fn get_preview_data_url(image_path: &str) -> Option<String> {
    if image_path.is_empty() || !Path::new(image_path).exists() { return None; }
    let bytes = fs::read(image_path).ok()?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    let ext = Path::new(image_path).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        _ => "image/png",
    };
    Some(format!("data:{};base64,{}", mime, b64))
}
