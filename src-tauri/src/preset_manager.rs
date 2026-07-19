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
    /// "" = normal group, "table" = table group (sub-groups are table rows).
    #[serde(default, rename = "type")]
    pub kind: String,
    /// Global shortcut bound to this group (table groups can have shortcuts).
    #[serde(default)]
    pub shortcut: Option<String>,
    /// Optional user description shown read-only in use mode.
    #[serde(default)]
    pub description: Option<String>,
    /// Optional preview media (same fields as preset meta.preview*).
    #[serde(default, rename = "previewPath")]
    pub preview_path: Option<String>,
    #[serde(default, rename = "previewKind")]
    pub preview_kind: Option<String>,
    #[serde(default, rename = "previewFrames")]
    pub preview_frames: Option<Vec<String>>,
    #[serde(default, rename = "previewFps")]
    pub preview_fps: Option<i32>,
    /// Optional own actions (INI/file/tint) — a table group can be an
    /// applicable unit itself, independent of its child presets.
    #[serde(default)]
    pub actions: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(rename = "nextPresetId", default = "d1")]
    pub next_preset_id: i64,
    #[serde(rename = "nextGroupId", default = "d1")]
    pub next_group_id: i64,
    /// Unified root-level children (presets + groups interleaved). Replaces the
    /// older separate rootGroupIds + rootPresetIds arrays; load_config migrates.
    #[serde(rename = "rootChildren", default)]
    pub root_children: Vec<ChildRef>,
    #[serde(default)]
    pub groups: Vec<Group>,
    #[serde(default)]
    pub presets: Vec<Value>,
    /// Persisted table-group UI state. tableExpandedChildren: {gid: [childGid]},
    /// tableRowSelection: {gid: {rowKey: presetId}}.
    #[serde(rename = "tableExpandedChildren", default)]
    pub table_expanded_children: Value,
    #[serde(rename = "tableRowSelection", default)]
    pub table_row_selection: Value,
    /// Persisted row-activation edges. tableActivations: {srcGid: [{ srcRowKey,
    /// srcOption, targets: [{ dstGid, dstRowKey, dstOption }] }]}. "Selecting
    /// srcOption forces each target row's dstOption and disables its siblings."
    /// See docs/row-activation-design.md.
    #[serde(rename = "tableActivations", default)]
    pub table_activations: Value,
}

fn d1() -> i64 { 1 }

impl Config {
    fn empty() -> Self {
        Config { next_preset_id: 1, next_group_id: 1, root_children: vec![], groups: vec![], presets: vec![], table_expanded_children: json!({}), table_row_selection: json!({}), table_activations: json!({}) }
    }
}

fn config_path(skin_path: &str) -> std::path::PathBuf {
    Path::new(skin_path).join(CONFIG_FILENAME)
}

pub fn load_config(skin_path: &str) -> Config {
    let p = config_path(skin_path);
    if !p.exists() { return Config::empty(); }
    let raw = match fs::read_to_string(&p) { Ok(s) => s, Err(_) => return Config::empty() };
    let v: Value = match serde_json::from_str(&raw) { Ok(v) => v, Err(_) => return Config::empty() };
    // Detect legacy format (pre-groups): a bare preset array or an object with
    // no nextPresetId/presets/groups. NOTE: a brand-new config that has presets
    // but no groups yet legitimately omits rootGroupIds AND groups — so those two
    // alone must NOT be treated as "legacy" (doing so makes load_config discard
    // the just-saved file, and scan_skin's self-clean then deletes it).
    let is_object = v.is_object();
    let has_tree_keys = v.get("nextPresetId").is_some()
        || v.get("presets").is_some()
        || v.get("rootGroupIds").is_some()
        || v.get("groups").is_some();
    if !is_object || !has_tree_keys {
        return Config::empty();
    }
    // Normalize presets (ensure meta/actions)
    let presets = v.get("presets")
        .and_then(|p| p.as_array())
        .map(|arr| arr.iter().map(|p| {
            let id = p.get("id").cloned().unwrap_or(json!(0));
            let meta = p.get("meta").cloned().unwrap_or_else(|| json!({"name": crate::i18n::t("preset.fallback_name", &[("id", &id.as_i64().unwrap_or(0).to_string())]), "description": "", "previewPath": ""}));
            let actions = p.get("actions").cloned().unwrap_or_else(|| json!({"skinIni": [], "fileCopies": [], "fileDeletes": [], "fileTints": []}));
            json!({"id": id, "meta": meta, "actions": actions})
        }).collect::<Vec<_>>())
        .unwrap_or_default();
    let groups: Vec<Group> = v.get("groups").and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|g| serde_json::from_value(g.clone()).ok()).collect()).unwrap_or_default();
    // Root children: prefer the unified `rootChildren` field. Migrate from the
    // legacy separate arrays (rootPresetIds then rootGroupIds — preserving the
    // previous visual order: all root presets first, then root groups).
    let mut root_children: Vec<ChildRef> = if v.get("rootChildren").is_some() {
        v.get("rootChildren").and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|c| serde_json::from_value(c.clone()).ok()).collect())
            .unwrap_or_default()
    } else {
        let mut rc = Vec::new();
        if let Some(arr) = v.get("rootPresetIds").and_then(|x| x.as_array()) {
            for x in arr {
                if let Some(id) = x.as_i64() { rc.push(ChildRef { kind: "preset".to_string(), id }); }
            }
        }
        if let Some(arr) = v.get("rootGroupIds").and_then(|x| x.as_array()) {
            for x in arr {
                if let Some(id) = x.as_i64() { rc.push(ChildRef { kind: "group".to_string(), id }); }
            }
        }
        rc
    };
    // Migrate orphans: presets not referenced by any group's children and not
    // already at root → append to root_children in presets order.
    {
        let mut in_a_group: Vec<i64> = Vec::new();
        for g in &groups {
            collect_preset_ids(&g.children, &groups, &mut in_a_group);
        }
        let in_a_group_set: std::collections::HashSet<i64> = in_a_group.into_iter().collect();
        let already_root: std::collections::HashSet<i64> = root_children.iter()
            .filter(|c| c.kind == "preset").map(|c| c.id).collect();
        for p in &presets {
            if let Some(id) = p.get("id").and_then(|x| x.as_i64()) {
                if !in_a_group_set.contains(&id) && !already_root.contains(&id) {
                    root_children.push(ChildRef { kind: "preset".to_string(), id });
                }
            }
        }
    }
    Config {
        next_preset_id: v.get("nextPresetId").and_then(|x| x.as_i64()).unwrap_or(1),
        next_group_id: v.get("nextGroupId").and_then(|x| x.as_i64()).unwrap_or(1),
        root_children,
        groups,
        presets,
        table_expanded_children: v.get("tableExpandedChildren").cloned().unwrap_or_else(|| json!({})),
        table_row_selection: v.get("tableRowSelection").cloned().unwrap_or_else(|| json!({})),
        table_activations: v.get("tableActivations").cloned().unwrap_or_else(|| json!({})),
    }
}

