# Research Canvas 后端

Rust 服务提供工作区、文稿版本、画布、关系、选段锚点、上下文快照、模型运行和修改提案接口。数据保存在项目内的 SQLite 数据库；模型 OAuth 凭据由本机 Router 管理。前端调用约定见 [api.md](api.md)。

## 构建与启动

在项目根目录执行：

```bash
cp -n config/server.example.toml config/server.toml
bash scripts/backend.sh build
bash scripts/backend.sh run
```

`build` 使用 Cargo 的开发构建配置，并将可执行文件安装到 `.runtime/bin/`。`run` 通过 Cargo 构建并启动；已安装的程序可通过 `bash scripts/backend.sh start` 启动。停止前台服务使用 `Ctrl+C`。服务接收终止信号后取消进行中的模型请求，将状态记录为 `interrupted`，并结束数据库操作。

默认地址为 `http://127.0.0.1:8787`，本地配置文件是 `config/server.toml`，示例文件随仓库提供。设置 `RC_CONFIG` 可选择项目内另一份服务配置。Python 验证需要 Python 3 和 `requests`，下列命令沿用开发环境中的 `conda base`；其他环境使用对应 Python 解释器执行相同脚本。

运行数据和依赖位置：

| 对象 | 路径 |
| --- | --- |
| SQLite | `.runtime/data/research-canvas.sqlite3` |
| Cargo 下载缓存 | `.runtime/cargo-home/` |
| Cargo 构建输出 | `.runtime/target/` |
| 安装后的可执行文件 | `.runtime/bin/research-canvas-server` |
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

参与 AI 上下文的关系按方向遍历祖先，按连线顺序去重。自由关系可以保留循环；启用上下文传递时验证有向循环。标题与正文搜索使用 Atomic 的 Reciprocal Rank Fusion 排名合并方法。

完整 JSON 归档保存文稿版本、关系、锚点、运行记录、画布和资产，支持在工作区标识不存在的数据库中恢复。ZIP 同时包含文稿 Markdown、关系 JSON、关系 SVG、原始资产与完整归档。

## 后端验证入口

`tests/backend_acceptance.py` 使用项目调研 PDF 和实际模型服务执行分阶段验收，结果记录在 `.runtime/backend-acceptance.json`。分阶段运行有助于保留已通过的结果，并对受影响部分继续验证。

```bash
conda run --no-capture-output -n base python tests/backend_acceptance.py core
conda run --no-capture-output -n base python tests/backend_acceptance.py models
conda run --no-capture-output -n base python tests/backend_acceptance.py cancellation
conda run --no-capture-output -n base python tests/backend_acceptance.py export
conda run --no-capture-output -n base python tests/backend_acceptance.py router
```

`export` 阶段还需要一个端口为 8788、使用空数据库的恢复验证服务。模型阶段会向配置的模型服务发送真实请求；已经通过的阶段按记录复用，相关条件变化后再确定受影响的验证范围。

2026-10-24 的验证已完成 PDF 四页文本导入、来源锚点及重定位、原文修订与历史恢复、画布内容引用、上下文祖先去重与循环拒绝、版本冲突、检索、请求取消和 JSON/ZIP 导出。导出的工作区已在独立数据库中恢复，并逐字段读回比较。真实改写结果经过提案确认及撤销，原文恢复为此前版本。

当前 Router OAuth 通道的请求标识为 `cc/gemini-3.8-flash-high`，实测响应模型为 `gemini-3.8-flash-n`，完成原因 `end_turn`，原生用量为 `input_tokens=227`、`output_tokens=241`。本次验证输入为调研 PDF 中的一个选段。当前协议的 `usage` 保留 Anthropic 字段以及后端记录的 `finish_reason`。
