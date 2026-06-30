# osu! Skin Configurator

[English](README.md) | **简体中文**

一个用于给 osu! 皮肤创建**预设**并一键切换的桌面工具。把一组「skin.ini 改动 + 文件复制 + 文件删除」打包成一个预设，手动点击或绑定全局快捷键即可瞬间应用——无需反复手改 ini、无需备份还原。

- **平台：** Windows（osu! stable 为 Windows 专属）
- **技术栈：** Tauri v2（Rust 后端 + 原生 JS 渲染层），单文件 exe 仅约 **4.8 MB**，免安装直接运行
- **界面语言：** 简体中文 / English / 繁體中文 / 日本語 / 한국어 / Русский（按系统语言自动选择）
- **前置要求：** [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Windows 10/11 通常已预装）

---

## 功能

| 功能 | 说明 |
|---|---|
| 🎨 **预设系统** | 把 skin.ini 改动、文件复制、文件删除、图像处理组合成一个可命名的预设，存放在每个皮肤的 `config.osp` 中 |
| 📂 **分组树** | 用分组（支持任意层级嵌套）整理预设，拖拽排序 / 嵌套 / 移动 |
| ⚡ **一键应用** | 单选或多选预设，确认后批量应用；相同 ini 字段以「后应用的预设」为准 |
| 🌐 **全局快捷键** | 给预设绑定全局热键，**仅当 osu! 在前台时触发**，应用在后台/最小化也能用 |
| 🖱️ **拖拽编辑** | 拖拽预设入组、拖组嵌套、拖到删除区、Ctrl+C 复制、Ctrl+G 智能建组 |
| 🖼️ **图像编辑** | 着色 → 裁切 → 暗化的实时（WebGL）预览管线；用短素材拼出长条（Percy LN）滑条身体 |
| 🔧 **可重绑快捷键** | 应用内所有操作（刷新、切换模式、保存、新建…）均可自定义热键 |
| 🔄 **自动更新** | 检测 GitHub 新版本，标题栏圆点发光提示，点击直接下载安装包并升级 |
| 📎 **`.osp` 文件关联** | 双击皮肤文件夹里的 `config.osp` 即可打开该皮肤的预设配置 |

### 两种工作模式

工具栏的 **✏️** 按钮（或 `Ctrl+E`）在两种模式间切换：

- **👁️ 使用模式**（默认）：左侧皮肤列表，右侧预设选择器。选中预设 → 点「应用」或按 `Space`。
- **✏️ 编辑模式**：左侧变为预设/分组树，右侧是预设编辑器（4 个标签页）：
  - **基本信息：** 名称、描述、预览图选取（单图 / 动图 GIF·APNG·WebP / 图片序列 + 帧率）
  - **INI 编辑：** 类型感知的 skin.ini 字段编辑器（布尔/数值/颜色/路径/枚举），支持排序与 Mania perColumn
  - **文件移动：** 皮肤内复制文件、标记删除文件
  - **图像编辑：** 按素材着色（颜色 + 混色模式）、裁切/平铺拼接长条、暗化，带实时预览

---

## 下载与使用

### 下载

从 [Releases](https://github.com/Sisurtic/osu-skin-configurator/releases) 下载 `osu-skin-configurator.exe`，双击即可运行。

### 快速上手

1. 启动 exe — 自动探测 osu! 安装路径（`%LOCALAPPDATA%\osu!`）
2. 左侧选中目标皮肤
3. 点 ✏️ 进入编辑模式 → 新建分组 → 新建预设
4. 添加 skin.ini 修改和/或文件操作
5. 点 💾 保存
6. 切回 👁️ 使用模式，悬停预览，点 ▶ 应用（或 `Space`）

---

## 数据存储

- **每个皮肤：** `osu!\Skins\<皮肤名>\config.osp`（预设树）
- **应用全局配置：** 系统 AppData 目录下的 `config.json`（osu 路径、上次皮肤、窗口位置、快捷键绑定）
- **文件路径：** 预览图片和文件源路径都以**皮肤相对路径**存储，确保跨电脑、跨皮肤路径一致

---

## 本地化贡献

应用支持 6 种语言，所有翻译文件位于 [`src/renderer/js/locales/`](src/renderer/js/locales/)。

### 添加新语言

1. 复制 [`en.json`](src/renderer/js/locales/en.json)，重命名为 `xx-XX.json`（如 `es-ES.json`）
2. 翻译所有 value（**不要改 key 名**，保留 `{placeholders}`）
3. 设置 `"_name"` 为该语言的母语名称
4. `easterEggs` 可自由定制彩蛋文本和触发概率
5. 提交 Pull Request，程序会自动识别新语言文件

### 要点

- 占位符（如 `{count}`、`{name}`）必须原样保留
- osu! 专有术语（HitCircle、Mania 等）建议保留英文
- skin.ini 字段标签翻译在各 locale 文件的 `iniFields` 和 `iniOptions` 对象中

---

## 构建与开发

### 前置要求

- **Rust**（stable, edition 2021）+ `cargo`
- **Tauri CLI v2：** `cargo install tauri-cli --version "^2"`
- **Windows 10/11** + MSVC 构建工具链
- **WebView2 Runtime**

### 常用命令

```bash
# 开发模式（热重载）
npm run dev        # → cargo tauri dev

# 打包独立 exe（~4.8MB）
npm run build     # → cargo tauri build
```

渲染层是纯 JS，无需 `npm install` 应用依赖。

### 版本管理

版本号的**唯一来源**是 [`package.json`](package.json) 的 `version` 字段。`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 由 pre-commit 钩子自动同步，`Cargo.lock` 在 `cargo build` 时自动跟随。

clone 仓库后激活钩子（仅需一次）：

```bash
git config core.hooksPath .githooks
```

发版时只改 `package.json` 的版本号即可，提交时钩子会把另外两处一并更新并暂存。也可手动同步：

```bash
npm run sync-version     # 写入 Cargo.toml / tauri.conf.json
npm run version:check    # 仅检查是否一致（不写入）
```

---

## 更新日志

### v1.0.1

**新功能**
- **图像编辑标签页** —— 着色 → 裁切 → 暗化的处理管线，着色用 WebGL 实时预览。通过裁切 + 平铺，用短素材生成长条（Percy LN）滑条身体，画布上面尾 / 留白 / 延伸身体有辅助线。每个素材独立着色（颜色 + 混色模式），可选暗化阶段。
- **预览图片序列与动图** —— 多选若干帧作为图片序列（带帧率输入；`-1` 表示 1 秒内播放所有帧，同 osu! 的 `AnimationFramerate`），或使用动图 GIF / APNG / WebP。编辑模式与使用模式悬停面板均支持。
- **紧凑的 `config.osp` 存储** —— 禁用的阶段不再写入；启用的阶段保留完整参数。附带迁移脚本（`scripts/migrate-osp.{js,bat}`）转换旧的格式化文件。

**性能**
- 图像处理用 rayon 并行化：裁切从约 5.6s 降到约 2.5ms；着色、暗化也已并行。Release 构建使用 `opt-level = 3`。

**应用对话框与提示**
- 单选/多选应用合并为一个对话框，三段式汇总（INI 编辑 / 文件移动 / 图像编辑）。成功提示显示紧凑的 `[INI×N, 文件移动×N, 图像编辑×N]` 汇总。
- 提示（toast）点击即关闭，带抛物线弹出动画。

**界面打磨**
- HSV 取色器改到触发按钮左侧。
- 禁用阶段的控件变暗；预设列表新增边缘渐变；Tab 循环现在能到达修改帧率按钮。
- 文件移动与图像编辑的目标路径输入框使用不同的提示词。

**问题修复**
- `帧率 = -1` 现在能正确保存（之前被钳制为 12）。
- 从序列帧预设切换到图片预设不再残留序列预览；首次点击序列帧预设能立即显示预览。用一个受视图代（view-gen）保护的单一定时器替代了原先「每个 `<img>` 一个定时器」的方案。
- 修复顶部边缘渐变的缝隙；将非 passive 的滚轮监听标记为 passive。
- 切回单图时不再残留序列帧字段。

**工程**
- `package.json` 成为版本号的唯一来源；pre-commit 钩子自动同步 `Cargo.toml` 和 `tauri.conf.json`（见[版本管理](#版本管理)）。

### v1.0.0

- 首次发布。

---

## 许可证

MIT © Citrusis
