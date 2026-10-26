// 工作区编辑会话：载入后端文稿与画布，负责恢复、自动保存、
// 版本冲突、服务端改写后的重建，以及画布连线与工作区关系的同步。
import { MarkdownAdapter, titleMiddleware } from '@editor/shared/adapters';
import type { Store } from '@editor/document';
import { MarkdownTransformer } from '@editor/widgets/linked-doc';
import { Text } from '@editor/document';
import * as Y from 'yjs';

import { api, ApiError } from '../api/client';
import type {
  Anchor, Canvas, CanvasObject, Content, EditorStateEnvelope, ProposalEndpoint, FragmentCard, ImportResult, LinkView, Relation, ResearchDocument, ResearchEndpoint, TextBlock,
} from '../api/types';
import { AssetBlobSource } from './blob-source';
import { getStoreExtensions } from './extensions';
import {
  buildCanvasStore, buildEmptyStore, buildStoreFromBlocks, parseBlockText, projectStore, reconcileStore, storeTitle,
} from './projection';
import { ResearchWorkspace } from './workspace';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error' | 'readonly';

export type EntryStatus = {
  state: SaveState;
  version: number;
  error?: string;
  conflictVersion?: number;
  savedAt?: number;
  /** 本地编辑序号：每次编辑递增 */
  seq?: number;
  /** 服务端已确认保存的编辑序号 */
  savedSeq?: number;
};

/** 保存失败或冲突、需要用户处理的对象。 */
export type PendingSave = { kind: 'document' | 'canvas'; id: string; title: string; state: SaveState; error?: string };

type DocEntry = {
  id: string;
  doc: ResearchDocument;
  store: Store;
  pages: Map<string, number>;
  readonly: boolean;
  status: EntryStatus;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
  /** 本地编辑序号，每次编辑状态更新时递增 */
  seq: number;
  /** 最近一次被服务端确认的快照对应的序号 */
  savedSeq: number;
  suppress: number;
  /** 仅有首次打开的格式转换、尚未写回；首次编辑或 flushDocument 时一并保存 */
  deferred?: boolean;
};

type CanvasEntry = {
  id: string;
  canvas: Canvas;
  store: Store;
  /** 连线标识 → 视图记录 */
  views: Map<string, LinkView>;
  /** 本画布隐藏的研究关系 */
  hidden: Set<string>;
  /** 片段卡片块标识 → 锚点引用 */
  fragments: Map<string, FragmentCard>;
  /** 本次会话中移除的视图；撤销恢复同一连线时重新绑定 */
  removed: Map<string, LinkView>;
  /** 保存暂停计数：画布事务提交期间不发起自动保存 */
  held: number;
  status: EntryStatus;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
  /** 本地编辑序号，每次编辑状态更新时递增 */
  seq: number;
  /** 最近一次被服务端确认的快照对应的序号 */
  savedSeq: number;
  suppress: number;
};

const SAVE_DELAY = 1200;
const SYNCED_DOC = 'affine:embed-synced-doc';

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function readEnvelope(state: unknown): EditorStateEnvelope | null {
  if (!state || typeof state !== 'object') return null;
  const envelope = state as Partial<EditorStateEnvelope>;
  return envelope.format === 'blocksuite-yjs-v1' && typeof envelope.update === 'string' ? (envelope as EditorStateEnvelope) : null;
}

function parseXYWH(value: string): [number, number, number, number] {
  try {
    const parsed = JSON.parse(value) as number[];
    if (parsed.length === 4 && parsed.every(Number.isFinite)) return parsed as [number, number, number, number];
  } catch {
    /* 非法布局值按原点处理 */
  }
  return [0, 0, 0, 0];
}

type ConnectorLike = { id: string; source: { id?: string }; target: { id?: string } };

type SurfaceLike = {
  getElementsByType(type: string): ConnectorLike[];
  addElement(props: Record<string, unknown>): string;
  deleteElement(id: string): void;
  hasElementById(id: string): boolean;
};

/** 连线一端在画布上的研究对象：文稿卡片、片段卡片（锚点）或自由想法实例。 */
export type ConnectorEnd =
  | { type: 'document'; id: string; instance: string }
  | { type: 'anchor'; id: string; documentId: string; instance: string }
  | { type: 'free'; instance: string };

/** 关系的语义端点；旧关系只有文稿标识。 */
export function relationEndpoint(relation: Relation, side: 'source' | 'target'): ResearchEndpoint {
  const ref = side === 'source' ? relation.source_ref : relation.target_ref;
  return ref ?? { type: 'document', id: side === 'source' ? relation.source_id : relation.target_id };
}

/** 画布连线生命周期中需要界面告知用户的结果。 */
export type LinkEvent =
  | { type: 'view-hidden'; canvasId: string; relationId: string }
  | { type: 'view-detached'; canvasId: string; connectorId: string; relationId: string };

const VIEW_VERSION = 2;

/** 读取画布的视图记录；旧版 links 迁移为绑定视图。 */
function readViews(envelope: EditorStateEnvelope | null) {
  const views = new Map<string, LinkView>();
  const hidden = new Set<string>(envelope?.hidden_relations ?? []);
  const fragments = new Map<string, FragmentCard>(Object.entries(envelope?.fragments ?? {}));
  if (envelope?.view_version && envelope.view_version >= VIEW_VERSION) {
    for (const [id, view] of Object.entries(envelope.link_views ?? {})) views.set(id, { ...view, connector_id: id });
  } else {
    for (const [connectorId, relationId] of Object.entries(envelope?.links ?? {})) {
      views.set(connectorId, {
        view_id: connectorId, connector_id: connectorId, relation_id: relationId,
        source_instance: null, target_instance: null, created_at: new Date().toISOString(),
      });
    }
  }
  return { views, hidden, fragments, migrated: !!envelope && !(envelope.view_version && envelope.view_version >= VIEW_VERSION) };
}

export class ResearchSession {
  readonly workspace: ResearchWorkspace;
  readonly blobs: AssetBlobSource;
  private readonly _docs = new Map<string, DocEntry>();
  private readonly _loading = new Map<string, Promise<DocEntry>>();
  private readonly _canvases = new Map<string, CanvasEntry>();
  private readonly _canvasLoading = new Map<string, Promise<CanvasEntry>>();
  private readonly _listeners = new Set<() => void>();
  private _relations: Relation[] = [];
  /** 关系列表来自服务端后才据此清理已删除关系的连线 */
  private _relationsLoaded = false;
  private readonly _generations = new Map<string, number>();
  private _version = 0;
  onLinkEvent?: (event: LinkEvent) => void;
  /** 文稿内容或版本号在会话内更新后通知界面（例如标题修改、保存后版本递增）。 */
  onDocumentSaved?: (doc: ResearchDocument) => void;
  onCanvasSaved?: (canvas: Canvas) => void;
  onRelationsChanged?: () => void;
  onAssetImported?: (result: ImportResult) => void;

