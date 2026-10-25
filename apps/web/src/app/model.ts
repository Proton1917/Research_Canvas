// 应用状态与操作。所有数据来自后端接口；编辑器内容由 ResearchSession 管理。
import {
  api, ApiError, type Anchor, type AnchorResolution, type Canvas, type Claim, type DocumentKind, type Health,
  type ModelCatalog, type Proposal, type Relation, type RelationInput, type ResearchContext, type ResearchDocument,
  type ResearchMode, type Run, subscribeRun, TERMINAL_RUN_STATUSES, type Workspace, type WorkspaceSummary,
} from '@research-canvas/research';
import { ResearchSession, type SelectionTarget, setEditorColorScheme, setPrimaryMode } from '@research-canvas/research/editor';

import { createStore, useStore } from '../lib/store';

export type View =
  | { type: 'empty' }
  | { type: 'canvas'; id: string }
  | { type: 'document'; id: string; focus?: { anchorId: string } | null };

export type PanelTab = 'discuss' | 'anchors' | 'relations' | 'versions' | 'runs';

export type CanvasSelection =
  | { kind: 'card'; documentId: string; blockId: string }
  | { kind: 'relation'; relationId: string }
  | null;

export type Composer = {
  mode: ResearchMode;
  question: string;
  documentIds: string[];
  anchorIds: string[];
  preview: ResearchContext | null;
  previewKey: string | null;
  busy: 'preview' | 'send' | null;
  error: string | null;
};

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

const emptyComposer: Composer = { mode: 'discussion', question: '', documentIds: [], anchorIds: [], preview: null, previewKey: null, busy: null, error: null };

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

export async function openWorkspace(id: string) {
  const previous = session;
  if (previous) {
    await previous.flushAll();
    previous.dispose();
  }
  runSubscriptions.forEach(close => close());
  runSubscriptions.clear();
  session = new ResearchSession(id);
  session.onDocumentSaved = doc => upsertDocument(doc);
  session.onCanvasSaved = canvas => upsertCanvas(canvas);
  session.onRelationsChanged = () => void refreshSummary();
  session.onAssetImported = result => {
    upsertDocument(result.document);
    toast(`图片已保存为工作区文件「${result.document.title}」`, 'success');
  };
  writeLocal('rc:workspace', id);
  app.set({
    workspaceId: id, summary: null, runs: [], contexts: {}, proposals: {}, resolutions: {}, loadingWorkspace: true,
    workspaceError: null, view: { type: 'empty' }, canvasSelection: null, selectedRelationId: null, composer: emptyComposer, picked: [],
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
  } catch (error) {
    app.set({ loadingWorkspace: false, workspaceError: errorText(error) });
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
    if (options.place) await placeOnCanvas(doc.id);
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

/** 画布视图注册的放置函数：按当前视口中心或指定位置放置文稿卡片。 */
let canvasPlacer: ((documentId: string, near?: string | null) => Promise<void>) | null = null;
export function registerCanvasPlacer(placer: typeof canvasPlacer) {
  canvasPlacer = placer;
}

export async function placeOnCanvas(documentId: string, near?: string | null) {
  const view = app.get().view;
  const canvasId = view.type === 'canvas' ? view.id : app.get().lastCanvasId;
  if (!canvasId) { toast('请先打开一张画布', 'error'); return; }
  if (view.type !== 'canvas') openCanvas(canvasId);
  // 画布视图挂载后执行放置
  for (let i = 0; i < 40 && !canvasPlacer; i++) await new Promise(resolve => setTimeout(resolve, 50));
  if (!canvasPlacer) return;
  try {
    await canvasPlacer(documentId, near);
  } catch (error) {
    reportError(error, '放置失败：');
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
    composer: { ...emptyComposer, mode: 'discussion', question: state.composer.question, documentIds: discussionIds },
    tab: 'discuss',
    panelOpen: true,
  }));
  focusComposer();
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
    app.set(state => ({
      contexts: { ...state.contexts, [context.id]: context },
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
      composer: { ...state.composer, busy: null, question: '', preview: null, previewKey: null, error: null },
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
  if (run.status === 'succeeded') {
    await refreshSummary();
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

export const emptyClaim: Claim = { status: 'analogy', conditions: '', counterexamples: '', sources: [] };

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

window.addEventListener('beforeunload', event => {
  if (session?.hasPendingChanges()) {
    void session.flushAll();
    event.preventDefault();
  }
});
