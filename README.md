# Research Canvas

Research Canvas 是面向科研文稿、数学公式、无限画布和分支讨论的研究工作区。文稿、画布布局、讨论上下文、来源锚点与历史版本使用统一的数据模型。

项目提供文稿与公式编辑、无限画布、精确片段讨论、画布 AI 操作提案、类型化研究关系、证据确认和可恢复归档。AI 写入经过预览与确认，并支持撤销。

产品流程见 [科研画布原型要求](docs/prototype-scope.md)，开发约定见 [贡献说明](CONTRIBUTING.md)。

## 下载安装

从 [GitHub Releases](https://github.com/Proton1917/Research_Canvas/releases) 下载 Windows x64、macOS Apple Silicon、macOS Intel 或 Linux x64 发行包。完整解压后，Windows 双击 `start.cmd`，macOS 打开 `Start.command`，Linux 运行 `bash start.sh`，然后访问 `http://127.0.0.1:8787`。

发行包包含编译后的程序和界面。各系统的安装步骤、PDF 工具、模型配置、数据迁移和故障处理见 [安装与使用指南](docs/installation.md)。

## 构建与运行

需要 Rust 工具链、Node/npm、Bash，以及用于 PDF 文本提取的 Poppler。开发验证环境为 macOS arm64、Rust 1.96.0、Node 22.23.4。克隆后建立本地配置并构建：

```bash
git clone https://github.com/Proton1917/Research_Canvas.git
cd Research_Canvas
cp -n config/server.example.toml config/server.toml
npm install --prefix .runtime/toolchain --cache .runtime/npm-cache --no-save --package-lock=false --no-audit --no-fund node@22.23.4
bash scripts/web.sh install
bash scripts/build.sh
bash scripts/backend.sh start
```

打开 `http://127.0.0.1:8787` 使用应用。该进程同时提供构建后的界面和 `/api` 接口；`GET /api/health` 提供状态。完整接口约定见 [HTTP 接口文档](docs/api.md)。前台服务使用 `Ctrl+C` 停止。

配置示例使用本机 Router 的 OAuth Gemini 3.8 Flash，模型标识为 `cc/gemini-3.8-flash-high`。使用此示例需要已有的 Router 服务及相应 OAuth 登录。根据本机服务设置 `config/server.toml` 中的接口地址、客户端标记和模型允许列表；OAuth 凭据由 Router 管理。本地配置文件由 Git 忽略。

SQLite 数据库位于 `.runtime/data/research-canvas.sqlite3`。PDF 原始文件、文本块、文稿版本、画布布局、关系、锚点和模型运行记录均通过本项目后端保存。详细配置、存储位置和验证命令见 [后端说明](docs/backend.md)。

## 项目结构

| 目录或文件 | 职责 |
| --- | --- |
| `src/*.rs` | Rust HTTP 服务、SQLite 存储、研究上下文、锚点、模型适配和导入导出 |
| `src/web/` | 应用界面、页面状态与业务操作 |
| `src/editor/` | 文档、画布、内容块、工具栏及编辑扩展 |
| `src/research/` | API 客户端、研究对象类型和编辑会话 |
| `src/ui/` | 通用界面组件和主题 |
| `config/server.example.toml`、`config/prompts/` | 服务配置示例和研究提示词 |
| `tests/backend_acceptance.py` | 使用调研资料与实际模型响应的后端验收入口 |
| `Cargo.toml`、`package.json` | 项目依赖及构建入口 |
| `target/`、`dist/` | Rust 和前端构建产物 |
| `.runtime/`、`tmp/` | 运行数据、工具、缓存、日志与中间文件 |

源码按功能组织在 `src/`，通过根目录配置统一构建。内部编辑模块使用 `@editor`，研究模块使用 `@research`，通用组件使用 `@ui`。

## 前端开发

开发服务器使用根目录的 Vite 和 TypeScript 配置。完成前述环境准备后运行：

```bash
bash scripts/web.sh dev
```

开发前端使用端口 5173，将同源 `/api` 请求代理至后端 8787。文稿、画布、讨论、来源和修改提案共用后端对象标识。类型检查与构建入口为 `bash scripts/web.sh typecheck` 和 `bash scripts/web.sh build`。

## 许可证

Research Canvas 自有代码采用 [Mozilla Public License 2.0](LICENSE)。
