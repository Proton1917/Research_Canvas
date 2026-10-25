// 应用状态与操作。所有数据来自后端接口；编辑器内容由 ResearchSession 管理。
import {
  api, ApiError, type Anchor, type AnchorResolution, type Canvas, type CanvasAction, type CanvasProposal, type CanvasProposalResult,
  type Capabilities, type Claim, type DocumentKind, type Health,
  type ModelCatalog, type Proposal, type Relation, type RelationInput, type ResearchContext, type ResearchDocument,
  type ResearchEndpoint, type ResearchMode, type Run, subscribeRun, TERMINAL_RUN_STATUSES, type Workspace, type WorkspaceSummary,
} from '@research';
import {
  type ConnectorEnd, type LinkEvent, type PendingSave, relationEndpoint, ResearchSession, type SceneLayout, type SceneProjection, type SelectionTarget, setEditorColorScheme, setPrimaryMode,
} from '@research/editor';

import { createStore, useStore } from '../lib/store';
import {
  type ExpectedSource, expectedFromMaterials, inheritedSources, legacyRequest, type Material,
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
  context: ResearchContext | null;
  contextKey: string | null;
  busy: 'preview' | 'send' | null;
  error: string | null;
  runId: string | null;
  placed: string | null;
};

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
};

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
export function capabilityOn(capabilities: Capabilities | null, name: 'scene_context' | 'frozen_inheritance' | 'canvas_proposals') {
  const value = capabilities?.[name];
  return value === true || (typeof value === 'number' && value > 0);
}

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
  session.onCanvasSaved = canvas => upsertCanvas(canvas);
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
    sceneIds: [], ask: null, expectations: {}, bridge: null, canvasProposals: {}, proposalDraft: null,
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
  if (event.type === 'relation-created') {
    toast('已为两张文稿卡片的连线建立研究关系。删除这条线只会在本画布隐藏它，研究关系在关系面板中管理。', 'success', {
      label: '研究这个联系', run: () => openBridge(event.relation.id, event.canvasId),
    });
  } else if (event.type === 'relation-failed') {
    toast(`连线已保留为纯视觉连线，建立研究关系失败：${event.error}`, 'error');
  } else if (event.type === 'view-hidden') {
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
  app.set({ view: { type: 'canvas', id }, lastCanvasId: id, canvasSelection: null, sidebarOpen: false });
}

export function openDocument(id: string, focus?: { anchorId: string } | null) {
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
  place(documentId: string, near?: string | null, point?: [number, number]): Promise<string | null>;
  placeFragment(anchor: Anchor, nearDocumentId?: string | null): string | null;
  ask(ids: string[]): void;
  /** 按当前选择重新生成投影（画布保存后取得对应 revision） */
  reproject(ids: string[]): { projection: SceneProjection; materials: Material[] } | null;
};
let canvasActions: CanvasActions | null = null;
export function registerCanvasActions(actions: CanvasActions | null) {
  canvasActions = actions;
}

