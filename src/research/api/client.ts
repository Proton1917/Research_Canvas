import type {
  Anchor, AnchorResolution, ApiErrorBody, Canvas, CanvasAction, CanvasProposal, CanvasProposalResult, Capabilities, ReviewRequest, SceneContextRequest, CanvasObject, ContextRequest, Content, DocumentKind,
  DocumentMetadata, DocumentVersion, Health, ImportResult, ModelCatalog, Proposal, ProposalResult, Relation,
  RelationInput, ResearchContext, ResearchDocument, Run, RunProgress, RunPlacementResult, Bounds, VisualAsset, SearchHit, Workspace, WorkspaceSummary,
  Project, ProjectSummary, ProjectTree, ProjectImportResult, ImportCapabilities,
} from './types';
import { TERMINAL_RUN_STATUSES } from './types';

/** 服务返回的业务错误，或网络层错误（status = 0）。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get isConflict() { return this.status === 409; }
  get isNetwork() { return this.status === 0; }
  get currentVersion(): number | undefined {
    const value = this.details.current_version;
    return typeof value === 'number' ? value : undefined;
  }
}

const BASE = '/api';

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (error) {
    throw new ApiError(0, 'network', `无法连接后端服务：${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    if (error) throw new ApiError(response.status, error.code, error.message, error.details ?? {});
    const proxyDown = response.status >= 500 && !text ? '（后端服务未响应）' : '';
    throw new ApiError(response.status, 'http_error', `请求失败：HTTP ${response.status}${proxyDown}${text && !body ? ` ${text.slice(0, 200)}` : ''}`);
  }
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<Health>('/health'),
  /** 能力发现；旧服务返回 404，调用方按“尚未接通”处理。 */
  capabilities: async (): Promise<Capabilities | null> => {
    try {
      // 当前服务的未知 /api 路径会落到界面静态文件的回退页（200 HTML），非 JSON 对象同样视为未接通
      const body = await request<unknown>('/capabilities');
      return body && typeof body === 'object' && !Array.isArray(body) ? (body as Capabilities) : null;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  },
  models: () => request<ModelCatalog>('/models'),

  listWorkspaces: () => request<Workspace[]>('/workspaces'),
  createWorkspace: (name: string) => request<Workspace>('/workspaces', { method: 'POST', json: { name } }),
  getWorkspace: (id: string, options: { projectDocuments?: boolean } = {}) => request<WorkspaceSummary>(`/workspaces/${enc(id)}${options.projectDocuments === false ? '?project_documents=false' : ''}`),
  renameWorkspace: (id: string, name: string) => request<Workspace>(`/workspaces/${enc(id)}`, { method: 'PATCH', json: { name } }),

  createDocument: (workspaceId: string, input: { title: string; kind?: DocumentKind; content: Content; metadata?: DocumentMetadata }) =>
    request<ResearchDocument>(`/workspaces/${enc(workspaceId)}/documents`, { method: 'POST', json: input }),
  getDocument: (id: string) => request<ResearchDocument>(`/documents/${enc(id)}`),
  updateDocument: (id: string, input: { expected_version: number; title?: string; content?: Content; metadata?: DocumentMetadata }) =>
    request<ResearchDocument>(`/documents/${enc(id)}`, { method: 'PATCH', json: input }),
  listVersions: (id: string) => request<DocumentVersion[]>(`/documents/${enc(id)}/versions`),
  getVersion: (id: string, version: number) => request<DocumentVersion>(`/documents/${enc(id)}/versions/${version}`),
  restoreVersion: (id: string, expected_version: number, version: number) =>
    request<ResearchDocument>(`/documents/${enc(id)}/restore`, { method: 'POST', json: { expected_version, version } }),

  createCanvas: (workspaceId: string, name: string) => request<Canvas>(`/workspaces/${enc(workspaceId)}/canvases`, { method: 'POST', json: { name } }),
  getCanvas: (id: string) => request<Canvas>(`/canvases/${enc(id)}`),
  updateCanvas: (id: string, input: { expected_revision: number; name: string; objects: CanvasObject[]; editor_state?: unknown }) =>
    request<Canvas>(`/canvases/${enc(id)}`, { method: 'PUT', json: input }),

  /** 文稿端点可只给 source_id / target_id；片段与自由想法使用 source_ref / target_ref */
  createRelation: (workspaceId: string, input: RelationInput) =>
    request<Relation>(`/workspaces/${enc(workspaceId)}/relations`, { method: 'POST', json: input }),
  updateRelation: (id: string, input: RelationInput) => request<Relation>(`/relations/${enc(id)}`, { method: 'PATCH', json: input }),
  deleteRelation: (id: string) => request<void>(`/relations/${enc(id)}`, { method: 'DELETE' }),
  getRelation: (id: string) => request<Relation>(`/relations/${enc(id)}`),
  reviewRelation: (id: string, input: ReviewRequest) => request<Relation>(`/relations/${enc(id)}/review`, { method: 'POST', json: input }),

  createAnchor: (workspaceId: string, input: { document_id: string; version: number; block_id: string; quote: string; start_utf16?: number }) =>
    request<Anchor>(`/workspaces/${enc(workspaceId)}/anchors`, { method: 'POST', json: input }),
  getAnchor: (id: string) => request<Anchor>(`/anchors/${enc(id)}`),
  resolveAnchor: (id: string) => request<AnchorResolution>(`/anchors/${enc(id)}/resolve`),

  createContext: (workspaceId: string, input: ContextRequest) =>
    request<ResearchContext>(`/workspaces/${enc(workspaceId)}/contexts`, { method: 'POST', json: input }),
  getContext: (id: string) => request<ResearchContext>(`/contexts/${enc(id)}`),
  createSceneContext: (workspaceId: string, input: SceneContextRequest) =>
    request<ResearchContext>(`/workspaces/${enc(workspaceId)}/scene-contexts`, { method: 'POST', json: input }),

  getCanvasProposal: (id: string) => request<CanvasProposal>(`/canvas-proposals/${enc(id)}`),
  updateCanvasProposal: (id: string, input: { expected_revision: number; actions: CanvasAction[]; expected_canvas_revision?: number }) =>
    request<CanvasProposal>(`/canvas-proposals/${enc(id)}`, { method: 'PATCH', json: input }),
  applyCanvasProposal: (id: string, input: { expected_revision: number; expected_canvas_revision: number }) =>
    request<CanvasProposalResult>(`/canvas-proposals/${enc(id)}/apply`, { method: 'POST', json: input }),
  revertCanvasProposal: (id: string, input: { expected_revision: number; expected_canvas_revision: number }) =>
    request<CanvasProposalResult>(`/canvas-proposals/${enc(id)}/revert`, { method: 'POST', json: input }),
  rejectCanvasProposal: (id: string, input: { expected_revision: number }) =>
    request<CanvasProposal>(`/canvas-proposals/${enc(id)}/reject`, { method: 'POST', json: input }),

  startRun: (workspaceId: string, input: { context_id: string; model?: string; max_output_tokens?: number }) =>
    request<Run>(`/workspaces/${enc(workspaceId)}/runs`, { method: 'POST', json: input }),
  listRuns: (workspaceId: string) => request<Run[]>(`/workspaces/${enc(workspaceId)}/runs`),
  getRun: (id: string) => request<Run>(`/runs/${enc(id)}`),
  cancelRun: (id: string) => request<Run>(`/runs/${enc(id)}/cancel`, { method: 'POST' }),
  placeRun: (id: string, input: { expected_canvas_revision: number; bounds?: Bounds }) =>
    request<RunPlacementResult>(`/runs/${enc(id)}/place`, { method: 'POST', json: input }),
  /** 从失败画布运行的原输出恢复提案；JSON 内容无效时返回具体错误 */
  recoverCanvasProposal: (id: string) => request<Run>(`/runs/${enc(id)}/recover-canvas-proposal`, { method: 'POST' }),

  getProposal: (id: string) => request<Proposal>(`/proposals/${enc(id)}`),
  applyProposal: (id: string, expected_version: number) => request<ProposalResult>(`/proposals/${enc(id)}/apply`, { method: 'POST', json: { expected_version } }),
  revertProposal: (id: string, expected_version: number) => request<ProposalResult>(`/proposals/${enc(id)}/revert`, { method: 'POST', json: { expected_version } }),
  rejectProposal: (id: string) => request<Proposal>(`/proposals/${enc(id)}/reject`, { method: 'POST' }),

  importFile: (workspaceId: string, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<ImportResult>(`/workspaces/${enc(workspaceId)}/imports`, { method: 'POST', body: form });
  },
  importCapabilities: () => request<ImportCapabilities>('/imports/capabilities'),
  createProject: (workspaceId: string, name: string) => request<Project>(`/workspaces/${enc(workspaceId)}/projects`, { method: 'POST', json: { name } }),
  listProjects: (workspaceId: string) => request<ProjectSummary[]>(`/workspaces/${enc(workspaceId)}/projects`),
  getProject: (id: string) => request<Project>(`/projects/${enc(id)}`),
  projectEntries: (id: string, options: { parent?: string; after?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (options.parent) query.set('parent', options.parent);
    if (options.after) query.set('after', options.after);
    if (options.limit != null) query.set('limit', String(options.limit));
    return request<ProjectTree>(`/projects/${enc(id)}/entries?${query}`);
  },
  importProjectFiles: (id: string, files: Array<{ file: File; path: string; expected_version?: number }>, directories: string[] = []) => {
    const form = new FormData();
    form.append('manifest', JSON.stringify({ directories, files: files.map((entry, index) => ({ field: String(index), path: entry.path, expected_version: entry.expected_version })) }));
    files.forEach((entry, index) => form.append(String(index), entry.file, entry.file.name));
    return request<ProjectImportResult>(`/projects/${enc(id)}/imports`, { method: 'POST', body: form });
  },
  assetUrl: (id: string) => `${BASE}/assets/${enc(id)}`,
  uploadVisual: (workspaceId: string, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<VisualAsset>(`/workspaces/${enc(workspaceId)}/visual-assets`, { method: 'POST', body: form });
  },
  listVisualAssets: (workspaceId: string) => request<VisualAsset[]>(`/workspaces/${enc(workspaceId)}/visual-assets`),
  discardVisual: (workspaceId: string, id: string) => request<void>(`/workspaces/${enc(workspaceId)}/visual-assets/${enc(id)}`, { method: 'DELETE' }),
  fetchAsset: async (id: string) => {
    const response = await fetch(`${BASE}/assets/${enc(id)}`);
    if (!response.ok) throw new ApiError(response.status, 'asset', `资产读取失败：HTTP ${response.status}`);
    return response.blob();
  },
  search: (workspaceId: string, q: string, limit = 20) =>
    request<SearchHit[]>(`/workspaces/${enc(workspaceId)}/search?q=${enc(q)}&limit=${limit}`),
  exportJsonUrl: (workspaceId: string) => `${BASE}/workspaces/${enc(workspaceId)}/export`,
  exportZipUrl: (workspaceId: string) => `${BASE}/workspaces/${enc(workspaceId)}/export.zip`,
  importArchive: (archive: unknown) => request<Workspace>('/workspaces/import', { method: 'POST', json: archive }),
};

/**
 * 订阅运行状态。服务端每次发送累积全文；收到终态后关闭连接。
 * 连接中断时按退避间隔重连，重连后先收到最新状态。
 */
export function subscribeRun(runId: string, onProgress: (progress: RunProgress) => void, onConnection?: (state: 'open' | 'retrying') => void) {
  let source: EventSource | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (closed) return;
    source = new EventSource(`${BASE}/runs/${enc(runId)}/events`);
    source.onopen = () => { retry = 0; onConnection?.('open'); };
    source.addEventListener('progress', event => {
      const progress = JSON.parse((event as MessageEvent<string>).data) as RunProgress;
      onProgress(progress);
      if (TERMINAL_RUN_STATUSES.includes(progress.run.status)) close();
    });
    source.onerror = () => {
      source?.close();
      if (closed) return;
      onConnection?.('retrying');
      retry += 1;
      timer = setTimeout(connect, Math.min(8000, 500 * 2 ** Math.min(retry, 4)));
    };
  };
  const close = () => {
    closed = true;
    if (timer) clearTimeout(timer);
    source?.close();
  };
  connect();
  return close;
}
