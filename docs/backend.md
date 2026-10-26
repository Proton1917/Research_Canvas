# Research Canvas 后端

Rust 服务提供工作区、文稿版本、画布、关系、选段锚点、上下文快照、模型运行和修改提案接口。数据保存在项目内的 SQLite 数据库；模型 OAuth 凭据由本机 Router 管理。前端调用约定见 [api.md](api.md)。

## 构建与启动

在项目根目录执行：

```bash
cp -n config/server.example.toml config/server.toml
bash scripts/backend.sh build
bash scripts/backend.sh run
```

`build` 使用根目录 Cargo 开发构建配置，并将可执行文件安装到 `.runtime/bin/`。`run` 通过 Cargo 构建并启动；已安装的程序可通过 `bash scripts/backend.sh start` 启动。服务同时提供 `dist/` 中的界面和 HTTP API。停止前台服务使用 `Ctrl+C`。服务接收终止信号后取消进行中的模型请求，将状态记录为 `interrupted`，并结束数据库操作。

默认地址为 `http://127.0.0.1:8787`，本地配置文件是 `config/server.toml`，示例文件随仓库提供。设置 `RC_CONFIG` 可选择项目内另一份服务配置。Python 验证需要 Python 3 和 `requests`，下列命令沿用开发环境中的 `conda base`；其他环境使用对应 Python 解释器执行相同脚本。

运行数据和依赖位置：

| 对象 | 路径 |
| --- | --- |
| SQLite | `.runtime/data/research-canvas.sqlite3` |
| Cargo 下载缓存 | `.runtime/cargo-home/` |
| Cargo 构建输出 | `target/` |
| 安装后的可执行文件 | `.runtime/bin/research-canvas` |
| PDF 提取中间文件 | `tmp/backend/`，提取操作结束后自动释放 |
| 服务与构建日志 | `.runtime/logs/` |

PDF 文本提取调用本机 Poppler 的 `pdftotext`。导入文件原始字节保存在 SQLite，页码及文本另存为文稿块。扫描 PDF 的文字识别需要上层另接 OCR；空页文本会按页保留。

## 模型连接

当前模型服务地址为 `http://127.0.0.1:43177/v1`，使用 Router 共享模型目录中的 `cc/gemini-3.8-flash-high`。Router 将该模型连接到现有 OAuth 通道。Research Canvas 使用本机客户端标记 `router-local-client`，OAuth 访问令牌和刷新令牌继续由 Router 管理。服务地址、请求头和允许的模型列表配置于 `config/server.toml`。

服务从 `/models` 读取目录，并按允许列表提供模型选项。当前通道通过 `/messages` 接收 Anthropic Messages SSE，SSE 解析使用 `eventsource-stream`。模型原始流在后端聚合为累积文本，通过运行事件接口发送。成功、失败、取消及服务中断均保存状态；错误和取消时保留已收到的内容。协议适配还包含标准 Chat Completions，具体使用协议由配置选择。

讨论、关系分析和改写提示词分别位于 `config/prompts/`。上下文接口保存完整消息快照。运行仅引用该快照，后续原文变化保留原请求的来源版本。

## 数据与修订

文稿版本保存文本块、可选 Markdown 和编辑器状态。客户端提交 `expected_version`，发生版本冲突时返回 409。画布保存独立的布局版本，多个画布对象可引用同一文稿。

锚点保存历史版本、文本块、UTF-16 偏移、原文及周边内容。定位使用原文本块和周边文本，返回精确、重新定位、已变化、缺失或歧义状态。改写提案确认时再次核对当前文稿版本与原选段；替换后清除旧编辑器表示，由前端根据新文本块重建。撤销提案生成新的历史版本。

AI 上下文读取显式选择的文稿与锚点，并继承讨论保存的材料快照。去重身份包含文稿、版本和片段；场景接口按前端材料勾选读取正文、历史来源和布局。研究关系独立保存，旧的有向上下文关系仍执行循环校验。标题与正文搜索使用 Reciprocal Rank Fusion 合并排名。