  constructor(readonly workspaceId: string) {
    this.blobs = new AssetBlobSource(workspaceId, result => this.onAssetImported?.(result));
    this.workspace = new ResearchWorkspace({ id: workspaceId, storeExtensions: getStoreExtensions(), blobSource: this.blobs });
  }

  // ---------------------------------------------------------------- 状态订阅
  subscribe = (listener: () => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  getVersion = () => this._version;

  private _emit() {
    this._version++;
    for (const listener of this._listeners) listener();
  }

  docStatus(id: string): EntryStatus | null {
    return this._docs.get(id)?.status ?? null;
  }

  canvasStatus(id: string): EntryStatus | null {
    return this._canvases.get(id)?.status ?? null;
  }

  getStore(id: string): Store | null {
    return this._docs.get(id)?.store ?? this._canvases.get(id)?.store ?? null;
  }

  isLoaded(id: string) {
    return this._docs.has(id);
  }

  pageOf(docId: string, blockId: string) {
    return this._docs.get(docId)?.pages.get(blockId) ?? null;
  }

  setRelations(relations: Relation[]) {
    this._relations = relations;
    this._relationsLoaded = true;
  }

  hasPendingChanges() {
    for (const entry of this._docs.values()) if (!entry.readonly && (entry.seq !== entry.savedSeq || entry.saving)) return true;
    for (const entry of this._canvases.values()) if (entry.seq !== entry.savedSeq || entry.saving) return true;
    return false;
  }

  dispose() {
    for (const entry of this._docs.values()) clearTimeout(entry.timer);
    for (const entry of this._canvases.values()) clearTimeout(entry.timer);
    this.workspace.dispose();
    this._listeners.clear();
  }

  // ---------------------------------------------------------------- 文稿载入
  ensureDocument(doc: ResearchDocument): Promise<DocEntry> {
    const existing = this._docs.get(doc.id);
    if (existing) return Promise.resolve(existing);
    const pending = this._loading.get(doc.id);
    if (pending) return pending;
    const promise = this._loadDocument(doc).finally(() => this._loading.delete(doc.id));
    this._loading.set(doc.id, promise);
    return promise;
  }

  async ensureStore(doc: ResearchDocument): Promise<Store> {
    return (await this.ensureDocument(doc)).store;
  }

  private async _loadDocument(doc: ResearchDocument): Promise<DocEntry> {
    const bsDoc = this.workspace.createDoc(doc.id);
    this.workspace.meta.setDocMeta(doc.id, { title: doc.title });
    const store = bsDoc.getStore({ id: doc.id });
    const readonly = doc.kind === 'pdf' || doc.kind === 'image';
    const pages = new Map<string, number>();
    for (const block of doc.content.blocks) if (block.page != null) pages.set(block.id, block.page);
    const entry: DocEntry = {
      id: doc.id, doc, store, pages, readonly, suppress: 1, seq: 0, savedSeq: 0,
      status: { state: readonly ? 'readonly' : 'saved', version: doc.current_version },
    };
    let convertAfterLoad: 'markdown' | 'paragraphs' | null = null;
    let upgradeProjection = false;

    const envelope = readEnvelope(doc.content.editor_state);
    if (envelope) {
      this._applyEnvelope(bsDoc.spaceDoc, envelope);
      bsDoc.load();
      if (!this._matches(store, doc.content.blocks, pages)) {
        // 编辑状态与文本块出自同一次保存；仅缺少新纳入投影的表格时保留编辑状态并补存文本块
        if (!readonly && this._missingOnlyTables(store, doc.content.blocks, pages)) upgradeProjection = true;
        else reconcileStore(store, doc.title, doc.content.blocks, true);
      }
    } else {
      // 服务端改写或恢复会清除 editor_state：先取最近一次带编辑状态的版本，再按当前文本块更新。
      const previous = doc.current_version > 1 && !readonly ? await this._latestEnvelope(doc) : null;
      if (previous) {
        this._applyEnvelope(bsDoc.spaceDoc, previous);
        bsDoc.load();
        reconcileStore(store, doc.title, doc.content.blocks, true);
      } else {
        bsDoc.load(() => {
          if (doc.kind === 'image') {
            buildEmptyStore(store, doc.title);
            const note = store.getModelsByFlavour('affine:note')[0];
            const assetId = doc.metadata.source_asset_id;
            if (note && assetId) {
              note.children.forEach(child => store.deleteBlock(child));
              store.addBlock('affine:image', { sourceId: assetId, caption: doc.metadata.source_filename ?? '' } as never, note.id);
            }
          } else if (markdownSource(doc)) {
            buildEmptyStore(store, doc.title);
            convertAfterLoad = 'markdown';
          } else if (doc.kind === 'pdf') {
            buildStoreFromBlocks(store, doc.title, doc.content.blocks, false);
          } else if (doc.content.blocks.length === 1 && doc.content.blocks[0].text.includes('\n\n')) {
            buildStoreFromBlocks(store, doc.title, splitParagraphs(doc.content.blocks[0]), true);
            convertAfterLoad = 'paragraphs';
          } else {
            buildStoreFromBlocks(store, doc.title, doc.content.blocks, true);
          }
        });
      }
    }
    store.resetHistory();
    const markdown = markdownSource(doc);
    if (convertAfterLoad === 'markdown' && markdown) {
      const note = store.getModelsByFlavour('affine:note')[0];
      if (note) {
        const placeholder = note.children.slice();
        await MarkdownTransformer.importMarkdownToBlock({ doc: store, markdown, blockId: note.id, extensions: getStoreExtensions() });
        placeholder.forEach(model => store.deleteBlock(model));
        store.resetHistory();
      }
    }
    if (readonly) store.readonly = true;

    bsDoc.spaceDoc.on('update', () => {
      if (entry.suppress > 0 || entry.readonly) return;
      this._markDocDirty(entry);
    });
    entry.suppress = 0;
    this._docs.set(doc.id, entry);
    // AI 画布提案新建的文稿在用户编辑前保持服务端版本，整组撤销据此判断无后续修改
    if (convertAfterLoad && !upgradeProjection && doc.metadata.canvas_proposal_id) entry.deferred = true;
    else if (convertAfterLoad || upgradeProjection) this._markDocDirty(entry);
    this._emit();
    return entry;
  }

  private _applyEnvelope(spaceDoc: Y.Doc, envelope: EditorStateEnvelope) {
    Y.applyUpdate(spaceDoc, fromBase64(envelope.update));
    for (const [key, asset] of Object.entries(envelope.assets ?? {})) this.blobs.keyToAsset.set(key, asset);
  }

  private async _latestEnvelope(doc: ResearchDocument): Promise<EditorStateEnvelope | null> {
    try {
      const versions = await api.listVersions(doc.id);
      for (let i = versions.length - 1; i >= 0; i--) {
        const envelope = readEnvelope(versions[i].content.editor_state);
        if (envelope) return envelope;
      }
    } catch {
      /* 版本列表读取失败时按文本块重建 */
    }
    return null;
  }

  private _matches(store: Store, blocks: TextBlock[], pages: Map<string, number>) {
    const projected = projectStore(store, pages);
    return projected.length === blocks.length && projected.every((block, index) => block.id === blocks[index].id && block.text === blocks[index].text);
  }

  private _missingOnlyTables(store: Store, blocks: TextBlock[], pages: Map<string, number>) {
    const saved = new Set(blocks.map(block => block.id));
    const projected = projectStore(store, pages);
    const extra = projected.filter(block => !saved.has(block.id));
    if (extra.length === 0 || extra.some(block => store.getBlock(block.id)?.model.flavour !== 'affine:table')) return false;
    const kept = projected.filter(block => saved.has(block.id));
    return kept.length === blocks.length && kept.every((block, index) => block.id === blocks[index].id && block.text === blocks[index].text);
  }

  // ---------------------------------------------------------------- 文稿保存
  private _markDocDirty(entry: DocEntry) {
    entry.deferred = false;
    entry.seq++;
    // 冲突与保存中状态保留：冲突由用户处理；保存结束时按序号判断是否仍有待保存编辑
    if (entry.status.state === 'conflict') { this._emit(); return; }
    if (entry.status.state !== 'saving') entry.status = { ...entry.status, state: 'dirty', error: undefined, seq: entry.seq };
    else entry.status = { ...entry.status, seq: entry.seq };
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.saveDocument(entry.id), SAVE_DELAY);
    this._emit();
  }

