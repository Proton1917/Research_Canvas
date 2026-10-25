import type { BlockStdScope } from '@blocksuite/affine/std';
import type { Store } from '@blocksuite/affine/store';
import {
  ChatWithAiIcon, CommentIcon, EdgelessIcon, EditIcon, FileIconPdfIcon, HistoryIcon,
} from '@blocksuite/icons/rc';
import { readSelection, rangeForProjection, scrollBlockIntoView, selectProjection, type SelectionTarget } from '@research-canvas/research/editor';
import { Button, QuietDotsWave } from '@research-canvas/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  addMaterialDocument, createAnchor, discussSelection, errorText, getSession, placeOnCanvas, refreshResolutions,
  setDialogs, setTab, toast, useApp,
} from '../app/model';
import { useSession } from '../app/useSession';
import { ConflictBar } from '../components/ConflictBar';
import { Chip, KindIcon, SaveIndicator } from '../components/common';
import { EditorHost } from '../components/EditorHost';
import { KIND_LABEL } from '../lib/format';

type Floating = { target: SelectionTarget; top: number; left: number; page: number | null } | null;

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };
const highlights = (): HighlightRegistry | null => (globalThis.CSS && 'highlights' in CSS ? (CSS as unknown as { highlights: HighlightRegistry }).highlights : null);
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