async function waitCanvasActions(): Promise<CanvasActions | null> {
  const view = app.get().view;
  const canvasId = view.type === 'canvas' ? view.id : app.get().lastCanvasId;
  if (!canvasId) { toast('请先打开一张画布', 'error'); return null; }
  if (view.type !== 'canvas') openCanvas(canvasId);
  // 画布视图挂载后执行
  for (let i = 0; i < 60 && canvasActions?.canvasId !== canvasId; i++) await new Promise(resolve => setTimeout(resolve, 50));
  return canvasActions?.canvasId === canvasId ? canvasActions : null;
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

function composerKey(composer: Composer) {
  return JSON.stringify([composer.mode, composer.question.trim(), [...composer.documentIds].sort(), [...composer.anchorIds].sort()]);
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
  const key = composerKey(composer);
  if (composer.preview && composer.previewKey === key) {
    if (open) setDialogs({ contextId: composer.preview.id });
    return composer.preview;
  }
  updateComposer({ busy: 'preview' });
  try {
    await flushMaterials(composer);
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
    updateComposer({ busy: null, error: errorText(error) });
  }
}

export function watchRun(id: string) {
  if (runSubscriptions.has(id)) return;
  const close = subscribeRun(id, ({ run }) => {
    app.set(state => ({ runs: state.runs.some(item => item.id === run.id) ? state.runs.map(item => (item.id === run.id ? run : item)) : [run, ...state.runs] }));
    if (TERMINAL_RUN_STATUSES.includes(run.status)) {
      runSubscriptions.delete(id);
      void onRunFinished(run);
    }
  });
  runSubscriptions.set(id, close);
}

async function onRunFinished(run: Run) {
  const ask = app.get().ask;
  if (ask?.runId === run.id) app.set(state => (state.ask ? { ask: { ...state.ask, busy: null } } : {}));
  if (run.status === 'succeeded') {
    await refreshSummary();
    if (run.canvas_proposal_id) {
      const proposal = await loadCanvasProposal(run.canvas_proposal_id);
      if (proposal && proposal.status === 'pending') openProposalDraft(proposal);
    }
    if (ask?.runId === run.id && run.document_id) {
      // 讨论框放在本次提问的写入区域，留在所讨论对象附近；来源连线由讨论关系同步生成
      const point: [number, number] | undefined = ask.region ? [ask.region.x, ask.region.y] : undefined;
      const placed = await placeOnCanvas(run.document_id, null, point);
      if (placed) {
        // 保留来源连接：从所选片段、想法与卡片连到讨论框（连线与分组不作为起点）
        const sources = ask.projection.objects.filter(object => !object.via && ['fragment', 'idea', 'discussion'].includes(object.kind)).map(object => object.instance_id);
        session?.addSourceLinks(ask.canvasId, sources.slice(0, 6), placed);
      }
      app.set(state => (state.ask?.runId === run.id ? { ask: { ...state.ask, placed } } : {}));
    }
    if (run.document_id) {
      void loadDiscussionContexts();
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

export async function cancelRun(id: string) {
  try {
    const run = await api.cancelRun(id);
    app.set(state => ({ runs: state.runs.map(item => (item.id === run.id ? run : item)) }));
  } catch (error) {
    reportError(error, '取消失败：');
  }
}

function replaceRun(run: Run) {
  app.set(state => ({ runs: state.runs.some(item => item.id === run.id) ? state.runs.map(item => (item.id === run.id ? run : item)) : [run, ...state.runs] }));
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
      ask: state.ask?.runId === failed.id ? { ...state.ask, runId: run.id, busy: 'send', placed: null } : state.ask,
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
export function openAsk(input: Pick<CanvasAsk, 'canvasId' | 'ids' | 'projection' | 'materials' | 'region' | 'anchor'>) {
  const defaultMode: CanvasAsk['mode'] = capabilityOn(app.get().capabilities, 'canvas_proposals') ? 'canvas' : 'discussion';
  app.set(state => {
    const previous = state.ask;
    // 同一选择重新打开时保留问题与材料勾选
    const same = previous && previous.canvasId === input.canvasId && JSON.stringify(previous.ids) === JSON.stringify(input.ids);
    const materials = same ? input.materials.map(item => ({ ...item, include: previous.materials.find(old => old.key === item.key)?.include ?? item.include })) : input.materials;
    return {
      ask: {
        ...input, materials, question: same ? previous.question : previous?.question ?? '', mode: previous?.mode ?? defaultMode,
        context: null, contextKey: null, busy: null, error: null, runId: same ? previous.runId : null, placed: same ? previous.placed : null,
      },
    };
  });
}

export function closeAsk() {
  app.set({ ask: null });
}

export function updateAsk(patch: Partial<CanvasAsk>) {
  app.set(state => {
    if (!state.ask) return {};
    const next = { ...state.ask, ...patch, error: patch.error === undefined ? null : patch.error };
    // 问题或材料变化后旧快照不再对应本次请求
    if (patch.question !== undefined && patch.question !== state.ask.question) { next.context = null; next.contextKey = null; }
    return { ask: next };
  });
}

export function toggleAskMaterial(key: string) {
  app.set(state => (state.ask ? {
    ask: { ...state.ask, context: null, contextKey: null, materials: state.ask.materials.map(item => (item.key === key ? { ...item, include: !item.include } : item)) },
  } : {}));
}

function askKey(ask: CanvasAsk) {
  const included = ask.materials.filter(item => item.include).map(item => item.key).sort();
  return JSON.stringify([ask.mode, ask.question.trim(), included, ask.region, ask.ids]);
}

/**
 * 预览本次阅读与写入范围。服务声明场景上下文能力时：先保存画布与相关文稿，
 * 再按保存后的 revision 重新投影，提交 SceneProjection 与 Material[]（include 决定阅读范围）。
 * 旧服务只接收片段与文稿，按 document_ids / anchor_ids 提交。
 */
export async function previewAsk(open = true): Promise<ResearchContext | null> {
  const { ask, workspaceId, capabilities } = app.get();
  if (!ask || !workspaceId) return null;
  if (!ask.question.trim()) { updateAsk({ error: '请先写下要问的问题' }); return null; }
  const key = askKey(ask);
  if (ask.context && ask.contextKey === key) {
    if (open) setDialogs({ contextId: ask.context.id });
    return ask.context;
  }
  updateAsk({ busy: 'preview' });
  try {
    const s = session;
    const request = legacyRequest(ask.materials);
    const anchorDocs = (app.get().summary?.anchors ?? []).filter(anchor => request.anchor_ids.includes(anchor.id)).map(anchor => anchor.document_id);
    if (s) await Promise.all(Array.from(new Set([...request.document_ids, ...anchorDocs])).filter(id => s.isLoaded(id)).map(id => s.flushDocument(id)));
    let context: ResearchContext;
    if (capabilityOn(capabilities, 'scene_context')) {
      if (s) await s.flushCanvas(ask.canvasId);
      const fresh = canvasActions?.canvasId === ask.canvasId ? canvasActions.reproject(ask.ids) : null;
      if (!fresh) throw new Error('请回到该画布后再预览');
      // 保留用户的勾选，投影与版本取保存后的状态
      const materials = fresh.materials.map(item => ({ ...item, include: ask.materials.find(old => old.key === item.key)?.include ?? item.include }));
      const region = ask.region;
      context = await api.createSceneContext(workspaceId, {
        question: ask.question.trim(),
        mode: ask.mode,
        projection: fresh.projection,
        materials,
        write_scope: {
          allow_create: ask.mode === 'canvas',
          object_ids: [],
          bounds: region ? { x: region.x, y: region.y, width: region.width, height: region.height } : null,
        },
      });
      app.set(state => (state.ask ? { ask: { ...state.ask, projection: fresh.projection, materials } } : {}));
    } else {
      context = await api.createContext(workspaceId, { question: ask.question.trim(), mode: 'discussion', ...request });
    }
    const expected = expectedFromMaterials(app.get().ask?.materials ?? ask.materials);
    app.set(state => ({
      contexts: { ...state.contexts, [context.id]: context },
      expectations: { ...state.expectations, [context.id]: expected },
      ask: state.ask ? { ...state.ask, context, contextKey: askKey(state.ask), busy: null, error: null } : null,
    }));
    if (open) setDialogs({ contextId: context.id });
    return context;
  } catch (error) {
    updateAsk({ busy: null, error: errorText(error) });
    return null;
  }
}

export async function sendAsk() {
  const { workspaceId, model } = app.get();
  if (!workspaceId) return;
  const context = await previewAsk(false);
  if (!context) return;
  updateAsk({ busy: 'send' });
  try {
    const run = await api.startRun(workspaceId, { context_id: context.id, model: model || undefined });
    app.set(state => ({
      runs: [run, ...state.runs.filter(item => item.id !== run.id)],
      ask: state.ask ? { ...state.ask, runId: run.id, placed: null } : null,
    }));
    watchRun(run.id);
  } catch (error) {
    updateAsk({ busy: null, error: errorText(error) });
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
 * 确认写入：暂停画布自动保存并保存已有修改 → 提交调整后的操作集合 →
 * 在隔离副本中物化完整 editor_state → 事务应用 → 采用服务端返回的画布与文稿版本 → 恢复自动保存。
 */
export async function applyProposalDraft(options: { acceptCanvasChanges?: boolean } = {}) {
  const draft = app.get().proposalDraft;
  const s = session;
  let proposal = draft ? app.get().canvasProposals[draft.id] : undefined;
  if (!draft || !s || !proposal) return;
  const dependency = proposalDependencyErrors(draft);
  if (dependency.length) { patchDraft({ error: dependency.join('；') }); return; }
  const canvasId = proposal.canvas_id;
  if (!s.canvasStatus(canvasId)) { patchDraft({ error: '请先打开该提案所属的画布' }); return; }
  patchDraft({ busy: 'apply', error: null });
  let held = false;
  try {
    const revision = await s.holdCanvas(canvasId);
    held = true;
    if (revision !== proposal.canvas_revision && !options.acceptCanvasChanges) {
      patchDraft({ busy: null, conflict: { from: proposal.canvas_revision, to: revision } });
      return;
    }
    const actions = draft.actions.filter(action => !draft.excluded.includes(actionKey(action)));
    if (draft.dirty || revision !== proposal.canvas_revision) {
      proposal = await api.updateCanvasProposal(proposal.id, {
        expected_revision: proposal.revision,
        actions,
        expected_canvas_revision: revision !== proposal.canvas_revision ? revision : undefined,
      });
      app.set(state => ({ canvasProposals: { ...state.canvasProposals, [proposal!.id]: proposal! } }));
    }
    const { envelope, unplaced } = s.materializeProposal(canvasId, proposal.actions, proposal.id_map);
    const result = await api.applyCanvasProposal(proposal.id, { expected_revision: proposal.revision, expected_canvas_revision: revision, editor_state: envelope });
    await adoptProposalResult(result);
    patchDraft({ busy: null, dirty: false, conflict: null, unplaced, actions: result.proposal.actions, excluded: [] });
    toast(`已写入 ${result.proposal.actions.length} 项画布操作，可整组撤销。`, 'success', { label: '撤销本次写入', run: () => void revertProposalDraft() });
  } catch (error) {
    if (error instanceof ApiError && error.isConflict) {
      const current = error.currentVersion ?? null;
      patchDraft({ busy: null, error: `${error.message}${current != null ? `（当前版本 ${current}）` : ''}。生成结果与调整仍保留。`, conflict: current != null && proposal ? { from: proposal.canvas_revision, to: current } : null });
      await loadCanvasProposal(draft.id);
    } else {
      patchDraft({ busy: null, error: errorText(error) });
    }
  } finally {
    if (held) s.releaseCanvas(canvasId);
  }
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
export async function relateConnector(canvasId: string, connectorId: string) {
  const { workspaceId, capabilities } = app.get();
  const s = session;
  if (!workspaceId || !s) return null;
  const [source, target] = s.connectorEndpoints(canvasId, connectorId);
  if (!source || !target || source.instance === target.instance) {
    toast('研究关系的两端需要是文稿卡片、片段卡片或带文字的想法（便笺、文字、形状）。', 'error');
    return null;
  }
  const typed = source.type !== 'document' || target.type !== 'document';
  if (typed && !capabilities?.relation_endpoints) {
    toast('当前后端尚未提供片段与想法端点，关系的两端需要是文稿卡片。', 'error');
    return null;
  }
  if (source.type === 'document' && target.type === 'document' && source.id === target.id) {
    toast('两端是同一篇文稿的卡片；如需研究其中两处内容，请先放置片段卡片。', 'error');
    return null;
  }
  try {
    let contextId: string | null = null;
    if (source.type === 'free' || target.type === 'free') {
      // 自由想法没有内容标识：冻结两端与连线的场景，关系引用该快照中的实例
      await s.flushCanvas(canvasId);
      const fresh = canvasActions?.canvasId === canvasId ? canvasActions.reproject([source.instance, target.instance, connectorId]) : null;
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
    const relation = await api.createRelation(workspaceId, typed
      ? { source_ref: ref(source), target_ref: ref(target), kind: '关联', label: '' }
      : { source_id: source.id, target_id: target.id, kind: '关联', label: '' });
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