  /** 生成与当前编辑状态一致的内容：文本块、Markdown 与可恢复的编辑器状态。 */
  async snapshotContent(id: string): Promise<{ seq: number; title: string; content: Content }> {
    const entry = this._docs.get(id);
    if (!entry) throw new Error('文稿尚未载入');
    const { store } = entry;
    // 以下读取在第一个 await 之前同步完成：序号、文本块、标题、编辑器状态和 Markdown 来源快照属于同一次编辑状态。
    const seq = entry.seq;
    const blocks = projectStore(store, entry.pages);
    const title = storeTitle(store).trim() || entry.doc.title;
    const update = Y.encodeStateAsUpdate(this.workspace.getResearchDoc(id)!.spaceDoc);
    const assets: Record<string, string> = {};
    for (const model of store.getModelsByFlavour(['affine:image', 'affine:attachment'])) {
      const key = (model.props as { sourceId?: string }).sourceId;
      const asset = key ? this.blobs.assetIdFor(key) : null;
      if (key && asset && asset !== key) assets[key] = asset;
    }
    const job = store.getTransformer([titleMiddleware(this.workspace.meta.docMetas)]);
    const snapshot = job.docToSnapshot(store);
    let markdown: string | null = null;
    if (snapshot) {
      try {
        const result = await new MarkdownAdapter(job, store.provider).fromDocSnapshot({ snapshot, assets: job.assetsManager });
        markdown = result.file;
      } catch {
        markdown = null;
      }
    }
    const envelope: EditorStateEnvelope = { format: 'blocksuite-yjs-v1', update: toBase64(update) };
    if (Object.keys(assets).length) envelope.assets = assets;
    return { seq, title, content: { blocks, markdown, editor_state: envelope } };
  }

  async saveDocument(id: string, options: { overwriteVersion?: number } = {}): Promise<void> {
    const entry = this._docs.get(id);
    if (!entry || entry.readonly) return;
    clearTimeout(entry.timer);
    if (entry.saving) {
      // 进行中的请求只覆盖其快照序号；结束后若序号已前进会继续保存
      await entry.saving;
      if (options.overwriteVersion === undefined) return;
    }
    if (options.overwriteVersion === undefined) {
      if (entry.seq === entry.savedSeq && entry.status.state !== 'error') return;
      if (entry.status.state === 'conflict') return;
    }
    entry.status = { ...entry.status, state: 'saving' };
    this._emit();
    entry.saving = (async () => {
      let retry = false;
      try {
        const { seq, title, content } = await this.snapshotContent(id);
        const expected = options.overwriteVersion ?? entry.status.version;
        const saved = await api.updateDocument(id, { expected_version: expected, title, content });
        entry.doc = saved;
        entry.savedSeq = Math.max(entry.savedSeq, seq);
        this.workspace.meta.setDocMeta(id, { title: saved.title });
        retry = entry.seq > entry.savedSeq;
        entry.status = { state: retry ? 'dirty' : 'saved', version: saved.current_version, savedAt: Date.now(), seq: entry.seq, savedSeq: entry.savedSeq };
        this.onDocumentSaved?.(saved);
      } catch (error) {
        if (error instanceof ApiError && error.isConflict) {
          entry.status = { ...entry.status, state: 'conflict', conflictVersion: error.currentVersion, error: error.message };
        } else {
          entry.status = { ...entry.status, state: 'error', error: error instanceof Error ? error.message : String(error) };
        }
      } finally {
        entry.saving = undefined;
        this._emit();
      }
      // 保存期间产生的编辑进入下一次保存
      if (retry) await this.saveDocument(id);
    })();
    return entry.saving;
  }

  /** 等待文稿的编辑全部写入后端，返回当前版本号。用于创建锚点和发起上下文前。 */
  async flushDocument(id: string): Promise<number> {
    const entry = this._docs.get(id);
    if (!entry) throw new Error('文稿尚未载入');
    if (entry.saving) await entry.saving;
    if (entry.deferred) { entry.deferred = false; entry.seq++; }
    if (!entry.readonly && (entry.seq !== entry.savedSeq || entry.status.state === 'error')) await this.saveDocument(id);
    if (entry.status.state === 'conflict') throw new Error('文稿存在版本冲突，请先处理冲突');
    if (entry.status.state === 'error') throw new Error(entry.status.error ?? '文稿保存失败');
    return entry.status.version;
  }

