# Research Canvas 后端联调接口

本文定义画布前端与 Rust 服务的接入数据。基础接口见 [api.md](api.md)。开发服务默认使用 `http://127.0.0.1:8787/api`；独立验收实例使用项目内单独数据库。

## 能力与调用顺序

`GET /capabilities` 提供 `scene_context`、`frozen_inheritance`、`canvas_proposals`、`canvas_proposal_recovery`、`claim_reviews`、`claim_research_plan`、`relation_endpoints`。值为正整数或 `true` 时可使用对应能力。`canvas_proposals=2` 支持结构化工具输出与片段、场景端点。未知 API 返回 JSON 404。

画布讨论先保存本地修改，再从已保存的编辑状态提取场景与材料清单，调用 `POST /workspaces/{id}/scene-contexts`。预览展示响应中的 `sources`、`scenes`、`messages`。发送调用原有 `POST /workspaces/{id}/runs`，引用该 `context_id`。材料、版本、选择、问题或写入区域变化后重新生成预览。

## 接收现有前端场景投影

前端 `src/research/editor/scene.ts` 的 `SceneProjection` 和 `src/web/app/materials.ts` 的 `Material[]` 可以直接作为以下请求的字段：

```typescript
type SceneContextRequest = {
  question: string;
  mode: 'discussion' | 'relation' | 'canvas';
  projection: SceneProjection;
  materials: Material[];
  write_scope?: {
    allow_create: boolean;
    object_ids: string[];
    bounds?: {x: number; y: number; width: number; height: number} | null;
  };
};
```

`projection.canvas_revision` 必须等于服务端当前画布版本。`materials` 中的 `include` 决定阅读范围：整篇材料按投影的文稿版本读取，锚点按历史片段读取，自由想法读取对应编辑器文字，研究关系正文从数据库取得。历史全文从讨论保存的上下文读取。文稿卡片的位置、连线端点和分组可以单独选入。

后端将前端投影转换成 `scenes` 中的冻结对象。每个对象记录 `id,kind,bounds,rotation,parent_ids,child_ids,document_id,version,anchor_id,relation_id,source_id,target_id,source_point,target_point,label,text,formulas,read_scope,unreadable`。对象的 `bounds` 可为 null；有位置时使用世界坐标。文稿与片段正文集中在 `sources`，自由对象正文保存在场景对象中。视口、选择入口及写入范围一同保存。

`write_scope.allow_create` 允许创建文稿及候选关系，`object_ids` 指定允许移动或改写的实例。将前端 `region` 转成 `bounds` 时传入矩形的四个字段，旋转值继续保存在场景布局中。

接口也接受独立客户端使用的规范化请求：`{question,mode,canvas_id,expected_revision,objects,write_scope,document_ids?,anchor_ids?,inherit_context_ids?,frozen_sources?,inherit_discussion_sources?,viewport?,entry?}`。其 `objects` 使用上述冻结对象字段；`read_scope` 可为 `reference`、`excerpt`、`full`、`inline`。`excerpt` 需要 `anchor_id`，`full` 需要 `document_id`，`inline` 用于编辑器自由内容。全文可附显式 `version`。规范化请求默认继承选入讨论的来源，逐项材料投影按用户的勾选读取。

## 画布提案与编辑器状态

`mode=canvas` 通过 `submit_canvas` 工具提交结构化操作，运行返回 `canvas_proposal_id`。流式阶段的 `run.answer` 是工具参数 JSON 草稿，应按生成进度展示；运行成功后的 `run.answer` 为分析正文。此时通过 `GET /canvas-proposals/{id}` 读取完整操作。

工具参数按 `create_documents`、`move_objects`、`replace_excerpts`、`create_relations` 四个数组提交，使用严格 JSON Schema。后端将工具参数转换为下述统一 `actions` 格式。流式草稿中的 `answer`、`title`、`label` 字段保留原名，完成后的提案接口使用统一操作类型。

Markdown 公式使用普通 LaTeX 字符串。工具声明与提示词要求命令保留单个反斜杠，矩阵换行保留两个反斜杠。生成完成后，后端通过 Markdown 解析器定位公式；对反斜杠一致重复转义且修正后能通过 LaTeX 解析的片段执行归一化。代码块、行内代码、正文中的字面反斜杠和正常公式保留原文。前端继续按 Markdown 和 LaTeX 渲染返回内容。

