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
| 🪟 **Borderless window** | Custom titlebar with native resize frame; drag to move, double-click to maximize, Windows 11 Snap Layout |
| 🔄 **Auto-update** | Checks GitHub for new releases on startup; one-click download with a live progress ring on the titlebar dot (right-click to cancel) |
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

### Changelog

See [release-v1.0.1.md](release-v1.0.1.md) for the v1.0.1 release notes and post-release fixes (checkbox-group apply rework, row slide-in animations, group-save editor reload, copy/paste actions + duplicate any item).

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

## License

MIT © Citrusis
