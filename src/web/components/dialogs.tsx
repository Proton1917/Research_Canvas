import { ArrowLeftSmallIcon, ArrowRightSmallIcon, CopyIcon, OpenInNewIcon, SearchIcon } from '@blocksuite/icons/rc';
import { api, type DocumentVersion, type ResearchContext, type SearchHit } from '@research';
import { Button, Dialog, QuietDotsWave, SkeletonShimmer } from '@ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  applyProposal, branchFrom, createWorkspace, errorText, loadContext, loadProposal, openDocument, openWorkspace,
  rejectProposal, renameWorkspace, restoreArchive, restoreVersion, revertProposal, setDialogs, toast, useApp,
} from '../app/model';
import { useSession } from '../app/useSession';
import { diffText } from '../lib/diff';
import { ANCHOR_STATUS_LABEL, excerpt, formatTime, formatUsage, KIND_LABEL, MODE_LABEL } from '../lib/format';
import { reasonLabel } from '../panels/VersionsPanel';
import { AnchorStatusChip, Chip, KindIcon } from './common';
import { Markdown } from './Markdown';

function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffText(before, after), [before, after]);
  return (
    <p className="rc-prose rounded-lg bg-surface-1 p-3 text-ink">
      {parts.map((part, index) => (
        <span key={index} className={part.type === 'del' ? 'rc-diff-del' : part.type === 'ins' ? 'rc-diff-ins' : undefined}>{part.text}</span>
      ))}
    </p>
  );
}

