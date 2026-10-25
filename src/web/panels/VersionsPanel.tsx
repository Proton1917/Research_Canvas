import { HistoryIcon, ResetIcon, ViewIcon } from '@blocksuite/icons/rc';
import { api, type DocumentVersion } from '@research';
import { Button, SkeletonShimmer } from '@ui';
import { useEffect, useState } from 'react';

import { errorText, restoreVersion, setDialogs, useApp } from '../app/model';
import { useSession } from '../app/useSession';
import { Chip, EmptyState, SectionTitle } from '../components/common';
import { formatTime } from '../lib/format';

export function reasonLabel(reason: string) {
  if (reason === 'create') return '创建';
  if (reason === 'edit') return '编辑';
  if (reason === 'import') return '导入';
  if (reason === 'generation') return 'AI 生成';
  if (reason.startsWith('restore:')) return `恢复自版本 ${reason.slice(8)}`;
  if (reason.startsWith('proposal:')) return '确认 AI 修改';
  if (reason.startsWith('revert-proposal:')) return '撤销 AI 修改';
  return reason;
}

export function VersionsPanel() {
  const view = useApp(state => state.view);
  const documentId = view.type === 'document' ? view.id : null;
  const doc = useApp(state => state.summary?.documents.find(item => item.id === documentId));
  const session = useSession();
  const localVersion = documentId ? session?.docStatus(documentId)?.version : undefined;
  const [versions, setVersions] = useState<DocumentVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentVersion = localVersion ?? doc?.current_version;

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    setError(null);
    api.listVersions(documentId)
      .then(list => { if (!cancelled) setVersions(list); })
      .catch(err => { if (!cancelled) setError(errorText(err)); });
    return () => { cancelled = true; };
  }, [documentId, currentVersion]);

  if (!documentId || !doc) {
    return <EmptyState title="打开一篇文稿查看版本">每次保存、AI 修改确认、撤销与恢复都会生成不可变版本。</EmptyState>;
  }

  return (
    <div className="p-3">
      <SectionTitle>{doc.title} · 版本历史</SectionTitle>
      {error && <p className="px-1 text-xs text-[var(--rc-bad)]">{error}</p>}
      {!versions && !error && <div className="space-y-2 p-1"><SkeletonShimmer height={44} /><SkeletonShimmer height={44} /></div>}
      {versions && versions.length === 0 && <EmptyState title="暂无版本" />}
      <ol className="space-y-1.5">
        {versions?.slice().reverse().map(version => {
          const isCurrent = version.version === currentVersion;
          return (
            <li key={version.version} className={`rounded-xl border px-3 py-2 ${isCurrent ? 'border-clay/50 bg-clay/5' : 'border-line bg-surface-2'}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-semibold tabular-nums text-ink">版本 {version.version}</span>
                <Chip tone={version.reason.startsWith('proposal') || version.reason === 'generation' ? 'clay' : 'muted'}>{reasonLabel(version.reason)}</Chip>
                {isCurrent && <Chip tone="ok">当前</Chip>}
                <span className="ml-auto text-[11px] text-ink-muted">{formatTime(version.created_at)}</span>
              </div>
              <p className="mt-1 truncate text-[11px] text-ink-muted">{version.content.blocks.length} 个文本块{version.title !== doc.title ? ` · 标题「${version.title}」` : ''}</p>
              <div className="mt-1.5 flex gap-1">
                <Button size="xs" variant="ghost" icon={<ViewIcon width={14} height={14} />} onClick={() => setDialogs({ version: { documentId, version: version.version } })}>查看与对比</Button>
                {!isCurrent && doc.kind !== 'pdf' && doc.kind !== 'image' && (
                  <Button size="xs" variant="ghost" icon={<ResetIcon width={14} height={14} />} onClick={() => void restoreVersion(documentId, version.version)}>恢复为新版本</Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 flex items-center gap-1.5 px-1 text-[11px] text-ink-muted"><HistoryIcon width={14} height={14} />恢复会以历史内容生成新版本，原有版本全部保留。</p>
    </div>
  );
}