// Recursively collect every preset id reachable through a group's children
// (sub-groups included), so load_config can tell which presets are orphans.
fn collect_preset_ids(children: &[ChildRef], groups: &[Group], out: &mut Vec<i64>) {
    for c in children {
        match c.kind.as_str() {
            "preset" => out.push(c.id),
            "group" => {
                if let Some(g) = groups.iter().find(|g| g.id == c.id) {
                    collect_preset_ids(&g.children, groups, out);
                }
            }
            _ => {}
        }
    }
}

fn save_config(skin_path: &str, cfg: &Config) -> Result<(), String> {
    let p = config_path(skin_path);
    let mut v = serde_json::Map::new();
    v.insert("nextPresetId".into(), json!(cfg.next_preset_id));
    v.insert("nextGroupId".into(), json!(cfg.next_group_id));
    if !cfg.root_children.is_empty() {
        v.insert("rootChildren".into(), json!(cfg.root_children));
    }
    if !cfg.groups.is_empty() {
        v.insert("groups".into(), json!(cfg.groups));
    }
    if !cfg.presets.is_empty() {
        v.insert("presets".into(), json!(cfg.presets));
    }
    if !cfg.table_expanded_children.is_null() && cfg.table_expanded_children.as_object().map_or(false, |o| !o.is_empty()) {
        v.insert("tableExpandedChildren".into(), cfg.table_expanded_children.clone());
    }
    if !cfg.table_row_selection.is_null() && cfg.table_row_selection.as_object().map_or(false, |o| !o.is_empty()) {
        v.insert("tableRowSelection".into(), cfg.table_row_selection.clone());
    }
    if !cfg.table_activations.is_null() && cfg.table_activations.as_object().map_or(false, |o| !o.is_empty()) {
        v.insert("tableActivations".into(), cfg.table_activations.clone());
    }
    // Compact (non-pretty) serialization keeps config.osp small — the file is
    // machine-only; readers use unwrap_or defaults for any omitted keys.
    let s = serde_json::to_string(&Value::Object(v))
        .map_err(|e| format!("serialize: {}", e))?;
    fs::write(&p, s).map_err(|e| format!("write {}: {}", p.display(), e))?;
    Ok(())
}

// ── Tree helpers ──

fn find_group_mut<'a>(cfg: &'a mut Config, group_id: i64) -> Option<usize> {
    cfg.groups.iter().position(|g| g.id == group_id)
}

