// 与 docs/api.md 对应的接口数据类型；字段保持 snake_case。
export type TextBlock = { id: string; text: string; page?: number | null };

/** 前端写入的 editor_state 结构；后端将其作为不透明 JSON 保存。 */
export type EditorStateEnvelope = {
  format: 'blocksuite-yjs-v1';
  /** Y.encodeStateAsUpdate 的 Base64 编码 */
  update: string;
  /** 编辑器内图片的内容摘要键 → 后端资产标识 */
  assets?: Record<string, string>;
  /** 画布连线标识 → 工作区关系标识（仅画布） */
  links?: Record<string, string>;
};

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

export type ClaimStatus = 'analogy' | 'candidate' | 'verified';
export type Claim = { status: ClaimStatus; conditions: string; counterexamples: string; sources: string[] };

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

export type RelationInput = Partial<Pick<Relation, 'source_id' | 'target_id' | 'kind' | 'label' | 'include_in_context' | 'context_order' | 'claim'>>;

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

export type ResearchMode = 'discussion' | 'rewrite' | 'relation';

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

export type ApiErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };
