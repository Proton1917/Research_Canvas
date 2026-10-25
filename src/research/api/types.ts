// 与 docs/api.md 对应的接口数据类型；字段保持 snake_case。
export type TextBlock = { id: string; text: string; page?: number | null };

/** 前端写入的 editor_state 结构；后端将其作为不透明 JSON 保存。 */
export type EditorStateEnvelope = {
  format: 'blocksuite-yjs-v1';
  /** Y.encodeStateAsUpdate 的 Base64 编码 */
  update: string;
  /** 编辑器内图片的内容摘要键 → 后端资产标识 */
  assets?: Record<string, string>;
  /** 旧版画布连线标识 → 工作区关系标识（仅画布；读取时迁移为 link_views） */
  links?: Record<string, string>;
  /** 画布前端视图结构版本；2 起使用 link_views、hidden_relations 与 fragments */
  view_version?: number;
  /** 视觉连线实例：连线标识 → 视图记录（仅画布） */
  link_views?: Record<string, LinkView>;
  /** 本画布隐藏的研究关系；同步时不再为其生成连线（仅画布） */
  hidden_relations?: string[];
  /** 片段卡片：编辑器块标识 → 引用的锚点（仅画布） */
  fragments?: Record<string, FragmentCard>;
};

/** 画布中一条视觉连线的显示与绑定记录。研究关系可以对应零个或多个视图。 */
export type LinkView = {
  view_id: string;
  /** 编辑器连线元素标识 */
  connector_id: string;
  /** 绑定的研究关系；纯视觉连线或改接后解除绑定时为 null */
  relation_id: string | null;
  /** 两端实例（编辑器块或元素标识），自由端点为 null */
  source_instance: string | null;
  target_instance: string | null;
  /** 改接前绑定的关系，用于界面说明来源 */
  detached_from?: string | null;
  created_at: string;
};

/** 画布中的片段卡片：内容引用锚点的历史版本，布局属于画布实例。 */
export type FragmentCard = { anchor_id: string; document_id: string; version: number };

export type Content = {
  blocks: TextBlock[];
  markdown?: string | null;
  editor_state?: unknown | null;
};

export type DocumentKind = 'document' | 'note' | 'discussion' | 'pdf' | 'image';

export type Workspace = { id: string; name: string; created_at: string; updated_at: string };

export type DocumentMetadata = {
  source_asset_id?: string;
  source_filename?: string;
  question?: string;
  model?: string | null;
  run_id?: string;
  context_id?: string;
  usage?: Usage | null;
  [key: string]: unknown;
};

export type ResearchDocument = {
  id: string;
  workspace_id: string;
  title: string;
  kind: DocumentKind;
  current_version: number;
  metadata: DocumentMetadata;
  content: Content;
  created_at: string;
  updated_at: string;
};

export type DocumentVersion = {
  document_id: string;
  version: number;
  title: string;
  content: Content;
  created_at: string;
  reason: string;
};

export type CanvasObject = { id: string; document_id: string; x: number; y: number; width: number; height: number };

export type Canvas = {
  id: string;
  workspace_id: string;
  name: string;
  revision: number;
  objects: CanvasObject[];
  editor_state: unknown | null;
  updated_at: string;
};

/** 研究状态；历史值 verified 可读取，新的人工确认转换为 established。 */
export type ClaimStatus = 'analogy' | 'candidate' | 'supported' | 'established' | 'refuted' | 'verified';
export type EvidenceRole = 'support' | 'derivation' | 'counterexample';
export type EvidenceRef = { document_id: string; version: number; anchor_id?: string | null; role: EvidenceRole; note: string };
export type ClaimReview = {
  claim_revision: number; status: ClaimStatus; evidence: EvidenceRef[];
  reason: string; confirmed_at: string; confirmed_by: string;
};
export type Claim = {
  status: ClaimStatus; conditions: string; counterexamples: string; sources: string[];
  mapping?: string; preserved_operations?: string[];
  /** 服务端维护的版本、确认记录与待复核标记 */
  revision?: number; reviews?: ClaimReview[]; review_required?: boolean;
};
export type ReviewRequest = {
  expected_claim_revision: number;
  status: Exclude<ClaimStatus, 'verified'>;
  evidence: EvidenceRef[];
  reason: string;
  confirmed: true;
};

export type Relation = {
  id: string;
  workspace_id: string;
  source_id: string;
  target_id: string;
  kind: string;
  label: string;
  include_in_context: boolean;
  context_order: number;
  claim: Claim | null;
  created_at: string;
};

export type RelationInput = Partial<Pick<Relation, 'source_id' | 'target_id' | 'kind' | 'label' | 'include_in_context' | 'context_order' | 'claim'>> & {
  /** 编辑已有研究关系时提交；存在人工确认记录时必填 */
  expected_claim_revision?: number;
};

export type Anchor = {
  id: string;
  workspace_id: string;
  document_id: string;
  version: number;
  block_id: string;
  quote: string;
  start_utf16: number;
  prefix: string;
  suffix: string;
  page: number | null;
  created_at: string;
};

export type AnchorStatus = 'exact' | 'relocated' | 'changed' | 'missing' | 'ambiguous';

export type AnchorResolution = {
  anchor: Anchor;
  status: AnchorStatus;
  current_version: number;
  block_id: string | null;
  start_utf16: number | null;
  end_utf16: number | null;
};

export type WorkspaceSummary = {
  workspace: Workspace;
  documents: ResearchDocument[];
  canvases: Canvas[];
  relations: Relation[];
  anchors: Anchor[];
};