fn remove_from_parent(cfg: &mut Config, child_id: i64, kind: &str) -> bool {
    // Root-level: unified root_children array.
    if let Some(pos) = cfg.root_children.iter().position(|c| c.kind == kind && c.id == child_id) {
        cfg.root_children.remove(pos);
        return true;
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
    match parent_group_id {
        None => {
            // Root: unified root_children. Default index = 0 (new items go to TOP).
            let len = cfg.root_children.len() as i64;
            let i = index.filter(|x| *x >= 0).unwrap_or(0).min(len) as usize;
            cfg.root_children.insert(i, ChildRef { kind: kind.to_string(), id: child_id });
        }
        Some(pid) => {
            let gi = find_group_mut(cfg, pid).ok_or_else(|| crate::i18n::t("err.target_group_not_found", &[("id", &pid.to_string())]))?;
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
    // remap root children (unified: both preset and group ids)
    for c in &mut cfg.root_children {
        if c.kind == "preset" {
            c.id = *preset_id_map.get(&c.id).unwrap_or(&c.id);
        } else if c.kind == "group" {
            c.id = *group_id_map.get(&c.id).unwrap_or(&c.id);
        }
    }
    // remap persisted table-group UI state. These maps are keyed by group/preset
    // id, so an id compaction would otherwise leave them pointing at stale or
    // wrong nodes (an expanded table group silently un-expanding, or a row
    // selection landing on a different preset). Keys are JSON-string ids; inner
    // values are ids too (presetId in tableRowSelection; childGids in
    // tableExpandedChildren). Entries whose key id no longer exists are dropped.
    cfg.table_expanded_children = remap_expanded(&cfg.table_expanded_children, &group_id_map);
    cfg.table_row_selection = remap_row_selection(&cfg.table_row_selection, &group_id_map, &preset_id_map);
    cfg.table_activations = remap_activations(&cfg.table_activations, &group_id_map, &preset_id_map);
    cfg.next_preset_id = cfg.presets.len() as i64 + 1;
    cfg.next_group_id = cfg.groups.len() as i64 + 1;
}

// Read an id that may be stored as a number OR a numeric string (the renderer
// is inconsistent about which it writes). Returns the parsed i64.
fn id_as_i64(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
}
// Re-emit a remapped id preserving the ORIGINAL JSON type (string or number),
// so we don't change the on-disk shape the renderer expects.
fn reemit_id(old: &Value, new_id: i64) -> Value {
    if old.is_string() { Value::String(new_id.to_string()) } else { json!(new_id) }
}

// Remap tableExpandedChildren: { "parentGid": ["childGid", ...] } — both the
// top-level key and every array entry are group ids. Drops a parent entry when
// its (old) key id is gone; drops child entries whose id is gone.
fn remap_expanded(v: &Value, group_map: &HashMap<i64, i64>) -> Value {
    let obj = match v.as_object() { Some(o) => o, None => return v.clone() };
    let mut out = serde_json::Map::new();
    for (k, arr) in obj {
        let parent = match k.parse::<i64>() { Ok(id) => id, Err(_) => continue };
        let new_parent = match group_map.get(&parent) { Some(np) => *np, None => continue };
        let children = match arr.as_array() { Some(a) => a, None => continue };
        let new_kids: Vec<Value> = children.iter().filter_map(|c| {
            id_as_i64(c).and_then(|cid| group_map.get(&cid).map(|nc| reemit_id(c, *nc)))
        }).collect();
        out.insert(new_parent.to_string(), Value::Array(new_kids));
    }
    Value::Object(out)
}

// Remap tableRowSelection: { "gid": { "rowKey": presetId } } — the top-level
// key is a group id; each inner value is a preset id (the rowKey is NOT an id,
// leave it). Drops a group entry when its (old) key id is gone; drops inner
// entries whose preset id is gone.
fn remap_row_selection(v: &Value, group_map: &HashMap<i64, i64>, preset_map: &HashMap<i64, i64>) -> Value {
    let obj = match v.as_object() { Some(o) => o, None => return v.clone() };
    let mut out = serde_json::Map::new();
    for (k, rows) in obj {
        let gid = match k.parse::<i64>() { Ok(id) => id, Err(_) => continue };
        let new_gid = match group_map.get(&gid) { Some(ng) => *ng, None => continue };
        let rows_obj = match rows.as_object() { Some(o) => o, None => continue };
        let mut new_rows = serde_json::Map::new();
        for (row_key, pid_val) in rows_obj {
            if let Some(pid) = id_as_i64(pid_val) {
                if let Some(np) = preset_map.get(&pid) {
                    new_rows.insert(row_key.clone(), reemit_id(pid_val, *np));
                }
                // preset gone → drop the selection (don't carry a stale id).
            }
        }
        out.insert(new_gid.to_string(), Value::Object(new_rows));
    }
    Value::Object(out)
}

// Remap a rowKey path's embedded group ids. A rowKey looks like "<gid>:<gid>:..."
// (with possible "__direct__" segments). Each numeric segment is a group id that
// must be remapped; "__direct__" and non-numeric segments are left alone. Returns
// None if ANY numeric segment's id is gone (the path points at a deleted node),
// so the caller can drop the whole edge.
fn remap_row_key_path(row_key: &str, group_map: &HashMap<i64, i64>) -> Option<String> {
    let mut out: Vec<String> = Vec::new();
    for part in row_key.split(':') {
        if part == "__direct__" || part.is_empty() {
            out.push(part.to_string());
        } else if let Ok(id) = part.parse::<i64>() {
            let new_id = *group_map.get(&id)?;
            out.push(new_id.to_string());
        } else {
            // Non-numeric, non-direct segment: leave as-is (forward-compat).
            out.push(part.to_string());
        }
    }
    Some(out.join(":"))
}

// Remap an option value: either a preset id (number/numeric-string) or a
// 'group:<gid>' marker. Returns None if the referenced id is gone.
fn remap_option(v: &Value, group_map: &HashMap<i64, i64>, preset_map: &HashMap<i64, i64>) -> Option<Value> {
    if let Some(s) = v.as_str() {
        if let Some(rest) = s.strip_prefix("group:") {
            let gid = rest.parse::<i64>().ok()?;
            let ng = *group_map.get(&gid)?;
            return Some(Value::String(format!("group:{}", ng)));
        }
        // numeric string preset id
        if let Ok(pid) = s.parse::<i64>() {
            let np = *preset_map.get(&pid)?;
            return Some(Value::String(np.to_string()));
        }
        return Some(v.clone());
    }
    if let Some(pid) = v.as_i64() {
        let np = *preset_map.get(&pid)?;
        return Some(json!(np));
    }
    Some(v.clone())
}

// Remap tableActivations: { srcGid: { srcOptionKey: [{ dstRowKey, dstOption }] } }.
// srcGid (outer key) is a group id; srcOptionKey (inner key) is a preset id
// (numeric string) or 'group:<gid>'; dstRowKey embeds gid path segments;
// dstOption is a preset id or 'group:<gid>'. Drops an edge when ANY referenced
// id is gone (conservative). NOTE: source is keyed by option id only (a preset
// appears in exactly one table group, so srcRowKey is redundant and omitted).
fn remap_activations(v: &Value, group_map: &HashMap<i64, i64>, preset_map: &HashMap<i64, i64>) -> Value {
    let obj = match v.as_object() { Some(o) => o, None => return v.clone() };
    let mut out = serde_json::Map::new();
    for (k, by_src) in obj {
        let src_gid = match k.parse::<i64>() { Ok(id) => id, Err(_) => continue };
        let new_src_gid = match group_map.get(&src_gid) { Some(ng) => *ng, None => continue };
        let src_obj = match by_src.as_object() { Some(o) => o, None => continue };
        let mut new_src_obj = serde_json::Map::new();
        for (src_key, targets) in src_obj {
            // Re-key the source option: preset id → remapped preset id;
            // 'group:<gid>' → remapped gid.
            let new_src_key = if let Some(rest) = src_key.strip_prefix("group:") {
                match rest.parse::<i64>() { Ok(gid) => match group_map.get(&gid) {
                    Some(ng) => format!("group:{}", ng), None => continue,
                }, Err(_) => continue }
            } else {
                match src_key.parse::<i64>() { Ok(pid) => match preset_map.get(&pid) {
                    Some(np) => np.to_string(), None => continue,
                }, Err(_) => src_key.clone() }
            };
            let targets_arr = match targets.as_array() { Some(a) => a, None => continue };
            let mut new_targets: Vec<Value> = Vec::new();
            for t in targets_arr {
                let to = match t.as_object() { Some(o) => o, None => continue };
                let dst_row = match to.get("dstRowKey").and_then(|v| v.as_str()) { Some(s) => s, None => continue };
                let new_dst_row = match remap_row_key_path(dst_row, group_map) { Some(p) => p, None => continue };
                let new_dst_opt = match to.get("dstOption").and_then(|v| remap_option(v, group_map, preset_map)) { Some(v) => v, None => continue };
                // Preserve effect ('select' default, 'disable') — it carries no id.
                let effect = to.get("effect").cloned().unwrap_or(json!("select"));
                new_targets.push(json!({ "dstRowKey": new_dst_row, "dstOption": new_dst_opt, "effect": effect }));
            }
            if new_targets.is_empty() { continue; } // all targets gone → drop this source
            new_src_obj.insert(new_src_key, Value::Array(new_targets));
        }
        if new_src_obj.is_empty() { continue; } // all sources gone → drop bucket
        out.insert(new_src_gid.to_string(), Value::Object(new_src_obj));
    }
    Value::Object(out)
}

pub fn scan_skin(skin_path: &str) -> Value {
    let cfg = load_config(skin_path);
    // Self-clean: if both presets and groups are empty, the config.osp is a
    // dead husk left by a full deletion — remove it so the skin folder is clean.
    if cfg.presets.is_empty() && cfg.groups.is_empty() {
        let _ = fs::remove_file(config_path(skin_path));
    }
    let preset_summaries: Vec<Value> = cfg.presets.iter().map(|p| {
        let id = p.get("id").cloned().unwrap_or(json!(0));
        let meta = p.get("meta").cloned().unwrap_or_else(|| json!({"name": crate::i18n::t("preset.fallback_name", &[("id", &id.as_i64().unwrap_or(0).to_string())])}));
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
        "rootChildren": cfg.root_children,
        "nextPresetId": cfg.next_preset_id,
        "nextGroupId": cfg.next_group_id,
        "tableExpandedChildren": cfg.table_expanded_children,
        "tableRowSelection": cfg.table_row_selection,
        "tableActivations": cfg.table_activations,
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
    // Build the preset entry: keep meta fields as-is (including empty
    // description/previewPath), keep all action arrays (even empty). Only the
    // compact JSON serialization (in save_config) reduces file size.
    let mut entry = serde_json::Map::new();
    entry.insert("id".into(), json!(id));
    let mut meta = serde_json::Map::new();
    if let Some(m) = data.get("meta").and_then(|m| m.as_object()) {
        let name = m.get("name").and_then(|v| v.as_str()).unwrap_or("");
        meta.insert("name".into(), json!(if name.is_empty() { crate::i18n::t("preset.fallback_name", &[("id", &id.to_string())]) } else { name.to_string() }));
        meta.insert("description".into(), json!(m.get("description").and_then(|v| v.as_str()).unwrap_or("")));
        meta.insert("previewPath".into(), json!(m.get("previewPath").and_then(|v| v.as_str()).unwrap_or("")));
        // Carry over preview kind/frames/fps (image sequence support).
        if let Some(k) = m.get("previewKind") { meta.insert("previewKind".into(), k.clone()); }
        if let Some(f) = m.get("previewFrames") { meta.insert("previewFrames".into(), f.clone()); }
        if let Some(fp) = m.get("previewFps") { meta.insert("previewFps".into(), fp.clone()); }
        // Carry over shortcut (global hotkey binding).
        if let Some(s) = m.get("shortcut") { meta.insert("shortcut".into(), s.clone()); }
    } else {
        meta.insert("name".into(), json!(crate::i18n::t("preset.fallback_name", &[("id", &id.to_string())])));
        meta.insert("description".into(), json!(""));
        meta.insert("previewPath".into(), json!(""));
    }
    entry.insert("meta".into(), Value::Object(meta));
    entry.insert("actions".into(), data.get("actions").cloned().unwrap_or_else(|| json!({"skinIni": [], "fileCopies": [], "fileDeletes": [], "fileTints": []})));
    let entry = Value::Object(entry);
    let is_new = preset_id.is_none();
    if let Some(pos) = cfg.presets.iter().position(|p| p.get("id").and_then(|v| v.as_i64()) == Some(id)) {
        cfg.presets[pos] = entry;
    } else {
        cfg.presets.push(entry);
    }
    // A brand-new preset (no id given) is placed at the TOP of root so it
    // appears first in the tree, mirroring new groups. Existing presets keep
    // their position (they're already in root_children via load/move).
    if is_new {
        let already_root = cfg.root_children.iter().any(|c| c.kind == "preset" && c.id == id);
        if !already_root {
            let _ = insert_into_parent(&mut cfg, id, "preset", None, Some(0));
        }
    }
    save_config(skin_path, &cfg)?;
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
        let _ = save_config(skin_path, cfg);
    }
}

// ── Group CRUD ──

pub fn add_group(skin_path: &str, name: &str, parent_group_id: Option<i64>, kind: &str) -> Result<i64, String> {
    let mut cfg = load_config(skin_path);
    let id = cfg.next_group_id;
    cfg.next_group_id += 1;
    cfg.groups.push(Group {
        id,
        name: if name.is_empty() { crate::i18n::t("group.default_empty_name", &[]) } else { name.to_string() },
        collapsed: false,
        children: vec![],
        kind: kind.to_string(),
        shortcut: None,
        description: None,
        preview_path: None,
        preview_kind: None,
        preview_frames: None,
        preview_fps: None,
        actions: None,
    });
    insert_into_parent(&mut cfg, id, "group", parent_group_id, None)?;
    save_config(skin_path, &cfg)?;
    Ok(id)
}

/// Set or clear the shortcut on a group (for table group hotkeys).
pub fn set_group_shortcut(skin_path: &str, group_id: i64, accelerator: &str) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let g = cfg.groups.iter_mut().find(|g| g.id == group_id)
        .ok_or_else(|| crate::i18n::t("err.group_not_found", &[("id", &group_id.to_string())]))?;
    if accelerator.is_empty() {
        g.shortcut = None;
    } else {
        g.shortcut = Some(accelerator.to_string());
    }
    save_config(skin_path, &cfg)
}

/// Set/clear the shortcut on MANY groups in a single load/edit/save (avoids the
/// N load+save round-trips of calling set_group_shortcut once per group).
pub fn set_group_shortcuts_batch(skin_path: &str, group_ids: &[i64], accelerator: &str) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let id_set: std::collections::HashSet<i64> = group_ids.iter().copied().collect();
    for g in cfg.groups.iter_mut() {
        if id_set.contains(&g.id) {
            g.shortcut = if accelerator.is_empty() { None } else { Some(accelerator.to_string()) };
        }
    }
    save_config(skin_path, &cfg)
}

/// Set or clear the description on a group (shown read-only in use mode).
pub fn set_group_description(skin_path: &str, group_id: i64, description: &str) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let g = cfg.groups.iter_mut().find(|g| g.id == group_id)
        .ok_or_else(|| crate::i18n::t("err.group_not_found", &[("id", &group_id.to_string())]))?;
    g.description = if description.is_empty() { None } else { Some(description.to_string()) };
    save_config(skin_path, &cfg)
}

/// Set or clear the own actions on a group (a table group can be an applicable
/// unit itself). Empty actions (all four arrays empty) are stored as None to
/// keep config.osp compact.
/// Persist the table-group UI state (expanded children + row selections).
pub fn set_table_state(skin_path: &str, expanded: &Value, row_selection: &Value, activations: &Value) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    cfg.table_expanded_children = expanded.clone();
    cfg.table_row_selection = row_selection.clone();
    cfg.table_activations = activations.clone();
    save_config(skin_path, &cfg)
}

