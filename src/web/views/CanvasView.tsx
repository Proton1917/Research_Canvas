import { GfxControllerIdentifier } from '@editor/runtime/gfx';
import type { BlockStdScope } from '@editor/runtime';
import type { Store } from '@editor/document';
import { ChatWithAiIcon, CloseIcon, EditIcon, ExpandFullIcon, ImportIcon, LinkIcon, NoteShadowDuotoneIcon, OpenInNewIcon, PlusIcon } from '@blocksuite/icons/rc';
import { Button, QuietDotsWave } from '@ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  addMaterialDocument, app, createDocument, createRelation, documentMap, errorText, getSession, importFiles, openDocument,
  registerCanvasPlacer, renameCanvas, setCanvasSelection, useApp,
} from '../app/model';
import { useSession } from '../app/useSession';
import { KindIcon, MenuItem, Popover, SaveIndicator } from '../components/common';
import { EditorHost } from '../components/EditorHost';
import { ConflictBar } from '../components/ConflictBar';
import { KIND_LABEL } from '../lib/format';

const CARD_SIZE = { width: 560, height: 420 };
const SYNCED = 'affine:embed-synced-doc';
export const DOC_DRAG_TYPE = 'application/x-research-canvas-document';

type Gfx = {
  viewport: { centerX: number; centerY: number; toModelCoordFromClientCoord(point: [number, number]): [number, number] };
  selection: { selectedIds: string[]; slots: { updated: { subscribe(fn: () => void): { unsubscribe(): void } } }; set(selection: { elements: string[]; editing: boolean }): void };
  fitToScreen(options?: { smooth?: boolean; padding?: [number, number, number, number] }): void;
};