完整 JSON 归档保存文稿版本、关系、锚点、运行记录、画布和资产，支持在工作区标识不存在的数据库中恢复。ZIP 同时包含文稿 Markdown、关系 JSON、关系 SVG、原始资产与完整归档。

## 后端验证入口

`tests/backend_acceptance.py` 使用项目调研 PDF 和实际模型服务执行分阶段验收，结果记录在 `.runtime/backend-acceptance.json`。分阶段运行有助于保留已通过的结果，并对受影响部分继续验证。`core` 和 `export` 阶段通过 `--source` 指定同一份材料的现有路径。材料须为原四页调研 PDF，脚本会核对其中的选段和页码。以下命令中的 `research_pdf` 应设为项目目录内该材料的实际路径。

```bash
conda run --no-capture-output -n base python tests/backend_acceptance.py core --source "$research_pdf"
conda run --no-capture-output -n base python tests/backend_acceptance.py models
conda run --no-capture-output -n base python tests/backend_acceptance.py cancellation
conda run --no-capture-output -n base python tests/backend_acceptance.py export --source "$research_pdf"
conda run --no-capture-output -n base python tests/backend_acceptance.py router
```

`export` 阶段还需要一个端口为 8788、使用空数据库的恢复验证服务。模型阶段会向配置的模型服务发送真实请求；已经通过的阶段按记录复用，相关条件变化后再确定受影响的验证范围。

2026-10-24 的验证已完成 PDF 四页文本导入、来源锚点及重定位、原文修订与历史恢复、画布内容引用、上下文祖先去重与循环拒绝、版本冲突、检索、请求取消和 JSON/ZIP 导出。导出的工作区已在独立数据库中恢复，并逐字段读回比较。真实改写结果经过提案确认及撤销，原文恢复为此前版本。

当前 Router OAuth 通道的请求标识为 `cc/gemini-3.8-flash-high`，实测响应模型为 `gemini-3.8-flash-n`，完成原因 `end_turn`，原生用量为 `input_tokens=227`、`output_tokens=241`。本次验证输入为调研 PDF 中的一个选段。当前协议的 `usage` 保留 Anthropic 字段以及后端记录的 `finish_reason`。

## 画布共创联调

接口和前端调用方式见 [backend-integration.md](backend-integration.md)。2026-10-25 使用用户提供的七页产品共识 PDF，在独立 SQLite 实例中执行 `tests/canvas_acceptance.py`，完成以下操作：

- 精确片段讨论实际模型调用；原文修订后的追问继承；同一文稿多个片段的上下文合并。
- 前端投影结构及材料勾选提交；取消正文选入后保留定位信息。
- 实际模型生成研究框与候选关系；画布版本冲突；确认当前版本后应用；重复应用保持同一事务；整组撤销。
- 研究状态人工确认、证据版本核对及来源更新后的待复核提示。
- 新建文稿被后续确认记录作为证据引用时，撤销返回冲突；解除引用后撤销成功。
- 版本 2 归档在独立实例恢复并读回比较；归档事务中的工作区归属校验。

结果记录在 `.runtime/canvas-acceptance.json`。Chrome 实际载入后端托管的联调工作区，页面无脚本错误，截图为 `.runtime/browser/backend-integration.png`。浏览器检查覆盖页面载入及基础 API 请求；画布提案的操作验证通过真实 HTTP 接口执行。前端文稿端点提案的完整 Yjs 状态物化、画布内确认和撤销记录见前端会话维护的 `docs/frontend.md`。新增精确片段与自由想法端点的连线预览和物化按前端交接继续验证。

## 结构化生成与研究端点

画布模式经 `submit_canvas` 提交回答及可选操作数组，服务通过类型派生的 JSON Schema 声明字段，再转换为公开提案的 `actions`。纯回答保存为讨论文稿。旧模型输出支持直接 JSON 和单个 JSON Markdown 代码块，解析采用 `serde_json` 与 `pulldown-cmark`。`POST /runs/{id}/recover-canvas-proposal` 可复用完整的失败输出，提案归档保存原始文本及恢复来源。

