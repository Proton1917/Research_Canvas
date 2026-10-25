import { ChatWithAiIcon, FileIconPdfIcon, HistoryIcon, LinkIcon } from '@blocksuite/icons/rc';
import type { Anchor } from '@research';
import { Button } from '@ui';
import { useMemo } from 'react';

import { addMaterialAnchor, openDocument, refreshResolutions, setDialogs, useApp } from '../app/model';
import { AnchorStatusChip, Chip, EmptyState, SectionTitle } from '../components/common';
import { ANCHOR_STATUS_HINT, excerpt, formatTime } from '../lib/format';

function AnchorItem({ anchor, showDocument }: { anchor: Anchor; showDocument: boolean }) {
  const resolution = useApp(state => state.resolutions[anchor.id]);
  const doc = useApp(state => state.summary?.documents.find(item => item.id === anchor.document_id));
  const contexts = useApp(state => state.contexts);
  const documents = useApp(state => state.summary?.documents);
  const focused = useApp(state => state.view.type === 'document' && state.view.focus?.anchorId === anchor.id);
  const discussions = useMemo(
    () => (documents ?? []).filter(item => item.kind === 'discussion' && item.metadata.context_id && contexts[item.metadata.context_id]?.anchor_ids.includes(anchor.id)),
    [documents, contexts, anchor.id]
  );
  const status = resolution?.status;
  const locatable = status === 'exact' || status === 'relocated';
  const assetId = doc?.metadata.source_asset_id;
  return (
    <li className={`rounded-xl border px-3 py-2.5 ${focused ? 'border-clay/60 bg-clay/5' : 'border-line bg-surface-2'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <AnchorStatusChip status={status} />
        <Chip>引用于版本 {anchor.version}</Chip>
        {resolution && resolution.current_version !== anchor.version && <Chip>当前版本 {resolution.current_version}</Chip>}
        {anchor.page != null && <Chip>第 {anchor.page} 页</Chip>}
        <span className="ml-auto text-[11px] text-ink-muted">{formatTime(anchor.created_at)}</span>
      </div>
      <blockquote className="mt-2 border-l-2 border-clay/50 pl-2.5 text-[13px] leading-relaxed text-ink">{excerpt(anchor.quote, 220)}</blockquote>
      {showDocument && doc && <p className="mt-1 truncate text-[11px] text-ink-muted">{doc.title}</p>}
      {status && !locatable && <p className="mt-1.5 text-[11px] text-[var(--rc-warn)]">{ANCHOR_STATUS_HINT[status]}，原引用保留在版本 {anchor.version}。</p>}
      {discussions.length > 0 && (
        <ul className="mt-2 space-y-1">
          {discussions.map(item => (
            <li key={item.id}>
              <button type="button" onClick={() => openDocument(item.id)} className="rc-focus-ring flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-ink-secondary hover:bg-[var(--cds-fill-ghost-hover)]">
                <ChatWithAiIcon width={14} height={14} className="shrink-0 text-clay" />
                <span className="truncate">{item.metadata.question ?? item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        <Button size="xs" variant={locatable ? 'secondary' : 'ghost'} disabled={!locatable} icon={<LinkIcon width={14} height={14} />} onClick={() => openDocument(anchor.document_id, { anchorId: anchor.id })}>定位原文</Button>
        <Button size="xs" variant={locatable ? 'ghost' : 'secondary'} icon={<HistoryIcon width={14} height={14} />} onClick={() => setDialogs({ version: { documentId: anchor.document_id, version: anchor.version, anchorId: anchor.id } })}>查看引用版本</Button>
        {anchor.page != null && assetId && (
          <Button size="xs" variant="ghost" icon={<FileIconPdfIcon width={14} height={14} />} onClick={() => setDialogs({ pdf: { assetId, page: anchor.page!, title: doc?.title ?? 'PDF' } })}>PDF 原页</Button>
        )}
        <Button size="xs" variant="ghost" icon={<ChatWithAiIcon width={14} height={14} />} onClick={() => addMaterialAnchor(anchor.id)}>加入讨论</Button>
      </div>
    </li>
  );
}

export function AnchorsPanel() {
  const view = useApp(state => state.view);
  const anchors = useApp(state => state.summary?.anchors ?? []);
  const documentId = view.type === 'document' ? view.id : null;
  const list = useMemo(() => {
    const filtered = documentId ? anchors.filter(anchor => anchor.document_id === documentId) : anchors;
    return [...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [anchors, documentId]);
  return (
    <div className="p-3">
      <SectionTitle action={<Button size="xs" variant="ghost" onClick={() => void refreshResolutions(documentId ?? undefined)}>重新定位</Button>}>
        {documentId ? '本文稿批注' : '全部批注'} · {list.length}
      </SectionTitle>
      {list.length === 0 ? (
        <EmptyState title="暂无批注">在文稿中选中文字后选择「记为批注」或「讨论选段」，锚点会记录所属版本和片段位置。</EmptyState>
      ) : (
        <ul className="space-y-2">{list.map(anchor => <AnchorItem key={anchor.id} anchor={anchor} showDocument={!documentId} />)}</ul>
      )}
    </div>
  );
}
