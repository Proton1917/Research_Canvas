import { Button } from '@ui';
import { useState } from 'react';

import { documentMap, errorText, getSession, toast } from '../app/model';

/** 版本冲突：保留本地内容生成新版本，或载入服务端当前版本。 */
export function ConflictBar({ kind, id }: { kind: 'document' | 'canvas'; id: string }) {
  const [busy, setBusy] = useState(false);
  const session = getSession();
  const status = kind === 'document' ? session?.docStatus(id) : session?.canvasStatus(id);
  const run = async (keepLocal: boolean) => {
    if (!session) return;
    setBusy(true);
    try {
      if (kind === 'document') {
        if (keepLocal) await session.resolveConflictKeepLocal(id);
        else await session.resolveConflictUseServer(id);
      } else if (keepLocal) {
        await session.resolveCanvasConflictKeepLocal(id);
      } else {
        await session.reloadCanvas(id, documentMap());
      }
      toast(keepLocal ? '已用本地内容生成新版本' : '已载入服务器当前版本', 'success');
    } catch (error) {
      toast(errorText(error), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-line bg-amber-500/10 px-3 py-2 text-xs text-ink">
      <span className="font-medium text-[var(--rc-warn)]">内容已在其他位置更新</span>
      <span className="text-ink-secondary">
        本地基于{kind === 'document' ? '版本' : '布局'} {status?.version}，服务器当前为 {status?.conflictVersion ?? '更新版本'}。本地修改仍保留在编辑器中。
      </span>
      <span className="ml-auto flex gap-1.5">
        <Button size="xs" variant="secondary" disabled={busy} onClick={() => void run(false)}>载入服务器版本</Button>
        <Button size="xs" variant="primary" disabled={busy} onClick={() => void run(true)}>保留本地内容</Button>
      </span>
    </div>
  );
}
