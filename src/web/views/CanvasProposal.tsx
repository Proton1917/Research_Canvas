// 画布提案：候选框、候选联系与移动在画布上以预览层显示；用户调整内容与位置、
// 选择采用的操作后确认写入，或拒绝；已写入的提案可整组撤销。
import { CloseIcon } from '@blocksuite/icons/rc';
import type { Bounds, CanvasAction, ProposalEndpoint } from '@research';
import { Button } from '@ui';
import { useRef, useState } from 'react';

import {
  actionKey, applyProposalDraft, closeProposalDraft, proposalDependencyErrors, rejectProposalDraft, revertProposalDraft,
  toggleProposalAction, updateProposalAction, useApp,
} from '../app/model';
import { Chip } from '../components/common';
import { Markdown } from '../components/Markdown';

type ToView = (x: number, y: number) => [number, number];

/** 流式阶段的 run.answer 是 JSON 草稿：读出已完整接收的分析正文与候选标题。 */
export function parseProposalDraft(answer: string) {
  const strings = (field: string) => Array.from(answer.matchAll(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g'))).map(match => {
    try { return JSON.parse(`"${match[1]}"`) as string; } catch { return match[1]; }
  });
  return { analysis: strings('answer')[0] ?? '', titles: strings('title'), labels: strings('label') };
}

