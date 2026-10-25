// 工作区编辑会话：把后端文稿与画布载入同一个 BlockSuite 工作区，负责恢复、自动保存、
// 版本冲突、服务端改写后的重建，以及画布连线与工作区关系的同步。
import { MarkdownAdapter, titleMiddleware } from '@blocksuite/affine/shared/adapters';
import type { Store } from '@blocksuite/affine/store';
import { MarkdownTransformer } from '@blocksuite/affine/widgets/linked-doc';
import * as Y from 'yjs';

import { api, ApiError } from '../api/client';
import type {
  Canvas, CanvasObject, Content, EditorStateEnvelope, ImportResult, Relation, ResearchDocument, TextBlock,
} from '../api/types';
import { AssetBlobSource } from './blob-source';
import { getStoreExtensions } from './extensions';
import {
  buildCanvasStore, buildEmptyStore, buildStoreFromBlocks, projectStore, reconcileStore, storeTitle,
} from './projection';
import { ResearchWorkspace } from './workspace';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error' | 'readonly';

export type EntryStatus = {
  state: SaveState;
  version: number;
  error?: string;
  conflictVersion?: number;
  savedAt?: number;
};

type DocEntry = {
  id: string;
  doc: ResearchDocument;
  store: Store;
  pages: Map<string, number>;
  readonly: boolean;
  status: EntryStatus;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
  again?: boolean;
  suppress: number;
};