新提案的分析、正文和研究说明在保存前完成上述处理。已有画布运行与提案的分析正文在读取时提供修正后的显示文本，原存储记录及 `raw_response` 保留。用户已编辑的文稿和提案操作继续使用各自保存的内容。

```typescript
type Bounds = {x: number; y: number; width: number; height: number};
type Endpoint =
  | {type: 'document'; id: string}
  | {type: 'created'; key: string}
  | {type: 'anchor'; id: string}
  | {type: 'scene'; object_id: string};
type CanvasAction =
  | {type: 'create_document'; key: string; title: string; text: string;
     kind: 'note' | 'discussion'; bounds: Bounds;
     source_numbers?: number[]; source_object_ids?: string[]}
  | {type: 'move_object'; object_id: string; bounds: Bounds}
  | {type: 'replace_excerpt'; anchor_id: string; expected_version: number; replacement: string}
  | {type: 'create_relation'; key: string; source: Endpoint; target: Endpoint;
     label: string; mapping?: string; preserved_operations?: string[];
     conditions?: string; counterexamples?: string; missing_proof?: string;
     next_validation?: string; source_numbers?: number[]};

type CanvasProposal = {
  id: string; workspace_id: string; run_id: string; context_id: string;
  canvas_id: string; canvas_revision: number; revision: number;
  status: 'pending' | 'applied' | 'reverted' | 'rejected';
  answer: string; actions: CanvasAction[]; id_map: Record<string, string>;
  created_at: string; transaction_id: string | null; applied_revision: number | null;
};
```

`id_map[key]` 是新文稿或新关系的正式标识；新文稿的画布实例标识为 `id_map[key + ':object']`。标识在确认前分配，预览和编辑状态物化共同使用。`source_numbers` 对应冻结上下文中的材料编号，`source_object_ids` 对应所选自由想法或其他场景实例。`anchor` 端点使用精确锚点，`scene` 端点使用本次场景中的实例标识；片段实例解析为锚点，文稿实例解析为文稿，自由想法保留冻结场景引用。

预览和隔离编辑副本的连线定位应处理全部端点类型。`scene.object_id` 可直接定位编辑器实例；`anchor.id` 通过当前画布的 `fragments` 查找实例；文稿通过卡片引用定位。关系的语义端点与 `link_views` 的视觉端点分别保存。

前端在隔离的编辑副本中按操作创建或移动对象，生成应用后的完整 `editor_state`。既有画布包含 Yjs 状态时，应用请求必须附带该状态；自由对象、分组、连线和隐藏记录都保留在这个完整状态中。后端检查状态格式、范围、引用和版本，并在一次 SQLite 事务中保存正式文稿、关系与画布状态。Yjs 的生成、对象绑定和正文投影由前端编辑适配层负责。

后端创建关系时返回关系标识，前端按 `id_map` 在预览副本中生成相应连线并写入 `link_views`。源文稿引用沿用已有 CanvasObject，新增文稿实例按提案标识放置。编辑器状态原本为空的纯文稿卡片画布可以省略 `editor_state`，沿用现有按 `Canvas.objects` 重建的行为。

| 方法与路径 | 请求与结果 |
| --- | --- |
| `GET /canvas-proposals/{id}` | 返回提案、稳定标识和状态 |
| `PATCH /canvas-proposals/{id}` | `{expected_revision,actions,expected_canvas_revision?}`；校验完整操作集合及其引用，返回递增 revision 的提案 |
| `POST /canvas-proposals/{id}/apply` | `{expected_revision,expected_canvas_revision,editor_state?}`；原子应用，返回提案、事务、画布、文稿和关系 |
| `POST /canvas-proposals/{id}/revert` | `{expected_revision,expected_canvas_revision}`；撤销该事务，返回恢复后的状态与移除标识 |
| `POST /canvas-proposals/{id}/reject` | `{expected_revision}`；保存拒绝状态 |

应用和撤销响应为 `{proposal,transaction_id,canvas,documents,relations,removed_document_ids,removed_relation_ids}`。应用成功后采用返回的服务端版本，更新编辑会话并恢复自动保存。同一提案的重复应用返回原事务结果。重新读取应用结果时，前端还应保留当前会话中比响应更新的版本。

旧画布版本提交返回 409。用户审阅布局变化后，可以用 PATCH 的 `expected_canvas_revision` 确认当前目标版本，调整已有操作并再次应用；模型输出和冻结阅读来源继续保留。改写仍检查实际文稿版本。整组撤销要求相关对象保持应用后的版本；新建文稿若已有后续引用，返回 `dependent_changes`，保留现状。

