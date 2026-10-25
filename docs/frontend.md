# Research Canvas 前端

前端是一个 React 19 单页应用，文稿和画布共用 `src/editor/` 中的编辑能力。所有数据来自 Rust 服务的 `/api` 接口，调用约定见 [api.md](api.md)。界面流程与实测截图见 [design/flow/index.html](design/flow/index.html)。

## 启动

在项目根目录执行（脚本加载 `scripts/environment.sh` 中的项目内 Node 22.23.4 与 Yarn 4.7.0）：

```bash
bash scripts/web.sh install     # 按 yarn.lock 安装依赖
bash scripts/backend.sh start   # 后端，默认 127.0.0.1:8787
bash scripts/web.sh dev         # 开发服务 http://127.0.0.1:5173，/api 代理到后端
```

Vite 开发代理从 `config/server.toml`（缺失时用 `config/server.example.toml`）读取后端地址；环境变量 `RESEARCH_CANVAS_API` 可改为其他地址。

| 命令 | 作用 |
| --- | --- |
| `bash scripts/web.sh typecheck` | `tsc --noEmit`，覆盖 `src/` 下全部 TypeScript |
| `bash scripts/web.sh build` | 类型检查后构建到 `dist/`；后端按 `frontend_directory = "dist"` 直接托管，访问 `http://127.0.0.1:8787/` |
| `bash scripts/web.sh preview` | 在 5173 预览 `dist/` |

模块别名以 `tsconfig.json` 的 `paths` 为唯一来源（`@editor/*`、`@research`、`@research/editor`、`@ui`），`vite.config.ts` 读取同一份配置。Vite 缓存位于 `.runtime/vite-cache/`。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/web/app/` | 应用状态与操作（`model.ts`）、页面框架（`App.tsx`） |
| `src/web/views/` | 画布视图（卡片放置、连线同步关系、卡片内编辑）与文稿视图（选段工具栏、锚点高亮） |
| `src/web/panels/` | 研究面板：讨论、批注、关系、版本、运行 |
| `src/web/components/` | 弹窗（上下文、比较、修改预览、版本、检索、PDF、工作区）、Markdown 渲染、编辑器挂载 |
| `src/research/api/` | 接口类型与请求客户端，含 SSE 订阅与重连 |
| `src/research/editor/` | 工作区适配、编辑会话（保存、冲突、重载）、文本块投影、选段换算、资产映射 |
| `src/ui/` | 按钮、对话框、分段选择、状态指示和滚动跟随组件 |
| `src/editor/` | 文档、画布、内容块、工具栏及编辑扩展 |

## 数据约定

- **文稿保存**：每次保存同时提交文本块投影、Markdown 与 `editor_state`（`blocksuite-yjs-v1`，Y.Doc 更新的 Base64）。编辑后约 1.2 秒自动保存，页面隐藏时立即保存。版本冲突（409）时保留本地内容，用户可选择保留本地或载入服务器版本。
- **文本块投影**：块标识沿用编辑器块标识。标题、引用、列表、代码、公式块写成 Markdown 前缀，行内公式写成 `$…$`，表格写成 GFM 表格。投影可逆：服务端改写清除 `editor_state` 后，前端按文本块重建结构。投影规则新增块类型后，已保存文稿首次打开时自动补存一次文本块，编辑状态保持不变。
- **锚点**：选段按块内投影文本的 UTF-16 偏移记录，并附带文稿版本。原文修订后由后端返回原位、已重定位、原文已改、定位失效或多处匹配。
- **画布**：卡片是 `affine:embed-synced-doc`，引用统一文稿；同一文稿可出现在多张画布。连接两张卡片的连线同步为工作区关系，`editor_state.links` 保存连线与关系的对应。
- **讨论**：预览上下文与发送使用同一 `context_id`；生成结果以 SSE 流式显示，回答按 Markdown（含表格与公式）渲染并保存为讨论文稿。讨论脉络按上下文关系组织，合并讨论挂在最近的直接分支下。

## 验证记录

2026-10-24 在真实后端（模型 `cc/gemini-3.8-flash-high`）上用 Playwright 驱动 Chrome 完成以下操作，截图见流程图：

- 后端未连接与重连；工作区创建与切换；PDF 导入；文稿输入与行内/块级公式；画布放置、拖动、缩放、框、卡片内编辑。
- 选段讨论、上下文预览、流式生成；分叉两个分支、并排比较、合并讨论及其上下文。
- 画布连线建立关系，编辑对应、条件、反例、出处与状态，重载后保持。
- 改写选段、差异预览、确认写入、撤销。
- 修订锚点所在原文后的已重定位与原文已改状态、查看引用版本、版本对比与恢复。
- PDF 选段页码与原页查看；检索；JSON 与 ZIP 导出；同一后端恢复归档时的 409 提示；空数据库实例中的归档恢复。
- 深色主题、390px 窄屏（无横向滚动）、生产构建由后端托管后的载入。

生产界面另在 `127.0.0.1:8789` 的独立 SQLite 验证实例中完成了文稿中文编辑、自动保存、编辑器图片拖放、刷新后的图片恢复及文稿放入画布。图片以 UUID 标识保存；文稿内容版本与画布布局版本分别记录。

尚未实测：系统中文输入法的组合输入（代码按 `isComposing` 跳过回车发送）、两个客户端并发编辑触发的保存冲突、Markdown/文本文件导入，以及系统文件选择器的自动化操作。
