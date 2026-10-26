# Research Canvas HTTP 接口约定

本文件定义前后端共用的接口与数据格式。服务默认地址为 `http://127.0.0.1:8787`，路径前缀为 `/api`。开发前端使用端口 5173，并通过 Vite 将 `/api` 转发至后端。JSON 字段使用 `snake_case`，标识使用 UUID，时间使用 RFC 3339。

## 配置与错误

`GET /api/health` 返回服务、数据库和凭据配置状态。`provider_configured` 表示本服务具备配置要求的客户端凭据；Router 的 OAuth 授权及模型可用性通过实际请求确认。`GET /api/models` 返回经过允许列表过滤的模型目录与默认模型。当前通道为本机 Router OAuth，模型标识 `cc/gemini-3.8-flash-high`。前端模型选择来自该目录。

`GET /api/capabilities` 返回 `api_version:2`、`scene_context:1`、`frozen_inheritance:true`、`canvas_proposals:2`、`canvas_proposal_recovery:1`、`claim_reviews:1`、`claim_research_plan:1` 和 `relation_endpoints:1`。`canvas_proposals` 在服务缺少 `canvas` 提示词配置时为 0。未知 `/api` 路径返回 JSON 404。场景与画布提案的完整调用约定见 [后端联调接口](backend-integration.md)。

能力响应还提供 `canvas_proposal_materialization`、`context_freshness`、`optional_canvas_actions`、`visual_inputs` 以及模型和输入预算配置。

业务错误统一返回：

```json
{"error":{"code":"version_conflict","message":"内容已更新，请读取当前版本后提交","details":{"current_version":2}}}
```

状态码包括 404（记录缺失）、409（版本冲突）、422（业务输入无效）、502（模型服务失败）和 503（模型配置缺失）。表单提交失败时保留用户输入，显示服务返回的信息。重试由用户触发。

## 文稿与版本

`Content` 包含：

```typescript
type TextBlock = { id: string; text: string; page?: number | null };
type Content = {
  blocks: TextBlock[];
  markdown?: string | null;
  editor_state?: unknown | null;
};
type DocumentKind = "document" | "note" | "discussion" | "pdf" | "image";
```

`blocks` 保存用于选段、搜索与 AI 上下文的文本投影，块标识在编辑期间保持稳定。`editor_state` 保存前端编辑器的可恢复状态，前端应将二进制状态编码为 Base64 字符串后放入 JSON 对象。`markdown` 保存可选的 Markdown 表示。保存时三者来自同一次编辑器状态；后端的选段改写会清除旧 `editor_state` 和 `markdown`，前端据新 `blocks` 重建编辑器。

文稿响应包含 `id, workspace_id, title, kind, current_version, metadata, content, created_at, updated_at`。版本响应包含 `document_id, version, title, content, created_at, reason`。

| 方法与路径 | 输入及结果 |
| --- | --- |
| `GET /workspaces` | 工作区数组 |
| `POST /workspaces` | `{name}` → 工作区 |
| `GET /workspaces/{id}` | `{workspace, documents, canvases, relations, anchors}` |
| `PATCH /workspaces/{id}` | `{name}` → 工作区 |
| `POST /workspaces/{id}/documents` | `{title, kind?, content, metadata?}` → 文稿 |
| `GET /documents/{id}` | 当前文稿 |
| `PATCH /documents/{id}` | `{expected_version, title?, content?, metadata?}` → 新版本文稿 |
| `GET /documents/{id}/versions` | 历史版本数组，按版本升序 |
| `GET /documents/{id}/versions/{version}` | 指定版本 |
| `POST /documents/{id}/restore` | `{expected_version, version}` → 以历史内容生成的新版本 |

文稿内容变更生成不可变版本。409 响应后重新读取当前内容并保留本地编辑，由用户处理冲突。画布布局变化独立保存。

## 画布与关系

画布对象结构：