type CanvasEntry = {
  id: string;
  canvas: Canvas;
  store: Store;
  links: Map<string, string>;
  status: EntryStatus;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
  again?: boolean;
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

type SurfaceLike = {
  getElementsByType(type: string): Array<{ id: string; source: { id?: string }; target: { id?: string } }>;
  addElement(props: Record<string, unknown>): string;
  deleteElement(id: string): void;
  hasElementById(id: string): boolean;
  elementAdded: { subscribe(fn: () => void): { unsubscribe(): void } };
  elementRemoved: { subscribe(fn: () => void): { unsubscribe(): void } };
  elementUpdated: { subscribe(fn: () => void): { unsubscribe(): void } };
};

export class ResearchSession {
  readonly workspace: ResearchWorkspace;
  readonly blobs: AssetBlobSource;
  private readonly _docs = new Map<string, DocEntry>();
  private readonly _loading = new Map<string, Promise<DocEntry>>();
  private readonly _canvases = new Map<string, CanvasEntry>();
  private readonly _canvasLoading = new Map<string, Promise<CanvasEntry>>();
  private readonly _listeners = new Set<() => void>();
  private _relations: Relation[] = [];
  private _version = 0;
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
  }

  hasPendingChanges() {
    for (const entry of this._docs.values()) if (entry.status.state === 'dirty' || entry.status.state === 'saving') return true;
    for (const entry of this._canvases.values()) if (entry.status.state === 'dirty' || entry.status.state === 'saving') return true;
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
      id: doc.id, doc, store, pages, readonly, suppress: 1,
      status: { state: readonly ? 'readonly' : 'saved', version: doc.current_version },
    };
    let convertAfterLoad: 'markdown' | 'paragraphs' | null = null;

    const envelope = readEnvelope(doc.content.editor_state);
    if (envelope) {
      this._applyEnvelope(bsDoc.spaceDoc, envelope);
      bsDoc.load();
      if (!this._matches(store, doc.content.blocks, pages)) reconcileStore(store, doc.title, doc.content.blocks, true);
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
    if (convertAfterLoad) this._markDocDirty(entry);
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

  // ---------------------------------------------------------------- 文稿保存
  private _markDocDirty(entry: DocEntry) {
    if (entry.status.state === 'conflict') return;
    entry.status = { ...entry.status, state: 'dirty', error: undefined };
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.saveDocument(entry.id), SAVE_DELAY);
    this._emit();
  }

  /** 生成与当前编辑状态一致的内容：文本块、Markdown 与可恢复的编辑器状态。 */
  async snapshotContent(id: string): Promise<{ title: string; content: Content }> {
    const entry = this._docs.get(id);
    if (!entry) throw new Error('文稿尚未载入');
    const { store } = entry;
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
    return { title, content: { blocks, markdown, editor_state: envelope } };
  }

  async saveDocument(id: string, options: { overwriteVersion?: number } = {}): Promise<void> {
    const entry = this._docs.get(id);
    if (!entry || entry.readonly) return;
    clearTimeout(entry.timer);
    if (entry.saving) {
      entry.again = true;
      return entry.saving;
    }
    if (entry.status.state === 'saved' && options.overwriteVersion === undefined) return;
    if (entry.status.state === 'conflict' && options.overwriteVersion === undefined) return;
    entry.status = { ...entry.status, state: 'saving' };
    this._emit();
    entry.saving = (async () => {
      try {
        const { title, content } = await this.snapshotContent(id);
        const expected = options.overwriteVersion ?? entry.status.version;
        const saved = await api.updateDocument(id, { expected_version: expected, title, content });
        entry.doc = saved;
        this.workspace.meta.setDocMeta(id, { title: saved.title });
        entry.status = { state: entry.again ? 'dirty' : 'saved', version: saved.current_version, savedAt: Date.now() };
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
      if (entry.again && entry.status.state === 'dirty') {
        entry.again = false;
        await this.saveDocument(id);
      }
      entry.again = false;
    })();
    return entry.saving;
  }

  /** 等待文稿的编辑全部写入后端，返回当前版本号。用于创建锚点和发起上下文前。 */
  async flushDocument(id: string): Promise<number> {
    const entry = this._docs.get(id);
    if (!entry) throw new Error('文稿尚未载入');
    if (entry.status.state === 'dirty' || entry.status.state === 'error') await this.saveDocument(id);
    else if (entry.saving) await entry.saving;
    if (entry.status.state === 'conflict') throw new Error('文稿存在版本冲突，请先处理冲突');
    if (entry.status.state === 'error') throw new Error(entry.status.error ?? '文稿保存失败');
    return entry.status.version;
  }

  async flushAll() {
    await Promise.all([
      ...Array.from(this._docs.keys()).map(id => this.flushDocument(id).catch(() => undefined)),
      ...Array.from(this._canvases.keys()).map(id => this.saveCanvas(id).catch(() => undefined)),
    ]);
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
    entry.status = { state: entry.readonly ? 'readonly' : 'saved', version: doc.current_version, savedAt: Date.now() };
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
    const entry: CanvasEntry = {
      id: canvas.id, canvas, store, links: new Map(Object.entries(envelope?.links ?? {})), suppress: 1,
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
    bsDoc.spaceDoc.on('update', () => {
      if (entry.suppress > 0) return;
      this._markCanvasDirty(entry);
    });
    entry.suppress = 0;
    this._emit();
    return entry;
  }

  private _markCanvasDirty(entry: CanvasEntry) {
    if (entry.status.state === 'conflict') return;
    entry.status = { ...entry.status, state: 'dirty', error: undefined };
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.saveCanvas(entry.id), SAVE_DELAY);
    this._emit();
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
    this.syncCanvasRelations(canvasId);
    return id;
  }

  /** 画布连线 → 工作区关系：两端都是文稿卡片的连线保存为关系；关系补齐为连线。 */
  async reconcileCanvasLinks(canvasId: string) {
    const entry = this._canvases.get(canvasId);
    if (!entry) return;
    const surface = this._surface(entry.store);
    if (!surface) return;
    const cardDoc = new Map(entry.store.getModelsByFlavour(SYNCED_DOC).map(model => [model.id, (model.props as unknown as { pageId: string }).pageId]));
    const relationById = new Map(this._relations.map(relation => [relation.id, relation]));
    let changed = false;
    const connectors = surface.getElementsByType('connector');
    const present = new Set(connectors.map(connector => connector.id));
    for (const [connectorId, relationId] of Array.from(entry.links)) {
      if (present.has(connectorId)) continue;
      entry.links.delete(connectorId);
      if (relationById.has(relationId)) {
        await api.deleteRelation(relationId).catch(() => undefined);
        this._relations = this._relations.filter(relation => relation.id !== relationId);
        changed = true;
      }
    }
    for (const connector of connectors) {
      const sourceDoc = connector.source.id ? cardDoc.get(connector.source.id) : undefined;
      const targetDoc = connector.target.id ? cardDoc.get(connector.target.id) : undefined;
      const linked = entry.links.get(connector.id);
      const relation = linked ? relationById.get(linked) : undefined;
      if (!sourceDoc || !targetDoc || sourceDoc === targetDoc) continue;
      if (relation && relation.source_id === sourceDoc && relation.target_id === targetDoc) continue;
      if (relation) {
        await api.deleteRelation(relation.id).catch(() => undefined);
        this._relations = this._relations.filter(item => item.id !== relation.id);
      }
      try {
        const created = await api.createRelation(this.workspaceId, { source_id: sourceDoc, target_id: targetDoc, kind: '关联', label: '' });
        this._relations.push(created);
        entry.links.set(connector.id, created.id);
      } catch {
        entry.links.delete(connector.id);
      }
      changed = true;
    }
    if (changed) this.onRelationsChanged?.();
  }

  /** 为画布上两端文稿都存在、但尚无连线的关系补齐连线；删除已失效关系的连线。 */
  syncCanvasRelations(canvasId: string) {
    const entry = this._canvases.get(canvasId);
    if (!entry || entry.store.readonly) return;
    const surface = this._surface(entry.store);
    if (!surface) return;
    const cards = entry.store.getModelsByFlavour(SYNCED_DOC);
    const cardByDoc = new Map<string, string>();
    for (const card of cards) {
      const pageId = (card.props as unknown as { pageId: string }).pageId;
      if (!cardByDoc.has(pageId)) cardByDoc.set(pageId, card.id);
    }
    const relationIds = new Set(this._relations.map(relation => relation.id));
    entry.suppress++;
    let changed = false;
    try {
      for (const [connectorId, relationId] of Array.from(entry.links)) {
        if (relationIds.has(relationId) && surface.hasElementById(connectorId)) continue;
        entry.links.delete(connectorId);
        if (surface.hasElementById(connectorId)) surface.deleteElement(connectorId);
        changed = true;
      }
      for (const relation of this._relations) {
        if (Array.from(entry.links.values()).includes(relation.id)) continue;
        const source = cardByDoc.get(relation.source_id);
        const target = cardByDoc.get(relation.target_id);
        if (!source || !target) continue;
        const context = relation.kind === 'context';
        const connectorId = surface.addElement({
          type: 'connector',
          mode: 2,
          source: { id: source },
          target: { id: target },
          stroke: context ? '#929292' : '#d97757',
          strokeStyle: context ? 'dash' : 'solid',
          strokeWidth: context ? 2 : 3,
        });
        entry.links.set(connectorId, relation.id);
        changed = true;
      }
    } finally {
      entry.suppress--;
    }
    if (changed) this._markCanvasDirty(entry);
  }

  relationForConnector(canvasId: string, connectorId: string) {
    return this._canvases.get(canvasId)?.links.get(connectorId) ?? null;
  }

  async saveCanvas(id: string, options: { overwriteRevision?: number } = {}): Promise<void> {
    const entry = this._canvases.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    if (entry.saving) {
      entry.again = true;
      return entry.saving;
    }
    if (entry.status.state === 'saved' && options.overwriteRevision === undefined) return;
    if (entry.status.state === 'conflict' && options.overwriteRevision === undefined) return;
    entry.status = { ...entry.status, state: 'saving' };
    this._emit();
    entry.saving = (async () => {
      try {
        await this.reconcileCanvasLinks(id);
        const update = Y.encodeStateAsUpdate(this.workspace.getResearchDoc(id)!.spaceDoc);
        const envelope: EditorStateEnvelope = { format: 'blocksuite-yjs-v1', update: toBase64(update), links: Object.fromEntries(entry.links) };
        const saved = await api.updateCanvas(id, {
          expected_revision: options.overwriteRevision ?? entry.status.version,
          name: entry.canvas.name,
          objects: this.canvasObjects(id),
          editor_state: envelope,
        });
        entry.canvas = saved;
        entry.status = { state: entry.again ? 'dirty' : 'saved', version: saved.revision, savedAt: Date.now() };
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
      if (entry.again && entry.status.state === 'dirty') {
        entry.again = false;
        await this.saveCanvas(id);
      }
      entry.again = false;
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
    const entry = this._canvases.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      this._canvases.delete(id);
      this.workspace.removeDoc(id);
    }
    await this.ensureCanvas(current, documents);
    return current;
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