  /** 等待画布的修改写入后端。冲突、失败或正在提交画布事务时抛出。 */
  async flushCanvas(id: string): Promise<number> {
    const entry = this._canvases.get(id);
    if (!entry) throw new Error('画布尚未载入');
    if (entry.saving) await entry.saving;
    if (entry.held === 0 && (entry.seq !== entry.savedSeq || entry.status.state === 'error')) await this.saveCanvas(id);
    if (entry.status.state === 'conflict') throw new Error('画布存在版本冲突，请先处理冲突');
    if (entry.status.state === 'error') throw new Error(entry.status.error ?? '画布保存失败');
    if (entry.seq !== entry.savedSeq) throw new Error('画布仍有未保存的修改');
    return entry.status.version;
  }

  /** 写入全部待保存内容，返回仍未保存的对象（冲突、失败或画布事务进行中）。 */
  async flushAll(): Promise<PendingSave[]> {
    const pending: PendingSave[] = [];
    const record = (kind: PendingSave['kind'], id: string, title: string, state: SaveState, error: unknown) =>
      pending.push({ kind, id, title, state, error: error instanceof Error ? error.message : String(error) });
    await Promise.all([
      ...Array.from(this._docs.values()).filter(entry => !entry.readonly).map(entry =>
        this.flushDocument(entry.id).catch(error => record('document', entry.id, storeTitle(entry.store) || entry.doc.title, entry.status.state, error))),
      ...Array.from(this._canvases.values()).map(entry =>
        this.flushCanvas(entry.id).catch(error => record('canvas', entry.id, entry.canvas.name, entry.status.state, error))),
    ]);
    return pending;
  }

  /** 冲突处理：以本地内容覆盖为新版本。 */
  async resolveConflictKeepLocal(id: string) {
    const current = await api.getDocument(id);
    const entry = this._docs.get(id);
    if (!entry) return;
    entry.status = { ...entry.status, state: 'dirty', conflictVersion: undefined, error: undefined };
    await this.saveDocument(id, { overwriteVersion: current.current_version });
  }

  /** 冲突处理：载入服务端当前版本，放弃本地未保存修改。 */
  async resolveConflictUseServer(id: string) {
    const current = await api.getDocument(id);
    this.applyServerDocument(current);
  }

  /** 后端生成新版本（提案确认、撤销、恢复历史版本）后，按其文本块更新已载入的编辑器。 */
  applyServerDocument(doc: ResearchDocument) {
    const entry = this._docs.get(doc.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.doc = doc;
    entry.pages = new Map(doc.content.blocks.filter(block => block.page != null).map(block => [block.id, block.page!]));
    entry.suppress++;
    const wasReadonly = entry.store.readonly;
    try {
      if (wasReadonly) entry.store.readonly = false;
      const envelope = readEnvelope(doc.content.editor_state);
      if (!this._matches(entry.store, doc.content.blocks, entry.pages) || envelope === null) {
        reconcileStore(entry.store, doc.title, doc.content.blocks, doc.kind !== 'pdf');
      }
    } finally {
      if (wasReadonly) entry.store.readonly = true;
      entry.suppress--;
    }
    this.workspace.meta.setDocMeta(doc.id, { title: doc.title });
    entry.savedSeq = entry.seq;
    entry.status = { state: entry.readonly ? 'readonly' : 'saved', version: doc.current_version, savedAt: Date.now(), seq: entry.seq, savedSeq: entry.savedSeq };
    this._emit();
  }

  /** 后端修改了标题或元数据但正文未改变时同步版本号。 */
  noteServerVersion(doc: ResearchDocument) {
    const entry = this._docs.get(doc.id);
    if (!entry) return;
    if (entry.status.state === 'saved' || entry.status.state === 'readonly') {
      entry.doc = doc;
      entry.status = { ...entry.status, version: doc.current_version };
      this._emit();
    }
  }

  // ---------------------------------------------------------------- 画布
  ensureCanvas(canvas: Canvas, documents: Map<string, ResearchDocument>): Promise<CanvasEntry> {
    const existing = this._canvases.get(canvas.id);
    if (existing) return Promise.resolve(existing);
    const pending = this._canvasLoading.get(canvas.id);
    if (pending) return pending;
    const promise = this._loadCanvas(canvas, documents).finally(() => this._canvasLoading.delete(canvas.id));
    this._canvasLoading.set(canvas.id, promise);
    return promise;
  }

  private async _loadCanvas(canvas: Canvas, documents: Map<string, ResearchDocument>): Promise<CanvasEntry> {
    // 画布中引用的文稿先载入，嵌入块即可显示同一份内容。
    const ids = new Set(canvas.objects.map(object => object.document_id));
    const envelope = readEnvelope(canvas.editor_state);
    await Promise.all(Array.from(ids).map(id => documents.get(id)).filter((doc): doc is ResearchDocument => !!doc).map(doc => this.ensureDocument(doc)));
    const bsDoc = this.workspace.createDoc(canvas.id);
    this.workspace.meta.setDocMeta(canvas.id, { title: canvas.name });
    const store = bsDoc.getStore({ id: canvas.id });
    const { views, hidden, fragments, migrated } = readViews(envelope);
    const entry: CanvasEntry = {
      id: canvas.id, canvas, store, views, hidden, fragments, removed: new Map(), held: 0, suppress: 1, seq: 0, savedSeq: 0,
      status: { state: 'saved', version: canvas.revision },
    };
    if (envelope) {
      this._applyEnvelope(bsDoc.spaceDoc, envelope);
      bsDoc.load();
    } else {
      bsDoc.load(() => {
        buildCanvasStore(store, canvas.name);
        const surface = store.getModelsByFlavour('affine:surface')[0];
        for (const object of canvas.objects) {
          if (!documents.has(object.document_id) || !surface) continue;
          store.addBlock(SYNCED_DOC, { id: object.id, pageId: object.document_id, xywh: `[${object.x},${object.y},${object.width},${object.height}]` } as never, surface.id);
        }
      });
    }
    store.resetHistory();
    this._canvases.set(canvas.id, entry);
    // 载入时已有的连线都登记为视图：旧版缺少连线的绑定转为隐藏，未绑定的连线保持纯视觉，不触发建立关系。
    const viewsChanged = this._reconcileViews(entry, true);
    bsDoc.spaceDoc.on('update', () => {
      if (entry.suppress > 0) return;
      this._markCanvasDirty(entry);
    });
    entry.suppress = 0;
    if (migrated && viewsChanged) this._markCanvasDirty(entry);
    this._emit();
    return entry;
  }

  private _markCanvasDirty(entry: CanvasEntry) {
    entry.seq++;
    if (entry.status.state === 'conflict') { this._emit(); return; }
    if (entry.status.state !== 'saving') entry.status = { ...entry.status, state: 'dirty', error: undefined, seq: entry.seq };
    else entry.status = { ...entry.status, seq: entry.seq };
    clearTimeout(entry.timer);
    if (entry.held === 0) entry.timer = setTimeout(() => void this.saveCanvas(entry.id), SAVE_DELAY);
    this._emit();
  }

  /**
   * 暂停画布自动保存，先写入已有修改并等待进行中的保存，返回当前 revision。
   * 用于服务端画布事务：调用方完成事务后以 releaseCanvas 恢复保存。
   */
  async holdCanvas(id: string): Promise<number> {
    const entry = this._canvases.get(id);
    if (!entry) throw new Error('画布尚未载入');
    if (entry.status.state === 'dirty' || entry.status.state === 'error') await this.saveCanvas(id);
    else if (entry.saving) await entry.saving;
    if (entry.status.state === 'conflict') throw new Error('画布存在版本冲突，请先处理冲突');
    if (entry.status.state === 'error') throw new Error(entry.status.error ?? '画布保存失败');
    entry.held++;
    clearTimeout(entry.timer);
    // 事务提交期间画布只读，服务端结果不会与未保存的本地编辑交错
    entry.store.readonly = true;
    this._emit();
    return entry.status.version;
  }

  /** 恢复自动保存；事务期间产生的本地修改随后写入。 */
  releaseCanvas(id: string) {
    const entry = this._canvases.get(id);
    if (!entry) return;
    entry.held = Math.max(0, entry.held - 1);
    if (entry.held === 0) entry.store.readonly = false;
    this._emit();
    if (entry.held === 0 && entry.status.state === 'dirty') {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => void this.saveCanvas(entry.id), SAVE_DELAY);
    }
  }

