// Research Canvas 的 BlockSuite Workspace / Doc / WorkspaceMeta 实现。
// 结构参考 BlockSuite 5cb5cb68471ca692f3c162258f0087cb22fcb82d 的
// packages/framework/store/src/test/{test-workspace,test-doc,test-meta}.ts（MIT）；
// 此处改为每个后端文稿或画布各自持有独立 Y.Doc，状态由后端 editor_state 恢复，
// 元数据保存在内存并由工作区数据驱动。
import { BlockSuiteError, ErrorCode } from '@blocksuite/affine/global/exceptions';
import { NoopLogger } from '@blocksuite/affine/global/utils';
import {
  AwarenessStore,
  type Doc,
  type DocMeta,
  type DocsPropertiesMeta,
  type ExtensionType,
  type GetStoreOptions,
  nanoid,
  type RemoveStoreOptions,
  type Store,
  StoreContainer,
  type Workspace,
  type WorkspaceMeta,
  type YBlock,
} from '@blocksuite/affine/store';
import { BlobEngine, type BlobSource, MemoryBlobSource } from '@blocksuite/affine/sync';
import { Subject } from 'rxjs';
import { Awareness } from 'y-protocols/awareness.js';
import * as Y from 'yjs';

class ResearchMeta implements WorkspaceMeta {
  private readonly _metas = new Map<string, DocMeta>();
  private _properties: DocsPropertiesMeta = { tags: { options: [] } };
  docMetaAdded = new Subject<string>();
  docMetaRemoved = new Subject<string>();
  docMetaUpdated = new Subject<void>();

  get docMetas() { return Array.from(this._metas.values()); }
  get docs() { return this.docMetas; }
  get properties() { return this._properties; }

  addDocMeta(props: DocMeta) {
    this._metas.set(props.id, { ...props });
    this.docMetaAdded.next(props.id);
    this.docMetaUpdated.next();
  }
  getDocMeta(id: string) { return this._metas.get(id); }
  setDocMeta(id: string, props: Partial<DocMeta>) {
    const meta = this._metas.get(id);
    if (!meta) return;
    Object.assign(meta, props);
    this.docMetaUpdated.next();
  }
  removeDocMeta(id: string) {
    if (!this._metas.delete(id)) return;
    this.docMetaRemoved.next(id);
    this.docMetaUpdated.next();
  }
  setProperties(meta: DocsPropertiesMeta) {
    this._properties = meta;
    this.docMetaUpdated.next();
  }
  initialize() {}
}

export class ResearchDoc implements Doc {
  readonly id: string;
  readonly rootDoc: Y.Doc;
  readonly spaceDoc: Y.Doc;
  readonly yBlocks: Y.Map<YBlock>;
  readonly awarenessStore: AwarenessStore;
  private readonly _workspace: ResearchWorkspace;
  private readonly _storeContainer: StoreContainer;
  private _ready = false;

  constructor(id: string, workspace: ResearchWorkspace) {
    this.id = id;
    this._workspace = workspace;
    this.rootDoc = workspace.doc;
    this.awarenessStore = workspace.awarenessStore;
    this.spaceDoc = new Y.Doc({ guid: id });
    this.rootDoc.getMap('spaces').set(id, this.spaceDoc);
    this.yBlocks = this.spaceDoc.getMap('blocks');
    this._storeContainer = new StoreContainer(this);
  }

  get workspace(): Workspace { return this._workspace; }
  get meta() { return this._workspace.meta.getDocMeta(this.id); }
  get loaded() { return true; }
  get ready() { return this._ready; }
  get removeStore(): (options: RemoveStoreOptions) => void { return this._storeContainer.removeStore; }

  clear() { this.yBlocks.clear(); }

  dispose() {
    if (this.ready) this.yBlocks.clear();
  }

  getStore({ readonly, query, provider, extensions, id }: GetStoreOptions = {}): Store {
    const storeId = id ?? (readonly !== undefined || query ? undefined : this.spaceDoc.guid);
    return this._storeContainer.getStore({
      id: storeId,
      readonly,
      query,
      provider,
      extensions: this._workspace.storeExtensions.concat(extensions ?? []),
    });
  }

  load(initFn?: () => void): this {
    if (this._ready) return this;
    this.spaceDoc.load();
    initFn?.();
    this._ready = true;
    return this;
  }

  remove() {
    this.spaceDoc.destroy();
    this.rootDoc.getMap('spaces').delete(this.id);
  }
}

export type ResearchWorkspaceOptions = {
  id: string;
  storeExtensions: ExtensionType[];
  blobSource?: BlobSource;
};

export class ResearchWorkspace implements Workspace {
  readonly id: string;
  readonly doc: Y.Doc;
  readonly meta: WorkspaceMeta = new ResearchMeta();
  readonly idGenerator = nanoid;
  readonly blobSync: BlobEngine;
  readonly awarenessStore: AwarenessStore;
  readonly storeExtensions: ExtensionType[];
  readonly slots = { docListUpdated: new Subject<void>() };
  private readonly _docs = new Map<string, ResearchDoc>();

  constructor({ id, storeExtensions, blobSource }: ResearchWorkspaceOptions) {
    this.id = id;
    this.doc = new Y.Doc({ guid: id });
    this.awarenessStore = new AwarenessStore(new Awareness(this.doc));
    this.storeExtensions = storeExtensions;
    this.blobSync = new BlobEngine(blobSource ?? new MemoryBlobSource(), [], new NoopLogger());
    this.meta.docMetaUpdated.subscribe(() => this.slots.docListUpdated.next());
  }

  get docs() { return this._docs as Map<string, Doc>; }

  createDoc(docId?: string): Doc {
    const id = docId ?? this.idGenerator();
    if (this._docs.has(id)) throw new BlockSuiteError(ErrorCode.DocCollectionError, 'doc already exists');
    const doc = new ResearchDoc(id, this);
    this._docs.set(id, doc);
    this.meta.addDocMeta({ id, title: '', createDate: Date.now(), tags: [] });
    return doc;
  }

  getDoc(docId: string): Doc | null {
    return this._docs.get(docId) ?? null;
  }

  getResearchDoc(docId: string): ResearchDoc | null {
    return this._docs.get(docId) ?? null;
  }

  removeDoc(docId: string) {
    const doc = this._docs.get(docId);
    if (!doc) return;
    doc.dispose();
    doc.remove();
    this._docs.delete(docId);
    this.meta.removeDocMeta(docId);
  }

  dispose() {
    for (const doc of this._docs.values()) doc.remove();
    this._docs.clear();
    this.awarenessStore.destroy();
  }
}