## 研究关系和人工确认

界面状态对应如下：

| 显示 | API 值 |
| --- | --- |
| 启发 | `analogy` |
| 候选 | `candidate` |
| 有支持 | `supported` |
| 已确立 | `established` |
| 被反驳 | `refuted` |

历史值 `verified` 可读取，新的人工确认会转换成 `established`。缺少确认记录的历史验证标签会返回 `review_required=true`。

`Claim` 在既有字段外增加 `mapping`、`preserved_operations`、`revision`、`reviews`、`review_required`。创建候选关系时这些字段可按需填写。编辑已有研究关系时提交 `expected_claim_revision`；存在人工确认记录时该字段必填，版本冲突返回 409。编辑研究内容会递增版本并使既有确认进入待复核状态。

`missing_proof: string` 保存尚缺论证和文献证据，`next_validation: string` 保存下一步验证方法。旧记录默认空字符串。两项通过既有关系创建和更新接口保存，也包含在 AI 候选关系操作中。

关系创建、更新支持以下类型化引用：

```typescript
type ResearchEndpoint =
  | {type: 'document'; id: string}
  | {type: 'anchor'; id: string}
  | {type: 'canvas_object'; context_id: string; canvas_id: string; instance_id: string};
```

请求使用 `source_ref`、`target_ref`，响应返回相同字段以及服务端确定的 `source_id`、`target_id`。旧文稿请求继续支持两个标识字段。自由想法端点引用明确的场景快照，保留当时的正文和版本；创建关系前可先预览场景，整个过程可以由用户直接完成。端点所属工作区由后端核对。场景中片段对象的 `id`、`anchor_id`、`document_id`、`version` 和布局共同表达画布实例，定位范围也保留锚点标识。

具有类型化引用的关系，前端按 `source_ref`、`target_ref` 解析内容类型。旧的 `source_id`、`target_id` 是对应端点的标识，包含自由场景端点时应作为不透明字符串使用。视觉线的删除继续遵循独立视图规则。

历史失败画布运行可通过 `POST /runs/{id}/recover-canvas-proposal` 从原输出恢复提案。单个 JSON 代码块由 Markdown 解析库提取，JSON 内容继续经过结构和范围校验。提案的归档记录保留 `raw_response` 和 `recovered_from`。存在非法 JSON 转义等内容错误时，恢复接口返回具体错误，前端可使用原 `context_id` 发起结构化运行。

```typescript
type EvidenceRef = {
  document_id: string; version: number; anchor_id?: string | null;
  role: 'support' | 'derivation' | 'counterexample'; note: string;
};
type ClaimReview = {
  claim_revision: number; status: string; evidence: EvidenceRef[];
  reason: string; confirmed_at: string; confirmed_by: 'local_user';
};
type ReviewRequest = {
  expected_claim_revision: number;
  status: 'analogy' | 'candidate' | 'supported' | 'established' | 'refuted';
  evidence: EvidenceRef[]; reason: string; confirmed: true;
};
```

通过 `POST /relations/{id}/review` 提交人工确认，响应为最新 `Relation`。`supported` 和 `established` 需要支持或论证证据，`refuted` 需要反例证据；服务核对来源工作区、历史版本和锚点。判断依据与确认时间随记录保存。`local_user` 表示本机界面的确认操作。

来源更新后，关系读取会返回 `review_required=true`，并保留原状态、证据版本和确认记录。前端同时展示原判断和待复核提示。数学或科学结论由研究者根据论证确认，服务校验的是记录及来源的一致性。

## 运行与验收

构建安装使用 `bash scripts/backend.sh build`，启动使用 `bash scripts/backend.sh start`。前端继续通过同源 `/api` 调用。画布模式提示词为 `config/prompts/canvas.txt`，通过服务配置的 `[prompts].canvas` 载入。

`tests/canvas_acceptance.py` 使用用户提供的七页产品共识 PDF 与实际模型响应，按 `contexts`、`proposals`、`reviews`、`projection`、`archive`、`undo_evidence`、`archive_scope` 分阶段执行。结果保存在 `.runtime/canvas-acceptance.json`；已成功的阶段复用记录。`tests/canvas_handoff_acceptance.py` 使用前端验收中保存的失败输出、片段和想法验证解析恢复及类型化端点。归档格式为 3，保留场景、画布提案、研究计划字段及人工确认记录。