关系支持文稿、精确锚点与冻结场景中的自由想法。旧关系在事务迁移中保留标识及内容。`missing_proof` 和 `next_validation` 保存证据缺口与验证方法，随关系修订、提案和归档保留。归档格式 3 同时保存类型化端点，关系 SVG 为片段和自由想法生成对应节点。

前端交接验证使用 `.runtime/frontend-verification.sqlite3` 中实际保存的输出和研究材料，记录位于 `.runtime/backend-handoff-acceptance.json`。两条代码块包裹的失败输出已直接恢复为待确认提案；另一条含非法 JSON 转义的输出使用原冻结上下文完成结构化运行。类型化端点的 HTTP 创建、字段修订、模型提案应用与撤销均已验证。版本 3 归档在独立实例恢复后读回一致，ZIP 关系图包含片段和自由想法节点。产品材料之外的 Connes–Kreimer 原始文献继续作为证据缺项，生成关系保存为候选。

## 公式转义

`src/math_text.rs` 使用 `pulldown-cmark` 定位 Markdown 公式，并使用 `latex2mathml` 校验去除一致重复转义后的候选。普通 LaTeX 命令、矩阵换行、代码块及行内代码有对应保留检查。工具参数提示词和 schema 同时声明字段中的 LaTeX 写法。

2026-10-25 使用前端验收记录中的原问题运行验证读取显示，并在独立验证库中完成一次新的 Router 模型调用。旧分析正文和新提案内容均在 Chrome 中显示双向箭头，所检查公式未出现 KaTeX 错误；新输出的代码示例与工具参数中的字面内容一致。原运行、原提案记录及原始模型输出保留。

验收脚本为 `tests/latex_acceptance.py` 和 `tests/latex_content.mjs`，记录保存在 `.runtime/latex-acceptance.json`。截图为 `.runtime/browser/latex-recorded.png` 与 `.runtime/browser/latex-generated.png`。新增运行使用 `.runtime/data/latex-verification.sqlite3`，与前端验收实例分别运行。

## 画布物化、版本与图像输入

`src/canvas_state.rs` 使用 `yrs` 操作编辑器数据。普通保存从 Yjs 读取文稿卡片位置；提案确认在原状态上直接修改目标对象，再生成对象表和连线绑定。事务继续管理内容、研究关系、画布版本及整组撤销。正文、格式及其他对象随 Yjs 原状态保留。

`src/context.rs` 在本轮来源选择时记录文稿和画布版本。发送时使用版本列查询，过期预览返回 `stale_context`。历史上下文继承保留引用时的来源。图像输入由 `src/visual.rs` 根据显式资产选择转换为模型协议，配置支持的模型及输入预算由 `config/server.toml` 提供。

2026-10-25 使用六页产品调整建议 PDF，在 8791 独立实例完成 `tests/canvas_consistency.py` 的画布、上下文、视觉输入及归档阶段。记录位于 `.runtime/canvas-consistency.json`。Chrome 中的编辑器生成原始画布，后端创建两张文稿卡片、移动便笺、建立候选连线；刷新后原有便笺内容保留，整组撤销恢复提交前状态。同一版本的并发保存取得 200 和 409；提交后丢弃响应体再请求同一提案，返回原事务结果。

上下文验证覆盖原文更新后的旧预览拒绝、重新冻结的新版本，以及历史来源保留。纯 `answer` 工具输出保存为讨论文稿。视觉运行发送 PDF 第四页图像，模型读取其中的验收表，响应标识为 `gemini-3.8-flash-n`。模型调用均经过本机 Router 的 `cc/gemini-3.8-flash-high`。工作区导出到 8792 空数据库后逐字段读回一致，包含图像引用及来源版本。

前端已接入默认讨论、显式建立联系、发送前刷新材料和图像选择。8790 独立实例的交互验收记录见 [frontend.md](frontend.md)，涵盖并发修改后的重新冻结、响应中断恢复、刷新与整组撤销。