pub fn set_group_actions(skin_path: &str, group_id: i64, actions: &Value) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let g = cfg.groups.iter_mut().find(|g| g.id == group_id)
        .ok_or_else(|| crate::i18n::t("err.group_not_found", &[("id", &group_id.to_string())]))?;
    let empty = json!({"skinIni":[],"fileCopies":[],"fileDeletes":[],"fileTints":[]});
    g.actions = if actions == &empty { None } else { Some(actions.clone()) };
    save_config(skin_path, &cfg)
}

/// Persist the table-group UI state (expanded children + row selections).
/// Flatten a group's nested sub-groups: move every preset from any depth in
/// the group's subtree into the group's DIRECT children, then delete all
/// intermediate sub-groups. Used when dragging a group with nested plain
/// sub-groups into a table group (table groups only allow one level of rows).
pub fn flatten_group_subgroups(skin_path: &str, group_id: i64) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let gi = cfg.groups.iter().position(|g| g.id == group_id)
        .ok_or_else(|| crate::i18n::t("err.group_not_found", &[("id", &group_id.to_string())]))?;

    // Collect presets + table sub-group refs from plain sub-groups (recursive).
    // Plain sub-groups get deleted; table sub-groups are kept as children.
    let mut new_children: Vec<ChildRef> = Vec::new();
    let mut to_delete: Vec<i64> = Vec::new();

    fn hoist_plain(cfg: &Config, gid: i64, out: &mut Vec<ChildRef>, to_delete: &mut Vec<i64>) {
        if let Some(g) = cfg.groups.iter().find(|g| g.id == gid) {
            for c in &g.children {
                match c.kind.as_str() {
                    "preset" => out.push(c.clone()),
                    "group" => {
                        if let Some(sub) = cfg.groups.iter().find(|x| x.id == c.id) {
                            if sub.kind == "table" {
                                // Keep table sub-group as a child.
                                out.push(c.clone());
                            } else {
                                // Plain sub-group: recurse + mark for deletion.
                                to_delete.push(c.id);
                                hoist_plain(cfg, c.id, out, to_delete);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // Walk the group's direct children.
    let old_children = cfg.groups[gi].children.clone();
    for c in &old_children {
        match c.kind.as_str() {
            "preset" => new_children.push(c.clone()),
            "group" => {
                if let Some(sub) = cfg.groups.iter().find(|x| x.id == c.id) {
                    if sub.kind == "table" {
                        new_children.push(c.clone());
                    } else {
                        to_delete.push(c.id);
                        hoist_plain(&cfg, c.id, &mut new_children, &mut to_delete);
                    }
                }
            }
            _ => {}
        }
    }

    cfg.groups[gi].children = new_children;
    let del_set: std::collections::HashSet<i64> = to_delete.into_iter().collect();
    cfg.groups.retain(|g| !del_set.contains(&g.id));
    save_config(skin_path, &cfg)
}

/// Set the preview media on a group (path/kind/frames/fps, same shape as preset meta).
pub fn set_group_preview(
    skin_path: &str,
    group_id: i64,
    path: Option<&str>,
    kind: Option<&str>,
    frames: Option<Vec<String>>,
    fps: Option<i32>,
) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let g = cfg.groups.iter_mut().find(|g| g.id == group_id)
        .ok_or_else(|| crate::i18n::t("err.group_not_found", &[("id", &group_id.to_string())]))?;
    g.preview_path = path.filter(|s| !s.is_empty()).map(|s| s.to_string());
    g.preview_kind = kind.filter(|s| !s.is_empty()).map(|s| s.to_string());
    g.preview_frames = frames.filter(|f| !f.is_empty());
    g.preview_fps = fps;
    save_config(skin_path, &cfg)
}

pub fn remove_group(skin_path: &str, group_id: i64) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let gi = find_group_mut(&mut cfg, group_id).ok_or_else(|| crate::i18n::t("err.group_not_found", &[("id", &group_id.to_string())]))?;
    if !cfg.groups[gi].children.is_empty() {
        return Err(crate::i18n::t("err.group_not_empty", &[]));
    }
    remove_from_parent(&mut cfg, group_id, "group");
    cfg.groups.retain(|g| g.id != group_id);
    compact_ids(&mut cfg);
    save_config(skin_path, &cfg)?;
    Ok(())
}

pub fn rename_group(skin_path: &str, group_id: i64, new_name: &str) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let gi = find_group_mut(&mut cfg, group_id).ok_or_else(|| crate::i18n::t("err.group_not_found", &[("id", &group_id.to_string())]))?;
    cfg.groups[gi].name = if new_name.is_empty() { crate::i18n::t("group.unnamed", &[]) } else { new_name.to_string() };
    save_config(skin_path, &cfg)?;
    Ok(())
}

// ── Movement ──

pub fn move_preset(skin_path: &str, preset_id: i64, target_group_id: Option<i64>, index: Option<i64>) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    if !cfg.presets.iter().any(|p| p.get("id").and_then(|v| v.as_i64()) == Some(preset_id)) {
        return Err(crate::i18n::t("err.preset_not_found", &[("id", &preset_id.to_string())]));
    }
    if let Some(tg) = target_group_id {
        if find_group_mut(&mut cfg, tg).is_none() {
            return Err(crate::i18n::t("err.target_group_not_found", &[("id", &tg.to_string())]));
        }
        // A single-level (top-level) table group may hold presets directly, as
        // can table sub-groups (rows). No restriction here.
    }
    remove_from_parent(&mut cfg, preset_id, "preset");
    insert_into_parent(&mut cfg, preset_id, "preset", target_group_id, index)?;
    save_config(skin_path, &cfg)?;
    Ok(())
}

pub fn move_group(skin_path: &str, group_id: i64, target_group_id: Option<i64>, index: Option<i64>) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    if find_group_mut(&mut cfg, group_id).is_none() {
        return Err(crate::i18n::t("err.group_not_found", &[("id", &group_id.to_string())]));
    }
    if let Some(tg) = target_group_id {
        if group_id == tg { return Err(crate::i18n::t("err.group_move_into_self", &[])); }
        if is_descendant(&cfg, group_id, tg) {
            return Err(crate::i18n::t("err.group_move_into_child", &[]));
        }
    }
    remove_from_parent(&mut cfg, group_id, "group");
    insert_into_parent(&mut cfg, group_id, "group", target_group_id, index)?;
    save_config(skin_path, &cfg)?;
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

pub fn reorder_children(skin_path: &str, parent_group_id: Option<i64>, child_order: Vec<ChildRef>) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    // Guard: prevent a group from being placed inside itself (circular ref
    // would cause infinite recursion in save_config → stack overflow).
    if let Some(pid) = parent_group_id {
        if child_order.iter().any(|c| c.kind == "group" && c.id == pid) {
            return Err("Cannot place a group inside itself".to_string());
        }
    }
    match parent_group_id {
        None => { cfg.root_children = child_order; }
        Some(pid) => {
            let gi = find_group_mut(&mut cfg, pid).ok_or_else(|| crate::i18n::t("err.group_not_found", &[("id", &pid.to_string())]))?;
            let order_map: HashMap<(String, i64), usize> = child_order.iter().enumerate()
                .map(|(i, c)| ((c.kind.clone(), c.id), i)).collect();
            cfg.groups[gi].children.sort_by(|a, b| {
                let ai = order_map.get(&(a.kind.clone(), a.id)).copied().unwrap_or(usize::MAX);
                let bi = order_map.get(&(b.kind.clone(), b.id)).copied().unwrap_or(usize::MAX);
                ai.cmp(&bi)
            });
        }
    }
    save_config(skin_path, &cfg)?;
    Ok(())
}

pub fn set_group_collapsed(skin_path: &str, group_id: i64, collapsed: bool) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    let gi = find_group_mut(&mut cfg, group_id).ok_or_else(|| crate::i18n::t("err.group_not_found", &[("id", &group_id.to_string())]))?;
    cfg.groups[gi].collapsed = collapsed;
    save_config(skin_path, &cfg)?;
    Ok(())
}