  isCanvasHeld(id: string) {
    return (this._canvases.get(id)?.held ?? 0) > 0;
  }

  private _surface(store: Store): SurfaceLike | null {
    return (store.getModelsByFlavour('affine:surface')[0] as unknown as SurfaceLike | undefined) ?? null;
  }

  canvasObjects(id: string): CanvasObject[] {
    const entry = this._canvases.get(id);
    if (!entry) return [];
    return entry.store.getModelsByFlavour(SYNCED_DOC).map(model => {
      const props = model.props as unknown as { pageId: string; xywh: string };
      const [x, y, width, height] = parseXYWH(props.xywh);
      return { id: model.id, document_id: props.pageId, x, y, width: Math.max(0, width), height: Math.max(0, height) };
    }).filter(object => this._docs.has(object.document_id));
  }

  /** 把文稿以同步嵌入块放到画布的指定位置，返回块标识。 */
  async addDocumentToCanvas(canvasId: string, doc: ResearchDocument, position: { x: number; y: number }, size = { width: 560, height: 420 }) {
    const entry = this._canvases.get(canvasId);
    if (!entry) throw new Error('画布尚未载入');
    await this.ensureDocument(doc);
    const surface = entry.store.getModelsByFlavour('affine:surface')[0];
    if (!surface) throw new Error('画布缺少绘制表面');
    const id = entry.store.addBlock(SYNCED_DOC, { pageId: doc.id, xywh: `[${Math.round(position.x)},${Math.round(position.y)},${size.width},${size.height}]` } as never, surface.id);
    // 嵌入块挂载后会按全文高度初始化；长文与 PDF 卡片限制在可读高度，内容在卡片内滚动。
    const maxHeight = Math.max(size.height, 640);
    const subscription = entry.store.slots.blockUpdated.subscribe(payload => {
      if (payload.id !== id || payload.type !== 'update') return;
      const model = entry.store.getModelById(id);
      if (!model) return;
      const [x, y, w, h] = parseXYWH((model.props as unknown as { xywh: string }).xywh);
      if (h > maxHeight) entry.store.updateBlock(model, { xywh: `[${x},${y},${w},${maxHeight}]` } as never);
    });
    setTimeout(() => subscription.unsubscribe(), 3000);
    this.syncCanvasRelations(canvasId);
    return id;
  }

  // ------------------------------------------------------------ 连线视图与研究关系
  //
  // 视觉连线（编辑器 connector）、连线视图记录（LinkView）与研究关系（Relation）各自独立：
  // - 删除画布连线只移除该视图；两端仍在时记入本画布的隐藏关系，研究关系保留。
  // - 改接连线解除视图与原关系的绑定，原关系记为隐藏，新端点保持纯视觉。
  // - 删除卡片带走的连线只移除视图，关系回到“尚未放置”状态。
  // - 显式删除研究关系后，同步移除绑定它的连线视图。
  // - 新画出的连线只登记视图；研究关系由用户“研究这个联系”显式建立。

  private _instances(entry: CanvasEntry) {
    const ids = new Set<string>();
    for (const model of entry.store.getModelsByFlavour([SYNCED_DOC, 'affine:note', 'affine:frame', 'affine:edgeless-text', 'affine:image'])) ids.add(model.id);
    return ids;
  }

