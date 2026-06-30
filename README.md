# osu! Skin Configurator

A desktop tool for creating **presets** of osu! skin changes and switching between them instantly. Bundle skin.ini edits + file copies + file deletions into a named preset, apply with a click or a global hotkey — no more manual ini editing or backup/restore.

- **Platform:** Windows (osu! stable is Windows-only)
- **Tech:** Tauri v2 (Rust backend + vanilla JS renderer), standalone exe, no installation required
- **Languages:** English / 简体中文 / 繁體中文 / 日本語 / 한국어 / Русский (auto-detected from system locale)
- **中文文档:** [README.zh-CN.md](README.zh-CN.md)

---

## Features

| Feature | Description |
|---|---|
| 🎨 **Preset system** | Bundle skin.ini edits, file moves, file deletions, and image processing into named presets, stored per-skin in `config.osp` |
| 📂 **Group tree** | Organize presets into nested groups with drag-and-drop reordering |
| ⚡ **One-click apply** | Select presets, confirm, apply — or bind global hotkeys for instant switching |
| 🌐 **Global hotkeys** | Bind per-preset global shortcuts that fire **only when osu! is focused** |
| 🖱️ **Drag-and-drop editing** | Drag presets into groups, drag to delete, Ctrl+C duplicate, Ctrl+G smart grouping |
| 🖼️ **Image editor** | Tint → crop → darken pipeline with real-time WebGL tint preview; build long-note (Percy LN) slider bodies from a short source |
| 🔧 **Rebindable shortcuts** | All in-app actions (refresh, mode toggle, save, new, etc.) have customizable hotkeys |
| 🔄 **Auto-update** | Checks GitHub for new releases on startup, one-click download and upgrade |
| 📎 **`.osp` file association** | Double-click a skin's `config.osp` to open it directly |

### Two modes

Toggle with the ✏️ button or `Ctrl+E`:

- **👁️ Use mode** (default): Skin list + preset selector grid. Select presets and apply.
- **✏️ Edit mode**: Preset/group tree editor with 4 tabs:
  - **Basic info:** Name, description, preview picker (single image / animated GIF·APNG·WebP / image sequence with FPS)
  - **INI edits:** Type-aware skin.ini field editor (bool/number/color/path/enum) with sorting and Mania perColumn support
  - **File moves:** Copy files within the skin folder, mark files for deletion
  - **Image editor:** Per-source tint (color + blend mode), crop/tile into long bodies, and darken — with a live preview

---

## Download & Usage

### Download

Get `osu-skin-configurator.exe` from [Releases](https://github.com/Sisurtic/osu-skin-configurator/releases).

### Prerequisites

- **Windows 10/11**
- **[WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)** — usually pre-installed on Windows 10/11

### Quick start

1. Launch the exe — it auto-detects your osu! installation (`%LOCALAPPDATA%\osu!`)
2. Select a skin from the left sidebar
3. Click ✏️ to enter edit mode → create a preset group → create a preset
4. Add skin.ini edits and/or file operations
5. Click 💾 Save
6. Switch back to 👁️ Use mode, hover a preset to preview, click ▶ Apply (or `Space`)

---

## Data storage

- **Per skin:** `osu!\Skins\<SkinName>\config.osp` (preset tree)
- **App config:** System AppData directory (`config.json`: osu! path, last skin, window bounds, shortcut bindings)
- **File paths:** All preview images and file sources are stored as **skin-relative paths** for portability across machines

---

## Localization

The app supports 6 languages, auto-detected from the system locale. To add a new language, see [Localization guide](README.md#localization-contribution) below.

### Localization contribution

Translation files are in [`src/renderer/js/locales/`](src/renderer/js/locales/). To add a new language:

1. Copy [`en.json`](src/renderer/js/locales/en.json), rename to `xx-XX.json` (BCP-47 code)
2. Translate all values (keep `{placeholders}` and keys unchanged)
3. Set `"_name"` to the native language name
4. `easterEggs` array can be customized per language
5. Submit a Pull Request — the app auto-discovers new locale files

For skin.ini field label translations, add entries to the `iniFields` and `iniOptions` objects in each locale file.

---

## Build & Development

### Prerequisites

- **Rust** (stable, edition 2021) + `cargo`
- **Tauri CLI v2:** `cargo install tauri-cli --version "^2"`
- **Windows 10/11** + MSVC build tools
- **WebView2 Runtime**

### Commands

```bash
# Development (hot reload)
npm run dev        # → cargo tauri dev

# Build standalone exe
npm run build     # → cargo tauri build
```

The renderer is unbundled vanilla JS — no `npm install` of app dependencies needed, only the Tauri CLI.

### Versioning

The **single source of truth** for the version is the `version` field in [`package.json`](package.json). `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` are kept in sync by a pre-commit hook, and `Cargo.lock` follows `Cargo.toml` automatically on `cargo build`.

After cloning, enable the hook once:

```bash
git config core.hooksPath .githooks
```

To release, just bump the version in `package.json` — the hook updates the other two files and stages them on commit. You can also sync manually:

```bash
npm run sync-version     # write Cargo.toml / tauri.conf.json
npm run version:check    # check only (no writes)
```

---

## Changelog

### v1.0.1

**New features**
- **Image editor tab** — a tint → crop → darken pipeline with a real-time WebGL tint preview. Generate long-note (Percy LN) slider bodies from a short source via crop + tile, with on-canvas guide lines for the tail / blank / extended body. Per-source tint color and blend mode, plus an optional darken stage.
- **Preview image sequences & animated images** — pick multiple frames as an image sequence (with an FPS input; `-1` plays all frames within 1 second, like osu!'s `AnimationFramerate`), or use animated GIF / APNG / WebP. Works in both edit mode and the use-mode hover panel.
- **Compact `config.osp` storage** — disabled stages are dropped; enabled stages keep their full parameter set. A migration script (`scripts/migrate-osp.{js,bat}`) converts older pretty-printed files.

**Performance**
- Image processing parallelized with rayon: crop went from ~5.6s to ~2.5ms; tint and darken now run in parallel. Release builds use `opt-level = 3`.

**Apply dialog & toasts**
- Unified single/multi apply into one dialog with a three-group summary (INI edits / file moves / image edits). The success toast shows a compact `[INI×N, files×N, image×N]` summary.
- Toasts are click-to-dismiss with a parabolic toss animation.

**UI polish**
- HSV color picker repositioned to the left of its trigger.
- Disabled stages dim their controls; preset list gains edge-fade overlays; Tab cycling now reaches the edit-FPS button.
- Distinct destination-path placeholders for file moves vs. image edits.

**Bug fixes**
- `FPS = -1` now persists (previously clamped to 12).
- Switching from a sequence preset to an image preset no longer leaks the sequence preview; the first click on a sequence preset now shows its preview. Replaced the per-`<img>` timer with a single shared timer guarded by a view-generation token.
- Fixed the top edge-fade gap; marked a non-passive wheel listener as passive.
- Stale sequence fields no longer persist when switching back to a single image.

**Project**
- `package.json` is now the single source of truth for the version; a pre-commit hook keeps `Cargo.toml` and `tauri.conf.json` in sync (see [Versioning](#versioning)).

### v1.0.0

- Initial release.

---

## License

MIT © Citrusis