/** 从起点开始按环形网格寻找不与现有卡片重叠的位置。 */
function freeSlot(store: Store, [x0, y0]: [number, number]): [number, number] {
  const gap = 48;
  const rects = store.getModelsByFlavour(SYNCED).map(model => JSON.parse((model.props as unknown as { xywh: string }).xywh) as number[]);
  const free = (x: number, y: number) => rects.every(([rx, ry, rw, rh]) => x + CARD_SIZE.width + gap <= rx || rx + rw + gap <= x || y + CARD_SIZE.height + gap <= ry || ry + rh + gap <= y);
  const stepX = CARD_SIZE.width + gap;
  const stepY = CARD_SIZE.height + gap;
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
  const selection = useApp(state => state.canvasSelection);
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [name, setName] = useState(canvas?.name ?? '');
  const gfxRef = useRef<Gfx | null>(null);
  const stdRef = useRef<BlockStdScope | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekStore, setPeekStore] = useState<Store | null>(null);
  const pendingPeek = useApp(state => state.peekRequest);

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
  }, [canvasId, session]);

  const cardDocument = useCallback((blockId: string) => {
    const model = store?.getModelById(blockId);
    return model?.flavour === SYNCED ? (model.props as unknown as { pageId: string }).pageId : null;
  }, [store]);

  const placeDocument = useCallback(async (documentId: string, near?: string | null, point?: [number, number]) => {
    const s = getSession();
    const gfx = gfxRef.current;
    const doc = documentMap().get(documentId);
    if (!s || !doc || !store) return;
    let x: number;
    let y: number;
    const nearCard = near ? store.getModelsByFlavour(SYNCED).find(model => (model.props as unknown as { pageId: string }).pageId === near) : undefined;
    if (point) {
      [x, y] = point;
    } else if (nearCard) {
      const [nx, ny, nw] = JSON.parse((nearCard.props as unknown as { xywh: string }).xywh) as number[];
      const siblings = store.getModelsByFlavour(SYNCED).filter(model => {
        const [mx] = JSON.parse((model.props as unknown as { xywh: string }).xywh) as number[];
        return mx >= nx + nw + 40;
      }).length;
      x = nx + nw + 120;
      y = ny + siblings * 60;
    } else {
      [x, y] = freeSlot(store, gfx ? [gfx.viewport.centerX - CARD_SIZE.width / 2, gfx.viewport.centerY - CARD_SIZE.height / 2] : [0, 0]);
    }
    const id = await s.addDocumentToCanvas(canvasId, doc, { x, y }, CARD_SIZE);
    gfx?.selection.set({ elements: [id], editing: false });
  }, [canvasId, store]);

  useEffect(() => {
    if (!store) return;
    registerCanvasPlacer((documentId, near) => placeDocument(documentId, near));
    return () => registerCanvasPlacer(null);
  }, [store, placeDocument]);

  const onReady = useCallback((_editor: unknown, std: BlockStdScope) => {
    stdRef.current = std;
    const gfx = std.get(GfxControllerIdentifier) as unknown as Gfx;
    gfxRef.current = gfx;
    const update = () => {
      const ids = gfx.selection.selectedIds;
      const s = getSession();
      const cards = ids.filter(id => cardDocument(id));
      setSelectedCards(cards);
      if (ids.length === 1) {
        const documentId = cardDocument(ids[0]);
        if (documentId) { setCanvasSelection({ kind: 'card', documentId, blockId: ids[0] }); return; }
        const relationId = s?.relationForConnector(canvasId, ids[0]);
        if (relationId) { setCanvasSelection({ kind: 'relation', relationId }); return; }
      }
      setCanvasSelection(null);
    };
    const subscription = gfx.selection.slots.updated.subscribe(update);
    const s = getSession();
    if (s && s.canvasObjects(canvasId).length > 0) {
      requestAnimationFrame(() => gfx.fitToScreen({ padding: [80, 80, 80, 80] }));
    }
    return () => subscription.unsubscribe();
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
    // 画布中的文稿卡片为只读渲染；双击卡片在编辑浮层中编辑同一份文稿。
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
  const selectedDoc = selection?.kind === 'card' ? documents.find(doc => doc.id === selection.documentId) : undefined;
  const pairDocs = selectedCards.length === 2 ? selectedCards.map(id => cardDocument(id)).filter((id): id is string => !!id) : [];

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
          {selectedDoc && (
            <>
              <Button size="sm" variant="ghost" icon={<EditIcon width={16} height={16} />} onClick={() => setPeekId(selectedDoc.id)}>编辑内容</Button>
              <Button size="sm" variant="ghost" icon={<OpenInNewIcon width={16} height={16} />} onClick={() => openDocument(selectedDoc.id)}>打开精读</Button>
              <Button size="sm" variant="ghost" icon={<ChatWithAiIcon width={16} height={16} />} onClick={() => addMaterialDocument(selectedDoc.id)}>作为讨论材料</Button>
            </>
          )}
          {pairDocs.length === 2 && pairDocs[0] !== pairDocs[1] && (
            <Button size="sm" variant="secondary" icon={<LinkIcon width={16} height={16} />} onClick={() => void createRelation(pairDocs[0], pairDocs[1])}>建立关系</Button>
          )}
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
      {status?.state === 'conflict' && <ConflictBar kind="canvas" id={canvasId} />}
      {status?.state === 'error' && (
        <div className="flex items-center gap-2 border-b border-line bg-orange-500/10 px-3 py-1.5 text-xs text-[var(--rc-bad)]">
          画布布局保存失败：{status.error}
          <Button size="xs" variant="secondary" onClick={() => void getSession()?.saveCanvas(canvasId)}>重试</Button>
        </div>
      )}
      <div ref={surface} className="relative min-h-0 flex-1" data-testid="canvas-surface">
        {error && <div className="p-6 text-sm text-[var(--rc-bad)]">画布载入失败：{error}</div>}
        {!store && !error && <div className="flex h-full items-center justify-center"><QuietDotsWave label="载入画布" /></div>}
        {store && <EditorHost store={store} mode="edgeless" onReady={onReady} />}
        {peekId && (
          <PeekEditor documentId={peekId} store={peekStore} onClose={() => setPeekId(null)} />
        )}
        {store && onCanvas.size === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
            <div className="pointer-events-auto rounded-xl border border-line bg-surface-2/95 px-4 py-3 text-center text-xs text-ink-secondary shadow-panel">
              从左侧拖入文稿，或使用「放入文稿」「新建想法」「导入」开始组织研究
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PeekEditor({ documentId, store, onClose }: { documentId: string; store: Store | null; onClose: () => void }) {
  const session = useSession();
  const doc = useApp(state => state.summary?.documents.find(item => item.id === documentId));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <section aria-label="编辑文稿卡片" className="rc-pop-in absolute bottom-3 right-3 top-3 z-20 flex w-[min(560px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-popover">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        {doc && <KindIcon kind={doc.kind} className="text-ink-muted" />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{doc?.title || '未命名'}</span>
        <SaveIndicator status={session?.docStatus(documentId) ?? null} />
        <Button size="xs" variant="ghost" icon={<OpenInNewIcon width={14} height={14} />} onClick={() => openDocument(documentId)}>精读</Button>
        <Button size="icon-sm" variant="ghost" aria-label="关闭编辑浮层" icon={<CloseIcon width={16} height={16} />} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1">
        {store ? <EditorHost store={store} mode="page" /> : <div className="flex h-full items-center justify-center"><QuietDotsWave label="载入文稿" /></div>}
      </div>
    </section>
  );
}
