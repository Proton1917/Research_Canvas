import { GfxControllerIdentifier } from '@editor/runtime/gfx';
import type { BlockStdScope } from '@editor/runtime';
import type { Store } from '@editor/document';
import { EdgelessClipboardController } from '@editor/blocks/root/edgeless/clipboard/clipboard';
import {
  ChatWithAiIcon, CloseIcon, CommentIcon, EditIcon, ExpandFullIcon, ImportIcon, LinkIcon, NoteShadowDuotoneIcon, OpenInNewIcon, PlusIcon, ViewIcon,
} from '@blocksuite/icons/rc';
import type { Anchor, ProposalEndpoint } from '@research';
import { allSceneIds, neighborIds, projectScene, readSelection, regionBelow, type SceneCatalog, type SelectionTarget } from '@research/editor';
import { Button, QuietDotsWave } from '@ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  addMaterialDocument, app, createAnchor, createDocument, createRelation, discussInPlace, documentMap, errorText, getSession,
  hideRelationOnCanvas, importFiles, openAsk, openBridge, openDocument, placeFragment, registerCanvasActions, relateConnector,
  renameCanvas, setCanvasSelection, setSceneIds, setTab, toast, useApp,
} from '../app/model';
import { buildMaterials } from '../app/materials';
import { useSession } from '../app/useSession';
import { Chip, KindIcon, MenuItem, Popover, SaveIndicator } from '../components/common';
import { EditorHost } from '../components/EditorHost';
import { ConflictBar } from '../components/ConflictBar';
import { KIND_LABEL } from '../lib/format';
import { BridgePanel } from './BridgeCard';
import { CanvasAskPanel, WriteRegion } from './CanvasAsk';
import { ProposalLayer, ProposalPanel } from './CanvasProposal';

const CARD_SIZE = { width: 560, height: 420 };
const SYNCED = 'affine:embed-synced-doc';
export const DOC_DRAG_TYPE = 'application/x-research-canvas-document';

type Subscribable = { subscribe(fn: () => void): { unsubscribe(): void } };

type Gfx = {
  viewport: {
    centerX: number; centerY: number; zoom: number;
    toModelCoordFromClientCoord(point: [number, number]): [number, number];
    toViewCoord(x: number, y: number): [number, number];
    setViewport(zoom: number, center: [number, number], smooth?: boolean): void;
    width: number; height: number;
    viewportUpdated: Subscribable;
  };
  selection: { selectedIds: string[]; slots: { updated: Subscribable }; set(selection: { elements: string[]; editing: boolean }): void };
  fitToScreen(options?: { smooth?: boolean; padding?: [number, number, number, number] }): void;
  /** 编辑器块或绘制表面元素 */
  getElementById(id: string): { xywh?: string } | null;
};

function xywhOf(model: { props: unknown }) {
  return JSON.parse((model.props as { xywh: string }).xywh) as [number, number, number, number];
}

/** 从起点开始按环形网格寻找不与现有卡片、便笺重叠的位置。 */
function freeSlot(store: Store, [x0, y0]: [number, number], size = CARD_SIZE): [number, number] {
  const gap = 48;
  const rects = store.getModelsByFlavour([SYNCED, 'affine:note']).filter(model => (model.props as { displayMode?: string }).displayMode !== 'doc').map(xywhOf);
  const free = (x: number, y: number) => rects.every(([rx, ry, rw, rh]) => x + size.width + gap <= rx || rx + rw + gap <= x || y + size.height + gap <= ry || ry + rh + gap <= y);
  const stepX = size.width + gap;
  const stepY = size.height + gap;
  for (let ring = 0; ring < 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = x0 + dx * stepX;
        const y = y0 + dy * stepY;
        if (free(x, y)) return [Math.round(x), Math.round(y)];
      }
    }
  }
  return [x0, y0];
}