  /** 本地视图簿记：登记新连线、记录删除与改接。返回视图状态是否变化。 */
  private _reconcileViews(entry: CanvasEntry, initial = false) {
    const surface = this._surface(entry.store);
    if (!surface) return false;
    const connectors = surface.getElementsByType('connector');
    const present = new Map(connectors.map(connector => [connector.id, connector]));
    const instances = this._instances(entry);
    const exists = (id: string | null) => !!id && (instances.has(id) || surface.hasElementById(id));
    let changed = false;
    for (const [connectorId, view] of Array.from(entry.views)) {
      if (present.has(connectorId)) continue;
      entry.views.delete(connectorId);
      entry.removed.set(connectorId, view);
      changed = true;
      if (!view.relation_id) continue;
      // 迁移的旧绑定没有端点记录；两端都在或无法判断时视为用户隐藏
      const endpointsKnown = view.source_instance !== null || view.target_instance !== null;
      if (!endpointsKnown || (exists(view.source_instance) && exists(view.target_instance))) {
        entry.hidden.add(view.relation_id);
        if (!initial) this.onLinkEvent?.({ type: 'view-hidden', canvasId: entry.id, relationId: view.relation_id });
      }
    }
    for (const connector of connectors) {
      const source = connector.source.id ?? null;
      const target = connector.target.id ?? null;
      let view = entry.views.get(connector.id);
      if (!view) {
        const restored = entry.removed.get(connector.id);
        if (restored) {
          // 撤销删除：恢复原视图与绑定
          entry.removed.delete(connector.id);
          view = restored;
          if (view.relation_id) entry.hidden.delete(view.relation_id);
        } else {
          view = { view_id: connector.id, connector_id: connector.id, relation_id: null, source_instance: source, target_instance: target, created_at: new Date().toISOString() };
        }
        entry.views.set(connector.id, view);
        changed = true;
      }
      if (view.source_instance === null && view.target_instance === null && view.relation_id && initial) {
        // 旧版绑定补记端点
        entry.views.set(connector.id, { ...view, source_instance: source, target_instance: target });
        changed = true;
        continue;
      }
      if (view.source_instance !== source || view.target_instance !== target) {
        const next: LinkView = { ...view, source_instance: source, target_instance: target };
        if (view.relation_id) {
          entry.hidden.add(view.relation_id);
          next.detached_from = view.relation_id;
          next.relation_id = null;
          this.onLinkEvent?.({ type: 'view-detached', canvasId: entry.id, connectorId: connector.id, relationId: view.relation_id });
        }
        entry.views.set(connector.id, next);
        changed = true;
      }
    }
    for (const id of Array.from(entry.fragments.keys())) {
      if (!entry.store.getModelById(id)) { entry.fragments.delete(id); changed = true; }
    }
    return changed;
  }

  private _cardDocuments(entry: CanvasEntry) {
    return new Map(entry.store.getModelsByFlavour(SYNCED_DOC).map(model => [model.id, (model.props as unknown as { pageId: string }).pageId]));
  }

  /**
   * 关系 → 连线：为两端都在画布、未隐藏且尚无视图的研究关系补齐连线；
   * 移除绑定已删除关系的连线。先完成本地视图簿记，缺失的连线不会被重新生成。
   */
  syncCanvasRelations(canvasId: string, persist = true): boolean {
    const entry = this._canvases.get(canvasId);
    if (!entry || entry.store.readonly) return false;
    const surface = this._surface(entry.store);
    if (!surface) return false;
    let changed = this._reconcileViews(entry);
    const relationIds = new Set(this._relations.map(relation => relation.id));
    entry.suppress++;
    try {
      if (this._relationsLoaded) {
        for (const [connectorId, view] of Array.from(entry.views)) {
          if (!view.relation_id || relationIds.has(view.relation_id)) continue;
          entry.views.delete(connectorId);
          if (surface.hasElementById(connectorId)) surface.deleteElement(connectorId);
          changed = true;
        }
        for (const id of Array.from(entry.hidden)) if (!relationIds.has(id)) { entry.hidden.delete(id); changed = true; }
      }
      const bound = new Set(Array.from(entry.views.values()).map(view => view.relation_id).filter((id): id is string => !!id));
      for (const relation of this._relations) {
        if (bound.has(relation.id) || entry.hidden.has(relation.id)) continue;
        const source = this._locate(entry, entry.store, relationEndpoint(relation, 'source'), false);
        const target = this._locate(entry, entry.store, relationEndpoint(relation, 'target'), false);
        if (!source || !target) continue;
        const connectorId = this._addConnector(surface, source, target, relation.kind === 'context');
        entry.views.set(connectorId, {
          view_id: connectorId, connector_id: connectorId, relation_id: relation.id,
          source_instance: source, target_instance: target, created_at: new Date().toISOString(),
        });
        changed = true;
      }
    } finally {
      entry.suppress--;
    }
    // 载入时补齐的连线只用于显示；用户操作引起的视图变化才写入画布布局。
    if (changed && persist) this._markCanvasDirty(entry);
    return changed;
  }

  private _addConnector(surface: SurfaceLike, source: string, target: string, context: boolean) {
    return surface.addElement({
      type: 'connector',
      mode: 2,
      source: { id: source },
      target: { id: target },
      stroke: context ? '#929292' : '#d97757',
      strokeStyle: context ? 'dash' : 'solid',
      strokeWidth: context ? 2 : 3,
    });
  }

  relationForConnector(canvasId: string, connectorId: string) {
    return this._canvases.get(canvasId)?.views.get(connectorId)?.relation_id ?? null;
  }

  linkView(canvasId: string, connectorId: string): LinkView | null {
    return this._canvases.get(canvasId)?.views.get(connectorId) ?? null;
  }

  linkViews(canvasId: string): LinkView[] {
    return Array.from(this._canvases.get(canvasId)?.views.values() ?? []);
  }

  hiddenRelations(canvasId: string): string[] {
    return Array.from(this._canvases.get(canvasId)?.hidden ?? []);
  }

  /** 关系在已载入画布中的显示情况，用于关系面板说明。 */
  relationPlacement(relationId: string) {
    const result: Array<{ canvasId: string; views: number; hidden: boolean }> = [];
    for (const entry of this._canvases.values()) {
      const views = Array.from(entry.views.values()).filter(view => view.relation_id === relationId).length;
      if (views > 0 || entry.hidden.has(relationId)) result.push({ canvasId: entry.id, views, hidden: entry.hidden.has(relationId) });
    }
    return result;
  }

  /**
   * 用户显式恢复隐藏关系在本画布的显示。两端未都放置时保持未放置。
   * 只有隐藏记录被移除或连线视图实际变化时才写入画布布局。
   */
  showRelation(canvasId: string, relationId: string): { unhidden: boolean; views: number; placed: [boolean, boolean] } {
    const entry = this._canvases.get(canvasId);
    const relation = this._relations.find(item => item.id === relationId);
    if (!entry || !relation) return { unhidden: false, views: 0, placed: [false, false] };
    const unhidden = entry.hidden.delete(relationId);
    const changed = this.syncCanvasRelations(canvasId, false);
    if (unhidden || changed) this._markCanvasDirty(entry);
    const views = Array.from(entry.views.values()).filter(view => view.relation_id === relationId).length;
    const placed: [boolean, boolean] = [
      !!this._locate(entry, entry.store, relationEndpoint(relation, 'source'), false),
      !!this._locate(entry, entry.store, relationEndpoint(relation, 'target'), false),
    ];
    return { unhidden, views, placed };
  }

