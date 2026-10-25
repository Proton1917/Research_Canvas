# 开源仓库与源码导航

以下记录对应 [repositories-lock.tsv](repositories-lock.tsv) 中的本地提交。目录相对于 Research_Canvas 根目录；许可证说明取自相应提交中的许可文件和 README。

## 主要候选

| 项目 | 本地目录与版本 | 许可证 | 研究入口 |
| --- | --- | --- | --- |
| [Dim0](https://github.com/vcmf/dim0) | `upstream/primary/dim0`，`main`，`c31efa052fa9` | MIT | 本地笔记、画布动作、Agent 工具、协作持久化 |
| [BlockSuite](https://github.com/toeverything/blocksuite) | `upstream/primary/blocksuite`，`main`，`5cb5cb68471c` | MPL-2.0 | 文档模型、页面与画布共享内容、编辑器扩展 |
| [ThoughtDAG](https://github.com/chenxiachan/thoughtdag) | `upstream/primary/thoughtdag`，`main`，`96af06fdd673` | MIT | 分支讨论、上下文组装、来源与文档阅读 |

Dim0 的画布挂载入口是 `webui/src/features/board/harness/canvas/harness-canvas.tsx`；`harness/convert/` 连接笔记模型与画布节点，`webui/src/features/board/persist/local/` 提供本地存储。Agent 工具定义位于 `webui/src/features/agent/engine/tools.ts`，上下文服务位于同目录的 `services/context.ts`。其绘图引擎通过 `@canvas-harness/*` npm 依赖取得。后端为 `backend/` 下的 FastAPI 应用，完整部署还使用 Postgres、Qdrant、Redis，入口见 [Dim0 README](https://github.com/vcmf/dim0/blob/c31efa052fa9e47ff958b894c4ad825e93c8b8fe/README.md)。

BlockSuite 的 `packages/framework/store/`、`std/`、`sync/` 分别提供文档存储、编辑扩展及同步；`packages/affine/blocks/` 和 `packages/affine/gfx/` 包含内容块与画布对象，`packages/playground/` 提供运行示例。当前独立仓库 `main` 的提交日期为 **2025-07-07**。同时取得的 AFFiNE `canary` 仓库包含 `blocksuite/framework/`、`blocksuite/affine/` 和 `blocksuite/playground/`，可用于核对当前 AFFiNE 所用的实现。独立仓库 README 和在线文档中的包名须结合当前源码及 `package.json` 使用。构建与开发说明见 [BUILDING.md](https://github.com/toeverything/blocksuite/blob/5cb5cb68471ca692f3c162258f0087cb22fcb82d/BUILDING.md)。

ThoughtDAG 的 `src/lib/graph.ts` 处理图结构，`src/lib/context-bundle.ts` 处理上下文材料，`src/lib/api.ts` 负责前端调用，`src/store/` 保存画布状态，`src/components/` 包含节点与阅读界面。本地代理入口是 `server.mjs`，模型连接说明见 [docs/setup.md](https://github.com/chenxiachan/thoughtdag/blob/96af06fdd6734fec075c8a8bb4273ce77218b1f4/docs/setup.md)。

## 产品参考

| 项目 | 本地目录 | 许可证来源 | 上游开发入口 |
| --- | --- | --- | --- |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | `upstream/reference/AFFiNE` | 根目录 `LICENSE`、`LICENSE-MIT`；后端 `packages/backend/server/LICENSE` | Node 22、Yarn 4、Rust；依次安装依赖、构建 native 模块，运行 `yarn dev -p @affine/web`；详见 [构建文档](https://github.com/toeverything/AFFiNE/blob/733d839bcf145535b281d0ad256f4c9a5092efa8/docs/BUILDING.md) |
| [Canvas Chat](https://github.com/ericmjl/canvas-chat) | `upstream/reference/canvas-chat` | README 声明 MIT；此提交的根目录缺少独立许可证文件 | Python 3.11+、Pixi；`pixi install` 后运行 `pixi run dev`，默认端口 7865 |
| [Logseq](https://github.com/logseq/logseq) | `upstream/reference/logseq` | `LICENSE.md`：AGPL-3.0 | Node、pnpm、Java、Clojure；`pnpm install` 后运行 `pnpm watch`；详见 [开发文档](https://github.com/logseq/logseq/blob/408198a4feba58788e9163b35ae5f44aca9451d3/docs/develop-logseq.md) |

AFFiNE 当前根许可将 `packages/backend/` 与 `packages/common/native/` 指向后端许可；其条文包含 EE 和 CE/MPL-2.0 的适用条件。复用这些目录中的实现时，应按相应文件及发行组成确认适用条款。其余内容以及第三方组件按根许可中的范围和各自许可处理。

Canvas Chat 可用于研究对话分叉、合并和摘录节点；复制或分发代码前，需要补齐其 README 许可声明与具体授权文本的核查。Logseq 可用于阅读文献回链和知识对象组织方式；PDF 引用的 [Whiteboard 文档](https://github.com/logseq/docs/blob/master/pages/Whiteboard.md) 属于对应功能说明，当前检出的 `master` 功能以该提交源码为准。

## 功能模块

| 项目 | 本地目录 | 许可与状态 | 源码及上游启动入口 |
| --- | --- | --- | --- |
| [Excalidraw](https://github.com/excalidraw/excalidraw) | `upstream/modules/excalidraw` | MIT | `packages/excalidraw/`、`packages/element/`；Yarn 1.22.22，安装依赖后运行 `yarn start` |
| [React Flow / xyflow](https://github.com/xyflow/xyflow) | `upstream/modules/xyflow` | MIT | `packages/react/`、`packages/system/`；pnpm 10.33.4，安装依赖后运行 `pnpm dev:react` |
| [Open Canvas](https://github.com/langchain-ai/open-canvas) | `upstream/modules/open-canvas` | MIT；GitHub 仓库已归档 | `apps/web/`、`apps/agents/src/open-canvas/`；Yarn 1.22.22、Supabase、LangGraph 及模型服务，按 [README](https://github.com/langchain-ai/open-canvas/blob/0310cecd51f31b3d37a52d6d1060137da3405280/README.md) 配置 |
| [Atomic](https://github.com/kenforthewin/atomic) | `upstream/modules/atomic` | MIT | `crates/atomic-core/src/search.rs`、`embedding.rs`、`graph_maintenance.rs`；Node 22+、Rust，Web 使用 `npm run dev`，服务端使用 `cargo run -p atomic-server -- serve --port 8080` |

这些上游命令作为各项目的开发入口记录；本次依赖安装和运行验证覆盖三个主要候选。Open Canvas 的长文局部修订和 Agent 实现仍可用于源码研究，其维护状态为归档。

## tldraw 资料

调研中的 tldraw 单独保留为资料链接：[SDK 许可](https://tldraw.dev/community/license)、[AI Agent 示例](https://tldraw.dev/starter-kits/agent)。其 SDK 按官方说明采用源码可见许可，生产使用需要相应许可；本地取得的开源仓库清单包含上表 10 个项目。
