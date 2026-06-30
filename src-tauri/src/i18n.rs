// Backend-side localization.
//
// Mirrors the renderer's i18n keys for strings that surface to the user from
// Rust: error envelopes ({ success:false, error }) and OS notifications fired
// by the global-shortcut path (which runs with no renderer involvement).
//
// The active locale is read once from the OS via the `sys-locale` crate at
// startup (i18n::init). Fallback chain: active → "zh-CN" → raw key.

use std::sync::OnceLock;

static ACTIVE: OnceLock<&'static str> = OnceLock::new();

pub fn init() {
    let _ = ACTIVE.set(detect());
}

pub fn current() -> &'static str {
    ACTIVE.get().copied().unwrap_or("zh-CN")
}

fn detect() -> &'static str {
    let raw = sys_locale::get_locale().unwrap_or_default().to_lowercase();
    if raw.starts_with("zh-tw") || raw.starts_with("zh-hk")
        || raw.starts_with("zh-hant") || raw.starts_with("zh-mo")
    {
        return "zh-TW";
    }
    if raw.starts_with("zh") { return "zh-CN"; }
    if raw.starts_with("ja") { return "ja"; }
    if raw.starts_with("ko") { return "ko-KR"; }
    if raw.starts_with("ru") { return "ru-RU"; }
    if raw.starts_with("en") { return "en"; }
    "en"
}

/// Translate a key with named {placeholder} interpolation.
/// `params` is a slice of (&str name, &str value).
pub fn t(key: &str, params: &[(&str, &str)]) -> String {
    let s = match lookup(current(), key) {
        Some(v) => v,
        None => match lookup("zh-CN", key) {
            Some(v) => v,
            None => return key.to_string(),
        },
    };
    let mut out = s.to_string();
    for (k, v) in params {
        out = out.replace(&format!("{{{k}}}"), v);
    }
    out
}

/// Per-key, per-locale string table. zh-CN is the source of truth.
#[allow(clippy::match_like_matches_macro)]
fn lookup(locale: &str, key: &str) -> Option<&'static str> {
    macro_rules! row {
        ($en:expr, $ja:expr, $zhtw:expr, $zh:expr) => {
            Some(match locale {
                "en" => $en,
                "ja" => $ja,
                "zh-TW" => $zhtw,
                _ => $zh,
            })
        };
    }
    match key {
        // ── errors (lib.rs) ──
        "err.osu_path_unset" => row!("osu! path not set", "osu! パスが未設定です", "未設定 osu! 路徑", "未设置 osu! 路径"),
        "err.shortcut_taken" => row!("Shortcut is taken or invalid", "ショートカットが使用中または無効です", "快捷鍵已被佔用或無效", "快捷键已被占用或无效"),

        // ── errors (preset_manager.rs / preset_applier.rs) ──
        "err.preset_not_found" => row!("Preset not found: {id}", "プリセットが見つかりません: {id}", "預設不存在: {id}", "预设不存在: {id}"),
        "err.group_not_found" => row!("Group not found: {id}", "グループが見つかりません: {id}", "分組不存在: {id}", "分组不存在: {id}"),
        "err.target_group_not_found" => row!("Target group not found: {id}", "目標グループが見つかりません: {id}", "目標分組不存在: {id}", "目标分组不存在: {id}"),
        "err.preset_at_root" => row!("A preset cannot be placed at the root level", "プリセットをルート階層に配置できません", "預設不能放置在根層級", "预设不能放置在根层级"),
        "err.group_not_empty" => row!("Group is not empty; cannot delete", "グループが空ではないため削除できません", "分組非空，無法刪除", "分组非空，无法删除"),
        "err.group_move_into_self" => row!("A group cannot be moved into itself", "グループを自身の中に移動できません", "不能將分組移動到自身內部", "不能将分组移动到自身内部"),
        "err.group_move_into_child" => row!("A group cannot be moved into its own child group", "グループを自身の子グループ内に移動できません", "不能將分組移動到其子分組內部", "不能将分组移动到其子分组内部"),

        // ── fallback names / defaults ──
        "preset.fallback_name" => row!("Preset {id}", "プリセット {id}", "預設 {id}", "预设 {id}"),
        "group.default_empty_name" => row!("New group", "新しいグループ", "新分組", "新分组"),
        "group.unnamed" => row!("Unnamed", "無題", "未命名", "未命名"),

        // ── OS notifications (global_shortcut.rs) ──
        "notify.applied_title" => row!("Preset applied", "プリセットを適用しました", "已套用預設", "已应用预设"),
        "notify.applied_body" => row!("Applied: {names}", "適用: {names}", "已套用: {names}", "已应用: {names}"),
        "notify.applied_body_warn" => row!("Applied {count}: {names} ({warn} warnings)", "{count} 件を適用: {names}（警告 {warn} 件）", "已套用 {count} 個: {names}（{warn} 條警告）", "已应用 {count} 个：{names}（{warn} 条警告）"),

        // ── apply warnings (preset_applier.rs) ──
        "warn.copy_invalid_path" => row!("Skipped \"{name}\": invalid target path", "スキップ \"{name}\": 無効なターゲットパス", "跳過 \"{name}\": 目標路徑無效", "跳过 \"{name}\": 目标路径无效"),
        "warn.copy_outside_skin" => row!("Skipped \"{name}\": target path is outside the skin folder", "スキップ \"{name}\": ターゲットパスがスキンフォルダ外です", "跳過 \"{name}\": 目標路徑超出皮膚目錄", "跳过 \"{name}\": 目标路径超出皮肤目录"),
        "warn.copy_source_missing" => row!("Skipped \"{name}\": source file does not exist", "スキップ \"{name}\": ソースファイルが存在しません", "跳過 \"{name}\": 來源檔案不存在", "跳过 \"{name}\": 源文件不存在"),
        "warn.del_invalid_path" => row!("Skipped delete \"{path}\": invalid path", "削除をスキップ \"{path}\": 無効なパス", "跳過刪除 \"{path}\": 路徑無效", "跳过删除 \"{path}\": 路径无效"),
        "warn.del_outside_skin" => row!("Skipped delete \"{path}\": path is outside the skin folder", "削除をスキップ \"{path}\": パスがスキンフォルダ外です", "跳過刪除 \"{path}\": 路徑超出皮膚目錄", "跳过删除 \"{path}\": 路径超出皮肤目录"),
        "warn.del_missing" => row!("Skipped delete \"{path}\": file does not exist", "削除をスキップ \"{path}\": ファイルが存在しません", "跳過刪除 \"{path}\": 檔案不存在", "跳过删除 \"{path}\": 文件不存在"),
        "warn.tint_failed" => row!("Skipped tint \"{name}\": {msg}", "色替えをスキップ \"{name}\": {msg}", "跳過調色 \"{name}\": {msg}", "跳过调色 \"{name}\": {msg}"),

        _ => None,
    }
}
