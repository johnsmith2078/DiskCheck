# DiskCheck

DiskCheck 是一个基于 Tauri 2 + React 的桌面磁盘占用分析工具：选择目录/磁盘后进行扫描，并用 Treemap（矩形树图）快速定位占用空间最大的文件；点击文件可在系统文件管理器中定位。

## 功能

- 目录扫描：Rust 后端并行遍历（`rayon`），UI 实时显示进度（files/dirs/bytes + 当前路径）。
- 交互浏览：左侧列表支持大目录虚拟滚动；点击目录下钻、`Up` 返回上级。
- Treemap 可视化：按文件扩展名着色，可调最小展示文件大小（例如 >= 10 MB）。
- 快速定位：在 Explorer/Finder/xdg-open 中显示文件或文件夹。

## 使用

1. 点击左侧文件夹图标选择要扫描的目录/磁盘。
2. 点击扫描按钮开始扫描；扫描中会显示当前进度与路径。
3. 左侧列表点击目录可下钻；点击文件会在系统文件管理器中定位该文件。
4. 右侧 Treemap 支持调整最小文件大小阈值，便于聚焦大文件。

## 技术栈

- 前端：React 18、TypeScript、Vite、Tailwind CSS
- 后端：Tauri 2、Rust 2021、serde、rayon

## 开发与运行

前置条件：Node.js (建议 18+)；Rust toolchain；按官方文档安装 Tauri 平台依赖：<https://tauri.app/v2/guides/getting-started/prerequisites/>

```bash
npm install

# 运行桌面应用（推荐）
npm run tauri dev
```

构建发行版：

```bash
npm run tauri build
```

## 目录结构

- `src/`: 前端 UI（入口 `src/main.tsx`，主界面 `src/App.tsx`）
- `src/components/`: 组件（`Treemap.tsx`、`VirtualList.tsx`、`components/ui/*`）
- `src/lib/`: 工具与类型（`fs.ts`, `format.ts`, `utils.ts`）
- `src-tauri/`: Tauri/Rust 后端（命令 `src-tauri/src/lib.rs`，扫描器 `src-tauri/src/scanner.rs`）

## 贡献

请先阅读 `AGENTS.md`（包含仓库结构、命令、风格与 PR 要求）。