// Set collapsed state for many groups in ONE read+write (used by Shift+click
// recursive expand/collapse, where per-group IPC would cause a visible stall).
pub fn set_groups_collapsed_batch(skin_path: &str, group_ids: &[i64], collapsed: bool) -> Result<(), String> {
    let mut cfg = load_config(skin_path);
    for g in cfg.groups.iter_mut() {
        if group_ids.contains(&g.id) { g.collapsed = collapsed; }
    }
    save_config(skin_path, &cfg)?;
    Ok(())
}

pub fn delete_group_recursive(skin_path: &str, group_id: i64) -> Result<Value, String> {
    let mut cfg = load_config(skin_path);
    let root_gi = find_group_mut(&mut cfg, group_id).ok_or_else(|| crate::i18n::t("err.group_not_found", &[("id", &group_id.to_string())]))?;
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
    // Purge any deleted group/preset refs from the unified root children.
    cfg.root_children.retain(|c| {
        if c.kind == "group" { !group_ids.contains(&c.id) }
        else if c.kind == "preset" { !preset_ids.contains(&c.id) }
        else { true }
    });

    compact_ids(&mut cfg);
    save_config(skin_path, &cfg)?;
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
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "apng" => "image/apng",
        _ => "image/png",
    };
    Some(format!("data:{};base64,{}", mime, b64))
}