export function DocumentView({ documentId, focusAnchorId }: { documentId: string; focusAnchorId?: string | null }) {
  const session = useSession();
  const doc = useApp(state => state.summary?.documents.find(item => item.id === documentId));
  const anchors = useApp(state => state.summary?.anchors);
  const resolutions = useApp(state => state.resolutions);
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [floating, setFloating] = useState<Floating>(null);
  const [busy, setBusy] = useState(false);
  const stdRef = useRef<BlockStdScope | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStore(null);
    setError(null);
    setFloating(null);
    const s = getSession();
    const current = doc;
    if (!s || !current) return;
    s.ensureStore(current)
      .then(loaded => { if (!cancelled) setStore(loaded); })
      .catch(err => { if (!cancelled) setError(errorText(err)); });
    return () => { cancelled = true; };
    // 只在切换文稿或工作区时重新载入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, session]);

  const status = session?.docStatus(documentId) ?? null;
  const docAnchors = (anchors ?? []).filter(anchor => anchor.document_id === documentId);

  // 版本变化后刷新本文稿锚点的定位状态
  useEffect(() => {
    if (!status || status.state === 'dirty' || status.state === 'saving') return;
    void refreshResolutions(documentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, status?.version, docAnchors.length]);

  const paintHighlights = useCallback(() => {
    const registry = highlights();
    const std = stdRef.current;
    if (!registry || !HighlightCtor || !std || !store) return;
    const current: Range[] = [];
    const active: Range[] = [];
    for (const anchor of docAnchors) {
      const resolution = resolutions[anchor.id];
      if (!resolution || resolution.block_id == null || resolution.start_utf16 == null || resolution.end_utf16 == null) continue;
      if (resolution.status !== 'exact' && resolution.status !== 'relocated') continue;
      const range = rangeForProjection(std, store, resolution.block_id, resolution.start_utf16, resolution.end_utf16);
      if (!range) continue;
      (anchor.id === focusAnchorId ? active : current).push(range);
    }
    registry.set('rc-anchor', new HighlightCtor(...current));
    registry.set('rc-anchor-active', new HighlightCtor(...active));
  }, [docAnchors, resolutions, store, focusAnchorId]);

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(paintHighlights);
    return () => cancelAnimationFrame(frame);
  }, [paintHighlights, ready, status?.version]);

  useEffect(() => () => { highlights()?.delete('rc-anchor'); highlights()?.delete('rc-anchor-active'); }, []);

  // 从批注跳转：滚动并选中当前定位
  useEffect(() => {
    if (!ready || !focusAnchorId || !store) return;
    const resolution = resolutions[focusAnchorId];
    const std = stdRef.current;
    if (!std || !resolution) return;
    if (resolution.block_id && resolution.start_utf16 != null && resolution.end_utf16 != null && (resolution.status === 'exact' || resolution.status === 'relocated')) {
      scrollBlockIntoView(std, resolution.block_id);
      if (!store.readonly) selectProjection(std, store, resolution.block_id, resolution.start_utf16, resolution.end_utf16);
    } else {
      toast('该批注在当前版本中无法精确定位，可在批注面板查看原版本', 'info');
    }
  }, [focusAnchorId, ready, resolutions, store]);

  const updateFloating = useCallback(() => {
    const std = stdRef.current;
    const box = viewport.current;
    if (!std || !store || !box) return;
    const read = readSelection(std, store);
    if (!read || 'error' in read) { setFloating(null); return; }
    const domSelection = window.getSelection();
    let rect: DOMRect | null = null;
    if (domSelection && domSelection.rangeCount > 0 && !domSelection.isCollapsed) rect = domSelection.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) rect = std.view.getBlock(read.target.blockId)?.getBoundingClientRect() ?? null;
    if (!rect) { setFloating(null); return; }
    const bounds = box.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left + rect.width / 2 - bounds.left, 150), bounds.width - 150);
    const top = Math.max(rect.top - bounds.top - 46, 8);
    setFloating({ target: read.target, top, left, page: getSession()?.pageOf(documentId, read.target.blockId) ?? null });
  }, [store, documentId]);

  const onReady = useCallback((_editor: unknown, std: BlockStdScope) => {
    stdRef.current = std;
    setReady(value => value + 1);
    const subscription = std.selection.slots.changed.subscribe(() => requestAnimationFrame(updateFloating));
    const onSelection = () => requestAnimationFrame(updateFloating);
    document.addEventListener('selectionchange', onSelection);
    let paint: ReturnType<typeof setTimeout> | undefined;
    const repaint = store?.slots.blockUpdated.subscribe(() => {
      clearTimeout(paint);
      paint = setTimeout(() => setReady(value => value + 1), 250);
    });
    return () => {
      subscription.unsubscribe();
      repaint?.unsubscribe();
      document.removeEventListener('selectionchange', onSelection);
    };
  }, [updateFloating, store]);

  const act = async (action: 'discuss' | 'rewrite' | 'anchor') => {
    if (!floating) return;
    setBusy(true);
    try {
      if (action === 'anchor') {
        const anchor = await createAnchor(documentId, floating.target);
        if (anchor) { toast(`已记录批注锚点（版本 ${anchor.version}）`, 'success'); setTab('anchors'); }
      } else {
        await discussSelection(documentId, floating.target, action === 'rewrite' ? 'rewrite' : 'discussion');
      }
      setFloating(null);
    } finally {
      setBusy(false);
    }
  };

  if (!doc) return <div className="p-6 text-sm text-ink-muted">文稿不存在或已从工作区移除。</div>;
  const assetId = doc.metadata.source_asset_id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-line bg-surface-1 px-3 py-1.5">
        <KindIcon kind={doc.kind} className="text-ink-muted" />
        <h1 className="min-w-0 max-w-[22rem] truncate text-sm font-semibold text-ink" title={doc.title}>{doc.title || '未命名'}</h1>
        <Chip>{KIND_LABEL[doc.kind]}</Chip>
        <SaveIndicator status={status} />
        {docAnchors.length > 0 && <Chip tone="clay">{docAnchors.length} 处批注</Chip>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {doc.kind === 'pdf' && assetId && (
            <Button size="sm" variant="ghost" icon={<FileIconPdfIcon width={16} height={16} />} onClick={() => setDialogs({ pdf: { assetId, page: floating?.page ?? 1, title: doc.title } })}>原始 PDF</Button>
          )}
          <Button size="sm" variant="ghost" icon={<ChatWithAiIcon width={16} height={16} />} onClick={() => addMaterialDocument(doc.id)}>作为讨论材料</Button>
          <Button size="sm" variant="ghost" icon={<HistoryIcon width={16} height={16} />} onClick={() => setTab('versions')}>版本</Button>
          <Button size="sm" variant="secondary" icon={<EdgelessIcon width={16} height={16} />} onClick={() => void placeOnCanvas(doc.id)}>放到画布</Button>
        </div>
      </div>
      {status?.state === 'conflict' && <ConflictBar kind="document" id={documentId} />}
      {status?.state === 'error' && (
        <div className="flex items-center gap-2 border-b border-line bg-orange-500/10 px-3 py-1.5 text-xs text-[var(--rc-bad)]">
          保存失败：{status.error}。编辑内容仍保留在本页。
          <Button size="xs" variant="secondary" onClick={() => void getSession()?.saveDocument(documentId)}>重试保存</Button>
        </div>
      )}
      <div ref={viewport} className="relative min-h-0 flex-1 bg-surface-2">
        {error && <div className="p-6 text-sm text-[var(--rc-bad)]">文稿载入失败：{error}</div>}
        {!store && !error && <div className="flex h-full items-center justify-center"><QuietDotsWave label="载入文稿" /></div>}
        {store && <EditorHost store={store} mode="page" onReady={onReady} className="rc-document-editor" />}
        {floating && (
          <div
            role="toolbar"
            aria-label="选段操作"
            className="rc-pop-in absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-surface-popover p-1 shadow-popover"
            style={{ top: floating.top, left: floating.left }}
            onMouseDown={event => event.preventDefault()}
          >
            {floating.page != null && <Chip className="mx-1">第 {floating.page} 页</Chip>}
            <Button size="sm" variant="ghost" disabled={busy} icon={<ChatWithAiIcon width={16} height={16} />} onClick={() => void act('discuss')}>讨论选段</Button>
            <Button size="sm" variant="ghost" disabled={busy || doc.kind === 'pdf' || doc.kind === 'image'} title={doc.kind === 'pdf' ? '来源文件只读，不能改写' : undefined} icon={<EditIcon width={16} height={16} />} onClick={() => void act('rewrite')}>改写选段</Button>
            <Button size="sm" variant="ghost" disabled={busy} icon={<CommentIcon width={16} height={16} />} onClick={() => void act('anchor')}>记为批注</Button>
          </div>
        )}
      </div>
    </div>
  );
}
