import { CloseIcon, EdgelessIcon, GroupingIcon, OpenInNewIcon, SendIcon, StopIcon, ViewIcon } from '@blocksuite/icons/rc';
import type { ResearchDocument, ResearchMode, Run } from '@research';
import { Button, QuietDotsWave, SegmentedControl, StreamingCursor, useScrollPinning } from '@ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  app, awaitingPlacement, branchFrom, canvasName, cancelRun, locateRun, documentMap, loadCanvasProposal, loadContext, recoverCanvasRun, regenerateRun, reopenCanvasProposal, openDocument, placeOnCanvas, previewContext, registerComposerFocus, removeMaterial,
  sendComposer, setDialogs, setInheritMode, setModel, togglePicked, updateComposer, useApp,
} from '../app/model';
import { inheritedSources } from '../app/materials';
import { AnchorStatusChip, Chip, EmptyState, KindIcon, SectionTitle } from '../components/common';
import { Markdown } from '../components/Markdown';
import { formatTime, formatUsage, MODE_LABEL, RUN_STATUS_LABEL } from '../lib/format';

const MODES: { id: ResearchMode; label: string }[] = [
  { id: 'discussion', label: MODE_LABEL.discussion },
  { id: 'rewrite', label: MODE_LABEL.rewrite },
  { id: 'relation', label: MODE_LABEL.relation },
];

const PLACEHOLDER: Record<ResearchMode, string> = {
  discussion: '提出要讨论的问题，例如：这个推论依赖哪些假设？',
  rewrite: '说明改写要求，例如：把这段论证改写得更严谨，保留公式',
  relation: '说明要分析的关系，例如：这两个概念的对应是否成立？',
  canvas: '说明希望 AI 在画布上创建或整理的内容',
};

/** 继续或合并讨论时继承的冻结材料：按完整引用列出，并标注来自哪个分支。 */
function InheritedMaterials() {
  const composer = useApp(state => state.composer);
  const contexts = useApp(state => state.contexts);
  const summary = useApp(state => state.summary);
  const { expected, missing } = useMemo(() => inheritedSources(composer.parents, documentMap(), contexts), [composer.parents, contexts, summary]);
  if (composer.parents.length === 0) return null;
  const grouped = new Map<string, { label: string; detail: string; origins: string[] }>();
  for (const item of expected) {
    if (composer.parents.includes(item.document_id) && !item.anchor_id) continue;
    const key = item.anchor_id ? `a:${item.anchor_id}` : `d:${item.document_id}@${item.version}`;
    const anchor = item.anchor_id ? summary?.anchors.find(entry => entry.id === item.anchor_id) : undefined;
    const title = summary?.documents.find(doc => doc.id === (anchor?.document_id ?? item.document_id))?.title ?? '文稿';
    const current = grouped.get(key) ?? {
      label: anchor ? `「${anchor.quote.slice(0, 48)}」` : `整篇「${title}」`,
      detail: `${title} · 版本 ${item.version ?? '?'}${anchor ? ' · 原片段' : ''}`,
      origins: [],
    };
    if (!current.origins.includes(item.origin)) current.origins.push(item.origin);
    grouped.set(key, current);
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-line px-2.5 py-2" data-testid="inherited-materials">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-ink-muted">{composer.parents.length > 1 ? `合并 ${composer.parents.length} 个分支` : '继续讨论'} · 继承材料</span>
        <SegmentedControl
          ariaLabel="继承方式"
          size="sm"
          className="ml-auto"
          items={[{ id: 'discussion', label: '含上一轮问答' }, { id: 'fragments', label: '仅原片段' }]}
          value={composer.inherit}
          onChange={value => setInheritMode(value as 'discussion' | 'fragments')}
        />
      </div>
      <ul className="space-y-0.5">
        {Array.from(grouped.entries()).map(([key, item]) => (
          <li key={key} className="text-[11.5px] text-ink">
            <span className="block truncate" title={item.label}>{item.label}</span>
            <span className="block truncate text-[11px] text-ink-muted">{item.detail} · {item.origins.join('、')}</span>
          </li>
        ))}
      </ul>
      {missing.map(item => <p key={item.id} className="text-[11px] text-[var(--rc-warn)]">「{item.title.slice(0, 30)}」{item.reason}；可在上方补选原片段。</p>)}
      <p className="text-[11px] text-ink-muted">
        {composer.inherit === 'discussion'
          ? '当前服务以讨论文稿为入口时会沿来源关系读取来源文稿的当前全文；预览会列出与原材料的差异。精确继承需要后端冻结材料支持。'
          : '只提交父讨论快照中的原片段及其历史版本，不包含上一轮问答。'}
      </p>
    </div>
  );
}

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
      <InheritedMaterials />
      <div className="flex flex-wrap gap-1.5" aria-label="上下文材料">
        {anchors.map(anchor => (
          <span key={anchor.id} className="flex w-full min-w-0 items-start gap-1.5 rounded-lg bg-clay/10 py-1 pl-2 pr-1 text-xs text-ink">
            <span className="shrink-0 whitespace-nowrap font-medium leading-5 text-clay">选段</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate leading-5" title={anchor.quote}>「{anchor.quote}」</span>
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-muted">
                <span className="min-w-0 truncate">{titleOf(anchor.document_id)} · v{anchor.version}</span>
                <AnchorStatusChip status={resolutions[anchor.id]?.status} />
              </span>
            </span>
            <button type="button" aria-label="移除该选段" className="rc-focus-ring shrink-0 rounded p-0.5 text-ink-muted hover:text-ink" onClick={() => removeMaterial('anchor', anchor.id)}><CloseIcon width={14} height={14} /></button>
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
          className="rc-input h-8 min-w-0 flex-1 py-0 text-xs leading-8"
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

/**
 * 失败的画布运行：从原输出恢复提案，或用原 context_id 重新生成。
 * 恢复失败时显示服务给出的具体格式错误，原输出与运行错误保持不变。
 */
function CanvasRecovery({ run }: { run: Run }) {
  const mode = useApp(state => state.contexts[run.context_id]?.mode);
  const [busy, setBusy] = useState<'recover' | 'regenerate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!mode) void loadContext(run.context_id); }, [mode, run.context_id]);
  if (mode !== 'canvas') return null;
  return (
    <div className="space-y-1.5 border-t border-line px-3 py-2 text-[11px]" data-testid="canvas-recovery">
      <p className="text-ink-secondary">画布操作未生成提案。原输出已保存{run.answer ? '' : '（无正文）'}；可从原输出恢复，或用同一冻结上下文重新生成。</p>
      {error && <p role="alert" className="text-[var(--rc-bad)]">恢复失败：{error}</p>}
      <div className="flex flex-wrap gap-1.5">
        {run.answer && run.status === 'failed' && (
          <Button size="xs" variant="primary" isLoading={busy === 'recover'} disabled={!!busy} onClick={async () => {
            setBusy('recover');
            setError(await recoverCanvasRun(run.id));
            setBusy(null);
          }}>从原输出恢复提案</Button>
        )}
        <Button size="xs" variant="secondary" isLoading={busy === 'regenerate'} disabled={!!busy} onClick={async () => {
          setBusy('regenerate');
          await regenerateRun(run);
          setBusy(null);
        }}>按原上下文重新生成</Button>
      </div>
    </div>
  );
}

export function RunOutput({ run, compact = false }: { run: Run; compact?: boolean }) {
  const doc = useApp(state => state.summary?.documents.find(item => item.id === run.document_id));
  const proposal = useApp(state => (run.proposal_id ? state.proposals[run.proposal_id] : undefined));
  const canvasProposal = useApp(state => (run.canvas_proposal_id ? state.canvasProposals[run.canvas_proposal_id] : undefined));
  // 刷新后按提案的实际状态显示入口（待确认、已写入、已撤销或已拒绝）
  const proposalLoaded = !!canvasProposal;
  useEffect(() => { if (run.canvas_proposal_id && !proposalLoaded) void loadCanvasProposal(run.canvas_proposal_id); }, [run.canvas_proposal_id, proposalLoaded]);
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
          {run.answer ? <Markdown text={run.answer} /> : (live ? <QuietDotsWave label={run.status === 'queued' ? '等待模型服务' : '正在生成'} /> : <span className="text-ink-muted">没有正文输出</span>)}
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
      {(run.status === 'failed' || run.status === 'interrupted') && !run.canvas_proposal_id && <CanvasRecovery run={run} />}
      {run.status === 'succeeded' && run.canvas_proposal_id && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          <Button size="xs" variant="primary" onClick={() => void reopenCanvasProposal(run.canvas_proposal_id!)}>
            {canvasProposal?.status === 'applied' ? '查看已写入的画布操作' : canvasProposal?.status === 'reverted' ? '查看已撤销的画布操作' : canvasProposal?.status === 'rejected' ? '查看已拒绝的画布操作' : '查看画布提案'}
          </Button>
        </div>
      )}
      {run.status === 'succeeded' && (doc || run.proposal_id) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          {doc && (
            <>
              {run.origin ? (
                // 画布提问的讨论按运行来源回到发问时的画布
                <Button size="xs" variant="primary" icon={<EdgelessIcon width={14} height={14} />} onClick={() => void locateRun(run.id)} title={`画布「${canvasName(run.origin.canvas_id)}」`}>
                  {awaitingPlacement(run) ? `放回原画布「${canvasName(run.origin.canvas_id)}」` : '在原画布中定位'}
                </Button>
              ) : (
                <Button size="xs" variant="primary" icon={<EdgelessIcon width={14} height={14} />} onClick={() => void placeOnCanvas(doc.id, firstSource(doc))}>加入画布</Button>
              )}
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

type TreeNode = { doc: ResearchDocument; children: TreeNode[]; parents: string[]; branches: string[] };

function useDiscussionTree() {
  const summary = useApp(state => state.summary);
  return useMemo(() => {
    const docs = (summary?.documents ?? []).filter(doc => doc.kind === 'discussion');
    const byId = new Map(docs.map(doc => [doc.id, { doc, children: [] as TreeNode[], parents: [] as string[], branches: [] as string[] }]));
    const contextRelations = (summary?.relations ?? []).filter(relation => relation.kind === 'context' && byId.has(relation.target_id));
    for (const relation of contextRelations) byId.get(relation.target_id)!.parents.push(relation.source_id);
    // 上下文连线包含整条祖先链；只保留直接分支来源，合并节点挂在最新的直接来源下，避免同一讨论重复出现
    const ancestors = new Map<string, Set<string>>();
    const ancestorsOf = (id: string, seen = new Set<string>()): Set<string> => {
      const cached = ancestors.get(id);
      if (cached) return cached;
      const result = new Set<string>();
      seen.add(id);
      for (const parent of byId.get(id)?.parents ?? []) {
        if (!byId.has(parent) || seen.has(parent)) continue;
        result.add(parent);
        ancestorsOf(parent, seen).forEach(item => result.add(item));
      }
      ancestors.set(id, result);
      return result;
    };
    const roots: TreeNode[] = [];
    for (const node of byId.values()) {
      const discussionParents = node.parents.filter(id => byId.has(id) && id !== node.doc.id);
      node.branches = discussionParents.filter(id => !discussionParents.some(other => other !== id && ancestorsOf(other).has(id)));
      const host = node.branches.map(id => byId.get(id)!).sort((a, b) => b.doc.created_at.localeCompare(a.doc.created_at))[0];
      if (host) host.children.push(node);
      else roots.push(node);
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
  const mergedFrom = node.branches.length;
  const mergedTitles = node.branches.map(id => summary?.documents.find(doc => doc.id === id)?.metadata.question ?? summary?.documents.find(doc => doc.id === id)?.title ?? '讨论');
  return (
    <li>
      <div className={`group relative rounded-lg px-2 py-1.5 hover:bg-[var(--cds-fill-ghost-hover)] ${picked ? 'bg-clay/8' : ''}`} style={{ marginLeft: depth * 14 }}>
        <div className="flex items-start gap-2">
          <input type="checkbox" checked={picked} onChange={() => togglePicked(node.doc.id)} aria-label={`选择讨论：${node.doc.title}`} className="mt-1 accent-[var(--cds-clay)]" />
          <button type="button" className="rc-focus-ring min-w-0 flex-1 rounded text-left" onClick={() => openDocument(node.doc.id)}>
            <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{node.doc.metadata.question ?? node.doc.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
              {mergedFrom > 1 && <span title={`合并自：${mergedTitles.join('；')}`}><Chip tone="clay">合并 {mergedFrom} 个分支</Chip></span>}
              {context && context.anchor_ids.length > 0 && <Chip tone="clay">{context.anchor_ids.length} 处选段</Chip>}
              {sourceTitles.length > 0 && <span className="truncate">来源：{sourceTitles.join('、')}</span>}
              <span>{formatTime(node.doc.created_at)}</span>
            </p>
          </button>
        </div>
        {/* 操作浮在条目右下角，显隐不改变列表布局，避免相邻条目点击时位移 */}
        <div className="absolute bottom-1 right-1 z-10 hidden gap-0.5 rounded-md border border-line bg-surface-popover p-0.5 shadow-popover group-focus-within:flex group-hover:flex">
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