export function CanvasView({ canvasId }: { canvasId: string }) {
  const session = useSession();
  const canvas = useApp(state => state.summary?.canvases.find(item => item.id === canvasId));
  const documents = useApp(state => state.summary?.documents ?? []);
  const relations = useApp(state => state.summary?.relations ?? []);
  const selection = useApp(state => state.canvasSelection);
  const sceneIds = useApp(state => state.sceneIds);
  const ask = useApp(state => (state.ask?.canvasId === canvasId ? state.ask : null));
  const bridge = useApp(state => state.bridge);
  const proposalOpen = useApp(state => !!state.proposalDraft && state.canvasProposals[state.proposalDraft.id]?.canvas_id === canvasId);
  const proposalId = useApp(state => (state.proposalDraft && state.canvasProposals[state.proposalDraft.id]?.canvas_id === canvasId ? state.proposalDraft.id : null));
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [name, setName] = useState(canvas?.name ?? '');
  const gfxRef = useRef<Gfx | null>(null);
  const stdRef = useRef<BlockStdScope | null>(null);
  /** “研究这个联系”的一句说明；null 表示未展开 */
  const [relateNote, setRelateNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekStore, setPeekStore] = useState<Store | null>(null);
  const [, setViewTick] = useState(0);
  const pendingPeek = useApp(state => state.peekRequest);
  const generation = session?.canvasGeneration(canvasId) ?? 0;

  useEffect(() => {
    let cancelled = false;
    setPeekStore(null);
    const doc = peekId ? documentMap().get(peekId) : undefined;
    const s = getSession();
    if (!doc || !s) return;
    void s.ensureStore(doc).then(loaded => { if (!cancelled) setPeekStore(loaded); });
    return () => { cancelled = true; };
  }, [peekId]);

  useEffect(() => {
    if (!pendingPeek) return;
    setPeekId(pendingPeek);
    app.set({ peekRequest: null });
  }, [pendingPeek]);

  useEffect(() => setName(canvas?.name ?? ''), [canvas?.name]);

  useEffect(() => {
    let cancelled = false;
    setStore(null);
    setError(null);
    const s = getSession();
    const current = app.get().summary?.canvases.find(item => item.id === canvasId);
    if (!s || !current) return;
    s.ensureCanvas(current, documentMap())
      .then(() => {
        if (cancelled) return;
        s.syncCanvasRelations(canvasId, false);
        setStore(s.getStore(canvasId));
      })
      .catch(err => !cancelled && setError(errorText(err)));
    return () => { cancelled = true; };
    // 画布事务或冲突处理采用服务端状态后 generation 递增，重新挂载编辑器
  }, [canvasId, session, generation]);

  const cardDocument = useCallback((blockId: string) => {
    const model = store?.getModelById(blockId);
    return model?.flavour === SYNCED ? (model.props as unknown as { pageId: string }).pageId : null;
  }, [store]);

  const placeDocument = useCallback(async (documentId: string, near?: string | null, point?: [number, number]) => {
    const s = getSession();
    const gfx = gfxRef.current;
    const doc = documentMap().get(documentId);
    if (!s || !doc || !store) return null;
    let x: number;
    let y: number;
    const nearCard = near ? store.getModelsByFlavour(SYNCED).find(model => (model.props as unknown as { pageId: string }).pageId === near) : undefined;
    if (point) {
      [x, y] = point;
    } else if (nearCard) {
      const [nx, ny, nw] = xywhOf(nearCard);
      const siblings = store.getModelsByFlavour(SYNCED).filter(model => xywhOf(model)[0] >= nx + nw + 40).length;
      x = nx + nw + 120;
      y = ny + siblings * 60;
    } else {
      [x, y] = freeSlot(store, gfx ? [gfx.viewport.centerX - CARD_SIZE.width / 2, gfx.viewport.centerY - CARD_SIZE.height / 2] : [0, 0]);
    }
    const id = await s.addDocumentToCanvas(canvasId, doc, { x, y }, CARD_SIZE);
    gfx?.selection.set({ elements: [id], editing: false });
    return id;
  }, [canvasId, store]);

  const placeFragment = useCallback((anchor: Anchor, nearDocumentId?: string | null) => {
    const s = getSession();
    if (!s || !store) return null;
    const title = documentMap().get(anchor.document_id)?.title ?? '文稿';
    const size = { width: 420, height: 220 };
    const card = nearDocumentId ? store.getModelsByFlavour(SYNCED).find(model => (model.props as unknown as { pageId: string }).pageId === nearDocumentId) : undefined;
    const gfx = gfxRef.current;
    const start: [number, number] = card
      ? (() => { const [cx, cy, cw] = xywhOf(card); return [cx + cw + 80, cy]; })()
      : gfx ? [gfx.viewport.centerX - size.width / 2, gfx.viewport.centerY - size.height / 2] : [0, 0];
    const [x, y] = freeSlot(store, start, size);
    const id = s.addFragmentToCanvas(canvasId, anchor, title, { x, y }, size.width);
    gfx?.selection.set({ elements: [id], editing: false });
    return id;
  }, [canvasId, store]);

  /** 将所选块与绘制元素按画布渲染为 PNG（编辑器自带的导出管线）。 */
  const capture = useCallback(async (ids: string[]) => {
    const std = stdRef.current;
    const gfx = gfxRef.current;
    if (!std || !gfx || !store) throw new Error('画布尚未就绪');
    const models = ids.map(id => gfx.getElementById(id)).filter(Boolean);
    const blocks = models.filter(model => store.getModelById((model as { id: string }).id));
    const shapes = models.filter(model => !store.getModelById((model as { id: string }).id));
    const clipboard = std.getOptional(EdgelessClipboardController);
    const canvas = clipboard ? await clipboard.toCanvas(blocks as never, shapes as never, { background: '#ffffff' }) : undefined;
    if (!canvas) throw new Error('所选对象没有可渲染的范围');
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('截图编码失败'))), 'image/png'));
  }, [store]);

  /** 按当前编辑器状态生成场景投影与材料清单；revision 取会话中已保存的画布版本。 */
  const project = useCallback((ids: string[]) => {
    const s = getSession();
    const gfx = gfxRef.current;
    const summary = app.get().summary;
    if (!s || !gfx || !store || !summary || ids.length === 0) return null;
    const catalog: SceneCatalog = {
      workspaceId: summary.workspace.id,
      canvasId,
      canvasRevision: s.canvasStatus(canvasId)?.version ?? 0,
      documents: documentMap(),
      anchors: new Map(summary.anchors.map(anchor => [anchor.id, anchor])),
      relations: new Map(summary.relations.map(relation => [relation.id, relation])),
      contexts: app.get().contexts,
      documentVersion: id => s.docStatus(id)?.version ?? null,
      linkView: id => s.linkView(canvasId, id),
      fragment: id => s.fragmentFor(canvasId, id),
      assetFor: key => s.blobs.assetIdFor(key),
    };
    const everything = allSceneIds(store);
    const whole = everything.length > 0 && everything.every(id => ids.includes(id));
    const projection = projectScene(store, ids, catalog, { zoom: gfx.viewport.zoom, centerX: gfx.viewport.centerX, centerY: gfx.viewport.centerY }, whole ? 'canvas' : 'selection');
    // 直接选中分组或框时，投影展开其子对象
    if (!whole && projection.objects.some(object => !object.via && (object.kind === 'group' || object.kind === 'frame'))) projection.entry = 'group';
    return { projection, materials: buildMaterials(projection, summary.anchors, documentMap()) };
  }, [canvasId, store]);

  const openAskFor = useCallback((ids: string[]) => {
    const result = project(ids);
    if (!result) return;
    openAsk({ canvasId, ids, ...result, region: regionBelow(result.projection.bounds), anchor: { left: 0, top: 0 } });
  }, [canvasId, project]);

  /** 视口中心附近的空位（讨论归位缺少冻结写入区域时使用）。 */
  const slot = useCallback((size: { width: number; height: number }) => {
    const gfx = gfxRef.current;
    const start: [number, number] = gfx ? [gfx.viewport.centerX - size.width / 2, gfx.viewport.centerY - size.height / 2] : [0, 0];
    const [x, y] = store ? freeSlot(store, start, size) : start;
    return { x, y, ...size };
  }, [store]);

  /** 选中对象并把视口移到其范围；编辑器刚挂载时等待其就绪，并排在挂载时的“显示全部”之后。 */
  const focus = useCallback((ids: string[]) => {
    const apply = (tries: number) => {
      const gfx = gfxRef.current;
      const rects = gfx ? ids.map(id => gfx.getElementById(id)?.xywh).filter((xywh): xywh is string => !!xywh).map(xywh => JSON.parse(xywh) as [number, number, number, number]) : [];
      if (!gfx || rects.length === 0) { if (tries < 40) setTimeout(() => apply(tries + 1), 50); return; }
      gfx.selection.set({ elements: ids, editing: false });
      const x = Math.min(...rects.map(rect => rect[0]));
      const y = Math.min(...rects.map(rect => rect[1]));
      const right = Math.max(...rects.map(rect => rect[0] + rect[2]));
      const bottom = Math.max(...rects.map(rect => rect[1] + rect[3]));
      const zoom = Math.min(1, (gfx.viewport.width - 160) / (right - x), (gfx.viewport.height - 160) / (bottom - y));
      gfx.viewport.setViewport(Math.max(0.1, zoom), [(x + right) / 2, (y + bottom) / 2], true);
    };
    setTimeout(() => apply(0), 100);
  }, []);

  useEffect(() => {
    if (!store || store !== getSession()?.getStore(canvasId)) return;
    registerCanvasActions({
      canvasId, generation, place: placeDocument, placeFragment, ask: openAskFor, reproject: project, neighbors: ids => neighborIds(store, ids), capture, slot, focus,
    });
    return () => registerCanvasActions(null);
  }, [store, canvasId, generation, placeDocument, placeFragment, openAskFor, project, capture, slot, focus]);

  const onReady = useCallback((_editor: unknown, std: BlockStdScope) => {
    const gfx = std.get(GfxControllerIdentifier) as unknown as Gfx;
    gfxRef.current = gfx;
    stdRef.current = std;
    const update = () => {
      const ids = gfx.selection.selectedIds;
      const s = getSession();
      setSelectedCards(ids.filter(id => cardDocument(id)));
      setSceneIds(ids);
      if (ids.length === 1) {
        const documentId = cardDocument(ids[0]);
        if (documentId) { setCanvasSelection({ kind: 'card', documentId, blockId: ids[0] }); return; }
        const view = s?.linkView(canvasId, ids[0]);
        if (view?.relation_id) { setCanvasSelection({ kind: 'relation', relationId: view.relation_id, connectorId: ids[0] }); return; }
        if (view) { setCanvasSelection({ kind: 'link', connectorId: ids[0] }); return; }
      }
      setCanvasSelection(null);
    };
    const subscription = gfx.selection.slots.updated.subscribe(update);
    // 视口变化时重新计算浮层位置（世界坐标 → 视图坐标）
    let frame = 0;
    const viewport = gfx.viewport.viewportUpdated.subscribe(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewTick(value => value + 1));
    });
    const s = getSession();
    if (s && s.canvasObjects(canvasId).length > 0) {
      requestAnimationFrame(() => gfx.fitToScreen({ padding: [80, 80, 80, 80] }));
    }
    return () => { subscription.unsubscribe(); viewport.unsubscribe(); cancelAnimationFrame(frame); setSceneIds([]); };
  }, [canvasId, cardDocument]);

  const onDrop = useCallback((event: DragEvent) => {
    const documentId = event.dataTransfer?.getData(DOC_DRAG_TYPE);
    if (!documentId) return;
    event.preventDefault();
    event.stopPropagation();
    const gfx = gfxRef.current;
    const point = gfx?.viewport.toModelCoordFromClientCoord([event.clientX, event.clientY]);
    void placeDocument(documentId, null, point ? [point[0] - 80, point[1] - 40] : undefined);
  }, [placeDocument]);

  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes(DOC_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); }
    };
    // 画布中的文稿卡片为只读渲染；双击卡片在当前研究区域旁展开编辑同一份文稿。
    const dblclick = (event: MouseEvent) => {
      const card = (event.target as HTMLElement | null)?.closest?.('affine-embed-edgeless-synced-doc-block') as HTMLElement | null;
      const documentId = card?.dataset.blockId ? cardDocument(card.dataset.blockId) : null;
      if (!documentId) return;
      event.preventDefault();
      event.stopPropagation();
      setPeekId(documentId);
    };
    element.addEventListener('dragover', over, true);
    element.addEventListener('drop', onDrop, true);
    element.addEventListener('dblclick', dblclick, true);
    return () => {
      element.removeEventListener('dragover', over, true);
      element.removeEventListener('drop', onDrop, true);
      element.removeEventListener('dblclick', dblclick, true);
    };
  }, [onDrop, cardDocument]);

  const onCanvas = useMemo(() => {
    if (!store) return new Set<string>();
    return new Set(store.getModelsByFlavour(SYNCED).map(model => (model.props as unknown as { pageId: string }).pageId));
    // 画布保存后重新计算已放置文稿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, session?.canvasStatus(canvasId)?.version, picker]);

  const status = session?.canvasStatus(canvasId) ?? null;
  const held = session?.isCanvasHeld(canvasId) ?? false;
  const selectedDoc = selection?.kind === 'card' ? documents.find(doc => doc.id === selection.documentId) : undefined;
  const pairDocs = selectedCards.length === 2 ? selectedCards.map(id => cardDocument(id)).filter((id): id is string => !!id) : [];
  const selectedRelation = selection?.kind === 'relation' ? relations.find(item => item.id === selection.relationId) : undefined;
  const linkView = selection?.kind === 'link' ? session?.linkView(canvasId, selection.connectorId) ?? null : null;
  const linkEnds = selection?.kind === 'link' ? session?.connectorEndpoints(canvasId, selection.connectorId) ?? [null, null] : [null, null];
  // 两端为文稿卡片、片段卡片或带文字的想法，且不是同一对象
  const linkRelatable = !!linkEnds[0] && !!linkEnds[1] && linkEnds[0].instance !== linkEnds[1].instance
    && !(linkEnds[0].type === 'document' && linkEnds[1].type === 'document' && linkEnds[0].id === linkEnds[1].id);
  const detachedFrom = linkView?.detached_from ? relations.find(item => item.id === linkView.detached_from) : undefined;

  // 浮层位置：就近提问面板放在所选范围右侧，空间不足时放在左侧
  const gfx = gfxRef.current;
  const toView = (x: number, y: number): [number, number] => gfx ? gfx.viewport.toViewCoord(x, y) : [x, y];
  const zoom = gfx?.viewport.zoom ?? 1;
  let askPosition = { left: 12, top: 12 };
  if (ask && gfx && surface.current) {
    const bounds = ask.projection.bounds;
    const width = surface.current.clientWidth;
    const height = surface.current.clientHeight;
    if (bounds) {
      const [x1, y1] = toView(bounds.x, bounds.y);
      const [x2] = toView(bounds.x + bounds.width, bounds.y);
      const left = x2 + 16 + 400 <= width ? x2 + 16 : x1 - 416 >= 0 ? x1 - 416 : width - 412;
      askPosition = { left: Math.max(12, Math.min(left, width - 412)), top: Math.max(12, Math.min(y1, height - 320)) };
    }
  }

  // 候选联系端点在本画布中的范围：文稿卡片、锚点的片段卡片或场景实例
  const endpointBounds = (endpoint: ProposalEndpoint) => {
    const s = getSession();
    if (!store || !s) return null;
    const id = s.locateEndpoint(canvasId, endpoint);
    const xywh = id ? gfxRef.current?.getElementById(id)?.xywh : undefined;
    if (!xywh) return null;
    const [x, y, width, height] = JSON.parse(xywh) as [number, number, number, number];
    return { x, y, width, height };
  };

  // 提案打开时将视口移到候选区域，候选框按可读尺寸显示
  useEffect(() => {
    const view = gfxRef.current?.viewport;
    const draft = app.get().proposalDraft;
    if (!proposalId || !view || !draft) return;
    // 候选框、移动目标，以及候选联系中已在画布上的端点（片段、想法、文稿卡片）
    const rects = draft.actions.flatMap(action => {
      if (action.type === 'create_document' || action.type === 'move_object') return [action.bounds];
      if (action.type !== 'create_relation') return [];
      return [action.source, action.target].flatMap(end => (end.type === 'created' ? [] : [endpointBounds(end)].filter((rect): rect is NonNullable<typeof rect> => !!rect)));
    });
    if (rects.length === 0) return;
    const x = Math.min(...rects.map(rect => rect.x));
    const y = Math.min(...rects.map(rect => rect.y));
    const right = Math.max(...rects.map(rect => rect.x + rect.width));
    const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
    // 右侧留出提案面板宽度
    const zoom = Math.min(1, (view.width - 480) / (right - x + 120), (view.height - 120) / (bottom - y + 120));
    view.setViewport(Math.max(0.1, zoom), [(x + right) / 2 + 200 / Math.max(0.1, zoom), (y + bottom) / 2], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId]);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && canvas && trimmed !== canvas.name) renameCanvas(canvasId, trimmed);
    else setName(canvas?.name ?? '');
  };

  if (!canvas) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-line bg-surface-1 px-3 py-1.5">
        <KindIcon kind="canvas" className="text-ink-muted" />
        <input
          aria-label="画布名称"
          value={name}
          onChange={event => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) (event.target as HTMLInputElement).blur(); }}
          className="rc-focus-ring w-40 min-w-[7rem] max-w-[16rem] shrink rounded-md bg-transparent px-1.5 py-1 text-sm font-semibold text-ink hover:bg-[var(--cds-fill-ghost-hover)]"
        />
        <SaveIndicator status={status} kind="canvas" />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Button size="sm" variant="secondary" icon={<PlusIcon width={16} height={16} />} onClick={() => setPicker(open => !open)} aria-expanded={picker}>放入文稿</Button>
            <Popover open={picker} onClose={() => setPicker(false)} className="right-0 max-h-[60vh] w-72 overflow-auto rc-scroll">
              {documents.length === 0 && <p className="px-3 py-4 text-xs text-ink-muted">工作区还没有文稿。可新建想法或导入文件。</p>}
              {documents.map(doc => (
                <MenuItem key={doc.id} icon={<KindIcon kind={doc.kind} />} hint={onCanvas.has(doc.id) ? '已在画布' : KIND_LABEL[doc.kind]} onClick={() => { setPicker(false); void placeDocument(doc.id); }}>
                  {doc.title || '未命名'}
                </MenuItem>
              ))}
            </Popover>
          </div>
          <Button size="sm" variant="ghost" icon={<NoteShadowDuotoneIcon width={16} height={16} />} onClick={() => void createDocument('note', '', { place: true })}>新建想法</Button>
          <Button size="sm" variant="ghost" icon={<ImportIcon width={16} height={16} />} onClick={() => fileInput.current?.click()}>导入</Button>
          {store && <Button size="sm" variant="ghost" icon={<ChatWithAiIcon width={16} height={16} />} onClick={() => openAskFor(allSceneIds(store))} title="以整张画布为范围提问">整张画布</Button>}
          <Button size="icon-sm" variant="ghost" aria-label="显示全部内容" title="显示全部内容" icon={<ExpandFullIcon width={16} height={16} />} onClick={() => gfxRef.current?.fitToScreen({ smooth: true, padding: [80, 80, 80, 80] })} />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept=".pdf,.md,.markdown,.txt,text/plain,text/markdown,application/pdf,image/*"
            onChange={event => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length) void importFiles(files, { place: true });
            }}
          />
        </div>
      </div>
      {/* 随选择变化的操作放在固定高度的一行：选择对象时画布位置保持不变，连续点击仍落在同一对象上 */}
      <div className="rc-scroll flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden border-b border-line bg-surface-1 px-3 [&>*]:shrink-0" data-testid="canvas-selection-bar">
        {!(sceneIds.length > 0 || selection !== null || pairDocs.length === 2) && <span className="text-xs text-ink-muted">选择卡片、片段、想法或连线后，在这里提问、展开编辑或研究联系</span>}
        {sceneIds.length > 0 && (
          <Button size="sm" variant="primary" icon={<ChatWithAiIcon width={16} height={16} />} onClick={() => openAskFor(sceneIds)}>
            向 AI 提问{sceneIds.length > 1 ? `（${sceneIds.length}）` : ''}
          </Button>
        )}
        {selectedDoc?.kind === 'discussion' && selection?.kind === 'card' && (
          <Button size="sm" variant="secondary" icon={<ChatWithAiIcon width={16} height={16} />} onClick={() => openAskFor([selection.blockId])} title="以这次讨论及其冻结材料为起点继续追问，结果放在旁边">继续追问</Button>
        )}
        {selectedDoc && (
          <>
            <Button size="sm" variant="ghost" icon={<EditIcon width={16} height={16} />} onClick={() => setPeekId(selectedDoc.id)}>展开编辑</Button>
            <Button size="sm" variant="ghost" icon={<OpenInNewIcon width={16} height={16} />} onClick={() => openDocument(selectedDoc.id)}>打开精读</Button>
            <Button size="sm" variant="ghost" icon={<ChatWithAiIcon width={16} height={16} />} onClick={() => addMaterialDocument(selectedDoc.id)}>作为讨论材料</Button>
          </>
        )}
        {selectedRelation && selection?.kind === 'relation' && (
          <>
            <Button size="sm" variant="secondary" icon={<LinkIcon width={16} height={16} />} onClick={() => openBridge(selectedRelation.id, canvasId)}>研究这个联系</Button>
            <Button size="sm" variant="ghost" icon={<ViewIcon width={16} height={16} />} onClick={() => hideRelationOnCanvas(selectedRelation.id)} title="只隐藏本画布中的连线，研究关系保留">在本画布隐藏</Button>
          </>
        )}
        {selection?.kind === 'link' && (
          <>
            <Chip>{detachedFrom ? '已改接 · 原关系保留' : '纯视觉连线'}</Chip>
            {linkRelatable && (relateNote === null ? (
              <Button size="sm" variant="secondary" icon={<LinkIcon width={16} height={16} />} onClick={() => setRelateNote('')}>研究这个联系</Button>
            ) : (
              <form
                className="flex items-center gap-1.5"
                onSubmit={event => { event.preventDefault(); void relateConnector(canvasId, selection.connectorId, relateNote.trim()).then(() => setRelateNote(null)); }}
              >
                <input
                  autoFocus
                  aria-label="联系说明"
                  className="rc-input w-56 py-1 text-xs"
                  placeholder="一句说明（可选）"
                  value={relateNote}
                  onChange={event => setRelateNote(event.target.value)}
                  onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setRelateNote(null); }}
                />
                <Button size="sm" variant="primary" type="submit">建立候选联系</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setRelateNote(null)}>取消</Button>
              </form>
            ))}
            {detachedFrom && <Button size="sm" variant="ghost" onClick={() => app.set({ selectedRelationId: detachedFrom.id, tab: 'relations', panelOpen: true })}>查看原关系</Button>}
          </>
        )}
        {pairDocs.length === 2 && pairDocs[0] !== pairDocs[1] && (
          <Button size="sm" variant="secondary" icon={<LinkIcon width={16} height={16} />} onClick={() => void createRelation(pairDocs[0], pairDocs[1])}>建立关系</Button>
        )}
      </div>
      {status?.state === 'conflict' && <ConflictBar kind="canvas" id={canvasId} />}
      {status?.state === 'error' && (
        <div className="flex items-center gap-2 border-b border-line bg-orange-500/10 px-3 py-1.5 text-xs text-[var(--rc-bad)]">
          画布布局保存失败：{status.error}。画布内容仍保留在本页。
          <Button size="xs" variant="secondary" onClick={() => void getSession()?.saveCanvas(canvasId)}>重试</Button>
        </div>
      )}
      {held && <div role="status" className="border-b border-line bg-clay/10 px-3 py-1.5 text-xs text-ink">正在提交画布写入，期间暂停编辑与自动保存。</div>}
      <div ref={surface} className="relative min-h-0 flex-1" data-testid="canvas-surface">
        {error && <div className="p-6 text-sm text-[var(--rc-bad)]">画布载入失败：{error}</div>}
        {!store && !error && <div className="flex h-full items-center justify-center"><QuietDotsWave label="载入画布" /></div>}
        {store && store === session?.getStore(canvasId) && <EditorHost key={generation} store={store} mode="edgeless" onReady={onReady} />}
        {gfx && (ask || proposalOpen) && (
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            {ask && <WriteRegion ask={ask} toView={toView} zoom={zoom} />}
            {proposalOpen && <ProposalLayer canvasId={canvasId} toView={toView} zoom={zoom} endpointBounds={endpointBounds} />}
            {ask && <CanvasAskPanel ask={ask} left={askPosition.left} top={askPosition.top} />}
            {proposalOpen && <ProposalPanel canvasId={canvasId} />}
          </div>
        )}
        {bridge && (bridge.canvasId === canvasId || bridge.canvasId === null) && <BridgePanel relationId={bridge.relationId} />}
        {peekId && (
          <PeekEditor documentId={peekId} store={peekStore} onClose={() => setPeekId(null)} />
        )}
        {store && onCanvas.size === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
            <div className="pointer-events-auto rounded-xl border border-line bg-surface-2/95 px-4 py-3 text-center text-xs text-ink-secondary shadow-panel">
              从左侧拖入文稿，或使用「放入文稿」「新建想法」「导入」开始组织研究；也可以直接画框、写便笺和连线
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type PeekFloating = { target: SelectionTarget; top: number; left: number } | null;

/** 在画布当前研究区域旁展开编辑文稿；选段后原位弹出讨论入口。 */
function PeekEditor({ documentId, store, onClose }: { documentId: string; store: Store | null; onClose: () => void }) {
  const session = useSession();
  const doc = useApp(state => state.summary?.documents.find(item => item.id === documentId));
  const [floating, setFloating] = useState<PeekFloating>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stdRef = useRef<BlockStdScope | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const updateFloating = useCallback(() => {
    const std = stdRef.current;
    const container = box.current;
    if (!std || !store || !container) return;
    const read = readSelection(std, store);
    if (!read || 'error' in read) { setFloating(null); return; }
    const domSelection = window.getSelection();
    let rect: DOMRect | null = null;
    if (domSelection && domSelection.rangeCount > 0 && !domSelection.isCollapsed) rect = domSelection.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) rect = std.view.getBlock(read.target.blockId)?.getBoundingClientRect() ?? null;
    if (!rect) { setFloating(null); return; }
    const bounds = container.getBoundingClientRect();
    setFloating({
      target: read.target,
      left: Math.min(Math.max(rect.left + rect.width / 2 - bounds.left, 160), bounds.width - 160),
      top: Math.max(rect.top - bounds.top - 46, 8),
    });
  }, [store]);

  const onReady = useCallback((_editor: unknown, std: BlockStdScope) => {
    stdRef.current = std;
    const subscription = std.selection.slots.changed.subscribe(() => requestAnimationFrame(updateFloating));
    const onSelection = () => requestAnimationFrame(updateFloating);
    document.addEventListener('selectionchange', onSelection);
    const container = box.current;
    container?.addEventListener('scroll', onSelection, { capture: true, passive: true });
    return () => {
      subscription.unsubscribe();
      document.removeEventListener('selectionchange', onSelection);
      container?.removeEventListener('scroll', onSelection, { capture: true });
    };
  }, [updateFloating]);

  const act = async (action: 'discuss' | 'fragment' | 'anchor') => {
    if (!floating) return;
    setBusy(true);
    try {
      if (action === 'discuss') {
        await discussInPlace(documentId, floating.target);
      } else {
        const anchor = await createAnchor(documentId, floating.target);
        if (anchor && action === 'fragment') {
          await placeFragment(anchor.id);
          toast(`已放置片段卡片（版本 ${anchor.version}）`, 'success');
        } else if (anchor) {
          toast(`已记录批注锚点（版本 ${anchor.version}）`, 'success');
          setTab('anchors');
        }
      }
      stdRef.current?.selection.clear(['text', 'block']);
      window.getSelection()?.removeAllRanges();
      setFloating(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="展开编辑文稿卡片" className="rc-pop-in absolute bottom-3 right-3 top-3 z-20 flex w-[min(560px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-popover">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        {doc && <KindIcon kind={doc.kind} className="text-ink-muted" />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{doc?.title || '未命名'}</span>
        <SaveIndicator status={session?.docStatus(documentId) ?? null} />
        <Button size="xs" variant="ghost" icon={<OpenInNewIcon width={14} height={14} />} onClick={() => openDocument(documentId)}>精读</Button>
        <Button size="icon-sm" variant="ghost" aria-label="关闭编辑浮层" icon={<CloseIcon width={16} height={16} />} onClick={onClose} />
      </div>
      <div ref={box} className="relative min-h-0 flex-1">
        {store ? <EditorHost store={store} mode="page" onReady={onReady} /> : <div className="flex h-full items-center justify-center"><QuietDotsWave label="载入文稿" /></div>}
        {floating && (
          <div
            role="toolbar"
            aria-label="画布选段操作"
            className="rc-pop-in absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-surface-popover p-1 shadow-popover"
            style={{ top: floating.top, left: floating.left }}
            onMouseDown={event => event.preventDefault()}
          >
            <Button size="sm" variant="ghost" disabled={busy} icon={<ChatWithAiIcon width={16} height={16} />} onClick={() => void act('discuss')}>原位讨论</Button>
            <Button size="sm" variant="ghost" disabled={busy} icon={<PlusIcon width={16} height={16} />} onClick={() => void act('fragment')}>放为片段卡片</Button>
            <Button size="sm" variant="ghost" disabled={busy} icon={<CommentIcon width={16} height={16} />} onClick={() => void act('anchor')}>记为批注</Button>
          </div>
        )}
      </div>
    </section>
  );
}