#[cfg(test)]
mod compact_tests {
    use super::*;
    use serde_json::json;

    fn cfg_with(ids: &[i64], table_exp: Value, table_sel: Value) -> Config {
        Config {
            next_preset_id: ids.len() as i64 + 1,
            next_group_id: 1,
            root_children: ids.iter().map(|id| ChildRef { kind: "preset".into(), id: *id }).collect(),
            groups: vec![],
            presets: ids.iter().map(|id| json!({ "id": id })).collect(),
            table_expanded_children: table_exp,
            table_row_selection: table_sel,
            table_activations: json!({}),
        }
    }

    #[test]
    fn presets_compact_to_contiguous_and_remap_root() {
        // presets 1,3,5 → compacted to 1,2,3; root_children preset refs remap.
        let mut c = cfg_with(&[1, 3, 5], json!({}), json!({}));
        compact_ids(&mut c);
        let got: Vec<i64> = c.root_children.iter().map(|ch| ch.id).collect();
        assert_eq!(got, vec![1, 2, 3]);
    }

    // Direct unit tests of the remap helpers (the part compact_ids newly calls).
    fn gmap(pairs: &[(i64, i64)]) -> HashMap<i64, i64> {
        pairs.iter().copied().collect()
    }

    #[test]
    fn remap_expanded_rekeys_and_drops_dead() {
        // group map: old 10→1, 20→2 (30 deleted, not in map). Child ids here are
        // NUMBERS (one renderer code path); parent keys are always strings.
        let m = gmap(&[(10, 1), (20, 2)]);
        let v = json!({ "10": [10, 20], "20": [20], "30": [10] });
        let out = remap_expanded(&v, &m);
        // parent 10→1 with children [1,2]; 20→2 with [2]; 30 dropped (gone).
        assert_eq!(out, json!({ "1": [1, 2], "2": [2] }));
    }

