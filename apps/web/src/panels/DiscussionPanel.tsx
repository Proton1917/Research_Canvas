import { CloseIcon, EdgelessIcon, GroupingIcon, OpenInNewIcon, SendIcon, StopIcon, ViewIcon } from '@blocksuite/icons/rc';
import type { ResearchDocument, ResearchMode, Run } from '@research-canvas/research';
import { Button, QuietDotsWave, SegmentedControl, StreamingCursor, useScrollPinning } from '@research-canvas/ui';
import { useEffect, useMemo, useRef } from 'react';

import {
  app, branchFrom, cancelRun, openDocument, placeOnCanvas, previewContext, registerComposerFocus, removeMaterial,
  sendComposer, setDialogs, setModel, togglePicked, updateComposer, useApp,
} from '../app/model';
import { AnchorStatusChip, Chip, EmptyState, KindIcon, SectionTitle } from '../components/common';
import { excerpt, formatTime, formatUsage, MODE_LABEL, RUN_STATUS_LABEL } from '../lib/format';

const MODES: { id: ResearchMode; label: string }[] = [
  { id: 'discussion', label: MODE_LABEL.discussion },
  { id: 'rewrite', label: MODE_LABEL.rewrite },
  { id: 'relation', label: MODE_LABEL.relation },
];

const PLACEHOLDER: Record<ResearchMode, string> = {
  discussion: '提出要讨论的问题，例如：这个推论依赖哪些假设？',
  rewrite: '说明改写要求，例如：把这段论证改写得更严谨，保留公式',
  relation: '说明要分析的关系，例如：这两个概念的对应是否成立？',
};

