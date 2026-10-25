# Research Canvas

Research Canvas 是面向科研文稿、数学公式、无限画布和分支讨论的研究工作区。文稿、画布布局、讨论上下文、来源锚点与历史版本使用统一的数据模型。

项目处于开发阶段。Rust 后端已完成文稿、版本、画布、关系、锚点、模型调用和归档接口，并进行了实际服务验证；前端正在集成 BlockSuite 编辑器和统一操作界面。当前公开源码包含编辑器适配及基础组件，完整界面的端到端验收仍在推进。

产品流程见 [科研画布原型要求](docs/prototype-scope.md)，开发约定见 [贡献说明](CONTRIBUTING.md)。

## 后端运行

需要 Rust 工具链、Bash，以及用于 PDF 文本提取的 Poppler。开发验证环境为 macOS arm64、Rust 1.96.0。克隆后建立本地配置并启动：

```bash
git clone https://github.com/Proton1917/Research_Canvas.git
cd Research_Canvas
cp -n config/server.example.toml config/server.toml
bash scripts/backend.sh build
bash scripts/backend.sh start
```

后端默认地址为 `http://127.0.0.1:8787`。`GET /api/health` 提供状态，完整接口约定见 [HTTP 接口文档](docs/api.md)。前台服务使用 `Ctrl+C` 停止。

配置示例使用本机 Router 的 OAuth Gemini 3.8 Flash，模型标识为 `cc/gemini-3.8-flash-high`。使用此示例需要已有的 Router 服务及相应 OAuth 登录。根据本机服务设置 `config/server.toml` 中的接口地址、客户端标记和模型允许列表；OAuth 凭据由 Router 管理。本地配置文件由 Git 忽略。

SQLite 数据库位于 `.runtime/data/research-canvas.sqlite3`。PDF 原始文件、文本块、文稿版本、画布布局、关系、锚点和模型运行记录均通过本项目后端保存。详细配置、存储位置和验证命令见 [后端说明](docs/backend.md)。

## 项目结构

| 目录或文件 | 职责 |
| --- | --- |
| `apps/web/` | React 与 Vite 前端入口 |
| `packages/blocksuite/` | 已迁入的 BlockSuite 编辑框架和编辑组件源码 |
| `packages/research/` | API 客户端、研究对象类型和编辑器适配 |
| `packages/ui/` | 界面组件和主题资源 |
| `crates/server/` | Rust HTTP 服务、SQLite 存储、研究上下文、锚点、模型适配和导入导出 |
| `config/server.example.toml`、`config/prompts/` | 服务配置示例和研究提示词 |
| `tests/backend_acceptance.py` | 使用调研资料与实际模型响应的后端验收入口 |
| `config/repositories.tsv`、`docs/repositories-lock.tsv` | 上游仓库入口及参考提交 |
| `licenses/`、`THIRD_PARTY_NOTICES.md` | 第三方许可和源码来源 |
| `.runtime/`、`tmp/` | 运行数据、工具、缓存、日志与中间文件 |

上下文图算法依据 ThoughtDAG 源码适配，检索排名合并依据 Atomic 的实现适配。编辑源码、流程参考及许可证详见 [第三方来源记录](THIRD_PARTY_NOTICES.md)。十个调研仓库的说明见 [仓库指南](docs/repository-guide.md)。

## 前端开发

前端使用 Node 22.23.4 和仓库随附的 Yarn 4.7.0。已安装 Node/npm 后，在项目根目录准备项目内的 Node 与依赖：

```bash
source scripts/environment.sh
npm install --prefix .runtime/toolchain --no-save --package-lock=false --no-audit --no-fund node@22.23.4
bash scripts/web.sh install
bash scripts/web.sh dev
```

开发前端使用端口 5173，将同源 `/api` 请求代理至后端 8787。文稿、画布、讨论、来源和修改提案共用后端对象标识。类型检查与构建入口为 `bash scripts/web.sh typecheck` 和 `bash scripts/web.sh build`。

编辑源码已纳入 `packages/blocksuite/`。需要阅读完整上游仓库时，可运行 `bash scripts/clone-repositories.sh`；该脚本将参考仓库放入本地 `upstream/` 目录。

## 许可证

Research Canvas 自有代码默认采用 [Mozilla Public License 2.0](LICENSE)。`packages/ui/` 按包声明采用 MIT，迁入的第三方代码保留各自的版权与许可证。源码来源、版本和适配位置见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