    #[test]
    fn remap_expanded_preserves_string_ids() {
        // The other renderer code path stores child ids as STRINGS — re-emit them
        // as strings so the on-disk shape the renderer expects is unchanged.
        let m = gmap(&[(10, 1), (20, 2)]);
        let v = json!({ "10": ["10", "20"] });
        let out = remap_expanded(&v, &m);
        assert_eq!(out, json!({ "1": ["1", "2"] }));
    }

    #[test]
    fn remap_row_selection_rekeys_and_drops_dead() {
        // group map 10→1, 20→2 (30 gone); preset map 100→1, 300→3 (200 gone).
        let gm = gmap(&[(10, 1), (20, 2)]);
        let pm: HashMap<i64, i64> = [(100, 1), (300, 3)].iter().copied().collect();
        let v = json!({ "10": { "row0": 100, "row1": 200 }, "20": { "row0": 300 }, "30": { "row0": 100 } });
        let out = remap_row_selection(&v, &gm, &pm);
        // 10→1: row0 100→1, row1 200 dropped (preset gone); 20→2: row0 300→3; 30 dropped.
        assert_eq!(out, json!({ "1": { "row0": 1 }, "2": { "row0": 3 } }));
    }

    #[test]
    fn remap_row_selection_preserves_string_preset_ids() {
        let gm = gmap(&[(10, 1)]);
        let pm: HashMap<i64, i64> = [(100, 1)].iter().copied().collect();
        let v = json!({ "10": { "row0": "100" } });
        let out = remap_row_selection(&v, &gm, &pm);
        assert_eq!(out, json!({ "1": { "row0": "1" } }));
    }

