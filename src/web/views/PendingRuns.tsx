// 后台运行的原画布入口：待放回发问画布的讨论、待确认的画布提案，以及归位失败的记录。
import { EdgelessIcon } from '@blocksuite/icons/rc';
import { Button } from '@ui';

import { awaitingPlacement, canvasName, locateRun, placeRun, reopenCanvasProposal, setTab, useApp } from '../app/model';

const SHOWN = 3;

export function PendingRuns() {
  const view = useApp(state => state.view);
  const runs = useApp(state => state.runs);
  const placements = useApp(state => state.placements);
  const contexts = useApp(state => state.contexts);
  const documents = useApp(state => state.summary?.documents);
  const proposals = useApp(state => state.canvasProposals);
  const current = view.type === 'canvas' ? view.id : null;

  // 目标画布在前台时由画布完成归位；失败的记录仍在此列出
  const waiting = runs.filter(run => awaitingPlacement(run) && (run.origin!.canvas_id !== current || placements[run.id]?.error));
  const pendingProposals = runs.filter(run => {
    const proposal = run.canvas_proposal_id ? proposals[run.canvas_proposal_id] : undefined;
    return proposal?.status === 'pending' && proposal.canvas_id !== current;
  });
  const hidden = Math.max(0, waiting.length - SHOWN) + Math.max(0, pendingProposals.length - SHOWN);
  if (waiting.length === 0 && pendingProposals.length === 0) return null;

  const title = (run: (typeof runs)[number]) => {
    const question = contexts[run.context_id]?.question ?? documents?.find(doc => doc.id === run.document_id)?.title ?? '讨论';
    return question.length > 32 ? `${question.slice(0, 32)}…` : question;
  };

  return (
    <div role="status" aria-label="待归位的讨论" className="flex max-h-28 flex-col gap-1 overflow-auto border-b border-line bg-clay/5 px-3 py-1.5 text-xs rc-scroll" data-testid="pending-runs">
      {waiting.slice(0, SHOWN).map(run => {
        const state = placements[run.id];
        const target = run.origin!.canvas_id;
        return (
          <div key={run.id} className="flex flex-wrap items-center gap-2" data-testid="pending-placement">
            <EdgelessIcon width={14} height={14} className="shrink-0 text-clay" />
            <span className="min-w-0 flex-1 truncate text-ink">
              讨论「{title(run)}」待放回画布「{canvasName(target)}」
              {state?.error && <span className="ml-1 text-[var(--rc-bad)]">· {state.error}</span>}
            </span>
            {state?.error && !state.retry && target === current
              ? <Button size="xs" variant="secondary" isLoading={state.busy} onClick={() => void placeRun(run.id)}>重试放回</Button>
              : target !== current && <Button size="xs" variant="secondary" onClick={() => void locateRun(run.id)}>前往原画布</Button>}
          </div>
        );
      })}
      {pendingProposals.slice(0, SHOWN).map(run => {
        const proposal = proposals[run.canvas_proposal_id!];
        return (
          <div key={run.id} className="flex flex-wrap items-center gap-2" data-testid="pending-proposal">
            <EdgelessIcon width={14} height={14} className="shrink-0 text-[#8e6cdf]" />
            <span className="min-w-0 flex-1 truncate text-ink">画布提案「{title(run)}」待确认 · 画布「{canvasName(proposal.canvas_id)}」</span>
            <Button size="xs" variant="secondary" onClick={() => void reopenCanvasProposal(proposal.id)}>{proposal.canvas_id === current ? '显示提案' : '前往查看'}</Button>
          </div>
        );
      })}
      {hidden > 0 && <button type="button" className="rc-focus-ring self-start rounded text-[11px] text-clay hover:underline" onClick={() => setTab('runs')}>另有 {hidden} 项，见运行记录</button>}
    </div>
  );
}
