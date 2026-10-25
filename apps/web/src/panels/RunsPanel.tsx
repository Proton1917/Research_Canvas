import { useApp } from '../app/model';
import { EmptyState, SectionTitle } from '../components/common';
import { formatTime, MODE_LABEL } from '../lib/format';
import { RunOutput } from './DiscussionPanel';

export function RunsPanel() {
  const runs = useApp(state => state.runs);
  const contexts = useApp(state => state.contexts);
  return (
    <div className="space-y-2 p-3">
      <SectionTitle>运行记录 · {runs.length}</SectionTitle>
      {runs.length === 0 && <EmptyState title="暂无运行">发送讨论、改写或关系分析后，这里记录模型、状态、用量与错误。</EmptyState>}
      {runs.map(run => {
        const context = contexts[run.context_id];
        return (
          <div key={run.id} className="space-y-1">
            <p className="flex items-center gap-1.5 px-1 text-[11px] text-ink-muted">
              <span>{formatTime(run.created_at)}</span>
              {context && <span>· {MODE_LABEL[context.mode]}</span>}
              {context && <span className="truncate">· {context.question}</span>}
            </p>
            <RunOutput run={run} compact />
          </div>
        );
      })}
    </div>
  );
}