export type ResearchMode = 'discussion' | 'rewrite' | 'relation' | 'canvas';

export type ContextRequest = {
  question: string;
  mode?: ResearchMode;
  document_ids?: string[];
  anchor_ids?: string[];
};

export type ContextSource = {
  number: number;
  document_id: string;
  version: number;
  title: string;
  content: string;
  anchor_id: string | null;
  anchor_status: AnchorStatus | null;
};

export type ChatMessage = { role: string; content: string };

export type ResearchContext = {
  id: string;
  workspace_id: string;
  mode: ResearchMode;
  question: string;
  document_ids: string[];
  anchor_ids: string[];
  ordered_document_ids: string[];
  sources: ContextSource[];
  inherited_context_ids?: string[];
  /** 冻结的画布场景（场景上下文） */
  scenes?: SceneSnapshot[];
  messages: ChatMessage[];
  character_count: number;
  created_at: string;
};

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled', 'interrupted'];

export type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  finish_reason?: string;
  [key: string]: unknown;
};

export type Run = {
  id: string;
  workspace_id: string;
  context_id: string;
  model: string;
  status: RunStatus;
  answer: string;
  model_used: string | null;
  usage: Usage | null;
  error: string | null;
  document_id: string | null;
  proposal_id: string | null;
  canvas_proposal_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type RunProgress = { sequence: number; run: Run };

export type ProposalStatus = 'pending' | 'applied' | 'reverted' | 'rejected';

export type Proposal = {
  id: string;
  workspace_id: string;
  run_id: string;
  anchor_id: string;
  replacement: string;
  status: ProposalStatus;
  applied_version: number | null;
  previous_version: number | null;
  created_at: string;
};

export type ProposalResult = { proposal: Proposal; document: ResearchDocument };

export type ImportedAsset = { id: string; filename: string; media_type: string; byte_length: number; url: string };
export type ImportResult = { document: ResearchDocument; asset: ImportedAsset };

export type SearchHit = { document_id: string; title: string; version: number; score: number; excerpt: string };

export type Health = {
  service: string;
  api_version: number;
  database: string;
  provider_configured: boolean;
  default_model: string;
};

export type ModelEntry = {
  id: string;
  name?: string;
  context_length?: number | null;
  [key: string]: unknown;
};

export type ModelCatalog = {
  default_model: string;
  models: ModelEntry[];
  [key: string]: unknown;
};

/**
 * `GET /api/capabilities` 的能力声明（docs/canvas-collaboration.md 的建议契约）。
 * 服务返回 404 时表示相应能力尚未接通，前端据此显示缺项；字段以 docs/api.md 实际记录为准。
 */
export type Capabilities = {
  scene_context?: number | boolean;
  frozen_inheritance?: boolean;
  canvas_proposals?: number | boolean;
  [key: string]: unknown;
};

// ---------------------------------------------------------------- 场景上下文与画布提案（docs/backend-integration.md）
export type Bounds = { x: number; y: number; width: number; height: number };

export type SceneSnapshotObject = {
  id: string; kind: string; bounds: Bounds | null; rotation: number;
  parent_ids: string[]; child_ids: string[];
  document_id: string | null; version: number | null; anchor_id: string | null; relation_id: string | null;
  source_id: string | null; target_id: string | null;
  source_point: [number, number] | null; target_point: [number, number] | null;
  label: string; text: string; formulas: string[];
  read_scope: 'reference' | 'excerpt' | 'full' | 'inline';
  unreadable: string | null;
};

export type WriteScope = { allow_create: boolean; object_ids: string[]; bounds?: Bounds | null };

export type SceneSnapshot = {
  canvas_id: string; revision: number; objects: SceneSnapshotObject[]; relations: Relation[];
  write_scope: WriteScope; viewport?: unknown; entry?: string | null;
};

/** 前端投影与材料清单直接提交；materials 的 include 决定阅读范围。 */
export type SceneContextRequest = {
  question: string;
  mode: 'discussion' | 'relation' | 'canvas';
  projection: unknown;
  materials: unknown[];
  write_scope?: WriteScope;
};

export type ProposalEndpoint = { type: 'document'; id: string } | { type: 'created'; key: string };

export type CanvasAction =
  | { type: 'create_document'; key: string; title: string; text: string; kind: 'note' | 'discussion'; bounds: Bounds; source_numbers?: number[]; source_object_ids?: string[] }
  | { type: 'move_object'; object_id: string; bounds: Bounds }
  | { type: 'replace_excerpt'; anchor_id: string; expected_version: number; replacement: string }
  | {
    type: 'create_relation'; key: string; source: ProposalEndpoint; target: ProposalEndpoint; label: string;
    mapping?: string; preserved_operations?: string[]; conditions?: string; counterexamples?: string; source_numbers?: number[];
  };

export type CanvasProposalStatus = 'pending' | 'applied' | 'reverted' | 'rejected';

export type CanvasProposal = {
  id: string; workspace_id: string; run_id: string; context_id: string;
  canvas_id: string; canvas_revision: number; revision: number;
  status: CanvasProposalStatus;
  answer: string; actions: CanvasAction[]; id_map: Record<string, string>;
  created_at: string; transaction_id: string | null; applied_revision: number | null;
};

export type CanvasProposalResult = {
  proposal: CanvasProposal;
  transaction_id: string;
  canvas: Canvas;
  documents: ResearchDocument[];
  relations: Relation[];
  removed_document_ids: string[];
  removed_relation_ids: string[];
};

export type ApiErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };
