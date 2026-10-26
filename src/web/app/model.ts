// 应用状态与操作。所有数据来自后端接口；编辑器内容由 ResearchSession 管理。
import {
  api, ApiError, type Anchor, type AnchorResolution, type Canvas, type CanvasAction, type CanvasProposal, type CanvasProposalResult,
  type Capabilities, type Claim, type DocumentKind, type Health,
  type EditorStateEnvelope, type ModelCatalog, type Proposal, type Relation, type RelationInput, type ResearchContext, type ResearchDocument,
  type Bounds, type ContextChange, type ResearchEndpoint, type ResearchMode, type Run, subscribeRun, TERMINAL_RUN_STATUSES, type VisualAsset, type Workspace, type WorkspaceSummary,
} from '@research';
import {
  type ConnectorEnd, type LinkEvent, type PendingSave, relationEndpoint, ResearchSession, type SceneLayout, type SceneProjection, type SelectionTarget, setEditorColorScheme, setPrimaryMode,
} from '@research/editor';

import { createStore, useStore } from '../lib/store';
import {
  type ExpectedSource, expectedFromMaterials, inheritedSources, type Material,
} from './materials';

export type View =
  | { type: 'empty' }
  | { type: 'canvas'; id: string }
  | { type: 'document'; id: string; focus?: { anchorId: string } | null };

export type PanelTab = 'discuss' | 'anchors' | 'relations' | 'versions' | 'runs';

export type CanvasSelection =
  | { kind: 'card'; documentId: string; blockId: string }
  | { kind: 'relation'; relationId: string; connectorId: string }
  | { kind: 'link'; connectorId: string }
  | null;

export type Composer = {
  mode: ResearchMode;
  question: string;
  documentIds: string[];
  anchorIds: string[];
  /** 继续或合并的父讨论；用于展示冻结材料与核对实际范围 */
  parents: string[];
  /** 继承方式：父讨论问答（当前服务会展开来源全文）或仅父讨论的原片段 */
  inherit: 'discussion' | 'fragments';
  preview: ResearchContext | null;
  previewKey: string | null;
  busy: 'preview' | 'send' | null;
  error: string | null;
};

/** 画布就近提问：场景投影、材料选择、写入区域与本次运行。 */
export type CanvasAsk = {
  /** 提问会话：面板打开时建立，关闭时结束 */
  session: string;
  /** 会话内的输入代次：问题、勾选、选择、模式、写入区域、截图或所在画布变化时递增 */
  generation: number;
  canvasId: string;
  /** discussion：讨论框；canvas：可确认的画布操作提案 */
  mode: 'discussion' | 'canvas';
  ids: string[];
  projection: SceneProjection;
  materials: Material[];
  question: string;
  region: SceneLayout | null;
  /** 面板在画布视口中的位置 */
  anchor: { left: number; top: number };
  /** 选区截图等额外图像（已保存为工作区资产） */
  visuals: AskVisual[];
  context: ResearchContext | null;
  contextKey: string | null;
  busy: 'preview' | 'send' | 'capture' | null;
  error: string | null;
  /** 服务拒绝发送的结构化原因，供界面列出变化对象或超出预算的来源 */
  problem: AskProblem | null;
  runId: string | null;
};

export type AskVisual = { asset_id: string; label: string; bytes: number; url: string };

export type AskProblem =
  | { type: 'stale'; changes: ContextChange[] }
  | { type: 'budget'; count: number; limit: number; sources: Array<{ number: number; document_id: string; character_count: number }> }
  | { type: 'image_budget'; message: string }
  | { type: 'vision'; message: string };

/** 画布提案在前端的调整状态：操作内容与位置可改，可排除部分操作。 */
export type ProposalDraft = {
  id: string;
  actions: CanvasAction[];
  excluded: string[];
  dirty: boolean;
  busy: 'apply' | 'revert' | 'reject' | null;
  error: string | null;
  /** 生成后画布已更新：显示版本差异，用户确认后按当前画布应用 */
  conflict: { from: number; to: number } | null;
  /** 未能在画布上放置连线的关系 */
  unplaced: string[];
};

export type UnsavedSwitch = { targetId: string; items: PendingSave[] };

export type Toast = { id: number; tone: 'info' | 'success' | 'error'; text: string; action?: { label: string; run: () => void } };

export type Dialogs = {
  contextId?: string | null;
  compare?: [string, string] | null;
  proposalId?: string | null;
  search?: boolean;
  pdf?: { assetId: string; page: number; title: string } | null;
  version?: { documentId: string; version: number; anchorId?: string } | null;
  workspace?: boolean;
};

export type AppState = {
  connection: 'checking' | 'online' | 'offline';
  health: Health | null;
  connectionError: string | null;
  catalog: ModelCatalog | null;
  catalogError: string | null;
  model: string;
  workspaces: Workspace[];
  workspaceId: string | null;
  summary: WorkspaceSummary | null;
  workspaceError: string | null;
  loadingWorkspace: boolean;
  runs: Run[];
  contexts: Record<string, ResearchContext>;
  proposals: Record<string, Proposal>;
  resolutions: Record<string, AnchorResolution>;
  view: View;
  lastCanvasId: string | null;
  tab: PanelTab;
  canvasSelection: CanvasSelection;
  selectedRelationId: string | null;
  composer: Composer;
  picked: string[];
  toasts: Toast[];
  dialogs: Dialogs;
  sidebarOpen: boolean;
  panelOpen: boolean;
  dark: boolean;
  activeRunId: string | null;
  /** 画布上请求打开编辑浮层的文稿 */
  peekRequest: string | null;
  /** 能力发现结果；null 表示服务未声明（旧服务 404） */
  capabilities: Capabilities | null;
  capabilitiesChecked: boolean;
  /** 画布当前选择的实例标识 */
  sceneIds: string[];
  ask: CanvasAsk | null;
  /** 上下文快照对应的期望材料，用于核对实际阅读范围 */
  expectations: Record<string, ExpectedSource[]>;
  unsaved: UnsavedSwitch | null;
  canvasProposals: Record<string, CanvasProposal>;
  proposalDraft: ProposalDraft | null;
  /** 画布上打开的学科桥卡 */
  bridge: { relationId: string; canvasId: string | null } | null;
  /** 讨论归位的进行状态与失败原因，按运行标识记录 */
  placements: Record<string, PlacementState>;
  /** 提问截图及其引用；null 表示尚未读取 */
  visualAssets: VisualAsset[] | null;
};

/** retry：冲突处理后（画布保存或载入服务器版本）自动重新归位 */
export type PlacementState = { busy: boolean; error: string | null; retry: boolean };

function readLocal(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 浏览器存储不可用时只影响偏好记忆 */
  }
}

const emptyComposer: Composer = { mode: 'discussion', question: '', documentIds: [], anchorIds: [], parents: [], inherit: 'discussion', preview: null, previewKey: null, busy: null, error: null };

export const app = createStore<AppState>({
  connection: 'checking',
  health: null,
  connectionError: null,
  catalog: null,
  catalogError: null,
  model: readLocal('rc:model') ?? '',
  workspaces: [],
  workspaceId: null,
  summary: null,
  workspaceError: null,
  loadingWorkspace: false,
  runs: [],
  contexts: {},
  proposals: {},
  resolutions: {},
  view: { type: 'empty' },
  lastCanvasId: null,
  tab: 'discuss',
  canvasSelection: null,
  selectedRelationId: null,
  composer: emptyComposer,
  picked: [],
  toasts: [],
  dialogs: {},
  sidebarOpen: false,
  panelOpen: false,
  dark: document.documentElement.classList.contains('dark'),
  activeRunId: null,
  peekRequest: null,
  capabilities: null,
  capabilitiesChecked: false,
  sceneIds: [],
  ask: null,
  expectations: {},
  unsaved: null,
  canvasProposals: {},
  proposalDraft: null,
  bridge: null,
  placements: {},
  visualAssets: null,
});

export const useApp = <S,>(selector: (state: AppState) => S) => useStore(app, selector);

let session: ResearchSession | null = null;
export const getSession = () => session;

const runSubscriptions = new Map<string, () => void>();
let toastSeq = 0;

// ------------------------------------------------------------------ 通用
export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']) {
  const id = ++toastSeq;
  app.set(state => ({ toasts: [...state.toasts, { id, tone, text, action }] }));
  setTimeout(() => dismissToast(id), tone === 'error' ? 9000 : 5000);
}

export function dismissToast(id: number) {
  app.set(state => ({ toasts: state.toasts.filter(item => item.id !== id) }));
}

export function errorText(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function reportError(error: unknown, prefix = '') {
  if (error instanceof ApiError && error.isNetwork) app.set({ connection: 'offline', connectionError: error.message });
  toast(`${prefix}${errorText(error)}`, 'error');
}

export function setDialogs(patch: Partial<Dialogs>) {
  app.set(state => ({ dialogs: { ...state.dialogs, ...patch } }));
}

export function setTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  setEditorColorScheme(dark);
  writeLocal('rc:theme', dark ? 'dark' : 'light');
  app.set({ dark });
}

export function documentById(id: string | null | undefined) {
  if (!id) return undefined;
  return app.get().summary?.documents.find(doc => doc.id === id);
}

export function documentMap() {
  return new Map((app.get().summary?.documents ?? []).map(doc => [doc.id, doc]));
}

// ------------------------------------------------------------------ 连接与启动
let healthTimer: ReturnType<typeof setTimeout> | undefined;

export async function checkHealth() {
  clearTimeout(healthTimer);
  try {
    const health = await api.health();
    const wasOffline = app.get().connection !== 'online';
    app.set({ connection: 'online', health, connectionError: null });
    if (wasOffline) void afterOnline();
    healthTimer = setTimeout(checkHealth, 30000);
  } catch (error) {
    app.set({ connection: 'offline', connectionError: errorText(error) });
    healthTimer = setTimeout(checkHealth, 4000);
  }
}

async function afterOnline() {
  void loadModels();
  void loadCapabilities();
  if (!app.get().workspaceId) await loadWorkspaces();
}

export async function loadModels() {
  try {
    const catalog = await api.models();
    const saved = app.get().model;
    const model = catalog.models.some(entry => entry.id === saved) ? saved : catalog.default_model;
    app.set({ catalog, catalogError: null, model });
  } catch (error) {
    app.set({ catalogError: errorText(error) });
  }
}

export async function loadCapabilities() {
  try {
    const capabilities = await api.capabilities();
    app.set({ capabilities, capabilitiesChecked: true });
  } catch {
    app.set({ capabilities: null, capabilitiesChecked: true });
  }
}

/** 能力是否已由服务声明。具体字段以 docs/api.md 记录的实际契约为准。 */
export function setModel(model: string) {
  writeLocal('rc:model', model);
  app.set({ model });
}

export async function boot() {
  setEditorColorScheme(app.get().dark);
  await checkHealth();
}

export async function loadWorkspaces() {
  try {
    let workspaces = await api.listWorkspaces();
    if (workspaces.length === 0) {
      const created = await api.createWorkspace('我的研究');
      workspaces = [created];
    }
    app.set({ workspaces });
    const saved = readLocal('rc:workspace');
    const target = workspaces.find(item => item.id === saved) ?? workspaces[0];
    await openWorkspace(target.id);
  } catch (error) {
    app.set({ workspaceError: errorText(error) });
  }
}

/**
 * 打开工作区。旧会话的待保存内容先写入；仍有失败或冲突时保留旧会话和编辑内容，
 * 由用户在提示中处理，或明确放弃这些修改后再切换。
 */
export async function openWorkspace(id: string, options: { discard?: boolean } = {}) {
  const previous = session;
  if (previous) {
    const pending = await previous.flushAll();
    if (pending.length > 0 && !options.discard) {
      app.set({ unsaved: { targetId: id, items: pending } });
      return false;
    }
    previous.dispose();
  }
  app.set({ unsaved: null });
  runSubscriptions.forEach(close => close());
  runSubscriptions.clear();
  session = new ResearchSession(id);
  session.onDocumentSaved = doc => upsertDocument(doc);
  session.onCanvasSaved = canvas => {
    upsertCanvas(canvas);
    // 冲突处理后的保存或载入服务器版本：继续完成该画布等待中的讨论归位
    schedulePlacements(canvas.id);
  };
  session.onRelationsChanged = () => void refreshSummary();
  session.onLinkEvent = onLinkEvent;
  session.onAssetImported = result => {
    upsertDocument(result.document);
    toast(`图片已保存为工作区文件「${result.document.title}」`, 'success');
  };
  writeLocal('rc:workspace', id);
  app.set({
    workspaceId: id, summary: null, runs: [], contexts: {}, proposals: {}, resolutions: {}, loadingWorkspace: true,
    workspaceError: null, view: { type: 'empty' }, canvasSelection: null, selectedRelationId: null, composer: emptyComposer, picked: [],
    sceneIds: [], ask: null, expectations: {}, bridge: null, canvasProposals: {}, proposalDraft: null, placements: {}, visualAssets: null,
  });
  try {
    const [summary, runs] = await Promise.all([api.getWorkspace(id), api.listRuns(id)]);
    if (session.workspaceId !== id) return;
    session.setRelations(summary.relations);
    app.set({ summary, runs, loadingWorkspace: false });
    runs.filter(run => !TERMINAL_RUN_STATUSES.includes(run.status)).forEach(run => watchRun(run.id));
    void loadDiscussionContexts();
    const savedCanvas = readLocal(`rc:canvas:${id}`);
    let canvas = summary.canvases.find(item => item.id === savedCanvas) ?? summary.canvases[0];
    if (!canvas) {
      canvas = await api.createCanvas(id, '主画布');
      upsertCanvas(canvas);
    }
    openCanvas(canvas.id);
    void refreshResolutions();
    return true;
  } catch (error) {
    app.set({ loadingWorkspace: false, workspaceError: errorText(error) });
    return false;
  }
}

function onLinkEvent(event: LinkEvent) {
  if (event.type === 'view-hidden') {
    toast('已从本画布移除这条连线，研究关系仍保留。', 'info', {
      label: '恢复显示', run: () => { session?.showRelation(event.canvasId, event.relationId); },
    });
  } else {
    toast('连线已改接：原研究关系保留并在本画布隐藏，新端点为纯视觉连线。', 'info', {
      label: '查看原关系', run: () => app.set({ selectedRelationId: event.relationId, tab: 'relations', panelOpen: true }),
    });
  }
}

export async function createWorkspace(name: string) {
  const workspace = await api.createWorkspace(name);
  app.set(state => ({ workspaces: [workspace, ...state.workspaces] }));
  await openWorkspace(workspace.id);
}

export async function renameWorkspace(id: string, name: string) {
  const workspace = await api.renameWorkspace(id, name);
  app.set(state => ({
    workspaces: state.workspaces.map(item => (item.id === id ? workspace : item)),
    summary: state.summary && state.summary.workspace.id === id ? { ...state.summary, workspace } : state.summary,
  }));
}

export async function refreshSummary() {
  const id = app.get().workspaceId;
  if (!id) return;
  try {
    const summary = await api.getWorkspace(id);
    if (app.get().workspaceId !== id) return;
    session?.setRelations(summary.relations);
    app.set({ summary });
    const view = app.get().view;
    if (view.type === 'canvas') session?.syncCanvasRelations(view.id);
  } catch (error) {
    reportError(error);
  }
}

function upsertDocument(doc: ResearchDocument) {
  app.set(state => {
    if (!state.summary) return {};
    const exists = state.summary.documents.some(item => item.id === doc.id);
    const documents = exists ? state.summary.documents.map(item => (item.id === doc.id ? doc : item)) : [...state.summary.documents, doc];
    return { summary: { ...state.summary, documents } };
  });
}

function upsertCanvas(canvas: Canvas) {
  app.set(state => {
    if (!state.summary) return {};
    const exists = state.summary.canvases.some(item => item.id === canvas.id);
    const canvases = exists ? state.summary.canvases.map(item => (item.id === canvas.id ? canvas : item)) : [...state.summary.canvases, canvas];
    return { summary: { ...state.summary, canvases } };
  });
}

function upsertRelation(relation: Relation) {
  app.set(state => {
    if (!state.summary) return {};
    const exists = state.summary.relations.some(item => item.id === relation.id);
    const relations = exists ? state.summary.relations.map(item => (item.id === relation.id ? relation : item)) : [...state.summary.relations, relation];
    session?.setRelations(relations);
    return { summary: { ...state.summary, relations } };
  });
  void loadEndpointContexts([relation]);
}

// ------------------------------------------------------------------ 视图
export function openCanvas(id: string) {
  const workspaceId = app.get().workspaceId;
  if (workspaceId) writeLocal(`rc:canvas:${workspaceId}`, id);
  setPrimaryMode(id, 'edgeless');
  const view = app.get().view;
  if (view.type !== 'canvas' || view.id !== id) advanceAsk();
  app.set({ view: { type: 'canvas', id }, lastCanvasId: id, canvasSelection: null, sidebarOpen: false });
}

export function openDocument(id: string, focus?: { anchorId: string } | null) {
  advanceAsk();
  app.set({ view: { type: 'document', id, focus: focus ?? null }, sidebarOpen: false });
}

export function setTab(tab: PanelTab) {
  app.set({ tab, panelOpen: true });
}

export function setCanvasSelection(selection: CanvasSelection) {
  const current = app.get().canvasSelection;
  if (JSON.stringify(current) === JSON.stringify(selection)) return;
  app.set(state => ({
    canvasSelection: selection,
    selectedRelationId: selection?.kind === 'relation' ? selection.relationId : state.selectedRelationId,
    tab: selection?.kind === 'relation' ? 'relations' : state.tab,
  }));
}

/** 画布当前选择的实例标识（块与元素），用于多对象提问。 */
export function setSceneIds(ids: string[]) {
  if (JSON.stringify(app.get().sceneIds) === JSON.stringify(ids)) return;
  app.set({ sceneIds: ids });
}

export function togglePicked(id: string) {
  app.set(state => ({ picked: state.picked.includes(id) ? state.picked.filter(item => item !== id) : [...state.picked, id] }));
}

// ------------------------------------------------------------------ 文稿与画布
export async function createDocument(kind: DocumentKind, title: string, options: { place?: boolean; open?: boolean } = {}) {
  const workspaceId = app.get().workspaceId;
  if (!workspaceId) return null;
  try {
    const doc = await api.createDocument(workspaceId, { title, kind, content: { blocks: [] } });
    upsertDocument(doc);
    if (options.place) {
      await placeOnCanvas(doc.id);
      app.set({ peekRequest: doc.id });
    }
    if (options.open) openDocument(doc.id);
    return doc;
  } catch (error) {
    reportError(error, '创建失败：');
    return null;
  }
}

export async function createCanvas(name: string) {
  const workspaceId = app.get().workspaceId;
  if (!workspaceId) return;
  try {
    const canvas = await api.createCanvas(workspaceId, name);
    upsertCanvas(canvas);
    openCanvas(canvas.id);
  } catch (error) {
    reportError(error, '创建画布失败：');
  }
}

export function renameCanvas(id: string, name: string) {
  session?.renameCanvasLocal(id, name);
  app.set(state => state.summary ? { summary: { ...state.summary, canvases: state.summary.canvases.map(item => (item.id === id ? { ...item, name } : item)) } } : {});
}

/** 画布视图注册的操作：放置文稿卡片、放置片段卡片、对指定对象发起就近提问。 */
export type CanvasActions = {
  canvasId: string;
  /** 登记时的画布存储代次；采用服务端画布后旧操作对象不再对应当前编辑器 */
  generation: number;
  place(documentId: string, near?: string | null, point?: [number, number]): Promise<string | null>;
  placeFragment(anchor: Anchor, nearDocumentId?: string | null): string | null;
  ask(ids: string[]): void;
  /** 按当前选择重新生成投影（画布保存后取得对应 revision） */
  reproject(ids: string[]): { projection: SceneProjection; materials: Material[] } | null;
  /** 选区附近的其他对象 */
  neighbors(ids: string[]): string[];
  /** 将所选对象渲染为 PNG */
  capture(ids: string[]): Promise<Blob>;
  /** 视口附近不与现有卡片重叠的区域（世界坐标） */
  slot(size: { width: number; height: number }): Bounds;
  /** 选中并显示指定对象 */
  focus(ids: string[]): void;
};
let canvasActions: CanvasActions | null = null;
export function registerCanvasActions(actions: CanvasActions | null) {
  canvasActions = actions;
  if (actions) schedulePlacements(actions.canvasId);
}

async function waitCanvasActions(): Promise<CanvasActions | null> {
  const view = app.get().view;
  const canvasId = view.type === 'canvas' ? view.id : app.get().lastCanvasId;
  if (!canvasId) { toast('请先打开一张画布', 'error'); return null; }
  if (view.type !== 'canvas') openCanvas(canvasId);
  return mountedCanvasActions(canvasId);
}

/** 已登记且对应当前画布存储的操作对象 */
function liveCanvasActions(canvasId: string) {
  const actions = canvasActions;
  return actions?.canvasId === canvasId && actions.generation === (session?.canvasGeneration(canvasId) ?? 0) ? actions : null;
}

/** 等待画布视图（重新）挂载并登记操作 */
async function mountedCanvasActions(canvasId: string): Promise<CanvasActions | null> {
  for (let i = 0; i < 60 && !liveCanvasActions(canvasId); i++) await new Promise(resolve => setTimeout(resolve, 50));
  return liveCanvasActions(canvasId);
}

/**
 * 同一画布上的服务端写入按顺序执行：讨论归位会采用新的画布版本，
 * 提问冻结的保存、重新投影与上下文创建需要对应同一版本。
 */
const canvasQueues = new Map<string, Promise<unknown>>();
function onCanvasQueue<T>(canvasId: string, task: () => Promise<T>): Promise<T> {
  const previous = canvasQueues.get(canvasId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const tail = next.catch(() => undefined);
  canvasQueues.set(canvasId, tail);
  void tail.then(() => { if (canvasQueues.get(canvasId) === tail) canvasQueues.delete(canvasId); });
  return next;
}

export async function placeOnCanvas(documentId: string, near?: string | null, point?: [number, number]) {
  const actions = await waitCanvasActions();
  if (!actions) return null;
  try {
    return await actions.place(documentId, near, point);
  } catch (error) {
    reportError(error, '放置失败：');
    return null;
  }
}

/** 把已有锚点作为片段卡片放到画布，靠近其所属文稿卡片。 */
export async function placeFragment(anchorId: string) {
  const anchor = app.get().summary?.anchors.find(item => item.id === anchorId);
  if (!anchor) return null;
  const actions = await waitCanvasActions();
  if (!actions) return null;
  try {
    return actions.placeFragment(anchor, anchor.document_id);
  } catch (error) {
    reportError(error, '放置片段失败：');
    return null;
  }
}

/** 画布内原位选段：建立锚点、在原卡片旁放置片段卡片，并对该片段打开就近提问。 */
export async function discussInPlace(documentId: string, target: SelectionTarget) {
  const anchor = await createAnchor(documentId, target);
  if (!anchor) return;
  const actions = await waitCanvasActions();
  if (!actions) return;
  try {
    const id = actions.placeFragment(anchor, documentId);
    if (id) setTimeout(() => actions.ask([id]), 60);
  } catch (error) {
    reportError(error, '放置片段失败：');
  }
}

export async function importFiles(files: File[], options: { place?: boolean } = {}) {
  const workspaceId = app.get().workspaceId;
  if (!workspaceId) return;
  for (const file of files) {
    try {
      const result = await api.importFile(workspaceId, file);
      upsertDocument(result.document);
      const pages = result.document.kind === 'pdf' ? `，共 ${result.document.content.blocks.length} 页` : '';
      toast(`已导入「${result.document.title}」${pages}`, 'success', { label: '打开', run: () => openDocument(result.document.id) });
      if (options.place) await placeOnCanvas(result.document.id);
    } catch (error) {
      reportError(error, `导入「${file.name}」失败：`);
    }
  }
}

export async function restoreVersion(documentId: string, version: number) {
  const s = session;
  if (!s) return;
  try {
    const doc = documentById(documentId);
    if (!doc) return;
    if (s.isLoaded(documentId)) await s.flushDocument(documentId);
    const current = s.docStatus(documentId)?.version ?? doc.current_version;
    const restored = await api.restoreVersion(documentId, current, version);
    s.applyServerDocument(restored);
    upsertDocument(restored);
    await refreshResolutions(documentId);
    toast(`已以版本 ${version} 的内容生成版本 ${restored.current_version}`, 'success');
  } catch (error) {
    reportError(error, '恢复失败：');
  }
}

// ------------------------------------------------------------------ 锚点
export async function createAnchor(documentId: string, target: SelectionTarget): Promise<Anchor | null> {
  const s = session;
  const workspaceId = app.get().workspaceId;
  if (!s || !workspaceId) return null;
  try {
    const version = await s.flushDocument(documentId);
    const anchor = await api.createAnchor(workspaceId, { document_id: documentId, version, block_id: target.blockId, quote: target.quote, start_utf16: target.start });
    app.set(state => state.summary ? { summary: { ...state.summary, anchors: [...state.summary.anchors, anchor] } } : {});
    void resolveAnchor(anchor.id);
    return anchor;
  } catch (error) {
    reportError(error, '创建批注锚点失败：');
    return null;
  }
}

export async function resolveAnchor(id: string) {
  try {
    const resolution = await api.resolveAnchor(id);
    app.set(state => ({ resolutions: { ...state.resolutions, [id]: resolution } }));
    return resolution;
  } catch (error) {
    reportError(error);
    return null;
  }
}

export async function refreshResolutions(documentId?: string) {
  const anchors = (app.get().summary?.anchors ?? []).filter(anchor => !documentId || anchor.document_id === documentId);
  await Promise.all(anchors.map(anchor => resolveAnchor(anchor.id)));
}

export async function discussSelection(documentId: string, target: SelectionTarget, mode: ResearchMode = 'discussion') {
  const anchor = await createAnchor(documentId, target);
  if (!anchor) return;
  app.set(state => ({
    composer: { ...emptyComposer, mode, question: state.composer.mode === mode ? state.composer.question : '', anchorIds: [anchor.id] },
    tab: 'discuss',
    panelOpen: true,
  }));
  focusComposer();
}

let composerFocus: (() => void) | null = null;
export function registerComposerFocus(focus: (() => void) | null) {
  composerFocus = focus;
}
function focusComposer() {
  setTimeout(() => composerFocus?.(), 60);
}

// ------------------------------------------------------------------ 讨论与运行
export function updateComposer(patch: Partial<Composer>) {
  app.set(state => ({ composer: { ...state.composer, ...patch, error: patch.error === undefined ? null : patch.error } }));
}

export function addMaterialDocument(id: string) {
  app.set(state => ({
    composer: state.composer.documentIds.includes(id) ? state.composer : { ...state.composer, documentIds: [...state.composer.documentIds, id] },
    tab: 'discuss',
    panelOpen: true,
  }));
  focusComposer();
}

export function addMaterialAnchor(id: string) {
  app.set(state => ({
    composer: state.composer.anchorIds.includes(id) ? state.composer : { ...state.composer, anchorIds: [...state.composer.anchorIds, id] },
    tab: 'discuss',
    panelOpen: true,
  }));
  focusComposer();
}

export function removeMaterial(kind: 'document' | 'anchor', id: string) {
  app.set(state => ({
    composer: kind === 'document'
      ? { ...state.composer, documentIds: state.composer.documentIds.filter(item => item !== id) }
      : { ...state.composer, anchorIds: state.composer.anchorIds.filter(item => item !== id) },
  }));
}

/** 从某次讨论继续：以讨论文稿为上下文入口，新问题形成独立分支。 */
export function branchFrom(discussionIds: string[]) {
  app.set(state => ({
    composer: { ...emptyComposer, mode: 'discussion', question: state.composer.question, documentIds: discussionIds, parents: discussionIds },
    tab: 'discuss',
    panelOpen: true,
  }));
  void loadParentContexts(discussionIds);
  focusComposer();
}

async function loadParentContexts(discussionIds: string[]) {
  const docs = documentMap();
  await Promise.all(discussionIds.map(id => docs.get(id)?.metadata.context_id).filter((id): id is string => !!id).map(id => loadContext(id)));
}

/**
 * 切换继承方式。“仅原片段”只提交父讨论快照中的锚点（各自的历史版本），
 * 不再以讨论文稿为入口，因此不含上一轮问答，也不会被服务展开为来源全文。
 */
export function setInheritMode(inherit: Composer['inherit']) {
  const { composer, contexts } = app.get();
  if (composer.parents.length === 0) return;
  const { expected } = inheritedSources(composer.parents, documentMap(), contexts);
  const parentAnchors = Array.from(new Set(expected.map(item => item.anchor_id).filter((id): id is string => !!id)));
  const others = composer.documentIds.filter(id => !composer.parents.includes(id));
  const extraAnchors = composer.anchorIds.filter(id => !parentAnchors.includes(id));
  updateComposer(inherit === 'fragments'
    ? { inherit, documentIds: others, anchorIds: [...extraAnchors, ...parentAnchors] }
    : { inherit, documentIds: [...composer.parents, ...others], anchorIds: extraAnchors });
}

/** 当前问题输入对应的期望材料：显式选择的片段与文稿，以及父讨论的冻结来源。 */
function composerExpectation(composer: Composer): ExpectedSource[] {
  const { summary, contexts } = app.get();
  const docs = documentMap();
  const expected: ExpectedSource[] = [];
  for (const id of composer.anchorIds) {
    const anchor = summary?.anchors.find(item => item.id === id);
    expected.push({ document_id: anchor?.document_id ?? '', version: anchor?.version ?? null, anchor_id: id, origin: '所选片段' });
  }
  for (const id of composer.documentIds) {
    if (composer.parents.includes(id)) continue;
    expected.push({ document_id: id, version: session?.docStatus(id)?.version ?? docs.get(id)?.current_version ?? null, anchor_id: null, origin: '所选文稿' });
  }
  if (composer.parents.length && composer.inherit === 'discussion') expected.push(...inheritedSources(composer.parents, docs, contexts).expected);
  return expected;
}

/** 快照身份包含整篇材料保存后的版本；片段引用固定版本。 */
function composerKey(composer: Composer) {
  const versions = [...composer.documentIds].sort().map(id => `${id}@${session?.docStatus(id)?.version ?? documentById(id)?.current_version ?? ''}`);
  return JSON.stringify([composer.mode, composer.question.trim(), versions, [...composer.anchorIds].sort()]);
}

async function flushMaterials(composer: Composer) {
  const s = session;
  if (!s) return;
  const anchorDocs = (app.get().summary?.anchors ?? []).filter(anchor => composer.anchorIds.includes(anchor.id)).map(anchor => anchor.document_id);
  const ids = new Set([...composer.documentIds, ...anchorDocs]);
  await Promise.all(Array.from(ids).filter(id => s.isLoaded(id)).map(id => s.flushDocument(id)));
}

export async function previewContext(open = true): Promise<ResearchContext | null> {
  const { composer, workspaceId } = app.get();
  if (!workspaceId) return null;
  if (!composer.question.trim()) { updateComposer({ error: '请先写下要讨论的问题' }); return null; }
  if (composer.mode === 'rewrite' && composer.anchorIds.length !== 1) { updateComposer({ error: '改写需要恰好一个精确选段' }); return null; }
  updateComposer({ busy: 'preview' });
  try {
    // 先保存材料，再按保存后的版本判断能否复用已冻结的预览
    await flushMaterials(composer);
    const key = composerKey(composer);
    if (composer.preview && composer.previewKey === key) {
      updateComposer({ busy: null });
      if (open) setDialogs({ contextId: composer.preview.id });
      return composer.preview;
    }
    const context = await api.createContext(workspaceId, {
      question: composer.question.trim(),
      mode: composer.mode,
      document_ids: composer.documentIds,
      anchor_ids: composer.anchorIds,
    });
    const expected = composerExpectation(composer);
    app.set(state => ({
      contexts: { ...state.contexts, [context.id]: context },
      expectations: { ...state.expectations, [context.id]: expected },
      composer: { ...state.composer, preview: context, previewKey: key, busy: null, error: null },
    }));
    if (open) setDialogs({ contextId: context.id });
    return context;
  } catch (error) {
    updateComposer({ busy: null, error: errorText(error) });
    return null;
  }
}

export async function sendComposer() {
  const { workspaceId, model } = app.get();
  if (!workspaceId) return;
  const context = await previewContext(false);
  if (!context) return;
  updateComposer({ busy: 'send' });
  try {
    const run = await api.startRun(workspaceId, { context_id: context.id, model: model || undefined });
    app.set(state => ({
      runs: [run, ...state.runs.filter(item => item.id !== run.id)],
      activeRunId: run.id,
      composer: { ...state.composer, busy: null, question: '', preview: null, previewKey: null, error: null, parents: [], inherit: 'discussion' },
    }));
    watchRun(run.id);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'stale_context') {
      // 材料在冻结后被修改：载入新版本，丢弃旧快照并重新冻结，问题与材料保留
      updateComposer({ busy: null, preview: null, previewKey: null });
      await adoptContextChanges((error.details as { changes?: ContextChange[] }).changes ?? []);
      await previewContext(false);
      updateComposer({ error: `材料在冻结后有更新（${staleSummary(error)}），已重新冻结，请检查后再次发送。` });
    } else {
      updateComposer({ busy: null, error: errorText(error) });
    }
  }
}

/**
 * 其他客户端在冻结后修改了材料：载入变化文稿的服务端版本，画布落后时按服务端画布重建并等待视图重新挂载，
 * 之后的重新冻结即按最新版本投影。冻结前已保存本地编辑，此处不覆盖未保存内容。
 */
async function adoptContextChanges(changes: ContextChange[]) {
  const s = session;
  if (!s) return;
  await Promise.all(changes.map(async change => {
    if (change.type === 'document') {
      const doc = await api.getDocument(change.id);
      upsertDocument(doc);
      s.applyServerDocument(doc);
    } else if ((s.canvasStatus(change.id)?.version ?? change.current_revision) < change.current_revision) {
      registerCanvasActions(null);
      await s.reloadCanvas(change.id, documentMap());
      await mountedCanvasActions(change.id);
    }
  }));
}

/** stale_context 详情的简短说明。 */
export function staleSummary(error: ApiError | ContextChange[]) {
  const changes = Array.isArray(error) ? error : ((error.details as { changes?: ContextChange[] }).changes ?? []);
  return changes.map(change => change.type === 'document'
    ? `「${documentById(change.id)?.title || '文稿'}」v${change.expected_version}→v${change.current_version}`
    : `画布「${app.get().summary?.canvases.find(canvas => canvas.id === change.id)?.name ?? '画布'}」r${change.expected_revision}→r${change.current_revision}`).join('、');
}

export function watchRun(id: string) {
  if (runSubscriptions.has(id)) return;
  const close = subscribeRun(id, ({ run }) => {
    // 运行属于发起时的工作区；用户已切到其他工作区时保留当前视图，回到原工作区后由运行列表恢复
    if (run.workspace_id !== app.get().workspaceId) return;
    replaceRun(run);
    if (TERMINAL_RUN_STATUSES.includes(run.status)) {
      runSubscriptions.delete(id);
      void onRunFinished(run);
    }
  });
  runSubscriptions.set(id, close);
}

async function onRunFinished(run: Run) {
  app.set(state => (state.ask?.runId === run.id ? { ask: { ...state.ask, busy: null } } : {}));
  if (run.status === 'succeeded') {
    await refreshSummary();
    if (run.workspace_id !== app.get().workspaceId) return;
    if (run.canvas_proposal_id) {
      const proposal = await loadCanvasProposal(run.canvas_proposal_id);
      if (proposal && proposal.status === 'pending') {
        // 提案按运行来源定位：目标画布在前台时直接显示，否则提示前往
        if (currentCanvasId() === proposal.canvas_id) openProposalDraft(proposal);
        else toast(`画布提案已生成，属于画布「${canvasName(proposal.canvas_id)}」。`, 'success', { label: '前往查看', run: () => void reopenCanvasProposal(proposal.id) });
      }
    }
    if (run.document_id) void loadDiscussionContexts();
    if (awaitingPlacement(run)) {
      // 讨论框放回发问时的画布；该画布不在前台时保留待归位记录
      const target = run.origin!.canvas_id;
      if (currentCanvasId() === target) schedulePlacements(target);
      else toast(`讨论已生成，待放回画布「${canvasName(target)}」。`, 'success', { label: '前往原画布', run: () => void locateRun(run.id) });
    } else if (run.document_id && !run.placement) {
      toast('讨论已生成，可加入画布或继续分支', 'success');
    }
    if (run.proposal_id) {
      await loadProposal(run.proposal_id);
      setDialogs({ proposalId: run.proposal_id });
    }
  } else if (run.status === 'failed') {
    toast(`生成失败：${run.error ?? '模型服务返回错误'}`, 'error');
  } else if (run.status === 'interrupted') {
    toast(`生成中断：${run.error ?? '服务停止'}`, 'error');
  }
}

export function canvasName(id: string) {
  return app.get().summary?.canvases.find(canvas => canvas.id === id)?.name ?? '已删除的画布';
}

// ------------------------------------------------------------------ 讨论归位
/** 成功的画布讨论：具有讨论文稿与发问来源、尚未放入原画布。 */
export function awaitingPlacement(run: Run) {
  return run.status === 'succeeded' && !!run.document_id && !!run.origin && !run.placement;
}

function setPlacement(runId: string, value: PlacementState | null) {
  app.set(state => {
    const placements = { ...state.placements };
    if (value) placements[runId] = value; else delete placements[runId];
    return { placements };
  });
}

const placing = new Map<string, Promise<void>>();

/** 目标画布挂载或保存后，完成其等待中的讨论归位。失败且无需重试的记录由用户手动重试。 */
function schedulePlacements(canvasId: string) {
  const { runs, placements, workspaceId } = app.get();
  const due = runs.filter(run => run.workspace_id === workspaceId && awaitingPlacement(run) && run.origin!.canvas_id === canvasId
    && !placing.has(run.id) && (!placements[run.id]?.error || placements[run.id].retry));
  if (due.length === 0) return;
  // 推迟到当前保存或挂载回调之后，避免在编辑器事件中改写画布
  setTimeout(() => { for (const run of due) void placeRun(run.id); }, 0);
}

/**
 * 归位：等待目标画布挂载 → 暂停自动保存并写入本地编辑 → POST /runs/{id}/place →
 * 采用返回的运行与完整画布。响应丢失时读取运行记录：已保存归位则重复调用取回当前画布。
 * 409 按画布保存冲突处理，本地编辑保留，冲突处理后的保存会再次触发归位。
 */
export function placeRun(runId: string): Promise<void> {
  const existing = placing.get(runId);
  if (existing) return existing;
  const task = onCanvasQueue(app.get().runs.find(run => run.id === runId)?.origin?.canvas_id ?? runId, () => doPlaceRun(runId))
    .finally(() => placing.delete(runId));
  placing.set(runId, task);
  return task;
}

async function doPlaceRun(runId: string) {
  const s = session;
  const run = app.get().runs.find(item => item.id === runId);
  if (!s || !run || !awaitingPlacement(run)) return;
  const canvasId = run.origin!.canvas_id;
  const actions = liveCanvasActions(canvasId);
  if (!actions) return;
  setPlacement(run.id, { busy: true, error: null, retry: false });
  let held = false;
  try {
    if (!documentById(run.document_id)) upsertDocument(await api.getDocument(run.document_id!));
    const revision = await s.holdCanvas(canvasId);
    held = true;
    const input = { expected_canvas_revision: revision, bounds: run.origin!.write_region ? undefined : actions.slot({ width: 560, height: 420 }) };
    let result;
    try {
      result = await api.placeRun(run.id, input);
    } catch (error) {
      if (!(error instanceof ApiError && (error.isNetwork || error.status >= 500))) throw error;
      const current = await api.getRun(run.id);
      if (!current.placement) throw new Error(`归位请求未完成（${error.message}），画布未写入，可重试。`);
      // 已保存的归位：重复请求返回原记录与目标画布的当前版本
      result = await api.placeRun(run.id, input);
    }
    if (session !== s) return;
    replaceRun(result.run);
    await s.adoptServerCanvas(result.canvas, documentMap());
    setPlacement(run.id, null);
    toast('讨论框已放回发问时的画布，并连回所选来源。', 'success', { label: '定位', run: () => void locateRun(run.id) });
  } catch (error) {
    const conflict = error instanceof ApiError && error.isConflict;
    if (conflict) s.markCanvasConflict(canvasId, error.currentVersion, error.message);
    setPlacement(run.id, {
      busy: false, retry: conflict,
      error: conflict ? `画布已被其他操作更新（当前版本 ${error.currentVersion ?? '未知'}），本地编辑已保留；处理冲突后自动放回。` : errorText(error),
    });
  } finally {
    if (held) s.releaseCanvas(canvasId);
  }
}

/** 运行来源定位：打开发问时的画布；待归位时先完成归位，再选中讨论框。 */
export async function locateRun(runId: string) {
  const run = app.get().runs.find(item => item.id === runId);
  const canvasId = run?.origin?.canvas_id;
  if (!run || !canvasId) return;
  if (!app.get().summary?.canvases.some(canvas => canvas.id === canvasId)) { toast('发问时的画布已删除，讨论文稿仍可在讨论列表中打开。', 'error'); return; }
  if (currentCanvasId() !== canvasId) openCanvas(canvasId);
  if (!(await mountedCanvasActions(canvasId))) return;
  if (awaitingPlacement(run)) await placeRun(run.id);
  const placed = app.get().runs.find(item => item.id === runId)?.placement;
  if (placed) (await mountedCanvasActions(canvasId))?.focus([placed.object_id]);
}

export async function cancelRun(id: string) {
  try {
    const run = await api.cancelRun(id);
    app.set(state => ({ runs: state.runs.map(item => (item.id === run.id ? run : item)) }));
  } catch (error) {
    reportError(error, '取消失败：');
  }
}

function replaceRun(run: Run) {
  app.set(state => (run.workspace_id !== state.workspaceId ? {} : {
    runs: state.runs.some(item => item.id === run.id) ? state.runs.map(item => (item.id === run.id ? run : item)) : [run, ...state.runs],
  }));
}

/**
 * 失败的画布运行：由服务从保存的原输出重新解析提案。成功后刷新运行并打开提案；
 * JSON 内容本身无效时返回具体错误，原输出与错误保持不变，可按原上下文重新生成。
 */
export async function recoverCanvasRun(id: string): Promise<string | null> {
  try {
    const run = await api.recoverCanvasProposal(id);
    replaceRun(run);
    if (!run.canvas_proposal_id) return '服务未返回画布提案';
    await reopenCanvasProposal(run.canvas_proposal_id);
    toast('已从原输出恢复画布提案，请审阅后确认写入。', 'success');
    return null;
  } catch (error) {
    return errorText(error);
  }
}

/** 使用失败运行的原 context_id 重新发起结构化运行；冻结的材料与写入范围不变。 */
export async function regenerateRun(failed: Run) {
  const workspaceId = app.get().workspaceId;
  if (!workspaceId) return null;
  try {
    const run = await api.startRun(workspaceId, { context_id: failed.context_id, model: app.get().model || failed.model || undefined });
    app.set(state => ({
      runs: [run, ...state.runs.filter(item => item.id !== run.id)],
      ask: state.ask?.runId === failed.id ? { ...state.ask, runId: run.id, busy: 'send' } : state.ask,
    }));
    watchRun(run.id);
    return run;
  } catch (error) {
    reportError(error, '重新生成失败：');
    return null;
  }
}

export async function loadContext(id: string) {
  const cached = app.get().contexts[id];
  if (cached) return cached;
  try {
    const context = await api.getContext(id);
    app.set(state => ({ contexts: { ...state.contexts, [id]: context } }));
    return context;
  } catch (error) {
    reportError(error);
    return null;
  }
}

/** 讨论文稿记录了生成时的上下文；载入后可显示其关联选段与来源。 */
export async function loadDiscussionContexts() {
  const { summary, runs, contexts } = app.get();
  void loadEndpointContexts(summary?.relations ?? []);
  const ids = new Set<string>();
  for (const doc of summary?.documents ?? []) if (doc.kind === 'discussion' && doc.metadata.context_id) ids.add(doc.metadata.context_id);
  for (const run of runs) if (run.proposal_id) ids.add(run.context_id);
  const missing = Array.from(ids).filter(id => !contexts[id]);
  const loaded = await Promise.all(missing.map(id => api.getContext(id).catch(() => null)));
  const patch: Record<string, ResearchContext> = {};
  loaded.forEach(context => { if (context) patch[context.id] = context; });
  if (Object.keys(patch).length) app.set(state => ({ contexts: { ...state.contexts, ...patch } }));
  const proposalIds = runs.map(run => run.proposal_id).filter((id): id is string => !!id && !app.get().proposals[id]);
  await Promise.all(proposalIds.map(loadProposal));
  // 画布提案及其冻结上下文：刷新后可从运行记录重新打开待确认或已写入的提案
  const canvasProposalIds = runs.map(run => run.canvas_proposal_id).filter((id): id is string => !!id && !app.get().canvasProposals[id]);
  await Promise.all(canvasProposalIds.map(id => api.getCanvasProposal(id).then(proposal => {
    app.set(state => ({ canvasProposals: { ...state.canvasProposals, [id]: proposal } }));
    return loadContext(proposal.context_id);
  }).catch(() => null)));
}

// ------------------------------------------------------------------ 修改提案
export async function loadProposal(id: string) {
  try {
    const proposal = await api.getProposal(id);
    app.set(state => ({ proposals: { ...state.proposals, [id]: proposal } }));
    return proposal;
  } catch (error) {
    reportError(error);
    return null;
  }
}

async function proposalDocument(proposal: Proposal) {
  const anchor = app.get().summary?.anchors.find(item => item.id === proposal.anchor_id) ?? await api.getAnchor(proposal.anchor_id);
  return anchor.document_id;
}

async function applyProposalResult(result: { proposal: Proposal; document: ResearchDocument }) {
  app.set(state => ({ proposals: { ...state.proposals, [result.proposal.id]: result.proposal } }));
  session?.applyServerDocument(result.document);
  upsertDocument(result.document);
  await refreshResolutions(result.document.id);
}

export async function applyProposal(id: string) {
  const proposal = app.get().proposals[id] ?? await loadProposal(id);
  if (!proposal || !session) return;
  try {
    const documentId = await proposalDocument(proposal);
    if (session.isLoaded(documentId)) await session.flushDocument(documentId);
    const current = session.docStatus(documentId)?.version ?? (await api.getDocument(documentId)).current_version;
    const result = await api.applyProposal(id, current);
    await applyProposalResult(result);
    toast(`修改已写入，生成版本 ${result.document.current_version}`, 'success', { label: '撤销', run: () => void revertProposal(id) });
  } catch (error) {
    reportError(error, '确认修改失败：');
  }
}

export async function revertProposal(id: string) {
  const proposal = app.get().proposals[id] ?? await loadProposal(id);
  if (!proposal || !session) return;
  try {
    const documentId = await proposalDocument(proposal);
    if (session.isLoaded(documentId)) await session.flushDocument(documentId);
    const current = session.docStatus(documentId)?.version ?? (await api.getDocument(documentId)).current_version;
    const result = await api.revertProposal(id, current);
    await applyProposalResult(result);
    toast(`已撤销修改，生成版本 ${result.document.current_version}`, 'success');
  } catch (error) {
    reportError(error, '撤销失败：');
  }
}

export async function rejectProposal(id: string) {
  try {
    const proposal = await api.rejectProposal(id);
    app.set(state => ({ proposals: { ...state.proposals, [id]: proposal } }));
    toast('已拒绝该修改，原文保持不变');
  } catch (error) {
    reportError(error, '拒绝失败：');
  }
}

// ------------------------------------------------------------------ 关系
export async function createRelation(sourceId: string, targetId: string, input: RelationInput = {}) {
  const workspaceId = app.get().workspaceId;
  if (!workspaceId) return null;
  try {
    const relation = await api.createRelation(workspaceId, { kind: '关联', label: '', ...input, source_id: sourceId, target_id: targetId });
    upsertRelation(relation);
    const view = app.get().view;
    if (view.type === 'canvas') session?.syncCanvasRelations(view.id);
    app.set({ selectedRelationId: relation.id, tab: 'relations', panelOpen: true });
    return relation;
  } catch (error) {
    reportError(error, '建立关系失败：');
    return null;
  }
}

/** 采用服务端返回的关系（复核状态、确认记录、claim 版本）。 */
export function upsertRelationFromServer(relation: Relation) {
  upsertRelation(relation);
}

export async function updateRelation(id: string, patch: RelationInput) {
  try {
    const relation = await api.updateRelation(id, patch);
    upsertRelation(relation);
    return relation;
  } catch (error) {
    reportError(error, '保存关系失败：');
    return null;
  }
}

export async function deleteRelation(id: string) {
  try {
    await api.deleteRelation(id);
    app.set(state => {
      if (!state.summary) return {};
      const relations = state.summary.relations.filter(item => item.id !== id);
      session?.setRelations(relations);
      return { summary: { ...state.summary, relations }, selectedRelationId: state.selectedRelationId === id ? null : state.selectedRelationId };
    });
    const view = app.get().view;
    if (view.type === 'canvas') session?.syncCanvasRelations(view.id);
  } catch (error) {
    reportError(error, '删除关系失败：');
  }
}

export const emptyClaim: Claim = { status: 'analogy', conditions: '', counterexamples: '', sources: [], missing_proof: '', next_validation: '' };

/** 关系端点的显示信息：文稿、精确片段或冻结场景中的自由想法。 */
export type EndpointInfo = {
  type: ResearchEndpoint['type'];
  title: string;
  detail: string;
  /** 可作为证据或材料的文稿与锚点；自由想法为 null */
  documentId: string | null;
  anchorId: string | null;
  version: number | null;
};

export function endpointInfo(relation: Relation, side: 'source' | 'target', state: Pick<AppState, 'summary' | 'contexts'> = app.get()): EndpointInfo {
  const ref = relationEndpoint(relation, side);
  if (ref.type === 'document') {
    const doc = state.summary?.documents.find(item => item.id === ref.id);
    return { type: ref.type, title: doc?.title || (doc?.kind === 'note' ? '未命名想法' : '已删除的文稿'), detail: doc ? `文稿 · 版本 ${doc.current_version}` : '文稿', documentId: ref.id, anchorId: null, version: doc?.current_version ?? null };
  }
  if (ref.type === 'anchor') {
    const anchor = state.summary?.anchors.find(item => item.id === ref.id);
    const doc = anchor ? state.summary?.documents.find(item => item.id === anchor.document_id) : undefined;
    return {
      type: ref.type, title: anchor ? `「${anchor.quote.length > 40 ? `${anchor.quote.slice(0, 40)}…` : anchor.quote}」` : '片段',
      detail: anchor ? `片段 · ${doc?.title ?? '文稿'} · 版本 ${anchor.version}${anchor.page != null ? ` · 第 ${anchor.page} 页` : ''}` : '片段',
      documentId: anchor?.document_id ?? null, anchorId: ref.id, version: anchor?.version ?? null,
    };
  }
  const scene = state.contexts[ref.context_id]?.scenes?.filter(item => item.canvas_id === ref.canvas_id).reverse()
    .find(item => item.objects.some(object => object.id === ref.instance_id));
  const object = scene?.objects.find(item => item.id === ref.instance_id);
  const text = object ? (object.text || object.label) : '';
  return {
    type: ref.type, title: text ? `「${text.length > 40 ? `${text.slice(0, 40)}…` : text}」` : '画布想法',
    detail: scene ? `画布想法 · 冻结于布局版本 ${scene.revision}` : '画布想法 · 冻结场景读取中', documentId: null, anchorId: null, version: null,
  };
}

/** 读取关系中自由想法端点引用的冻结场景，供标题解析。 */
async function loadEndpointContexts(relations: Relation[]) {
  const ids = new Set<string>();
  for (const relation of relations) for (const ref of [relation.source_ref, relation.target_ref]) if (ref?.type === 'canvas_object') ids.add(ref.context_id);
  const missing = Array.from(ids).filter(id => !app.get().contexts[id]);
  const loaded = await Promise.all(missing.map(id => api.getContext(id).catch(() => null)));
  const patch: Record<string, ResearchContext> = {};
  loaded.forEach(context => { if (context) patch[context.id] = context; });
  if (Object.keys(patch).length) app.set(state => ({ contexts: { ...state.contexts, ...patch } }));
}

// ------------------------------------------------------------------ 画布就近提问
//
// 提问会话（session）在面板打开时建立、关闭时结束；会话内用户每次改变问题、勾选、选择、
// 模式、写入区域、截图或所在画布都推进代次（generation）。冻结与截图的异步结果在保存完成、
// 上下文返回、运行创建返回三处核对所属会话与代次：上下文与运行记入各自的记录，面板只按当前代次更新。

/** 打开或重新选择：同一面板内保留会话与问题，选择变化推进代次。 */
export function openAsk(input: Pick<CanvasAsk, 'canvasId' | 'ids' | 'projection' | 'materials' | 'region' | 'anchor'>) {
  app.set(state => {
    const previous = state.ask;
    // 同一选择重新打开时保留问题、回答方式、材料勾选与图像
    const same = previous && previous.canvasId === input.canvasId && JSON.stringify(previous.ids) === JSON.stringify(input.ids);
    const materials = same ? input.materials.map(item => ({ ...item, include: previous.materials.find(old => old.key === item.key)?.include ?? item.include })) : input.materials;
    return {
      ask: {
        ...input, materials, question: previous?.question ?? '', mode: same ? previous.mode : 'discussion',
        session: previous?.session ?? crypto.randomUUID(), generation: (previous?.generation ?? 0) + 1,
        visuals: same ? previous.visuals : [], context: null, contextKey: null, busy: null, error: null, problem: null,
        runId: same ? previous.runId : null,
      },
    };
  });
}

/** 关闭面板结束会话；已发起的运行继续按运行记录跟踪与归位。 */
export function closeAsk() {
  app.set({ ask: null });
}

/** 用户输入变化：推进代次，旧快照不再对应本次请求。 */
function advanceAsk(patch: Partial<CanvasAsk> = {}) {
  app.set(state => (state.ask ? { ask: { ...state.ask, ...patch, generation: state.ask.generation + 1 } } : {}));
}

/** 问题、回答方式与写入区域由用户修改。 */
export function updateAsk(patch: Partial<Pick<CanvasAsk, 'question' | 'mode' | 'region'>>) {
  advanceAsk({ ...patch, error: null, problem: null });
}

export function toggleAskMaterial(key: string) {
  app.set(state => (state.ask ? {
    ask: {
      ...state.ask, generation: state.ask.generation + 1, problem: null,
      materials: state.ask.materials.map(item => (item.key === key ? { ...item, include: !item.include } : item)),
    },
  } : {}));
}

/** 异步操作发起时捕获的会话、代次、工作区、编辑会话与画布操作对象。 */
type AskTicket = { session: string; generation: number; workspaceId: string; canvasId: string; s: ResearchSession; actions: CanvasActions };

function askTicket(): AskTicket | null {
  const { ask, workspaceId } = app.get();
  const actions = ask ? liveCanvasActions(ask.canvasId) : null;
  if (!ask || !workspaceId || !session || !actions) return null;
  return { session: ask.session, generation: ask.generation, workspaceId, canvasId: ask.canvasId, s: session, actions };
}

/** 操作仍属于当前会话的当前代次 */
function askCurrent(ticket: AskTicket) {
  const { ask, workspaceId } = app.get();
  return session === ticket.s && workspaceId === ticket.workspaceId && ask?.session === ticket.session && ask.generation === ticket.generation;
}

/** 写入所属会话的状态（忙碌、错误与运行）；会话已结束时不改动当前面板。 */
function patchAskSession(ticket: AskTicket, patch: Partial<CanvasAsk>) {
  app.set(state => (state.ask?.session === ticket.session && state.workspaceId === ticket.workspaceId ? { ask: { ...state.ask, ...patch } } : {}));
}

/** 把选区附近的对象加入本轮选择；默认不勾选其正文，由用户决定读取范围。 */
export function addNeighborsToAsk() {
  const ask = app.get().ask;
  const actions = ask ? liveCanvasActions(ask.canvasId) : null;
  if (!ask || !actions) return;
  const extra = actions.neighbors(ask.ids);
  if (extra.length === 0) { toast('选区附近没有其他对象'); return; }
  const fresh = actions.reproject([...ask.ids, ...extra]);
  if (!fresh) return;
  const added = new Set(extra);
  const materials = fresh.materials.map(item => ({
    ...item, include: ask.materials.find(old => old.key === item.key)?.include ?? (added.has(item.objectId) ? false : item.include),
  }));
  advanceAsk({ ids: [...ask.ids, ...extra], projection: fresh.projection, materials, problem: null });
  toast(`已加入附近 ${extra.length} 个对象，正文默认未勾选。`);
}

const visualOf = (asset: VisualAsset): AskVisual => ({ asset_id: asset.id, label: asset.filename, bytes: asset.byte_length, url: asset.url });

/**
 * 截取所选对象所在区域，作为提问截图上传（不生成工作区文稿）。截图完成时提问已变化则不加入本轮，
 * 截图保留在截图列表中，可重新选择。
 */