```typescript
type CanvasObject = {
  id: string; document_id: string;
  x: number; y: number; width: number; height: number;
};
type Canvas = {
  id: string; workspace_id: string; name: string; revision: number;
  objects: CanvasObject[]; editor_state: unknown | null; updated_at: string;
};
type Claim = {
  status: "analogy" | "candidate" | "supported" | "established" | "refuted" | "verified";
  conditions: string; counterexamples: string; sources: string[];
  mapping: string; preserved_operations: string[];
  missing_proof: string; next_validation: string;
  revision: number; reviews: ClaimReview[]; review_required: boolean;
};
type Relation = {
  id: string; workspace_id: string; source_id: string; target_id: string;
  source_ref: ResearchEndpoint | null; target_ref: ResearchEndpoint | null;
  kind: string; label: string; include_in_context: boolean;
  context_order: number; claim: Claim | null; created_at: string;
};
```

`CanvasObject` 引用统一文稿；同一文稿可在多张画布中出现。原生绘图、框、笔迹和编辑器布局保存在画布 `editor_state`。`Relation` 支持文稿、精确锚点及冻结场景中的自由想法端点，类型引用见 `backend-integration.md`。旧文稿端点可继续使用 `source_id`、`target_id`；新端点通过 `source_ref`、`target_ref` 提交。自由关系默认 `include_in_context=false`；旧版有向上下文连线使用文稿端点并执行循环校验。

| 方法与路径 | 输入及结果 |
| --- | --- |
| `POST /workspaces/{id}/canvases` | `{name}` → 画布 |
| `GET /canvases/{id}` | 画布 |
| `PUT /canvases/{id}` | `{expected_revision, name, objects, editor_state?}` → 更新后的画布；携带编辑状态时从 Yjs 生成对象表 |
| `POST /workspaces/{id}/relations` | `{source_id,target_id,kind?,label?,include_in_context?,context_order?,claim?}` → 关系 |
| `PATCH /relations/{id}` | 上述可编辑关系字段的子集 → 关系 |
| `GET /relations/{id}` | 当前关系及证据复核状态 |
| `POST /relations/{id}/review` | 带版本的证据、目标状态、判断依据和人工确认 → 关系 |
| `DELETE /relations/{id}` | 删除关系，204 |

## 选段锚点

`POST /workspaces/{id}/anchors` 接收 `{document_id, version, block_id, quote, start_utf16?}`，返回锚点。偏移以 JavaScript UTF-16 单元计算，页码从 1 开始。服务核对该历史版本中的原文，并保存周边文本。未提供偏移时要求选段在块内唯一。

`GET /anchors/{id}` 返回锚点；`GET /anchors/{id}/resolve` 返回：

```typescript
type AnchorStatus = "exact" | "relocated" | "changed" | "missing" | "ambiguous";
type AnchorResolution = {
  anchor: Anchor;
  status: AnchorStatus;
  current_version: number;
  block_id: string | null;
  start_utf16: number | null;
  end_utf16: number | null;
};
```

`Anchor` 包含 `id, workspace_id, document_id, version, block_id, quote, start_utf16, prefix, suffix, page, created_at`。前端显示旧引用的版本和原文，同时展示当前定位状态。`changed`、`missing`、`ambiguous` 状态保留原引用，并提供返回历史版本的入口。

## 上下文与 AI 运行

`POST /workspaces/{id}/contexts`：

```typescript
type ContextRequest = {
  question: string;
  mode?: "discussion" | "rewrite" | "relation";
  document_ids?: string[];
  anchor_ids?: string[];
  inherit_context_ids?: string[];
  inherit_discussion_sources?: boolean;
  frozen_sources?: {context_id: string; number: number}[];
};
```

服务读取显式选择的文稿和锚点。选入讨论文稿时，默认继承其 `metadata.context_id` 指向的冻结来源及历史场景，再加入本次选入的讨论正文。`inherit_discussion_sources=false` 用于用户逐项调整材料范围；`inherit_context_ids` 继承完整快照中的材料，`frozen_sources` 按快照和来源编号选入单项材料。材料按文稿、版本、锚点共同去重，关系线继续独立保存。

响应包括 `id, workspace_id, mode, question, document_ids, anchor_ids, ordered_document_ids, sources, inherited_context_ids, scenes, messages, character_count, created_at`。`sources` 的每项包含 `number, document_id, version, title, content, anchor_id, anchor_status`。显式整篇文稿使用预览时的版本；片段和继承材料使用原引用版本，锚点状态反映当前定位情况。缺少讨论来源快照时返回错误，用户可补选材料范围。输入中的未知字段会被拒绝。

