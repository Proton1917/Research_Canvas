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
  project_id?: string;
  relative_path?: string;
  file_format?: string;
  media_type?: string;
  byte_length?: number;
  text_status?: FileTextStatus;
  import_message?: string | null;
  import_details?: {
    sheets?: Array<{ name: string; rows: number; columns: number; start_row?: number; start_column?: string; formula_count: number }>;
    slides?: Array<{ number: number; title: string | null }>;
    legacy?: boolean;
    formula_values?: 'stored';
  };
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
  /** 尚缺论证与文献证据；下一步验证方法（旧记录为空字符串） */
  missing_proof?: string; next_validation?: string;
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

/** 研究关系的类型化端点：文稿、精确锚点或冻结场景中的自由想法。 */
export type ResearchEndpoint =
  | { type: 'document'; id: string }
  | { type: 'anchor'; id: string }
  | { type: 'canvas_object'; context_id: string; canvas_id: string; instance_id: string };

export type Relation = {
  id: string;
  workspace_id: string;
  /** 端点标识；含自由场景端点时为不透明字符串，内容类型按 source_ref / target_ref 解析 */
  source_id: string;
  target_id: string;
  source_ref?: ResearchEndpoint | null;
  target_ref?: ResearchEndpoint | null;
  kind: string;
  label: string;
  include_in_context: boolean;
  context_order: number;
  claim: Claim | null;
  created_at: string;
};

export type RelationInput = Partial<Pick<Relation, 'source_id' | 'target_id' | 'kind' | 'label' | 'include_in_context' | 'context_order' | 'claim'>> & {
  source_ref?: ResearchEndpoint;
  target_ref?: ResearchEndpoint;
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
  projects: Project[];
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
  /** 本轮直接选择材料时的文稿与画布版本；历史上下文为 null */
  freshness?: { documents: Record<string, number>; canvases: Record<string, number> } | null;
  /** 本轮的图像输入 */
  visuals?: SceneVisual[];
  origin?: RunOrigin | null;
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
  origin?: RunOrigin | null;
  placement?: { object_id: string; canvas_revision: number } | null;
  created_at: string;
  updated_at: string;
};

export type RunProgress = { sequence: number; run: Run };

export type RunOrigin = { canvas_id: string; source_ids: string[]; write_region: Bounds | null };
export type RunPlacementResult = { run: Run; canvas: Canvas };

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
export type VisualAsset = ImportedAsset & {
  created_at: string;
  references: Array<{ type: 'context' | 'document' | 'document_version' | 'canvas' | 'canvas_proposal'; id: string; version: number | null }>;
};
export type FileTextStatus = 'ready' | 'partial' | 'image' | 'empty' | 'attachment' | 'error';
export type ImportResult = { document: ResearchDocument; asset: ImportedAsset; text_status: FileTextStatus; message: string | null };

export type Project = { id: string; workspace_id: string; name: string; created_at: string; updated_at: string };
export type ProjectSummary = { project: Project; file_count: number; byte_length: number };
export type ProjectEntry = {
  project_id: string; path: string; parent_path: string; name: string;
  kind: 'file' | 'directory'; document_id: string | null; asset_id: string | null;
  media_type: string | null; byte_length: number; imported_version: number | null;
  text_status: FileTextStatus | 'directory'; message: string | null; updated_at: string;
};
export type ProjectTree = { project: Project; parent: string; entries: ProjectEntry[]; next_cursor: string | null };
export type ProjectImportResult = {
  project: Project;
  results: Array<
    { path: string; status: 'imported' | 'updated' | 'unchanged'; entry: ProjectEntry }
    | { path: string; status: 'conflict'; error: ApiErrorBody['error'] }
  >;
};
export type ImportCapabilities = {
  projects: boolean; relative_paths: boolean; batch_upload: boolean;
  max_request_bytes: number; max_archive_bytes: number; project_page_size: number; pdf_text: 'builtin';
  text_encodings: string[]; formats: string[];
};

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
  canvas_proposal_recovery?: number | boolean;
  canvas_proposal_materialization?: number | boolean;
  context_freshness?: number | boolean;
  optional_canvas_actions?: number | boolean;
  visual_inputs?: number | boolean;
  /** 支持图像输入的已配置模型 */
  vision_models?: string[];
  /** 本机配置的文本字符上限与图像字节上限；null 表示采用上游限制 */
  max_input_characters?: number | null;
  max_input_image_bytes?: number | null;
  claim_research_plan?: number | boolean;
  relation_endpoints?: number | boolean;
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
export type SceneVisual = { asset_id: string; object_ids: string[] };

export type SceneContextRequest = {
  question: string;
  mode: 'discussion' | 'relation' | 'canvas';
  projection: unknown;
  materials: unknown[];
  visuals?: SceneVisual[];
  write_scope?: WriteScope;
};

/** 上下文冻结后的材料版本变化（`GET /contexts/{id}/freshness` 与 409 stale_context 的详情） */
export type ContextChange =
  | { type: 'document'; id: string; expected_version: number; current_version: number }
  | { type: 'canvas'; id: string; expected_revision: number; current_revision: number };

export type ProposalEndpoint =
  | { type: 'document'; id: string }
  | { type: 'created'; key: string }
  /** 精确锚点：通过当前画布的片段卡片定位 */
  | { type: 'anchor'; id: string }
  /** 本次场景中的画布实例标识 */
  | { type: 'scene'; object_id: string };

export type CanvasAction =
  | { type: 'create_document'; key: string; title: string; text: string; kind: 'note' | 'discussion'; bounds: Bounds; source_numbers?: number[]; source_object_ids?: string[] }
  | { type: 'move_object'; object_id: string; bounds: Bounds }
  | { type: 'replace_excerpt'; anchor_id: string; expected_version: number; replacement: string }
  | {
    type: 'create_relation'; key: string; source: ProposalEndpoint; target: ProposalEndpoint; label: string;
    mapping?: string; preserved_operations?: string[]; conditions?: string; counterexamples?: string;
    missing_proof?: string; next_validation?: string; source_numbers?: number[];
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
