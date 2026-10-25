# Research Canvas HTTP 接口约定

本文件定义前后端共用的接口与数据格式。服务默认地址为 `http://127.0.0.1:8787`，路径前缀为 `/api`。开发前端使用端口 5173，并通过 Vite 将 `/api` 转发至后端。JSON 字段使用 `snake_case`，标识使用 UUID，时间使用 RFC 3339。

## 配置与错误

`GET /api/health` 返回服务、数据库和凭据配置状态。`provider_configured` 表示本服务具备配置要求的客户端凭据；Router 的 OAuth 授权及模型可用性通过实际请求确认。`GET /api/models` 返回经过允许列表过滤的模型目录与默认模型。当前通道为本机 Router OAuth，模型标识 `cc/gemini-3.8-flash-high`。前端模型选择来自该目录。

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
  status: "analogy" | "candidate" | "verified";
  conditions: string; counterexamples: string; sources: string[];
};
type Relation = {
  id: string; workspace_id: string; source_id: string; target_id: string;
  kind: string; label: string; include_in_context: boolean;
  context_order: number; claim: Claim | null; created_at: string;
};
```

`CanvasObject` 引用统一文稿；同一文稿可在多张画布中出现。原生绘图、框、笔迹和编辑器布局保存在画布 `editor_state`。`Relation` 连接文稿或讨论文稿。自由关系默认 `include_in_context=false`；参与上下文的关系具有方向，后端拒绝其形成循环。

| 方法与路径 | 输入及结果 |
| --- | --- |
| `POST /workspaces/{id}/canvases` | `{name}` → 画布 |
| `GET /canvases/{id}` | 画布 |
| `PUT /canvases/{id}` | `{expected_revision, name, objects, editor_state?}` → 更新后的画布 |
| `POST /workspaces/{id}/relations` | `{source_id,target_id,kind?,label?,include_in_context?,context_order?,claim?}` → 关系 |
| `PATCH /relations/{id}` | 上述可编辑关系字段的子集 → 关系 |
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
};
```

服务按参与上下文的入边遍历祖先，按连线 `context_order`、创建时间及标识排序并去重。响应包括 `id, workspace_id, mode, question, document_ids, anchor_ids, ordered_document_ids, sources, messages, character_count, created_at`。`sources` 的每项包含 `number, document_id, version, title, content, anchor_id, anchor_status`。整篇文稿使用预览时的版本；选段使用锚点所保存的历史版本，并展示当前定位状态。

`messages` 是实际发给模型的完整消息数组。上下文保存后保持固定；修改勾选材料或提问内容时重新生成预览。`GET /contexts/{id}` 可读取该快照。

`POST /workspaces/{id}/runs` 接收 `{context_id, model?, max_output_tokens?}`，立即返回运行记录。`GET /workspaces/{id}/runs` 返回该工作区的运行记录。`GET /runs/{id}` 返回当前运行状态，`POST /runs/{id}/cancel` 取消正在执行的运行。

```typescript
type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
type Run = {
  id: string; workspace_id: string; context_id: string; model: string;
  status: RunStatus; answer: string; model_used: string | null;
  usage: unknown | null; error: string | null;
  document_id: string | null; proposal_id: string | null;
  created_at: string; updated_at: string;
};
```

`GET /runs/{id}/events` 提供 SSE，事件名为 `progress`，数据为 `{sequence,run}`。`run.answer` 始终是累积全文，客户端以收到的全文替换当前文本。连接后先发送最新状态；终态为 `succeeded, failed, cancelled, interrupted`，客户端收到终态后关闭连接。重连读取最新状态，已有文本可保留。

讨论和关系分析成功后创建 `kind=discussion` 的文稿，并保存问题、模型、用量和上下文来源。返回的 `document_id` 可作为后续分支的材料，多个讨论文稿可共同作为新上下文的入口。前端通过用户操作将结果加入画布。

改写模式要求恰好一个锚点，成功后返回 `proposal_id`。此时原文保持原版本，前端显示修改预览。

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

PDF 保留原始文件，提取每页文本作为独立文本块并记录页码。完整归档的 `format_version=1`，包括 `workspace,documents,versions,canvases,relations,anchors,contexts,runs,proposals,assets`。其中资产使用 `data_base64` 保存。导出文稿中的 AI 内容保留模型、运行和上下文来源。