`messages` 是实际发给模型的完整消息数组。上下文保存后保持固定；修改勾选材料或提问内容时重新生成预览。`GET /contexts/{id}` 可读取该快照。

### 运行来源与归位

场景上下文保存 `origin: {canvas_id, source_ids, write_region}`，分别表示本轮提问的画布、选中来源实例及讨论卡片区域。运行创建时复制该字段；`context_id` 指向完整冻结材料。文稿讨论和历史记录的 `origin` 可为 null。继承历史材料时，本轮场景决定新运行的归位位置。

`Run.placement` 为 null 或 `{object_id, canvas_revision}`。成功讨论同时具有 `document_id`、`origin` 且 `placement` 为 null 时，表示等待放入原画布。运行列表、单项读取、事件流和归档均包含这两个字段。

`POST /runs/{id}/place` 接收 `{expected_canvas_revision, bounds?}`，返回 `{run, canvas}`。目标画布由运行保存的 `origin.canvas_id` 确定。服务优先使用冻结的 `write_region`；该字段为 null 时由请求提供 `bounds`。尺寸和坐标采用画布世界坐标。

归位在同一事务中生成讨论卡片、仍在目标画布中的来源连线、完整 Yjs、对象表及运行归位记录。来源对象已移走时保留讨论卡片，来源记录继续存于上下文。新增来源线的 `relation_id` 为 null。画布版本冲突返回 409 `version_conflict`；客户端保留编辑，处理冲突后重新发起。

同一运行的重复归位返回原归位记录和目标画布的当前版本。已放置卡片的后续移动、编辑和删除由画布保存管理。前端在目标画布挂载后保存本地编辑，再调用归位；采用响应时遵循已有编辑器卸载与服务端版本载入流程。运行中的画布切换、提问框关闭及页面刷新，均可通过运行记录恢复目标画布信息。

### 提问截图资产

导入材料使用 `/workspaces/{id}/imports`。临时提问截图使用以下接口，上传响应直接提供资产信息，工作区文稿数量保持原值：

| 方法与路径 | 请求与结果 |
| --- | --- |
| `POST /workspaces/{id}/visual-assets` | multipart `file`，支持 PNG、JPEG、WebP、GIF，返回截图资产 |
| `GET /workspaces/{id}/visual-assets` | 返回截图资产列表及现有引用 |
| `DELETE /workspaces/{id}/visual-assets/{asset_id}` | 显式清理空引用截图，成功返回 204 |

截图资产包含 `{id,filename,media_type,byte_length,url,created_at,references}`。引用项为 `{type,id,version}`，类型包括 `context`、`document`、`document_version`、`canvas`、`canvas_proposal`。大小单位为字节。列表查询读取元信息，图像内容仍通过 `/assets/{id}` 获取。

删除时在事务中检查冻结上下文、导入文稿、文稿历史版本、画布及提案撤销快照中的引用。存在引用时返回 409 `asset_in_use`，详情为 `{asset_id,references}`；图像和引用保持原样。冻结预览也是保存的来源记录，引用会显示在列表中。移除提问中的截图只调整本轮材料；永久删除通过可见清理操作执行。已有截图可通过资产标识再次加入提问。

归档中的 `Asset.temporary` 标记提问截图类别，旧归档默认 false；是否可清理由当前引用决定。来源及归位字段随归档恢复保存。

### 运行执行与事件

`POST /workspaces/{id}/runs` 接收 `{context_id, model?, max_output_tokens?}`，立即返回运行记录。`GET /workspaces/{id}/runs` 返回该工作区的运行记录。`GET /runs/{id}` 返回当前运行状态，`POST /runs/{id}/cancel` 取消正在执行的运行。

新上下文保存本轮材料版本于 `freshness`。`GET /contexts/{id}/freshness` 返回版本变化详情。发送遇到材料更新时返回 409 `stale_context`；超出本机文本或图像预算时返回 422 `context_budget_exceeded` 或 `image_budget_exceeded`。图像使用场景请求的 `visuals` 字段，支持模型、上限及完整接入数据见 [后端联调接口](backend-integration.md)。

```typescript
type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
type Run = {
  id: string; workspace_id: string; context_id: string; model: string;
  status: RunStatus; answer: string; model_used: string | null;
  usage: unknown | null; error: string | null;
  document_id: string | null; proposal_id: string | null;
  canvas_proposal_id: string | null;
  origin: {canvas_id: string; source_ids: string[]; write_region: Bounds | null} | null;
  placement: {object_id: string; canvas_revision: number} | null;
  created_at: string; updated_at: string;
};
```

`GET /runs/{id}/events` 提供 SSE，事件名为 `progress`，数据为 `{sequence,run}`。`run.answer` 始终是累积全文，客户端以收到的全文替换当前文本。连接后先发送最新状态；终态为 `succeeded, failed, cancelled, interrupted`，客户端收到终态后关闭连接。重连读取最新状态，已有文本可保留。

讨论和关系分析成功后创建 `kind=discussion` 的文稿，并保存问题、模型、用量和上下文来源。返回的 `document_id` 可作为后续分支的材料，多个讨论文稿可共同作为新上下文的入口。前端通过用户操作将结果加入画布。

改写模式要求恰好一个锚点，成功后返回 `proposal_id`。此时原文保持原版本，前端显示修改预览。

场景接口支持 `mode=canvas`，通过 `submit_canvas` 结构化工具输出，运行成功后返回 `canvas_proposal_id`。画布操作经结构检查后保存为待确认提案。流式阶段 `answer` 为正在接收的工具参数 JSON，成功后转换为其中的分析正文；完整操作从画布提案接口读取。画布中的正式写入由应用接口执行。

`POST /runs/{id}/recover-canvas-proposal` 重新解析已保存、模型输出完整的失败画布运行。解析接受直接 JSON 对象或单个 JSON Markdown 代码块；成功时生成待确认提案并返回更新后的运行，保留原始输出和恢复记录。该接口复用原模型输出。JSON 内容自身无效时返回具体格式错误。

## 修改提案

| 方法与路径 | 输入及结果 |
| --- | --- |
| `GET /proposals/{id}` | 修改提案 |
| `POST /proposals/{id}/apply` | `{expected_version}` → `{proposal, document}` |
| `POST /proposals/{id}/revert` | `{expected_version}` → `{proposal, document}` |
| `POST /proposals/{id}/reject` | 拒绝待确认提案 → 提案 |

提案字段为 `id,workspace_id,run_id,anchor_id,replacement,status,applied_version,previous_version,created_at`，状态为 `pending,applied,reverted,rejected`。确认时要求当前版本匹配，且原选段能唯一定位；撤销要求当前版本仍为此次提案生成的版本。恢复旧版本也会生成新版本，版本历史保留。

## 文件、检索和导出

| 方法与路径 | 输入及结果 |
| --- | --- |
| `POST /workspaces/{id}/imports` | `multipart/form-data`，字段 `file`；支持 PDF、Markdown、文本、图片 → `{document,asset}` |
| `GET /assets/{id}` | 原始文件，按保存的媒体类型响应 |
| `GET /workspaces/{id}/search?q=...&limit=20` | 当前文稿的标题与正文检索，返回 `{document_id,title,version,score,excerpt}` 数组 |
| `GET /workspaces/{id}/export` | 完整、可恢复的 JSON 归档 |
| `GET /workspaces/{id}/export.zip` | 包含 Markdown、关系 SVG、原始资产及完整 JSON 的 ZIP |
| `POST /workspaces/import` | 提交完整 JSON 归档，恢复原标识及版本；目标工作区标识已存在时返回 409 |

PDF 保留原始文件，提取每页文本作为独立文本块并记录页码。完整归档的 `format_version=3`，包括 `workspace,documents,versions,canvases,relations,anchors,contexts,runs,proposals,canvas_proposals,assets`，保留类型化关系端点。恢复同时接受版本 1 和 2。资产使用 `data_base64` 保存。画布提案包含原始输出、应用与撤销记录，讨论保留模型、运行及冻结来源。
