# 第三方源码与许可

Research Canvas 自有代码默认采用根目录的 [MPL-2.0](LICENSE)。`packages/ui/` 按其包声明采用 MIT；第三方源码及适配模块保留相应上游许可。下表记录来源、具体版本和接入位置。

| 来源 | 上游版本 | 项目内位置与用途 | 许可 |
| --- | --- | --- | --- |
| [BlockSuite](https://github.com/toeverything/blocksuite) | `5cb5cb68471ca692f3c162258f0087cb22fcb82d` | `packages/blocksuite/` 中的编辑框架与 AFFiNE 编辑组件，以及 `packages/research/src/editor/editor-container.ts` 的容器适配 | 根 MPL-2.0；具体包的 MIT 声明和 [MIT 文本](licenses/toeverything-MIT.txt) 随源码保留 |
| [ThoughtDAG](https://github.com/chenxiachan/thoughtdag) | `96af06fdd6734fec075c8a8bb4273ce77218b1f4` | `crates/server/src/research.rs` 中的上下文祖先遍历，依据 `src/lib/graph.ts` 适配为迭代遍历、索引查找及循环检测 | [MIT](licenses/thoughtdag-MIT.txt) |
| [Atomic](https://github.com/kenforthewin/atomic) | `983bea6baf449d060514c94b3b15b5f85f77ba9b` | `crates/server/src/research.rs` 中的 Reciprocal Rank Fusion，依据 `crates/atomic-core/src/search.rs` 适配，合并本项目的标题与正文检索排名 | [MIT](licenses/atomic-MIT.txt) |
| [Open Canvas](https://github.com/langchain-ai/open-canvas) | `0310cecd51f31b3d37a52d6d1060137da3405280` | `config/prompts/rewrite.txt` 及修改提案流程，参考 `updateHighlightedText.ts` 的选段替换与版本保留方式；使用本项目中文提示词和服务接口 | [MIT](licenses/open-canvas-MIT.txt) |
| [Dim0](https://github.com/vcmf/dim0) | `c31efa052fa9e47ff958b894c4ad825e93c8b8fe` | 画布对象、文稿动作和写入确认流程的实现参考；原始仓库保存在 `upstream/primary/dim0/` | [MIT](licenses/dim0-MIT.txt) |
| [Open Claude UI](https://github.com/Caho1/open-claude-ui) | `02d021fceaf2a907f9e63a8125621bdda1b85d60` | `packages/ui/` 中的主题及适配组件 | [MIT](licenses/open-claude-ui-MIT.txt) |

Yarn 4.7.0 的发布文件位于 `.yarn/releases/`，采用 [BSD-2-Clause](licenses/yarn-BSD-2-Clause.txt)。其中随发布文件捆绑的依赖保留各自的许可证声明。

其他调研仓库的来源与许可证见 `docs/repository-guide.md`。新增的源码迁入和依赖接入应在此文件补充具体位置及许可证。