function Composer() {
  const composer = useApp(state => state.composer);
  const summary = useApp(state => state.summary);
  const resolutions = useApp(state => state.resolutions);
  const catalog = useApp(state => state.catalog);
  const catalogError = useApp(state => state.catalogError);
  const model = useApp(state => state.model);
  const health = useApp(state => state.health);
  const connection = useApp(state => state.connection);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    registerComposerFocus(() => textarea.current?.focus());
    return () => registerComposerFocus(null);
  }, []);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [composer.question]);

  const anchors = (summary?.anchors ?? []).filter(anchor => composer.anchorIds.includes(anchor.id));
  const docs = (summary?.documents ?? []).filter(doc => composer.documentIds.includes(doc.id));
  const titleOf = (id: string) => summary?.documents.find(doc => doc.id === id)?.title ?? '文稿';
  const canSend = connection === 'online' && !!composer.question.trim() && composer.busy === null && health?.provider_configured !== false;
  const stale = !!composer.preview && composer.previewKey !== JSON.stringify([composer.mode, composer.question.trim(), [...composer.documentIds].sort(), [...composer.anchorIds].sort()]);

  return (
    <div className="space-y-2.5 rounded-2xl border border-line bg-surface-3 p-3 shadow-composer focus-within:shadow-composer-focus">
      <SegmentedControl ariaLabel="讨论模式" size="sm" items={MODES} value={composer.mode} onChange={mode => updateComposer({ mode })} />
      <div className="flex flex-wrap gap-1.5" aria-label="上下文材料">
        {anchors.map(anchor => (
          <span key={anchor.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-clay/10 py-1 pl-2 pr-1 text-xs text-ink">
            <span className="font-medium text-clay">选段</span>
            <span className="min-w-0 truncate" title={anchor.quote}>「{excerpt(anchor.quote, 28)}」</span>
            <span className="shrink-0 text-ink-muted">{titleOf(anchor.document_id)} · v{anchor.version}</span>
            <AnchorStatusChip status={resolutions[anchor.id]?.status} />
            <button type="button" aria-label="移除该选段" className="rc-focus-ring rounded p-0.5 text-ink-muted hover:text-ink" onClick={() => removeMaterial('anchor', anchor.id)}><CloseIcon width={14} height={14} /></button>
          </span>
        ))}
        {docs.map(doc => (
          <span key={doc.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-[var(--cds-alpha-1)] py-1 pl-2 pr-1 text-xs text-ink">
            <KindIcon kind={doc.kind} className="text-ink-muted" />
            <span className="min-w-0 truncate">{doc.title || '未命名'}</span>
            <button type="button" aria-label="移除该文稿" className="rc-focus-ring rounded p-0.5 text-ink-muted hover:text-ink" onClick={() => removeMaterial('document', doc.id)}><CloseIcon width={14} height={14} /></button>
          </span>
        ))}
        {anchors.length === 0 && docs.length === 0 && (
          <span className="text-xs text-ink-muted">在文稿中选中段落或公式后选择「讨论选段」，或在画布卡片上选择「作为讨论材料」。没有材料时只发送问题。</span>
        )}
      </div>
      <textarea
        ref={textarea}
        rows={2}
        value={composer.question}
        placeholder={PLACEHOLDER[composer.mode]}
        aria-label="问题"
        className="rc-scroll block max-h-[220px] w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-muted"
        onChange={event => updateComposer({ question: event.target.value })}
        onKeyDown={event => {
          // 输入法合成期间的回车用于选词，不发送
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (canSend) void sendComposer();
          }
        }}
      />
      {composer.error && <p role="alert" className="text-xs text-[var(--rc-bad)]">{composer.error}</p>}
      {health && !health.provider_configured && <p className="text-xs text-[var(--rc-warn)]">后端未配置模型凭据，可预览上下文，暂不能生成。</p>}
      <div className="flex items-center gap-1.5">
        <select
          aria-label="模型"
          className="rc-input h-7 min-w-0 flex-1 py-0 text-xs"
          value={model}
          onChange={event => setModel(event.target.value)}
          disabled={!catalog}
          title={catalogError ?? undefined}
        >
          {!catalog && <option value="">{catalogError ? '模型目录读取失败' : '读取模型目录…'}</option>}
          {catalog?.models.map(entry => (
            <option key={entry.id} value={entry.id}>{entry.name ?? entry.id}{entry.id === catalog.default_model ? '（默认）' : ''}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          icon={<ViewIcon width={16} height={16} />}
          isLoading={composer.busy === 'preview'}
          disabled={!composer.question.trim() || composer.busy !== null || connection !== 'online'}
          onClick={() => void previewContext(true)}
          title="生成并查看将发送给模型的完整上下文"
        >
          {composer.preview && !stale ? '查看上下文' : '预览上下文'}
        </Button>
        <Button size="sm" variant="primary" icon={<SendIcon width={16} height={16} />} isLoading={composer.busy === 'send'} disabled={!canSend} onClick={() => void sendComposer()} aria-label="发送">
          发送
        </Button>
      </div>
      {composer.preview && !stale && (
        <p className="text-[11px] text-ink-muted tabular-nums">已生成上下文：{composer.preview.sources.length} 项来源 · {composer.preview.character_count.toLocaleString()} 字符；发送时使用此上下文。</p>
      )}
    </div>
  );
}

export function RunOutput({ run, compact = false }: { run: Run; compact?: boolean }) {
  const doc = useApp(state => state.summary?.documents.find(item => item.id === run.document_id));
  const proposal = useApp(state => (run.proposal_id ? state.proposals[run.proposal_id] : undefined));
  const live = run.status === 'queued' || run.status === 'running';
  const { containerRef, handleScroll, markUserInput, showJumpControl, scrollToBottom } = useScrollPinning([run.answer]);
  const tone = run.status === 'succeeded' ? 'ok' : run.status === 'failed' || run.status === 'interrupted' ? 'bad' : run.status === 'cancelled' ? 'warn' : 'clay';
  return (
    <div className="rc-pop-in overflow-hidden rounded-xl border border-line bg-surface-2">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        <Chip tone={tone}>{RUN_STATUS_LABEL[run.status]}</Chip>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-muted" title={run.model_used ?? run.model}>{run.model_used ?? run.model}</span>
        <Button size="xs" variant="ghost" onClick={() => setDialogs({ contextId: run.context_id })}>本次上下文</Button>
        {live && <Button size="xs" variant="secondary" icon={<StopIcon width={14} height={14} />} onClick={() => void cancelRun(run.id)}>停止</Button>}
      </div>
      <div className="relative">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onWheel={markUserInput}
          onTouchMove={markUserInput}
          onKeyDown={markUserInput}
          tabIndex={0}
          aria-live="polite"
          className={`rc-scroll rc-prose overflow-auto px-3 py-2.5 text-ink outline-none ${compact ? 'max-h-48' : 'max-h-[46vh]'}`}
        >
          {run.answer || (live ? <QuietDotsWave label={run.status === 'queued' ? '等待模型服务' : '正在生成'} /> : <span className="text-ink-muted">没有正文输出</span>)}
          {live && run.answer && <StreamingCursor />}
        </div>
        {showJumpControl && (
          <button type="button" onClick={() => scrollToBottom(true)} className="rc-focus-ring absolute bottom-2 right-3 rounded-full border border-line bg-surface-popover px-2.5 py-1 text-[11px] text-ink shadow-popover">跳到最新</button>
        )}
      </div>
      {(run.error || run.usage) && (
        <div className="space-y-1 border-t border-line px-3 py-2 text-[11px]">
          {run.error && <p className="text-[var(--rc-bad)]">{run.error}</p>}
          {run.usage && <p className="tabular-nums text-ink-muted">{formatUsage(run.usage)}</p>}
        </div>
      )}
      {run.status === 'succeeded' && (doc || run.proposal_id) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          {doc && (
            <>
              <Button size="xs" variant="primary" icon={<EdgelessIcon width={14} height={14} />} onClick={() => void placeOnCanvas(doc.id, firstSource(doc))}>加入画布</Button>
              <Button size="xs" variant="secondary" onClick={() => branchFrom([doc.id])}>继续讨论</Button>
              <Button size="xs" variant="ghost" icon={<OpenInNewIcon width={14} height={14} />} onClick={() => openDocument(doc.id)}>打开</Button>
            </>
          )}
          {run.proposal_id && (
            <Button size="xs" variant="primary" onClick={() => setDialogs({ proposalId: run.proposal_id })}>
              {proposal?.status === 'applied' ? '查看已写入修改' : proposal?.status === 'reverted' ? '查看已撤销修改' : proposal?.status === 'rejected' ? '查看已拒绝修改' : '查看修改差异'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function firstSource(doc: ResearchDocument) {
  const relations = app.get().summary?.relations ?? [];
  return relations.find(relation => relation.target_id === doc.id && relation.kind === 'context')?.source_id ?? null;
}

type TreeNode = { doc: ResearchDocument; children: TreeNode[]; parents: string[] };

function useDiscussionTree() {
  const summary = useApp(state => state.summary);
  return useMemo(() => {
    const docs = (summary?.documents ?? []).filter(doc => doc.kind === 'discussion');
    const byId = new Map(docs.map(doc => [doc.id, { doc, children: [] as TreeNode[], parents: [] as string[] }]));
    const contextRelations = (summary?.relations ?? []).filter(relation => relation.kind === 'context' && byId.has(relation.target_id));
    for (const relation of contextRelations) byId.get(relation.target_id)!.parents.push(relation.source_id);
    const roots: TreeNode[] = [];
    for (const node of byId.values()) {
      const discussionParents = node.parents.filter(id => byId.has(id));
      if (discussionParents.length === 0) roots.push(node);
      else discussionParents.forEach(id => byId.get(id)!.children.push(node));
    }
    const sort = (nodes: TreeNode[]) => nodes.sort((a, b) => a.doc.created_at.localeCompare(b.doc.created_at)).forEach(node => sort(node.children));
    sort(roots);
    return { roots, count: docs.length };
  }, [summary]);
}

function DiscussionNode({ node, depth }: { node: TreeNode; depth: number }) {
  const picked = useApp(state => state.picked.includes(node.doc.id));
  const summary = useApp(state => state.summary);
  const context = useApp(state => (node.doc.metadata.context_id ? state.contexts[node.doc.metadata.context_id] : undefined));
  const sourceTitles = node.parents.filter(id => !summary?.documents.find(doc => doc.id === id && doc.kind === 'discussion')).map(id => summary?.documents.find(doc => doc.id === id)?.title ?? '文稿');
  const mergedFrom = node.parents.filter(id => summary?.documents.find(doc => doc.id === id && doc.kind === 'discussion')).length;
  return (
    <li>
      <div className={`group rounded-lg px-2 py-1.5 hover:bg-[var(--cds-fill-ghost-hover)] ${picked ? 'bg-clay/8' : ''}`} style={{ marginLeft: depth * 14 }}>
        <div className="flex items-start gap-2">
          <input type="checkbox" checked={picked} onChange={() => togglePicked(node.doc.id)} aria-label={`选择讨论：${node.doc.title}`} className="mt-1 accent-[var(--cds-clay)]" />
          <button type="button" className="rc-focus-ring min-w-0 flex-1 rounded text-left" onClick={() => openDocument(node.doc.id)}>
            <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{node.doc.metadata.question ?? node.doc.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
              {mergedFrom > 1 && <Chip tone="clay">合并 {mergedFrom} 个分支</Chip>}
              {context && context.anchor_ids.length > 0 && <Chip tone="clay">{context.anchor_ids.length} 处选段</Chip>}
              {sourceTitles.length > 0 && <span className="truncate">来源：{sourceTitles.join('、')}</span>}
              <span>{formatTime(node.doc.created_at)}</span>
            </p>
          </button>
        </div>
        <div className="mt-1 hidden gap-1 pl-6 group-focus-within:flex group-hover:flex">
          <Button size="xs" variant="ghost" onClick={() => branchFrom([node.doc.id])}>从此分叉</Button>
          <Button size="xs" variant="ghost" onClick={() => void placeOnCanvas(node.doc.id, node.parents[0])}>加入画布</Button>
          {node.doc.metadata.context_id && <Button size="xs" variant="ghost" onClick={() => setDialogs({ contextId: node.doc.metadata.context_id })}>上下文</Button>}
        </div>
      </div>
      {node.children.length > 0 && <ul>{node.children.map(child => <DiscussionNode key={child.doc.id} node={child} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export function DiscussionPanel() {
  const runs = useApp(state => state.runs);
  const activeRunId = useApp(state => state.activeRunId);
  const picked = useApp(state => state.picked);
  const pickedDiscussions = useApp(state => state.picked.filter(id => state.summary?.documents.find(doc => doc.id === id)?.kind === 'discussion'));
  const tree = useDiscussionTree();
  const active = runs.find(run => run.id === activeRunId) ?? runs.find(run => run.status === 'running' || run.status === 'queued');

  return (
    <div className="space-y-3 p-3">
      <Composer />
      {active && <RunOutput run={active} />}
      <div>
        <SectionTitle action={picked.length > 0 ? <Button size="xs" variant="ghost" onClick={() => app.set({ picked: [] })}>清除选择</Button> : undefined}>
          讨论脉络 · {tree.count}
        </SectionTitle>
        {pickedDiscussions.length >= 2 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-clay/8 px-2 py-1.5 text-xs">
            <span className="text-ink-secondary">已选 {pickedDiscussions.length} 个讨论</span>
            <Button size="xs" variant="secondary" disabled={pickedDiscussions.length !== 2} title={pickedDiscussions.length !== 2 ? '比较需要恰好两个讨论' : undefined} onClick={() => setDialogs({ compare: [pickedDiscussions[0], pickedDiscussions[1]] })}>并排比较</Button>
            <Button size="xs" variant="primary" icon={<GroupingIcon width={14} height={14} />} onClick={() => branchFrom(pickedDiscussions)}>合并为新讨论</Button>
          </div>
        )}
        {tree.count === 0 ? (
          <EmptyState title="还没有讨论">选中文稿中的段落或公式发起讨论；生成的讨论会保存为文稿，并可继续分叉。</EmptyState>
        ) : (
          <ul className="space-y-0.5">{tree.roots.map(node => <DiscussionNode key={node.doc.id} node={node} depth={0} />)}</ul>
        )}
      </div>
    </div>
  );
}
