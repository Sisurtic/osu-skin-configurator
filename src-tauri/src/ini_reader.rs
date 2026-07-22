// osu! skin.ini parser/serializer + merge engine. Faithful port of ini-reader.js.
// IMPORTANT: duplicate [Mania] sections are load-bearing (osu! uses one per
// key-count), discriminated by the `Keys` value inside each section. Keys use
// ordered IndexMap so round-trips preserve order (HashMap would randomize).
// Separator is ':' (accepts '=' too on parse).

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub section: String,
    pub keys: IndexMap<String, String>,
}

pub fn parse_ini(content: &str) -> Vec<Section> {
    let mut result: Vec<Section> = Vec::new();
    let mut current: Option<usize> = None;
    for raw in content.split('\n') {
        let line = raw.trim_matches(|c| c == '\r').trim();
        if line.is_empty() {
            continue;
        }
        // section header [Name]
        if line.starts_with('[') && line.ends_with(']') {
            let name = line[1..line.len() - 1].trim().to_string();
            result.push(Section { section: name, keys: IndexMap::new() });
            current = Some(result.len() - 1);
            continue;
        }
        // key: value  OR  key = value
        // Only keep lines whose key starts with a letter — this naturally
        // discards comments (// ; # /* -- etc.) and any unrecognised lines
        // without needing to enumerate comment prefixes.
        if let Some(idx) = current {
            let kv = split_kv(line);
            if let Some((k, v)) = kv {
                if k.chars().next().map(|c| c.is_alphabetic()).unwrap_or(false) {
                    result[idx].keys.insert(k, v);
                }
            }
        }
    }
    result
}

/// Split on the first ':' or '=' (whichever comes first), matching
/// /^([^=:]+)[=:]\s*(.*)$/
fn split_kv(line: &str) -> Option<(String, String)> {
    let mut split_at: Option<(usize, char)> = None;
    for (i, c) in line.char_indices() {
        if c == ':' || c == '=' {
            split_at = Some((i, c));
            break;
        }
    }
    let (i, sep) = split_at?;
    let key = line[..i].trim().to_string();
    if key.is_empty() {
        return None;
    }
    let _ = sep;
    let value = line[i + 1..].trim().to_string();
    Some((key, value))
}

pub fn serialize_ini(sections: &[Section]) -> String {
    let mut lines: Vec<String> = Vec::new();
    for entry in sections {
        lines.push(format!("[{}]", entry.section));
        for (k, v) in &entry.keys {
            lines.push(format!("{}: {}", k, v));
        }
        lines.push(String::new());
    }
    let mut joined = lines.join("\n");
    joined = joined.trim_end_matches(|c: char| c.is_whitespace()).to_string();
    joined.push('\n');
    joined
}

pub fn read_skin_ini(skin_path: &str) -> Vec<Section> {
    let ini = Path::new(skin_path).join("skin.ini");
    match std::fs::read_to_string(&ini) {
        Ok(s) => parse_ini(&s),
        Err(_) => Vec::new(),
    }
}

/// Logical key for a section entry: non-Mania → its name; Mania →
/// "Mania◆Keys:<N>" (or "Mania◆Keys:?" if Keys missing).
pub fn section_key(entry: &Section) -> String {
    if entry.section != "Mania" {
        return entry.section.clone();
    }
    match entry.keys.get("Keys") {
        Some(v) => format!("Mania◆Keys:{}", v),
        None => "Mania◆Keys:?".to_string(),
    }
}

fn find_section_mut(sections: &mut [Section], key: &str) -> Option<usize> {
    // can't borrow mut while scanning; collect index first
    let mut found: Option<usize> = None;
    for (i, e) in sections.iter().enumerate() {
        if section_key(e) == key {
            found = Some(i);
            break;
        }
    }
    found
}

/// A single INI edit. `_delete` removes the key. `mania_keys` selects which
/// [Mania] section (by Keys value) when section == "Mania".
#[derive(Debug, Clone, Deserialize)]
pub struct IniEdit {
    pub section: String,
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(rename = "maniaKeys")]
    pub mania_keys: Option<serde_json::Value>,
    #[serde(rename = "_delete", default)]
    pub delete: bool,
}

pub fn merge_ini_edits(sections: &mut Vec<Section>, edits: &[IniEdit]) {
    for edit in edits {
        let target_key = if edit.section == "Mania" {
            let mk = edit.mania_keys.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "?".to_string());
            format!("Mania◆Keys:{}", mk)
        } else {
            edit.section.clone()
        };

        let idx = find_section_mut(sections, &target_key);
        let idx = match idx {
            Some(i) => i,
            None => {
                // create new section
                let mut keys = IndexMap::new();
                if edit.section == "Mania" {
                    if let Some(mk) = &edit.mania_keys {
                        // store the raw value (stringified)
                        keys.insert("Keys".to_string(), mk.to_string());
                    }
                }
                sections.push(Section { section: edit.section.clone(), keys });
                sections.len() - 1
            }
        };

        if edit.delete {
            sections[idx].keys.shift_remove(&edit.key);
        } else {
            sections[idx].keys.insert(edit.key.clone(), edit.value.clone());
        }
    }
}

pub fn write_skin_ini(skin_path: &str, sections: &[Section]) {
    let ini = Path::new(skin_path).join("skin.ini");
    let content = serialize_ini(sections);
    let _ = std::fs::write(&ini, content);
}