  /** 从画布隐藏关系的全部视图，研究关系保留。 */
  hideRelation(canvasId: string, relationId: string) {
    const entry = this._canvases.get(canvasId);
    const surface = entry ? this._surface(entry.store) : null;
    if (!entry || !surface) return;
    entry.hidden.add(relationId);
    for (const [connectorId, view] of Array.from(entry.views)) {
      if (view.relation_id !== relationId) continue;
      entry.views.delete(connectorId);
      if (surface.hasElementById(connectorId)) surface.deleteElement(connectorId);
    }
    this._markCanvasDirty(entry);
  }

  /** 将一条已解除绑定或纯视觉的连线绑定到研究关系（新建或已有）。 */
  bindConnector(canvasId: string, connectorId: string, relationId: string) {
    const entry = this._canvases.get(canvasId);
    const view = entry?.views.get(connectorId);
    if (!entry || !view) return;
    entry.views.set(connectorId, { ...view, relation_id: relationId });
    entry.hidden.delete(relationId);
    this._markCanvasDirty(entry);
  }

  /** 连线两端的研究对象。自由端点或无法读取内容的图形返回 null。 */
  connectorEndpoints(canvasId: string, connectorId: string): [ConnectorEnd | null, ConnectorEnd | null] {
    const entry = this._canvases.get(canvasId);
    const view = entry?.views.get(connectorId);
    if (!entry || !view) return [null, null];
    const cards = this._cardDocuments(entry);
    const surface = this._surface(entry.store);
    const end = (instance: string | null): ConnectorEnd | null => {
      if (!instance) return null;
      const doc = cards.get(instance);
      if (doc) return { type: 'document', id: doc, instance };
      const fragment = entry.fragments.get(instance);
      if (fragment) return { type: 'anchor', id: fragment.anchor_id, documentId: fragment.document_id, instance };
      const block = entry.store.getModelById(instance);
      if (block && ['affine:note', 'affine:edgeless-text'].includes(block.flavour)) return { type: 'free', instance };
      const element = surface?.hasElementById(instance) ? surface.getElementsByType('shape').concat(surface.getElementsByType('text')).find(item => item.id === instance) : null;
      return element ? { type: 'free', instance } : null;
    };
    return [end(view.source_instance), end(view.target_instance)];
  }

  /** 端点在画布中的实例：文稿取卡片，锚点取片段卡片，自由想法与场景对象直接使用实例标识。 */
  locateEndpoint(canvasId: string, endpoint: ResearchEndpoint | ProposalEndpoint): string | null {
    const entry = this._canvases.get(canvasId);
    return entry ? this._locate(entry, entry.store, endpoint, true) : null;
  }

  private _locate(entry: CanvasEntry, store: Store, endpoint: ResearchEndpoint | ProposalEndpoint, documentFragments: boolean): string | null {
    const surface = store.getModelsByFlavour('affine:surface')[0] as unknown as SurfaceLike | undefined;
    const exists = (id: string) => !!store.getModelById(id) || !!surface?.hasElementById(id);
    switch (endpoint.type) {
      case 'document': {
        const card = store.getModelsByFlavour(SYNCED_DOC).find(model => (model.props as unknown as { pageId: string }).pageId === endpoint.id);
        if (card) return card.id;
        // 提案预览：文稿没有卡片时退回到该文稿的片段卡片
        if (!documentFragments) return null;
        return Array.from(entry.fragments).find(([id, fragment]) => fragment.document_id === endpoint.id && exists(id))?.[0] ?? null;
      }
      case 'anchor':
        return Array.from(entry.fragments).find(([id, fragment]) => fragment.anchor_id === endpoint.id && exists(id))?.[0] ?? null;
      case 'canvas_object':
        return endpoint.canvas_id === entry.id && exists(endpoint.instance_id) ? endpoint.instance_id : null;
      case 'scene':
        return exists(endpoint.object_id) ? endpoint.object_id : null;
      default:
        return null;
    }
  }

  /**
   * 来源连接：从提问时所选的对象连到生成的讨论框。属于纯视觉连线（不建立研究关系），
   * 删除时只影响本画布。已有同端点连线时不重复添加。
   */
  addSourceLinks(canvasId: string, sourceIds: string[], targetId: string) {
    const entry = this._canvases.get(canvasId);
    const surface = entry ? this._surface(entry.store) : null;
    if (!entry || !surface || entry.store.readonly) return [];
    const existing = new Set(Array.from(entry.views.values()).map(view => `${view.source_instance}>${view.target_instance}`));
    const created: string[] = [];
    for (const source of sourceIds) {
      if (source === targetId || existing.has(`${source}>${targetId}`)) continue;
      if (!entry.store.getModelById(source) && !surface.hasElementById(source)) continue;
      const connectorId = surface.addElement({ type: 'connector', mode: 2, source: { id: source }, target: { id: targetId }, stroke: '#8e6cdf', strokeStyle: 'solid', strokeWidth: 2 });
      // 先登记视图，避免保存时被当作新画出的文稿连线而自动建立研究关系
      entry.views.set(connectorId, { view_id: connectorId, connector_id: connectorId, relation_id: null, source_instance: source, target_instance: targetId, created_at: new Date().toISOString() });
      created.push(connectorId);
    }
    if (created.length) this._markCanvasDirty(entry);
    return created;
  }

  // ------------------------------------------------------------ 片段卡片
  fragmentCards(canvasId: string): Array<[string, FragmentCard]> {
    return Array.from(this._canvases.get(canvasId)?.fragments ?? []);
  }

  fragmentFor(canvasId: string, blockId: string): FragmentCard | null {
    return this._canvases.get(canvasId)?.fragments.get(blockId) ?? null;
  }