// ---------------------------------------------------------------- 上下文预览
function ContextBody({ context }: { context: ResearchContext }) {
  const [tab, setTab] = useState<'sources' | 'messages'>('sources');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Chip tone="clay">{MODE_LABEL[context.mode]}</Chip>
        <Chip>{context.sources.length} 项来源</Chip>
        <Chip>{context.messages.length} 条消息</Chip>
        <Chip>{context.character_count.toLocaleString()} 字符</Chip>
        <span className="text-ink-muted">生成于 {formatTime(context.created_at)}</span>
      </div>
      <p className="rounded-lg bg-[var(--cds-alpha-1)] px-3 py-2 text-[13px] text-ink"><span className="text-ink-muted">问题：</span>{context.question}</p>
      <div className="flex gap-1 border-b border-line" role="tablist">
        {(['sources', 'messages'] as const).map(id => (
          <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)} className={`rc-focus-ring -mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${tab === id ? 'border-clay text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
            {id === 'sources' ? '来源材料' : '完整消息'}
          </button>
        ))}
      </div>
      {tab === 'sources' ? (
        <ol className="space-y-2">
          {context.sources.length === 0 && <li className="text-xs text-ink-muted">本次请求没有附加来源材料，只发送问题。</li>}
          {context.sources.map(source => (
            <li key={source.number} className="rounded-xl border border-line bg-surface-1 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] font-semibold text-clay">[来源{source.number}]</span>
                <span className="min-w-0 truncate text-[13px] font-medium text-ink">{source.title}</span>
                <Chip>版本 {source.version}</Chip>
                {source.anchor_id ? <><Chip tone="clay">精确选段</Chip><AnchorStatusChip status={source.anchor_status} /></> : <Chip>整篇</Chip>}
              </div>
              <p className="rc-prose mt-2 max-h-48 overflow-auto rc-scroll text-[12.5px] text-ink-secondary">{source.content}</p>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="space-y-2">
          {context.messages.map((message, index) => (
            <li key={index} className="rounded-xl border border-line bg-surface-1 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold uppercase text-ink-muted">{message.role}</span>
                <Button size="xs" variant="ghost" icon={<CopyIcon width={14} height={14} />} onClick={() => { void navigator.clipboard.writeText(message.content); toast('已复制消息内容'); }}>复制</Button>
              </div>
              <p className="rc-prose text-[12.5px] text-ink">{message.content}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ContextDialog() {
  const contextId = useApp(state => state.dialogs.contextId);
  const context = useApp(state => (contextId ? state.contexts[contextId] : undefined));
  useEffect(() => { if (contextId && !context) void loadContext(contextId); }, [contextId, context]);
  return (
    <Dialog open={!!contextId} onClose={() => setDialogs({ contextId: null })} title="模型上下文" description="以下内容即实际发送给模型的消息；材料来自所选选段、文稿及参与上下文的连线祖先。" width="max-w-3xl"
      footer={<Button variant="secondary" size="sm" onClick={() => setDialogs({ contextId: null })}>关闭</Button>}>
      {context ? <ContextBody context={context} /> : <QuietDotsWave label="读取上下文" />}
    </Dialog>
  );
}

// ---------------------------------------------------------------- 讨论比较
function CompareColumn({ documentId }: { documentId: string }) {
  const doc = useApp(state => state.summary?.documents.find(item => item.id === documentId));
  const context = useApp(state => (doc?.metadata.context_id ? state.contexts[doc.metadata.context_id] : undefined));
  useEffect(() => { if (doc?.metadata.context_id && !context) void loadContext(doc.metadata.context_id); }, [doc, context]);
  if (!doc) return null;
  const body = doc.content.blocks.map(block => block.text).join('\n\n');
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="rounded-lg bg-[var(--cds-alpha-1)] px-3 py-2">
        <p className="text-[13px] font-medium text-ink">{doc.metadata.question ?? doc.title}</p>
        <p className="mt-1 flex flex-wrap gap-1 text-[11px] text-ink-muted">
          <span className="font-mono">{doc.metadata.model ?? ''}</span>
          <span>· {formatTime(doc.created_at)}</span>
          <span>· 版本 {doc.current_version}</span>
        </p>
        {doc.metadata.usage && <p className="mt-0.5 text-[11px] tabular-nums text-ink-muted">{formatUsage(doc.metadata.usage)}</p>}
      </div>
      <div className="rounded-lg border border-line p-2.5">
        <p className="mb-1 text-[11px] font-medium text-ink-muted">本次上下文</p>
        {context ? (
          <ol className="space-y-0.5 text-xs text-ink-secondary">
            {context.sources.map(source => (
              <li key={source.number} className="flex items-center gap-1">
                <span className="font-mono text-clay">[{source.number}]</span>
                <span className="truncate">{source.anchor_id ? `「${excerpt(source.content, 24)}」` : source.title}</span>
                <span className="shrink-0 text-ink-muted">v{source.version}</span>
                {source.anchor_status && <span className="shrink-0 text-ink-muted">{ANCHOR_STATUS_LABEL[source.anchor_status]}</span>}
              </li>
            ))}
          </ol>
        ) : <SkeletonShimmer height={36} />}
        {context && <Button size="xs" variant="ghost" className="mt-1" onClick={() => setDialogs({ contextId: context.id })}>完整上下文</Button>}
      </div>
      <div className="rc-prose max-h-[48vh] overflow-auto rc-scroll rounded-lg bg-surface-1 p-3 text-[13px] text-ink"><Markdown text={body} /></div>
      <Button size="xs" variant="ghost" icon={<OpenInNewIcon width={14} height={14} />} onClick={() => { setDialogs({ compare: null }); openDocument(doc.id); }}>打开此讨论</Button>
    </div>
  );
}

export function CompareDialog() {
  const pair = useApp(state => state.dialogs.compare);
  return (
    <Dialog open={!!pair} onClose={() => setDialogs({ compare: null })} title="比较两个讨论分支" description="分支各自独立保存；下方列出每次调用使用的上下文来源。" width="max-w-5xl"
      footer={<>
        <Button size="sm" variant="secondary" onClick={() => setDialogs({ compare: null })}>关闭</Button>
        {pair && <Button size="sm" variant="primary" onClick={() => { setDialogs({ compare: null }); branchFrom(pair); }}>合并为新讨论</Button>}
      </>}>
      {pair && <div className="grid gap-4 md:grid-cols-2"><CompareColumn documentId={pair[0]} /><CompareColumn documentId={pair[1]} /></div>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- 修改提案
export function ProposalDialog() {
  const proposalId = useApp(state => state.dialogs.proposalId);
  const proposal = useApp(state => (proposalId ? state.proposals[proposalId] : undefined));
  const anchor = useApp(state => state.summary?.anchors.find(item => item.id === proposal?.anchor_id));
  const doc = useApp(state => state.summary?.documents.find(item => item.id === anchor?.document_id));
  const resolution = useApp(state => (anchor ? state.resolutions[anchor.id] : undefined));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (proposalId && !proposal) void loadProposal(proposalId); }, [proposalId, proposal]);
  const block = doc?.content.blocks.find(item => item.id === (resolution?.block_id ?? anchor?.block_id));
  const close = () => setDialogs({ proposalId: null });
  const act = async (fn: (id: string) => Promise<void>) => {
    if (!proposalId) return;
    setBusy(true);
    await fn(proposalId);
    setBusy(false);
  };
  const statusText = proposal ? { pending: '待确认', applied: '已写入文稿', reverted: '已撤销', rejected: '已拒绝' }[proposal.status] : '';
  return (
    <Dialog open={!!proposalId} onClose={close} title="AI 修改预览" description="确认前原文保持不变；确认后生成新版本，可随时撤销。" width="max-w-2xl"
      footer={proposal && <>
        <Button size="sm" variant="ghost" onClick={close}>关闭</Button>
        {proposal.status === 'pending' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(rejectProposal)}>拒绝</Button>}
        {proposal.status === 'pending' && <Button size="sm" variant="primary" isLoading={busy} onClick={() => void act(applyProposal)}>确认修改</Button>}
        {proposal.status === 'applied' && <Button size="sm" variant="secondary" isLoading={busy} onClick={() => void act(revertProposal)}>撤销修改</Button>}
      </>}>
      {!proposal || !anchor ? <QuietDotsWave label="读取修改" /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Chip tone={proposal.status === 'applied' ? 'ok' : proposal.status === 'pending' ? 'clay' : 'muted'}>{statusText}</Chip>
            {doc && <span className="text-ink-secondary">{doc.title}</span>}
            <Chip>选段来自版本 {anchor.version}</Chip>
            {proposal.applied_version != null && <Chip>写入版本 {proposal.applied_version}</Chip>}
            <AnchorStatusChip status={resolution?.status} />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium text-ink-muted">选段差异</p>
            <DiffView before={anchor.quote} after={proposal.replacement} />
          </div>
          {block && proposal.status === 'pending' && resolution?.start_utf16 != null && resolution.end_utf16 != null && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-ink-muted">所在段落修改后</p>
              <DiffView before={block.text} after={block.text.slice(0, resolution.start_utf16) + proposal.replacement + block.text.slice(resolution.end_utf16)} />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- 历史版本
export function VersionDialog() {
  const target = useApp(state => state.dialogs.version);
  const doc = useApp(state => state.summary?.documents.find(item => item.id === target?.documentId));
  const anchor = useApp(state => state.summary?.anchors.find(item => item.id === target?.anchorId));
  const session = useSession();
  const [version, setVersion] = useState<DocumentVersion | null>(null);
  const [current, setCurrent] = useState<DocumentVersion | null>(null);
  const [compare, setCompare] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highlight = useRef<HTMLElement>(null);
  const currentVersion = target ? (session?.docStatus(target.documentId)?.version ?? doc?.current_version) : undefined;

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setVersion(null); setCurrent(null); setError(null); setCompare(false);
    Promise.all([api.getVersion(target.documentId, target.version), currentVersion ? api.getVersion(target.documentId, currentVersion) : Promise.resolve(null)])
      .then(([v, c]) => { if (!cancelled) { setVersion(v); setCurrent(c); } })
      .catch(err => { if (!cancelled) setError(errorText(err)); });
    return () => { cancelled = true; };
  }, [target, currentVersion]);

  useEffect(() => { highlight.current?.scrollIntoView({ block: 'center' }); }, [version]);

  const close = () => setDialogs({ version: null });
  return (
    <Dialog open={!!target} onClose={close} title={`${doc?.title ?? '文稿'} · 版本 ${target?.version ?? ''}`} width="max-w-3xl"
      description={version ? `${reasonLabel(version.reason)} · ${formatTime(version.created_at)}${currentVersion ? ` · 当前版本 ${currentVersion}` : ''}` : undefined}
      footer={<>
        {current && version && current.version !== version.version && <Button size="sm" variant="ghost" onClick={() => setCompare(value => !value)}>{compare ? '查看原文' : '与当前版本对比'}</Button>}
        {target && doc && version && currentVersion !== version.version && doc.kind !== 'pdf' && doc.kind !== 'image' && (
          <Button size="sm" variant="secondary" onClick={() => { close(); void restoreVersion(target.documentId, version.version); }}>恢复为新版本</Button>
        )}
        <Button size="sm" variant="primary" onClick={close}>关闭</Button>
      </>}>
      {error && <p className="text-sm text-[var(--rc-bad)]">{error}</p>}
      {!version && !error && <QuietDotsWave label="读取历史版本" />}
      {version && !compare && (
        <div className="space-y-2">
          {anchor && <p className="rounded-lg bg-clay/8 px-3 py-2 text-xs text-ink">引用片段：「{excerpt(anchor.quote, 160)}」{anchor.page != null ? ` · 第 ${anchor.page} 页` : ''}</p>}
          {version.content.blocks.map(block => {
            const isAnchor = anchor && block.id === anchor.block_id;
            const start = isAnchor ? anchor.start_utf16 : -1;
            const end = isAnchor ? anchor.start_utf16 + anchor.quote.length : -1;
            return (
              <div key={block.id} className="rc-prose text-[13px] text-ink">
                {block.page != null && <span className="mr-2 text-[11px] text-ink-muted">第 {block.page} 页</span>}
                {isAnchor ? (
                  <>
                    {block.text.slice(0, start)}
                    <mark ref={highlight} className="rounded bg-[var(--rc-anchor-active)] px-0.5 text-ink">{block.text.slice(start, end)}</mark>
                    {block.text.slice(end)}
                  </>
                ) : (block.text || <span className="text-ink-muted">（空段落）</span>)}
              </div>
            );
          })}
        </div>
      )}
      {version && compare && current && (
        <DiffView before={version.content.blocks.map(block => block.text).join('\n\n')} after={current.content.blocks.map(block => block.text).join('\n\n')} />
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- 检索
export function SearchDialog() {
  const open = useApp(state => !!state.dialogs.search);
  const workspaceId = useApp(state => state.workspaceId);
  const documents = useApp(state => state.summary?.documents ?? []);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const composing = useRef(false);

  useEffect(() => { if (open) { setQuery(''); setHits(null); setActive(0); setError(null); } }, [open]);
  useEffect(() => {
    if (!open || !workspaceId || !query.trim() || composing.current) { if (!query.trim()) setHits(null); return; }
    const timer = setTimeout(() => {
      api.search(workspaceId, query.trim(), 20)
        .then(result => { setHits(result); setActive(0); setError(null); })
        .catch(err => setError(errorText(err)));
    }, 220);
    return () => clearTimeout(timer);
  }, [query, open, workspaceId]);

  const choose = (hit: SearchHit) => { setDialogs({ search: false }); openDocument(hit.document_id); };
  return (
    <Dialog open={open} onClose={() => setDialogs({ search: false })} title="检索工作区" width="max-w-xl">
      <div className="space-y-2">
        <div className="relative">
          <SearchIcon width={16} height={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            autoFocus
            aria-label="检索词"
            className="rc-input pl-8"
            placeholder="检索标题与正文"
            value={query}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={event => { composing.current = false; setQuery((event.target as HTMLInputElement).value); }}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive(value => Math.min(value + 1, (hits?.length ?? 1) - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(value - 1, 0)); }
              if (event.key === 'Enter' && hits?.[active]) choose(hits[active]);
            }}
          />
        </div>
        {error && <p className="text-xs text-[var(--rc-bad)]">{error}</p>}
        {hits && hits.length === 0 && <p className="px-1 py-4 text-center text-xs text-ink-muted">没有匹配的文稿</p>}
        <ul role="listbox" className="max-h-[50vh] space-y-0.5 overflow-auto rc-scroll">
          {hits?.map((hit, index) => {
            const doc = documents.find(item => item.id === hit.document_id);
            return (
              <li key={hit.document_id} role="option" aria-selected={index === active}>
                <button type="button" onMouseEnter={() => setActive(index)} onClick={() => choose(hit)} className={`rc-focus-ring w-full rounded-lg px-2.5 py-2 text-left ${index === active ? 'bg-[var(--cds-fill-ghost-selected)]' : ''}`}>
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    {doc && <KindIcon kind={doc.kind} className="text-ink-muted" />}
                    <span className="truncate">{hit.title}</span>
                    <span className="ml-auto shrink-0 text-[11px] font-normal text-ink-muted">{doc ? KIND_LABEL[doc.kind] : ''} · v{hit.version}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-secondary">{hit.excerpt}</p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- PDF 原页
export function PdfDialog() {
  const target = useApp(state => state.dialogs.pdf);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const docRef = useRef<{ numPages: number; getPage(n: number): Promise<unknown>; destroy(): Promise<void> } | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setPage(target.page);
    setError(null);
    setLoading(true);
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const data = await (await api.fetchAsset(target.assetId)).arrayBuffer();
      const loaded = await pdfjs.getDocument({ data }).promise;
      if (cancelled) { void loaded.destroy(); return; }
      docRef.current = loaded as unknown as typeof docRef.current;
      setPages(loaded.numPages);
    })().catch(err => !cancelled && setError(errorText(err))).finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      void docRef.current?.destroy();
      docRef.current = null;
      setPages(0);
    };
  }, [target]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || !pages) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    (async () => {
      const pdfPage = (await doc.getPage(Math.min(Math.max(page, 1), pages))) as {
        getViewport(options: { scale: number }): { width: number; height: number };
        render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { cancel(): void; promise: Promise<void> };
      };
      if (cancelled) return;
      const ratio = window.devicePixelRatio || 1;
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(1.6, 820 / base.width);
      const viewport = pdfPage.getViewport({ scale: scale * ratio });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / ratio}px`;
      canvas.style.height = `${viewport.height / ratio}px`;
      task = pdfPage.render({ canvasContext: canvas.getContext('2d')!, viewport });
      await task.promise;
    })().catch(err => { if (!cancelled && !String(err).includes('Rendering cancelled')) setError(errorText(err)); });
    return () => { cancelled = true; task?.cancel(); };
  }, [page, pages]);

  return (
    <Dialog open={!!target} onClose={() => setDialogs({ pdf: null })} title={`${target?.title ?? 'PDF'} · 第 ${page} 页`} width="max-w-4xl"
      footer={<>
        <Button size="sm" variant="ghost" icon={<ArrowLeftSmallIcon width={16} height={16} />} disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
        <span className="text-xs tabular-nums text-ink-muted">{page} / {pages || '…'}</span>
        <Button size="sm" variant="ghost" icon={<ArrowRightSmallIcon width={16} height={16} />} iconPosition="right" disabled={!pages || page >= pages} onClick={() => setPage(value => value + 1)}>下一页</Button>
        <Button size="sm" variant="primary" onClick={() => setDialogs({ pdf: null })}>关闭</Button>
      </>}>
      {error && <p className="text-sm text-[var(--rc-bad)]">PDF 渲染失败：{error}</p>}
      {loading && <QuietDotsWave label="载入 PDF" />}
      <div className="flex justify-center overflow-auto rounded-lg bg-surface-1 p-2"><canvas ref={canvasRef} className="max-w-full bg-white shadow-panel" aria-label={`PDF 第 ${page} 页`} /></div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 工作区
export function WorkspaceDialog() {
  const open = useApp(state => !!state.dialogs.workspace);
  const workspaces = useApp(state => state.workspaces);
  const currentId = useApp(state => state.workspaceId);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const archive = useRef<HTMLInputElement>(null);
  const close = () => setDialogs({ workspace: false });
  return (
    <Dialog open={open} onClose={close} title="工作区" description="每个工作区拥有独立的文稿、画布、关系与讨论历史。" width="max-w-lg"
      footer={<>
        <Button size="sm" variant="ghost" onClick={() => archive.current?.click()}>从 JSON 归档恢复</Button>
        <input ref={archive} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) { close(); void restoreArchive(file); } }} />
        <Button size="sm" variant="primary" onClick={close}>完成</Button>
      </>}>
      <ul className="space-y-1">
        {workspaces.map(workspace => (
          <li key={workspace.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${workspace.id === currentId ? 'bg-clay/8' : 'hover:bg-[var(--cds-fill-ghost-hover)]'}`}>
            {editing?.id === workspace.id ? (
              <input autoFocus aria-label="工作区名称" className="rc-input flex-1 py-1 text-[13px]" value={editing.name}
                onChange={event => setEditing({ ...editing, name: event.target.value })}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter' && editing.name.trim()) { void renameWorkspace(workspace.id, editing.name.trim()).catch(err => toast(errorText(err), 'error')); setEditing(null); }
                  if (event.key === 'Escape') { event.stopPropagation(); setEditing(null); }
                }} />
            ) : (
              <button type="button" className="rc-focus-ring min-w-0 flex-1 truncate rounded text-left text-[13px] text-ink" onClick={() => { close(); if (workspace.id !== currentId) void openWorkspace(workspace.id); }}>
                {workspace.name}
              </button>
            )}
            <span className="shrink-0 text-[11px] text-ink-muted">{formatTime(workspace.updated_at)}</span>
            <Button size="xs" variant="ghost" onClick={() => setEditing({ id: workspace.id, name: workspace.name })}>重命名</Button>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); if (name.trim()) { close(); void createWorkspace(name.trim()).catch(err => toast(errorText(err), 'error')); setName(''); } }}>
        <input aria-label="新工作区名称" className="rc-input flex-1" placeholder="新工作区名称" value={name} onChange={event => setName(event.target.value)} />
        <Button type="submit" size="md" variant="secondary" disabled={!name.trim()}>新建</Button>
      </form>
    </Dialog>
  );
}

export function Dialogs() {
  useApp(state => state.dialogs);
  return (
    <>
      <ContextDialog />
      <CompareDialog />
      <ProposalDialog />
      <VersionDialog />
      <SearchDialog />
      <PdfDialog />
      <WorkspaceDialog />
    </>
  );
}