export async function captureAskRegion() {
  const ticket = askTicket();
  const ask = app.get().ask;
  if (!ticket || !ask) return;
  patchAskSession(ticket, { busy: 'capture', error: null });
  try {
    const blob = await ticket.actions.capture(ask.ids);
    const file = new File([blob], `画布选区-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, { type: 'image/png' });
    const asset = await api.uploadVisual(ticket.workspaceId, file);
    if (app.get().workspaceId === ticket.workspaceId) app.set(state => ({ visualAssets: state.visualAssets ? [...state.visualAssets.filter(item => item.id !== asset.id), asset] : state.visualAssets }));
    patchAskSession(ticket, { busy: null });
    if (askCurrent(ticket)) advanceAsk({ visuals: [...ask.visuals.filter(item => item.asset_id !== asset.id), visualOf(asset)], problem: null });
    else if (app.get().ask?.session === ticket.session) toast('截图完成时提问已变化，截图未加入本轮；可在截图列表中重新选择。');
  } catch (error) {
    patchAskSession(ticket, { busy: null, error: `截图失败：${errorText(error)}` });
  }
}

/** 从本轮材料移出截图；图像本身保留，可在截图列表中重新选择或清理。 */
export function removeAskVisual(assetId: string) {
  app.set(state => (state.ask ? { ask: { ...state.ask, generation: state.ask.generation + 1, visuals: state.ask.visuals.filter(item => item.asset_id !== assetId), problem: null } } : {}));
}

/** 按已有截图资产重新加入本轮提问。 */
export function addAskVisual(asset: VisualAsset) {
  const ask = app.get().ask;
  if (!ask || ask.visuals.some(item => item.asset_id === asset.id)) return;
  advanceAsk({ visuals: [...ask.visuals, visualOf(asset)], problem: null });
}

export async function loadVisualAssets() {
  const workspaceId = app.get().workspaceId;
  if (!workspaceId) return;
  try {
    const assets = await api.listVisualAssets(workspaceId);
    if (app.get().workspaceId === workspaceId) app.set({ visualAssets: assets });
  } catch (error) {
    reportError(error, '读取截图列表失败：');
  }
}

export type VisualReference = VisualAsset['references'][number];

/**
 * 永久清理提问截图。空引用时删除并从本轮材料移出；已有冻结预览、讨论来源、历史版本或画布引用时
 * 服务返回 asset_in_use，图像保留，返回引用位置供界面列出。
 */
export async function discardVisualAsset(assetId: string): Promise<VisualReference[] | null> {
  const workspaceId = app.get().workspaceId;
  if (!workspaceId) return null;
  try {
    await api.discardVisual(workspaceId, assetId);
    app.set(state => ({
      visualAssets: state.visualAssets?.filter(item => item.id !== assetId) ?? null,
      ask: state.ask?.visuals.some(item => item.asset_id === assetId)
        ? { ...state.ask, generation: state.ask.generation + 1, visuals: state.ask.visuals.filter(item => item.asset_id !== assetId) }
        : state.ask,
    }));
    toast('已永久清理该截图。', 'success');
    return null;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'asset_in_use') {
      const references = ((error.details as { references?: VisualReference[] }).references ?? []);
      app.set(state => ({ visualAssets: state.visualAssets?.map(item => (item.id === assetId ? { ...item, references } : item)) ?? null }));
      return references;
    }
    reportError(error, '清理截图失败：');
    return null;
  }
}

/** 截图引用位置的说明 */
export function visualReferenceLabel(reference: VisualReference) {
  const { summary, contexts } = app.get();
  switch (reference.type) {
    case 'context': {
      const question = contexts[reference.id]?.question;
      return `冻结上下文${question ? `「${question.length > 24 ? `${question.slice(0, 24)}…` : question}」` : ` ${reference.id.slice(0, 8)}`}（预览或讨论来源）`;
    }
    case 'document': return `文稿「${summary?.documents.find(doc => doc.id === reference.id)?.title ?? reference.id.slice(0, 8)}」`;
    case 'document_version': return `文稿「${summary?.documents.find(doc => doc.id === reference.id)?.title ?? reference.id.slice(0, 8)}」历史版本 ${reference.version ?? ''}`;
    case 'canvas': return `画布「${canvasName(reference.id)}」布局版本 ${reference.version ?? ''}`;
    default: return `画布提案 ${reference.id.slice(0, 8)} 的撤销快照`;
  }
}

/** 本轮请求的视觉输入：勾选的图片对象与选区截图，均关联本轮选入的场景对象。 */
function askVisuals(ask: CanvasAsk) {
  const included = ask.materials.filter(item => item.include);
  const visuals = included.filter(item => item.group === 'visual' && item.asset_id).map(item => ({ asset_id: item.asset_id!, object_ids: [item.objectId] }));
  if (ask.visuals.length) {
    const chosen = new Set(ask.ids);
    const objects = Array.from(new Set(included.map(item => item.objectId)));
    const inSelection = objects.filter(id => chosen.has(id));
    for (const visual of ask.visuals) visuals.push({ asset_id: visual.asset_id, object_ids: inSelection.length ? inSelection : objects });
  }
  return visuals;
}

/** 快照身份：问题、模式、勾选材料及其版本、画布版本、写入区域、选择与图像。 */
function askKey(ask: CanvasAsk) {
  const included = ask.materials.filter(item => item.include).map(item => `${item.key}@${item.version ?? ''}`).sort();
  return JSON.stringify([ask.mode, ask.question.trim(), included, ask.projection.canvas_revision, ask.region, ask.ids, ask.visuals.map(item => item.asset_id)]);
}

type Frozen = { context: ResearchContext } | { expired: true } | null;

/**
 * 冻结本轮阅读：保存相关文稿与画布 → 按保存后的版本重新投影 → 与上次快照身份相同则复用，
 * 否则提交场景投影、材料与图像建立新上下文。预览与发送都经过这一步，本地编辑总在复用前写入。
 * 输入取自发起时的会话代次；保存完成或上下文返回时代次已变化则返回 expired。
 */
async function freezeAsk(ticket: AskTicket): Promise<Frozen> {
  const ask = app.get().ask;
  if (!ask || !askCurrent(ticket)) return { expired: true };
  if (!ask.question.trim()) { patchAskSession(ticket, { error: '请先写下要问的问题' }); return null; }
  return onCanvasQueue(ticket.canvasId, async (): Promise<Frozen> => {
    const { s } = ticket;
    const documents = new Set<string>();
    for (const object of ask.projection.objects) if (object.ref.type === 'document' || object.ref.type === 'anchor') documents.add(object.ref.document_id);
    await Promise.all(Array.from(documents).filter(id => s.isLoaded(id)).map(id => s.flushDocument(id)));
    await s.flushCanvas(ticket.canvasId);
    // 边界一：保存完成
    if (!askCurrent(ticket)) return { expired: true };
    // 捕获的操作对象仍对应当前编辑器时直接使用；排在前面的归位采用了新画布时使用重新挂载后的同一画布
    const actions = ticket.actions.generation === s.canvasGeneration(ticket.canvasId) ? ticket.actions : await mountedCanvasActions(ticket.canvasId);
    if (!actions || !askCurrent(ticket)) return { expired: true };
    const fresh = actions.reproject(ask.ids);
    if (!fresh) return { expired: true };
    // 保留用户的勾选；投影与版本取保存后的状态
    const materials = fresh.materials.map(item => ({ ...item, include: ask.materials.find(old => old.key === item.key)?.include ?? item.include }));
    const current: CanvasAsk = { ...ask, projection: fresh.projection, materials };
    const key = askKey(current);
    if (ask.context && ask.contextKey === key) return { context: ask.context };
    const region = ask.region;
    const context = await api.createSceneContext(ticket.workspaceId, {
      question: ask.question.trim(),
      mode: ask.mode,
      projection: fresh.projection,
      materials,
      visuals: askVisuals(current),
      write_scope: {
        allow_create: ask.mode === 'canvas',
        object_ids: [],
        bounds: region ? { x: region.x, y: region.y, width: region.width, height: region.height } : null,
      },
    });
    // 边界二：上下文返回。快照记入上下文记录；面板只在代次未变时采用
    app.set(state => (state.workspaceId !== ticket.workspaceId ? {} : {
      contexts: { ...state.contexts, [context.id]: context },
      expectations: { ...state.expectations, [context.id]: expectedFromMaterials(materials) },
    }));
    if (!askCurrent(ticket)) return { expired: true };
    patchAskSession(ticket, { projection: fresh.projection, materials, context, contextKey: key });
    return { context };
  });
}

/** 服务拒绝发送时的结构化原因：材料版本变化、文字或图像超出预算、模型不接收图像。 */
function askProblem(error: unknown): AskProblem | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details as Record<string, unknown>;
  switch (error.code) {
    case 'stale_context': return { type: 'stale', changes: (details.changes ?? []) as ContextChange[] };
    case 'context_budget_exceeded': return {
      type: 'budget', count: Number(details.character_count ?? 0), limit: Number(details.max_input_characters ?? 0),
      sources: (details.sources ?? []) as Array<{ number: number; document_id: string; character_count: number }>,
    };
    case 'image_budget_exceeded': return { type: 'image_budget', message: error.message };
    case 'vision_unsupported': return { type: 'vision', message: error.message };
    default: return null;
  }
}

/** 失败说明：图像类原因只显示服务说明一次，变化对象与文字预算另附结构化明细。 */
function askFailure(error: unknown) {
  const problem = askProblem(error);
  return { problem, error: problem?.type === 'vision' || problem?.type === 'image_budget' ? null : errorText(error) };
}

const EXPIRED_NOTE = '冻结期间提问内容已变化，本次未发送；请确认当前问题、选择与材料后再次发送。';

export async function previewAsk(open = true): Promise<ResearchContext | null> {
  const ticket = askTicket();
  if (!ticket) { if (app.get().ask) updateAskError('请回到该画布后再提问'); return null; }
  patchAskSession(ticket, { busy: 'preview', error: null, problem: null });
  try {
    const frozen = await freezeAsk(ticket);
    patchAskSession(ticket, { busy: null });
    if (!frozen || 'expired' in frozen) return null;
    if (open) setDialogs({ contextId: frozen.context.id });
    return frozen.context;
  } catch (error) {
    patchAskSession(ticket, { busy: null });
    if (askCurrent(ticket)) patchAskSession(ticket, askFailure(error));
    return null;
  }
}

function updateAskError(error: string) {
  app.set(state => (state.ask ? { ask: { ...state.ask, error } } : {}));
}

/**
 * 发送：先冻结本轮阅读（必要时重建上下文），再以返回的 context_id 发起运行。
 * 冻结期间输入变化时结束本次发送；运行创建后切换画布或关闭面板，运行仍记录并按 run.origin 归位。
 * 远端修改造成 stale_context 时保留问题、选择与勾选，展示变化对象并重新冻结预览，由用户再次发送。
 */
export async function sendAsk() {
  const ticket = askTicket();
  if (!ticket) { if (app.get().ask) updateAskError('请回到该画布后再提问'); return; }
  const model = app.get().model;
  patchAskSession(ticket, { busy: 'send', error: null, problem: null });
  try {
    const frozen = await freezeAsk(ticket);
    if (!frozen) { patchAskSession(ticket, { busy: null }); return; }
    if ('expired' in frozen) { patchAskSession(ticket, { busy: null, error: app.get().ask?.session === ticket.session ? EXPIRED_NOTE : null }); return; }
    const run = await api.startRun(ticket.workspaceId, { context_id: frozen.context.id, model: model || undefined });
    // 边界三：运行创建返回。运行属于本会话，代次变化或面板关闭都继续跟踪
    replaceRun(run);
    if (app.get().workspaceId === ticket.workspaceId) {
      app.set({ activeRunId: run.id });
      watchRun(run.id);
    }
    patchAskSession(ticket, { busy: null, runId: run.id });
  } catch (error) {
    patchAskSession(ticket, { busy: null });
    if (!askCurrent(ticket)) return;
    const { error: message, problem } = askFailure(error);
    patchAskSession(ticket, { error: message, problem });
    if (problem?.type === 'stale') {
      patchAskSession(ticket, { context: null, contextKey: null });
      await adoptContextChanges(problem.changes);
      await previewAsk(false);
      if (app.get().ask?.session === ticket.session) patchAskSession(ticket, { problem, error: '材料在冻结后有更新，已按最新版本重新冻结，请检查后再次发送。' });
    }
  }
}

// ------------------------------------------------------------------ 画布提案
export function actionKey(action: CanvasAction) {
  switch (action.type) {
    case 'create_document':
    case 'create_relation':
      return action.key;
    case 'move_object':
      return `move:${action.object_id}`;
    default:
      return `replace:${action.anchor_id}`;
  }
}

export async function loadCanvasProposal(id: string) {
  try {
    const proposal = await api.getCanvasProposal(id);
    app.set(state => ({ canvasProposals: { ...state.canvasProposals, [id]: proposal } }));
    return proposal;
  } catch (error) {
    reportError(error, '读取画布提案失败：');
    return null;
  }
}

/** 从运行记录重新打开画布提案：切到所属画布并显示候选内容。 */
export async function reopenCanvasProposal(id: string) {
  const proposal = await loadCanvasProposal(id);
  if (!proposal) return;
  void loadContext(proposal.context_id);
  if (!(app.get().view.type === 'canvas' && (app.get().view as { id: string }).id === proposal.canvas_id)) openCanvas(proposal.canvas_id);
  openProposalDraft(proposal);
}

export function openProposalDraft(proposal: CanvasProposal) {
  app.set({ proposalDraft: { id: proposal.id, actions: proposal.actions.map(action => ({ ...action })), excluded: [], dirty: false, busy: null, error: null, conflict: null, unplaced: [] } });
}

export function closeProposalDraft() {
  app.set({ proposalDraft: null });
}

function patchDraft(patch: Partial<ProposalDraft>) {
  app.set(state => (state.proposalDraft ? { proposalDraft: { ...state.proposalDraft, ...patch } } : {}));
}

/** 调整候选内容或位置；只修改前端草稿，确认时连同完整操作集合提交校验。 */
export function updateProposalAction(key: string, patch: Partial<CanvasAction>) {
  app.set(state => {
    const draft = state.proposalDraft;
    if (!draft) return {};
    return { proposalDraft: { ...draft, dirty: true, error: null, actions: draft.actions.map(action => (actionKey(action) === key ? ({ ...action, ...patch } as CanvasAction) : action)) } };
  });
}

export function toggleProposalAction(key: string) {
  app.set(state => {
    const draft = state.proposalDraft;
    if (!draft) return {};
    const excluded = draft.excluded.includes(key) ? draft.excluded.filter(item => item !== key) : [...draft.excluded, key];
    return { proposalDraft: { ...draft, excluded, dirty: true, error: null } };
  });
}

/** 采用的操作集合必须依赖完整：关系引用的新建框也须被采用。 */
export function proposalDependencyErrors(draft: ProposalDraft) {
  const included = draft.actions.filter(action => !draft.excluded.includes(actionKey(action)));
  const created = new Set(included.filter(action => action.type === 'create_document').map(action => actionKey(action)));
  const errors: string[] = [];
  for (const action of included) {
    if (action.type !== 'create_relation') continue;
    for (const end of [action.source, action.target]) {
      if (end.type === 'created' && !created.has(end.key)) errors.push(`候选联系「${action.label || action.key}」引用了未采用的框 ${end.key}`);
    }
  }
  return errors;
}

async function adoptProposalResult(result: CanvasProposalResult) {
  const s = session;
  app.set(state => {
    if (!state.summary) return { canvasProposals: { ...state.canvasProposals, [result.proposal.id]: result.proposal } };
    const removedDocs = new Set(result.removed_document_ids);
    const removedRelations = new Set(result.removed_relation_ids);
    const documents = state.summary.documents.filter(doc => !removedDocs.has(doc.id));
    for (const doc of result.documents) {
      const index = documents.findIndex(item => item.id === doc.id);
      // 保留当前会话中比响应更新的版本
      if (index >= 0) { if (documents[index].current_version <= doc.current_version) documents[index] = doc; } else documents.push(doc);
    }
    const relations = state.summary.relations.filter(relation => !removedRelations.has(relation.id));
    for (const relation of result.relations) {
      const index = relations.findIndex(item => item.id === relation.id);
      if (index >= 0) relations[index] = relation; else relations.push(relation);
    }
    s?.setRelations(relations);
    return {
      summary: { ...state.summary, documents, relations },
      canvasProposals: { ...state.canvasProposals, [result.proposal.id]: result.proposal },
    };
  });
  for (const doc of result.documents) if (s?.isLoaded(doc.id) && (s.docStatus(doc.id)?.version ?? 0) <= doc.current_version) s.applyServerDocument(doc);
  if (s) await s.adoptServerCanvas(result.canvas, documentMap());
}

/**
 * 确认写入：暂停画布自动保存并保存已有修改 → 提交调整后的操作集合 → 后端在一个事务中
 * 物化文稿、关系、Yjs 与对象表 → 采用响应的画布与文稿版本 → 恢复自动保存。
 * 请求中断时读取提案状态：已应用则以幂等的重复确认取回同一事务结果。
 */
export async function applyProposalDraft(options: { acceptCanvasChanges?: boolean } = {}) {
  const draft = app.get().proposalDraft;
  const s = session;
  let proposal = draft ? app.get().canvasProposals[draft.id] : undefined;
  if (!draft || !s || !proposal) return;
  const canvasId = proposal.canvas_id;
  patchDraft({ busy: 'apply', error: null });
  let held = false;
  try {
    const revision = await s.holdCanvas(canvasId);
    held = true;
    if (revision !== proposal.canvas_revision && !options.acceptCanvasChanges) {
      patchDraft({ busy: null, conflict: { from: proposal.canvas_revision, to: revision } });
      return;
    }
    if (draft.dirty || revision !== proposal.canvas_revision) {
      proposal = await api.updateCanvasProposal(proposal.id, {
        expected_revision: proposal.revision,
        actions: draft.actions.filter(action => !draft.excluded.includes(actionKey(action))),
        expected_canvas_revision: revision !== proposal.canvas_revision ? revision : undefined,
      });
      app.set(state => ({ canvasProposals: { ...state.canvasProposals, [proposal!.id]: proposal! } }));
    }
    const input = { expected_revision: proposal.revision, expected_canvas_revision: revision };
    let result: CanvasProposalResult;
    try {
      result = await api.applyCanvasProposal(proposal.id, input);
    } catch (error) {
      if (!(error instanceof ApiError && (error.isNetwork || error.status >= 500))) throw error;
      // 响应丢失：事务要么完整提交要么未发生；读取提案状态决定取回结果或允许重试
      const current = await api.getCanvasProposal(proposal.id);
      if (current.status !== 'applied') throw new Error(`确认请求未完成（${error.message}），画布未写入，可重试。`);
      result = await api.applyCanvasProposal(proposal.id, input);
    }
    await adoptProposalResult(result);
    patchDraft({ busy: null, dirty: false, conflict: null, unplaced: unplacedRelations(result), actions: result.proposal.actions, excluded: [] });
    toast(`已写入 ${result.proposal.actions.length} 项画布操作，可整组撤销。`, 'success', { label: '撤销本次写入', run: () => void revertProposalDraft() });
  } catch (error) {
    if (error instanceof ApiError && error.isConflict) {
      // 其他客户端已更新画布：本地修改已在暂停保存时写入，载入服务端画布后由用户按当前画布确认
      const server = held ? await api.getCanvas(canvasId).catch(() => null) : null;
      if (server && server.revision > (s.canvasStatus(canvasId)?.version ?? server.revision)) {
        await s.adoptServerCanvas(server, documentMap());
        patchDraft({ busy: null, error: null, conflict: { from: proposal.canvas_revision, to: server.revision } });
      } else {
        const current = error.currentVersion ?? null;
        patchDraft({ busy: null, error: `${error.message}${current != null ? `（当前版本 ${current}）` : ''}。生成结果与调整仍保留。`, conflict: current != null ? { from: proposal.canvas_revision, to: current } : null });
      }
      await loadCanvasProposal(draft.id);
    } else {
      patchDraft({ busy: null, error: errorText(error) });
    }
  } finally {
    if (held) s.releaseCanvas(canvasId);
  }
}

/** 应用结果中没有在本画布形成连线的新关系（端点位于其他画布时保持待放置）。 */
function unplacedRelations(result: CanvasProposalResult) {
  const views = Object.values((result.canvas.editor_state as EditorStateEnvelope | null)?.link_views ?? {});
  const bound = new Set(views.map(view => view.relation_id));
  return result.relations.filter(relation => !bound.has(relation.id)).map(relation => relation.id);
}

/** 按本次事务整组撤销。后续编辑或引用导致的冲突保留现状并显示原因。 */
export async function revertProposalDraft(id = app.get().proposalDraft?.id) {
  const s = session;
  const proposal = id ? app.get().canvasProposals[id] ?? await loadCanvasProposal(id) : null;
  if (!s || !proposal) return;
  if (app.get().proposalDraft?.id === proposal.id) patchDraft({ busy: 'revert', error: null });
  let held = false;
  try {
    const revision = await s.holdCanvas(proposal.canvas_id);
    held = true;
    const result = await api.revertCanvasProposal(proposal.id, { expected_revision: proposal.revision, expected_canvas_revision: revision });
    await adoptProposalResult(result);
    if (app.get().proposalDraft?.id === proposal.id) patchDraft({ busy: null });
    toast('已撤销本次画布写入，原有材料与关系保持原状态。', 'success');
  } catch (error) {
    const message = error instanceof ApiError && error.code === 'dependent_changes' ? `${error.message}。当前内容保持不变。` : errorText(error);
    if (app.get().proposalDraft?.id === proposal.id) patchDraft({ busy: null, error: message });
    else toast(`撤销失败：${message}`, 'error');
  } finally {
    if (held) s.releaseCanvas(proposal.canvas_id);
  }
}

export async function rejectProposalDraft() {
  const draft = app.get().proposalDraft;
  const proposal = draft ? app.get().canvasProposals[draft.id] : undefined;
  if (!draft || !proposal) return;
  patchDraft({ busy: 'reject', error: null });
  try {
    const result = await api.rejectCanvasProposal(proposal.id, { expected_revision: proposal.revision });
    app.set(state => ({ canvasProposals: { ...state.canvasProposals, [result.id]: result }, proposalDraft: null }));
    toast('已拒绝本次画布提案，画布保持原状；分析正文仍保留在运行记录中。');
  } catch (error) {
    patchDraft({ busy: null, error: errorText(error) });
  }
}

// ------------------------------------------------------------------ 学科桥与画布连线视图
export function openBridge(relationId: string, canvasId?: string | null) {
  app.set({ bridge: { relationId, canvasId: canvasId ?? null }, selectedRelationId: relationId });
}

export function closeBridge() {
  app.set({ bridge: null });
}

function currentCanvasId() {
  const view = app.get().view;
  return view.type === 'canvas' ? view.id : null;
}

export function showRelationOnCanvas(relationId: string) {
  const canvasId = currentCanvasId();
  if (!canvasId || !session) return;
  const relation = app.get().summary?.relations.find(item => item.id === relationId);
  const result = session.showRelation(canvasId, relationId);
  if (relation && result.views === 0) {
    // 说明哪一端不在本画布：文稿需要卡片，片段需要片段卡片，想法需在其所属画布
    const missing = (['source', 'target'] as const).filter((_, index) => !result.placed[index]).map(side => {
      const info = endpointInfo(relation, side);
      const ref = relationEndpoint(relation, side);
      const where = ref.type === 'canvas_object' && ref.canvas_id !== canvasId
        ? `属于画布「${app.get().summary?.canvases.find(canvas => canvas.id === ref.canvas_id)?.name ?? '其他画布'}」`
        : ref.type === 'anchor' ? '尚无片段卡片在本画布' : ref.type === 'canvas_object' ? '已从本画布删除' : '尚无卡片在本画布';
      return `${info.title}${where}`;
    });
    toast(missing.length
      ? `关系保持未放置：${missing.join('；')}。放入后会显示连线。`
      : '两端已在本画布，但未能生成连线。', 'info');
  } else if (result.unhidden) {
    toast('已在本画布显示该关系的连线。', 'success');
  }
  app.set(state => ({ summary: state.summary ? { ...state.summary } : null }));
}

export function hideRelationOnCanvas(relationId: string) {
  const canvasId = currentCanvasId();
  if (!canvasId || !session) return;
  session.hideRelation(canvasId, relationId);
  toast('已在本画布隐藏该关系的连线，研究关系保留。', 'info', { label: '恢复显示', run: () => showRelationOnCanvas(relationId) });
  app.set(state => ({ summary: state.summary ? { ...state.summary } : null }));
}

/**
 * 显式操作：为一条纯视觉或已改接的连线建立研究关系，并绑定到该视图。
 * 文稿卡片使用文稿端点，片段卡片使用精确锚点；自由想法先冻结两端与连线的场景，
 * 再以 canvas_object 引用该场景中的实例。
 */
/** “研究这个联系”：用户显式把一条视觉连线建立为候选研究关系 */
export async function relateConnector(canvasId: string, connectorId: string, label: string) {
  const { workspaceId } = app.get();
  const s = session;
  if (!workspaceId || !s) return null;
  const [source, target] = s.connectorEndpoints(canvasId, connectorId);
  if (!source || !target || source.instance === target.instance) {
    toast('研究关系的两端需要是文稿卡片、片段卡片或带文字的想法（便笺、文字、形状）。', 'error');
    return null;
  }
  const typed = source.type !== 'document' || target.type !== 'document';
  if (source.type === 'document' && target.type === 'document' && source.id === target.id) {
    toast('两端是同一篇文稿的卡片；如需研究其中两处内容，请先放置片段卡片。', 'error');
    return null;
  }
  try {
    let contextId: string | null = null;
    if (source.type === 'free' || target.type === 'free') {
      // 自由想法没有内容标识：冻结两端与连线的场景，关系引用该快照中的实例
      await s.flushCanvas(canvasId);
      const fresh = liveCanvasActions(canvasId)?.reproject([source.instance, target.instance, connectorId]) ?? null;
      if (!fresh) throw new Error('请回到该画布后再建立关系');
      const context = await api.createSceneContext(workspaceId, {
        question: '建立研究关系：记录两端对象及连线的冻结场景',
        mode: 'relation',
        projection: fresh.projection,
        materials: fresh.materials,
        write_scope: { allow_create: false, object_ids: [], bounds: null },
      });
      app.set(state => ({ contexts: { ...state.contexts, [context.id]: context } }));
      contextId = context.id;
    }
    const ref = (end: ConnectorEnd): ResearchEndpoint => end.type === 'free'
      ? { type: 'canvas_object', context_id: contextId!, canvas_id: canvasId, instance_id: end.instance }
      : { type: end.type, id: end.id };
    const claim = { ...emptyClaim, status: 'candidate' as const };
    const relation = await api.createRelation(workspaceId, typed
      ? { source_ref: ref(source), target_ref: ref(target), kind: '关联', label, claim }
      : { source_id: source.id, target_id: target.id, kind: '关联', label, claim });
    if (contextId) toast('已冻结两端想法的场景并建立候选关系，想法内容按建立时的文字记录。', 'success', { label: '查看场景', run: () => setDialogs({ contextId }) });
    s.bindConnector(canvasId, connectorId, relation.id);
    upsertRelation(relation);
    setCanvasSelection({ kind: 'relation', relationId: relation.id, connectorId });
    openBridge(relation.id, canvasId);
    return relation;
  } catch (error) {
    reportError(error, '建立关系失败：');
    return null;
  }
}

// ------------------------------------------------------------------ 归档
export async function restoreArchive(file: File) {
  try {
    const archive = JSON.parse(await file.text()) as unknown;
    const workspace = await api.importArchive(archive);
    app.set(state => ({ workspaces: [workspace, ...state.workspaces.filter(item => item.id !== workspace.id)] }));
    toast(`已恢复工作区「${workspace.name}」`, 'success');
    await openWorkspace(workspace.id);
  } catch (error) {
    if (error instanceof SyntaxError) toast('归档文件不是有效的 JSON', 'error');
    else reportError(error, '恢复归档失败：');
  }
}

export async function exportWith(kind: 'json' | 'zip') {
  const workspaceId = app.get().workspaceId;
  if (!workspaceId) return;
  await session?.flushAll();
  const link = document.createElement('a');
  link.href = kind === 'json' ? api.exportJsonUrl(workspaceId) : api.exportZipUrl(workspaceId);
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void session?.flushAll();
});

/** 工作区切换遇到保存失败或冲突时：重试、返回处理，或明确放弃后切换。 */
export async function resolveUnsavedSwitch(action: 'retry' | 'review' | 'discard') {
  const unsaved = app.get().unsaved;
  if (!unsaved) return;
  if (action === 'review') {
    app.set({ unsaved: null, dialogs: { ...app.get().dialogs, workspace: false } });
    const first = unsaved.items[0];
    if (first?.kind === 'canvas') openCanvas(first.id);
    else if (first) openDocument(first.id);
    return;
  }
  await openWorkspace(unsaved.targetId, { discard: action === 'discard' });
}

window.addEventListener('beforeunload', event => {
  if (session?.hasPendingChanges()) {
    void session.flushAll();
    event.preventDefault();
  }
});