  /** 把锚点作为片段卡片放到画布：卡片显示引用版本的原文，内容身份由锚点保存。 */
  addFragmentToCanvas(canvasId: string, anchor: Anchor, title: string, position: { x: number; y: number }, width = 420) {
    const entry = this._canvases.get(canvasId);
    if (!entry) throw new Error('画布尚未载入');
    const root = entry.store.root;
    if (!root) throw new Error('画布缺少根节点');
    const lines = anchor.quote.split(/\n{2,}/).filter(line => line.trim());
    const height = Math.min(520, 96 + lines.join('\n').length * 0.9);
    let noteId = '';
    entry.store.transact(() => {
      noteId = entry.store.addBlock('affine:note', {
        xywh: `[${Math.round(position.x)},${Math.round(position.y)},${width},${Math.round(height)}]`,
        displayMode: 'edgeless',
        background: { light: '#fbf4ee', dark: '#3a2a22' },
      } as never, root.id);
      for (const line of lines) {
        const parsed = parseBlockText(line, true);
        if (parsed.flavour === 'affine:latex') entry.store.addBlock('affine:latex', { latex: parsed.props.latex } as never, noteId);
        else if (parsed.flavour === 'affine:table') entry.store.addBlock('affine:paragraph', { type: 'quote', text: new Text(line) } as never, noteId);
        else entry.store.addBlock('affine:paragraph', { type: 'quote', text: new Text(parsed.delta ?? []) } as never, noteId);
      }
      const page = anchor.page != null ? ` · 第 ${anchor.page} 页` : '';
      entry.store.addBlock('affine:paragraph', { type: 'text', text: new Text(`— ${title} · 版本 ${anchor.version}${page}`) } as never, noteId);
    });
    entry.fragments.set(noteId, { anchor_id: anchor.id, document_id: anchor.document_id, version: anchor.version });
    this._markCanvasDirty(entry);
    return noteId;
  }

  async saveCanvas(id: string, options: { overwriteRevision?: number } = {}): Promise<void> {
    const entry = this._canvases.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    if (entry.saving) {
      await entry.saving;
      if (options.overwriteRevision === undefined) return;
    }
    if (options.overwriteRevision === undefined) {
      if (entry.seq === entry.savedSeq && entry.status.state !== 'error') return;
      if (entry.status.state === 'conflict' || entry.held > 0) return;
    }
    entry.status = { ...entry.status, state: 'saving' };
    this._emit();
    entry.saving = (async () => {
      let retry = false;
      try {
        // 视图登记、序号、编辑器状态与卡片布局在同一个同步段内读取，对象表与 Yjs 来自同一快照
        this._reconcileViews(entry);
        const seq = entry.seq;
        const update = Y.encodeStateAsUpdate(this.workspace.getResearchDoc(id)!.spaceDoc);
        const bound = Array.from(entry.views.values()).filter(view => view.relation_id);
        const envelope: EditorStateEnvelope = {
          format: 'blocksuite-yjs-v1',
          update: toBase64(update),
          view_version: VIEW_VERSION,
          link_views: Object.fromEntries(entry.views),
          hidden_relations: Array.from(entry.hidden),
          fragments: Object.fromEntries(entry.fragments),
          // 保留旧字段，供只读取绑定关系的旧版界面使用
          links: Object.fromEntries(bound.map(view => [view.connector_id, view.relation_id!])),
        };
        const objects = this.canvasObjects(id);
        const saved = await api.updateCanvas(id, {
          expected_revision: options.overwriteRevision ?? entry.status.version,
          name: entry.canvas.name,
          objects,
          editor_state: envelope,
        });
        entry.canvas = saved;
        entry.savedSeq = Math.max(entry.savedSeq, seq);
        retry = entry.seq > entry.savedSeq;
        entry.status = { state: retry ? 'dirty' : 'saved', version: saved.revision, savedAt: Date.now(), seq: entry.seq, savedSeq: entry.savedSeq };
        this.onCanvasSaved?.(saved);
      } catch (error) {
        if (error instanceof ApiError && error.isConflict) {
          entry.status = { ...entry.status, state: 'conflict', conflictVersion: error.currentVersion, error: error.message };
        } else {
          entry.status = { ...entry.status, state: 'error', error: error instanceof Error ? error.message : String(error) };
        }
      } finally {
        entry.saving = undefined;
        this._emit();
      }
      if (retry && entry.held === 0) await this.saveCanvas(id);
    })();
    return entry.saving;
  }

  renameCanvasLocal(id: string, name: string) {
    const entry = this._canvases.get(id);
    if (!entry) return;
    entry.canvas = { ...entry.canvas, name };
    this.workspace.meta.setDocMeta(id, { title: name });
    this._markCanvasDirty(entry);
  }

  async resolveCanvasConflictKeepLocal(id: string) {
    const current = await api.getCanvas(id);
    const entry = this._canvases.get(id);
    if (!entry) return;
    entry.status = { ...entry.status, state: 'dirty', conflictVersion: undefined, error: undefined };
    await this.saveCanvas(id, { overwriteRevision: current.revision });
  }

  /** 冲突处理：丢弃本地布局并按服务端画布重新载入。 */
  async reloadCanvas(id: string, documents: Map<string, ResearchDocument>) {
    const current = await api.getCanvas(id);
    await this.adoptServerCanvas(current, documents);
    return current;
  }

  /**
   * 采用服务端画布的完整状态（冲突时载入服务器版本，或画布事务返回新 revision 后）。
   * 编辑器以新的存储重建，界面通过 canvasGeneration 感知并重新挂载。
   */
  async adoptServerCanvas(canvas: Canvas, documents: Map<string, ResearchDocument>) {
    const entry = this._canvases.get(canvas.id);
    const held = entry?.held ?? 0;
    if (entry) {
      clearTimeout(entry.timer);
      this._canvases.delete(canvas.id);
      // 视图只挂载当前登记的存储：先通知卸载旧编辑器，下一任务再销毁旧文档，旧编辑器不会渲染已删除的块
      this._emit();
      await new Promise(resolve => setTimeout(resolve, 0));
      this.workspace.removeDoc(canvas.id);
    }
    const loaded = await this.ensureCanvas(canvas, documents);
    loaded.held = held;
    if (held > 0) loaded.store.readonly = true;
    this._generations.set(canvas.id, (this._generations.get(canvas.id) ?? 0) + 1);
    this.syncCanvasRelations(canvas.id, false);
    this.onCanvasSaved?.(canvas);
    this._emit();
  }

  canvasGeneration(id: string) {
    return this._generations.get(id) ?? 0;
  }
}

/** 导入的 Markdown 与 AI 讨论正文首次打开时按 Markdown 结构建立编辑器内容。 */
function markdownSource(doc: ResearchDocument): string | null {
  if (doc.content.blocks.length > 1) return null;
  if (doc.kind === 'document' && doc.content.markdown) return doc.content.markdown;
  if (doc.kind === 'discussion' && doc.content.blocks[0]?.text) return doc.content.blocks[0].text;
  return null;
}

function splitParagraphs(block: TextBlock): TextBlock[] {
  const parts = block.text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  return parts.map((text, index) => ({ id: index === 0 ? block.id : crypto.randomUUID(), text }));
}