function CandidateBox({ action, excluded, toView, zoom }: { action: Extract<CanvasAction, { type: 'create_document' }>; excluded: boolean; toView: ToView; zoom: number }) {
  const drag = useRef<{ x: number; y: number; bounds: Bounds } | null>(null);
  const [editing, setEditing] = useState(false);
  const [left, top] = toView(action.bounds.x, action.bounds.y);
  return (
    <div
      className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border-2 border-dashed bg-surface-2/95 shadow-popover ${excluded ? 'border-line opacity-45' : 'border-[#8e6cdf]'}`}
      style={{ left, top, width: action.bounds.width * zoom, height: action.bounds.height * zoom }}
      data-testid="proposal-candidate"
      onPointerDown={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <div
        className="flex cursor-move items-center gap-1.5 border-b border-line bg-[#8e6cdf]/10 px-2 py-1"
        onPointerDown={event => {
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, bounds: action.bounds };
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (!start) return;
          updateProposalAction(action.key, { bounds: { ...start.bounds, x: Math.round(start.bounds.x + (event.clientX - start.x) / zoom), y: Math.round(start.bounds.y + (event.clientY - start.y) / zoom) } });
        }}
        onPointerUp={() => { drag.current = null; }}
      >
        <Chip tone="clay">候选</Chip>
        <input
          aria-label="候选框标题"
          className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-ink outline-none"
          value={action.title}
          onPointerDown={event => event.stopPropagation()}
          onChange={event => updateProposalAction(action.key, { title: event.target.value })}
        />
        <button type="button" className="rc-focus-ring shrink-0 rounded px-1 text-[11px] text-clay hover:underline" onPointerDown={event => event.stopPropagation()} onClick={() => setEditing(value => !value)}>{editing ? '预览' : '编辑'}</button>
      </div>
      {editing ? (
        <textarea
          aria-label="候选框内容"
          className="rc-scroll min-h-0 flex-1 resize-none bg-transparent p-2 font-mono text-[11.5px] leading-relaxed text-ink outline-none"
          value={action.text}
          onChange={event => updateProposalAction(action.key, { text: event.target.value })}
        />
      ) : (
        <div className="rc-scroll rc-prose min-h-0 flex-1 overflow-auto p-2 text-[12px] text-ink"><Markdown text={action.text} /></div>
      )}
    </div>
  );
}

/** 候选内容预览层：放在画布视口坐标系中，随缩放与平移更新。 */
export function ProposalLayer({ canvasId, toView, zoom, endpointBounds }: {
  canvasId: string; toView: ToView; zoom: number; endpointBounds: (endpoint: ProposalEndpoint) => Bounds | null;
}) {
  const draft = useApp(state => state.proposalDraft);
  const proposal = useApp(state => (draft ? state.canvasProposals[draft.id] : undefined));
  const region = useApp(state => (proposal ? state.contexts[proposal.context_id]?.scenes?.at(-1)?.write_scope.bounds ?? null : null));
  if (!draft || !proposal || proposal.canvas_id !== canvasId || proposal.status !== 'pending') return null;
  const [regionLeft, regionTop] = region ? toView(region.x, region.y) : [0, 0];
  const created = new Map(draft.actions.filter((action): action is Extract<CanvasAction, { type: 'create_document' }> => action.type === 'create_document').map(action => [action.key, action]));
  const center = (end: ProposalEndpoint): [number, number] | null => {
    const bounds = end.type === 'created' ? created.get(end.key)?.bounds ?? null : endpointBounds(end);
    if (!bounds) return null;
    return toView(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  };
  return (
    <>
      {region && (
        <div className="pointer-events-none absolute rounded-xl border-2 border-dashed border-clay/50" style={{ left: regionLeft, top: regionTop, width: region.width * zoom, height: region.height * zoom }} data-testid="proposal-region">
          <span className="m-1 inline-block rounded bg-surface-popover/90 px-1.5 py-0.5 text-[11px] text-clay">允许写入区域（冻结于本次上下文）</span>
        </div>
      )}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {draft.actions.map(action => {
          if (action.type !== 'create_relation') return null;
          const a = center(action.source);
          const b = center(action.target);
          if (!a || !b) return null;
          const excluded = draft.excluded.includes(action.key);
          return (
            <g key={action.key} opacity={excluded ? 0.3 : 1}>
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#8e6cdf" strokeWidth={2} strokeDasharray="6 5" />
              <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 6} textAnchor="middle" fontSize={12} fill="#8e6cdf">候选 · {action.label}</text>
            </g>
          );
        })}
      </svg>
      {draft.actions.map(action => {
        if (action.type === 'create_document') return <CandidateBox key={action.key} action={action} excluded={draft.excluded.includes(action.key)} toView={toView} zoom={zoom} />;
        if (action.type === 'move_object') {
          const [left, top] = toView(action.bounds.x, action.bounds.y);
          return <div key={actionKey(action)} className="pointer-events-none absolute rounded-xl border-2 border-dotted border-[#8e6cdf]" style={{ left, top, width: action.bounds.width * zoom, height: action.bounds.height * zoom }}><span className="m-1 inline-block rounded bg-surface-popover px-1 text-[11px] text-[#8e6cdf]">移动到此</span></div>;
        }
        return null;
      })}
    </>
  );
}

/** 候选联系端点的名称：文稿标题、片段原文、场景实例的文字或新建框标题。 */
function useEndpointLabel(proposalId: string) {
  const draft = useApp(state => state.proposalDraft);
  const proposal = useApp(state => state.canvasProposals[proposalId]);
  const summary = useApp(state => state.summary);
  const scene = useApp(state => (proposal ? state.contexts[proposal.context_id]?.scenes?.at(-1) : undefined));
  return (end: ProposalEndpoint) => {
    switch (end.type) {
      case 'created': {
        const action = draft?.actions.find(item => item.type === 'create_document' && item.key === end.key);
        return `新建框「${action && action.type === 'create_document' ? action.title : end.key}」`;
      }
      case 'document': {
        const doc = summary?.documents.find(item => item.id === end.id);
        return `文稿「${doc?.title || '未命名'}」`;
      }
      case 'anchor': {
        const anchor = summary?.anchors.find(item => item.id === end.id);
        return anchor ? `片段「${anchor.quote.slice(0, 30)}${anchor.quote.length > 30 ? '…' : ''}」v${anchor.version}` : '片段';
      }
      case 'scene': {
        const object = scene?.objects.find(item => item.id === end.object_id);
        const text = object?.text || object?.label || '';
        return `画布想法「${text.slice(0, 30)}${text.length > 30 ? '…' : ''}」`;
      }
      default:
        return '端点';
    }
  };
}

function ActionRow({ action, excluded, sourceTitle, endpointLabel }: { action: CanvasAction; excluded: boolean; sourceTitle: (number: number) => string; endpointLabel: (end: ProposalEndpoint) => string }) {
  const key = actionKey(action);
  const sources = 'source_numbers' in action && action.source_numbers?.length ? action.source_numbers.map(number => `[来源${number}] ${sourceTitle(number)}`).join('；') : '';
  return (
    <li className={`rounded-lg border border-line px-2.5 py-2 text-xs ${excluded ? 'opacity-55' : ''}`}>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 accent-[var(--cds-clay)]" checked={!excluded} onChange={() => toggleProposalAction(key)} aria-label={`采用：${key}`} />
        <span className="min-w-0 flex-1">
          {action.type === 'create_document' && <><Chip tone="clay">新建{action.kind === 'note' ? '框' : '讨论'}</Chip> <span className="font-medium text-ink">{action.title}</span></>}
          {action.type === 'move_object' && <><Chip>移动</Chip> <span className="text-ink">对象 {action.object_id}</span></>}
          {action.type === 'replace_excerpt' && <><Chip tone="warn">改写片段</Chip> <span className="text-ink">版本 {action.expected_version}：{action.replacement.slice(0, 80)}</span></>}
          {action.type === 'create_relation' && (
            <>
              <Chip tone="warn">候选联系</Chip> <span className="font-medium text-ink">{action.label}</span>
              <span className="mt-1 block text-ink-secondary">{endpointLabel(action.source)} → {endpointLabel(action.target)}</span>
              {action.mapping && <span className="mt-1 block text-ink-secondary">对应：{action.mapping}</span>}
              {!!action.preserved_operations?.length && <span className="block text-ink-secondary">保持的运算：{action.preserved_operations.join('、')}</span>}
              {action.conditions && <span className="block text-ink-secondary">条件：{action.conditions}</span>}
              {action.counterexamples && <span className="block text-ink-secondary">反例：{action.counterexamples}</span>}
              {action.missing_proof && <span className="mt-1 block rounded bg-amber-500/10 px-1.5 py-1 text-ink-secondary" data-testid="proposal-gap"><b className="text-[var(--rc-warn)]">证据缺口：</b>{action.missing_proof}</span>}
              {action.next_validation && <span className="block text-ink-secondary">下一步验证：{action.next_validation}</span>}
            </>
          )}
          {sources && <span className="mt-1 block text-[11px] text-ink-muted">{sources}</span>}
        </span>
      </label>
    </li>
  );
}

/** 提案审阅面板：分析正文、操作清单、版本冲突与确认、拒绝、撤销。 */
export function ProposalPanel({ canvasId }: { canvasId: string }) {
  const draft = useApp(state => state.proposalDraft);
  const proposal = useApp(state => (draft ? state.canvasProposals[draft.id] : undefined));
  const context = useApp(state => (proposal ? state.contexts[proposal.context_id] : undefined));
  const endpointLabel = useEndpointLabel(draft?.id ?? '');
  if (!draft || !proposal || proposal.canvas_id !== canvasId) return null;
  const sourceTitle = (number: number) => context?.sources.find(source => source.number === number)?.title || '想法';
  const dependency = proposalDependencyErrors(draft);
  const pending = proposal.status === 'pending';
  return (
    <section aria-label="画布提案" className="rc-pop-in pointer-events-auto absolute bottom-3 right-3 z-30 flex max-h-[min(70vh,600px)] w-[min(400px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-popover" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold text-ink">AI 画布提案</span>
        <Chip tone={proposal.status === 'applied' ? 'ok' : proposal.status === 'pending' ? 'clay' : 'muted'}>
          {{ pending: '待确认', applied: '已写入', reverted: '已撤销', rejected: '已拒绝' }[proposal.status]}
        </Chip>
        <span className="text-[11px] text-ink-muted">提案 r{proposal.revision} · 画布 r{proposal.canvas_revision}</span>
        <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="关闭提案面板" icon={<CloseIcon width={16} height={16} />} onClick={closeProposalDraft} />
      </div>
      <div className="rc-scroll min-h-0 flex-1 space-y-2.5 overflow-auto px-3 py-2.5">
        {proposal.answer && <div className="rc-prose max-h-40 overflow-auto rounded-lg bg-[var(--cds-alpha-1)] p-2.5 text-[12.5px] text-ink"><Markdown text={proposal.answer} /></div>}
        <p className="text-[11px] text-ink-muted">科学联系以“候选”状态写入；状态升级需在学科桥中附证据人工确认。</p>
        <ul className="space-y-1.5">{draft.actions.map(action => <ActionRow key={actionKey(action)} action={action} excluded={draft.excluded.includes(actionKey(action))} sourceTitle={sourceTitle} endpointLabel={endpointLabel} />)}</ul>
        {dependency.map(item => <p key={item} className="text-xs text-[var(--rc-bad)]">{item}</p>)}
        {draft.unplaced.length > 0 && <p className="text-[11px] text-[var(--rc-warn)]">{draft.unplaced.length} 条候选联系的端点不在本画布，关系已保存但未画线；放入两端卡片后可在关系面板显示。</p>}
        {draft.conflict && pending && (
          <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-ink">
            <p className="font-medium text-[var(--rc-warn)]">画布在生成后已更新：版本 {draft.conflict.from} → {draft.conflict.to}</p>
            <p className="mt-0.5 text-ink-secondary">生成结果与调整均保留。检查候选位置后，可按当前画布确认；模型不会重新调用。</p>
            <Button size="xs" variant="primary" className="mt-1.5" disabled={!!draft.busy} onClick={() => void applyProposalDraft({ acceptCanvasChanges: true })}>按当前画布确认写入</Button>
          </div>
        )}
        {draft.error && <p role="alert" className="text-xs text-[var(--rc-bad)]">{draft.error}</p>}
      </div>
      <div className="flex items-center gap-1.5 border-t border-line px-3 py-2">
        {pending ? (
          <>
            <Button size="sm" variant="ghost" disabled={!!draft.busy} isLoading={draft.busy === 'reject'} onClick={() => void rejectProposalDraft()}>拒绝</Button>
            <span className="flex-1 text-right text-[11px] text-ink-muted">{draft.dirty ? '已调整，确认时提交校验' : ''}</span>
            <Button size="sm" variant="primary" disabled={!!draft.busy || dependency.length > 0 || draft.excluded.length === draft.actions.length} isLoading={draft.busy === 'apply'} onClick={() => void applyProposalDraft()}>确认写入</Button>
          </>
        ) : proposal.status === 'applied' ? (
          <>
            <span className="flex-1 text-[11px] text-ink-muted">新对象可继续编辑、引用和讨论。</span>
            <Button size="sm" variant="secondary" disabled={!!draft.busy} isLoading={draft.busy === 'revert'} onClick={() => void revertProposalDraft()}>撤销本次写入</Button>
          </>
        ) : <span className="text-[11px] text-ink-muted">提案已{proposal.status === 'reverted' ? '撤销' : '拒绝'}。</span>}
      </div>
    </section>
  );
}
