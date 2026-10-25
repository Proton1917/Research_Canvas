// 来源：Open Claude UI 02d021fceaf2a907f9e63a8125621bdda1b85d60 code-examples/ConfirmationDialog.tsx（MIT）。
// 适配：改为通用对话框外壳，CSS 进入动画，Escape 关闭、初始焦点与焦点循环。
import { useEffect, useRef, type ReactNode } from 'react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export function Dialog({ open, onClose, title, description, children, footer, width = 'max-w-md' }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter(element => !element.hasAttribute('disabled'));
    (focusable()[0] ?? panel.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); previous?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px] rc-fade-in" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`rc-dialog-in relative z-10 flex max-h-[min(86vh,900px)] w-full ${width} flex-col rounded-2xl border border-line bg-surface-2 shadow-popover outline-none`}
      >
        <div className="space-y-1 px-5 pb-3 pt-5">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description && <div className="text-xs leading-relaxed text-ink-muted">{description}</div>}
        </div>
        {children && <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">{children}</div>}
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