    #[test]
    fn remap_non_object_is_passthrough() {
        let m = gmap(&[(1, 2)]);
        assert_eq!(remap_expanded(&json!(null), &m), json!(null));
        assert_eq!(remap_row_selection(&json!("x"), &m, &m), json!("x"));
        assert_eq!(remap_activations(&json!(null), &m, &m), json!(null));
    }

    #[test]
    fn remap_activations_rekeys_paths_options_and_drops_dead() {
        // New structure: { srcGid: { srcOptionKey: [{ dstRowKey, dstOption }] } }.
        // group map 10→1, 20→2 (30 gone); preset map 100→1 (200 gone).
        // srcGid 10→1; srcOptionKey "100" (preset) → "1"; target dstRowKey
        // "20:__direct__" → "2:__direct__"; dstOption 'group:20' → 'group:2'.
        // Target with gone preset 200 (dstOption) → dropped; source "100" then has
        // one live target so survives. Bucket "30" (srcGid gone) → dropped.
        let gm = gmap(&[(10, 1), (20, 2)]);
        let pm: HashMap<i64, i64> = [(100, 1)].iter().copied().collect();
        let v = json!({
            "10": {
                "100": [
                    { "dstRowKey": "20:__direct__", "dstOption": "group:20" },
                    { "dstRowKey": "20:__direct__", "dstOption": 200, "effect": "disable" }
                ]
            },
            "30": {
                "100": [ { "dstRowKey": "20:__direct__", "dstOption": 100 } ]
            }
        });
        let out = remap_activations(&v, &gm, &pm);
        // Targets without an effect default to "select"; explicit effect preserved.
        assert_eq!(out, json!({
            "1": {
                "1": [
                    { "dstRowKey": "2:__direct__", "dstOption": "group:2", "effect": "select" }
                ]
            }
        }));
    }

    #[test]
    fn remap_row_key_path_drops_when_any_segment_gone() {
        let m = gmap(&[(10, 1), (20, 2)]); // 30 gone
        assert_eq!(remap_row_key_path("10:20:", &m), Some("1:2:".to_string()));
        assert_eq!(remap_row_key_path("10:__direct__", &m), Some("1:__direct__".to_string()));
        assert_eq!(remap_row_key_path("10:30:", &m), None); // 30 gone → whole path invalid
    }
}
