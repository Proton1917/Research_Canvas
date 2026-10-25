# 第三方版权、许可与来源说明

Research Canvas 统一采用根目录的 [Mozilla Public License 2.0](../LICENSE)。本目录集中保存第三方原作者的版权、原始许可文本和来源记录。

## 主要代码与流程来源

| 来源 | 参考版本 | 当前源码位置与用途 | 原始许可告知 |
| --- | --- | --- | --- |
| [BlockSuite](https://github.com/toeverything/blocksuite) | `5cb5cb68471ca692f3c162258f0087cb22fcb82d` | `src/editor/` 的文档、画布、内容块和编辑扩展；`src/research/editor/` 的工作区与编辑容器适配 | TOEVERYTHING PTE. LTD. and its affiliates；[MPL-2.0 原文](blocksuite-MPL-2.0.txt)、[MIT 原文](toeverything-MIT.txt) |
| [ThoughtDAG](https://github.com/chenxiachan/thoughtdag) | `96af06fdd6734fec075c8a8bb4273ce77218b1f4` | `src/research.rs` 的上下文祖先遍历 | [MIT](thoughtdag-MIT.txt) |
| [Atomic](https://github.com/kenforthewin/atomic) | `983bea6baf449d060514c94b3b15b5f85f77ba9b` | `src/research.rs` 的 Reciprocal Rank Fusion 排名合并 | [MIT](atomic-MIT.txt) |
| [Open Canvas](https://github.com/langchain-ai/open-canvas) | `0310cecd51f31b3d37a52d6d1060137da3405280` | 选段改写、修改提案与历史版本流程参考 | [MIT](open-canvas-MIT.txt) |
| [Dim0](https://github.com/vcmf/dim0) | `c31efa052fa9e47ff958b894c4ad825e93c8b8fe` | 画布动作与修改确认流程参考 | [MIT](dim0-MIT.txt) |
| [Open Claude UI](https://github.com/Caho1/open-claude-ui) | `02d021fceaf2a907f9e63a8125621bdda1b85d60` | `src/ui/` 的主题、按钮、对话框、分段选择、状态指示与滚动行为；`config/theme.cjs` 的样式映射 | [MIT](open-claude-ui-MIT.txt) |
| [Yarn](https://github.com/yarnpkg/berry) | 4.7.0 | `.yarn/releases/yarn-4.7.0.cjs` 开发工具 | Copyright (c) 2016-present, Yarn Contributors；[BSD-2-Clause](yarn-BSD-2-Clause.txt) |
| [Dagre](https://github.com/dagrejs/dagre) | 3.1.1 | 界面流程图的自动布局 | Copyright (c) 2012-2014 Chris Pettitt；[MIT](dagre-MIT.txt) |

## 编辑模块中的原始署名

| 当前文件或目录 | 原始署名及来源 | 许可资料 |
| --- | --- | --- |
| `src/editor/platform/gfx/perfect-freehand/` | Copyright (c) 2021 Stephen Ruiz Ltd | [MIT](perfect-freehand-MIT.txt) |
| `src/editor/blocks/surface/utils/points-on-path/` | Copyright (c) 2020 Preet | [MIT](points-on-path-MIT.txt) |
| `src/editor/blocks/surface/utils/points-on-curve/` | Copyright (c) 2020 Preet Shihn | [MIT](points-on-curve-MIT.txt) |
| `src/editor/blocks/surface/utils/rough/` | Copyright (c) 2020 Preet Shihn | [MIT](rough-MIT.txt) |
| `src/editor/blocks/surface/utils/path-data-parser/` | Copyright (c) 2020 Preet Shihn | [MIT](path-data-parser-MIT.txt) |
| `src/editor/platform/lit/signal-watcher.ts`、`watch.ts` | Copyright 2023 Google LLC；原文件标识 `SPDX-License-Identifier: BSD-3-Clause` | [BSD-3-Clause](lit-BSD-3-Clause.txt) |
| `src/editor/shared/adapters/markdown/gfm.ts` | Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com>；原文件说明 `mdast-util-gfm-autolink-literal is from markdown only` | [MIT](gfm-autolink-MIT.txt) |
| `src/editor/shared/utils/figma-squircle/` | [figma-squircle](https://github.com/phamfoo/figma-squircle)，Copyright (c) 2021 Tien Pham | [MIT](figma-squircle-MIT.txt) |
| `src/editor/platform/gfx/model/vec.ts` | tldraw 向量实现，参考提交 `24cad6959f59f93e20e556d018c391fd89d4ecca`；Copyright (c) 2022 tldraw GB Ltd | [MIT](tldraw-vector-MIT.txt) |
| `src/editor/document/adapter/base.ts` | [estree-walker](https://github.com/Rich-Harris/estree-walker) 的遍历方式 | [MIT](estree-walker-MIT.txt) |
| `src/editor/data-view/core/utils/utils.ts` | jQuery `hiddenVisibleSelectors.js` 可见性判断，原记录日期 2018-03-11 | [MIT](jquery-MIT.txt) |
| `src/editor/platform/di/stable-hash.ts` | [stable-hash](https://github.com/shuding/stable-hash)，作者 Shu Ding；上游 README 和 package.json 声明 MIT | [MIT 许可声明](https://github.com/shuding/stable-hash#license) |

## 对迁入 BlockSuite 源码的修改

以下文件在 BlockSuite 参考版本基础上修改，仍按 MPL-2.0 提供：

- `src/editor/platform/disposable/index.ts`：`DisposableGroup.addFromEvent` 增加接受任意 `EventTarget` 与可空目标的重载，空目标不注册监听。上游以包产物类型引用时调用方依赖等效的宽松签名。
- `src/editor/blocks/embed-doc/embed-synced-doc-block/embed-synced-doc-block.ts`、`embed-edgeless-synced-doc-block.ts`：空白同步卡片的提示文字改为中文操作说明。
- `src/research/editor/workspace.ts`：工作区、文稿集合与元数据适配，参照上游 `framework/store` 测试工作区实现，改为按后端文稿标识创建独立 Y.Doc。
- `src/research/editor/editor-container.ts`：文稿与画布编辑容器，参照上游 `integration-test` 的编辑器容器。
- 上游测试专用导出（store 测试工作区、shared `test-utils`）未迁入。

源文件还记录了以下算法和资料参考：

- `src/editor/blocks/list/utils/get-number-prefix.ts`：[imilu 的列表编号实现](https://gist.github.com/imilu/00f32c61e50b7ca296f91e9d96d8e976)。
- `src/editor/platform/gfx/curve.ts`：[Bezier.js 直线相交说明](https://pomax.github.io/bezierjs/#intersect-line)，原记录标注 MIT。
- `src/editor/shared/utils/figma-squircle/draw.ts`：[Figma 圆角说明](https://www.figma.com/blog/desperately-seeking-squircles/)及 [MartinRGB 的圆角计算](https://github.com/MartinRGB/Figma_Squircles_Approximation/blob/bf29714aab58c54329f3ca130ffa16d39a2ff08c/js/rounded-corners.js#L64)。

## 调研参考

产品调研材料保存在 [research-material.pdf](research-material.pdf)。其中还参考了以下项目：

| 项目 | 参考提交 | 调研用途 |
| --- | --- | --- |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | `733d839bcf145535b281d0ad256f4c9a5092efa8` | 文稿与画布的产品交互 |
| [Canvas Chat](https://github.com/ericmjl/canvas-chat) | `127cb0188810f6151695f1d6cefbe8d3e3d64a77` | 非线性讨论与摘录交互 |
| [Logseq](https://github.com/logseq/logseq) | `408198a4feba58788e9163b35ae5f44aca9451d3` | 文献回链与知识管理 |
| [Excalidraw](https://github.com/excalidraw/excalidraw) | `b7de45e88111f5680ae4bb3c3f3541c7d3b279fe` | 绘图与连接线交互 |
| [React Flow](https://github.com/xyflow/xyflow) | `8523d8dd9f1551954bc221dccabd6a3119ef9e22` | 关系图交互 |

第三方依赖通过根目录依赖清单及锁文件管理，其分发材料保留相应原作者的许可告知。
