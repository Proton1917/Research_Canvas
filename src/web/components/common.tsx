import type { AnchorStatus, DocumentKind } from '@research';
import type { EntryStatus } from '@research/editor';
import { ClayBreatheDot } from '@ui';
import {
  ChatWithAiIcon, EdgelessIcon, FileIconPdfIcon, ImageIcon, NoteShadowDuotoneIcon, PageIcon,
} from '@blocksuite/icons/rc';
import type { ReactNode } from 'react';

import { ANCHOR_STATUS_HINT, ANCHOR_STATUS_LABEL, anchorTone, formatTime } from '../lib/format';

export function KindIcon({ kind, className = '' }: { kind: DocumentKind | 'canvas'; className?: string }) {
  const props = { className: `shrink-0 ${className}`, width: 16, height: 16, 'aria-hidden': true } as const;
  switch (kind) {
    case 'canvas': return <EdgelessIcon {...props} />;
    case 'note': return <NoteShadowDuotoneIcon {...props} />;
    case 'discussion': return <ChatWithAiIcon {...props} />;
    case 'pdf': return <FileIconPdfIcon {...props} />;
    case 'image': return <ImageIcon {...props} />;
    default: return <PageIcon {...props} />;
  }
}

const TONE_CLASS = {
  ok: 'bg-emerald-500/12 text-[var(--rc-ok)]',
  warn: 'bg-amber-500/14 text-[var(--rc-warn)]',
  bad: 'bg-orange-600/12 text-[var(--rc-bad)]',
  muted: 'bg-[var(--cds-alpha-1)] text-ink-muted',
  clay: 'bg-clay/12 text-clay',
} as const;

export function Chip({ tone = 'muted', children, title, className = '' }: { tone?: keyof typeof TONE_CLASS; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium leading-none ${TONE_CLASS[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function AnchorStatusChip({ status }: { status: AnchorStatus | null | undefined }) {
  if (!status) return <Chip>定位中</Chip>;
  return <Chip tone={anchorTone(status)} title={ANCHOR_STATUS_HINT[status]}>{ANCHOR_STATUS_LABEL[status]}</Chip>;
}

export function SaveIndicator({ status, kind = 'document' }: { status: EntryStatus | null; kind?: 'document' | 'canvas' }) {
  if (!status) return null;
  const unit = kind === 'canvas' ? '布局' : '版本';
  switch (status.state) {
    case 'readonly':
      return <Chip title="来源文件只读，可选段批注与讨论">只读来源 · 版本 {status.version}</Chip>;
    case 'saved':
      return <Chip tone="ok" title={status.savedAt ? `保存于 ${formatTime(status.savedAt)}` : undefined}>已保存 · {unit} {status.version}</Chip>;
    case 'dirty':
      return <Chip>未保存修改</Chip>;
    case 'saving':
      return <ClayBreatheDot label="保存中" />;
    case 'conflict':
      return <Chip tone="bad">版本冲突</Chip>;
    case 'error':
      return <Chip tone="bad" title={status.error}>保存失败</Chip>;
  }
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-xs text-xs leading-relaxed text-ink-muted">{children}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 pb-1.5 pt-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{children}</h3>
      {action}
    </div>
  );
}

export function Popover({ open, onClose, children, className = '' }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[90]" onClick={onClose} />
      <div
        className={`rc-pop-in absolute z-[100] mt-1 rounded-xl border border-line bg-surface-popover p-1 shadow-popover ${className}`}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
      >
        {children}
      </div>
    </>
  );
}

export function MenuItem({ icon, children, onClick, disabled, hint }: { icon?: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rc-focus-ring flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-[var(--cds-fill-ghost-hover)] disabled:opacity-40"
    >
      {icon && <span className="flex shrink-0 text-ink-secondary">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-ink-muted">{hint}</span>}
    </button>
  );
}
