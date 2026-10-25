// 分段选择、方向键导航与减少动态效果设置。
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedItem<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  badge?: string | number;
}

export interface SegmentedControlProps<T extends string> {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel: string;
}

export function SegmentedControl<T extends string>({ items, value, onChange, size = 'md', className = '', ariaLabel }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, items.findIndex(item => item.id === value));
  const move = (event: KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    onChange(items[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`relative flex select-none items-stretch rounded-full p-[2px] ${size === 'sm' ? 'h-7 text-xs' : 'h-8 text-[13px]'} ${className}`}
      style={{ backgroundColor: 'var(--cds-segmented-track)' }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[2px] top-[2px] rounded-full transition-[left] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
        style={{
          left: `calc(2px + ${activeIndex} * (100% - 4px) / ${items.length})`,
          width: `calc((100% - 4px) / ${items.length})`,
          background: 'var(--cds-segmented-thumb)',
          boxShadow: 'inset 0 0 0 1px var(--cds-alpha-1), 0 1px 2px 0 rgba(0,0,0,0.08)',
        }}
      />
      {items.map((item, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={item.id}
            ref={element => { refs.current[index] = element; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={event => move(event, index)}
            className={`relative z-10 flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 truncate rounded-full border-0 bg-transparent px-2.5 outline-none transition-colors focus-visible:shadow-focus-glow ${active ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink'}`}
          >
            {item.icon && <span className="flex shrink-0 items-center">{item.icon}</span>}
            <span className="truncate">{item.label}</span>
            {item.badge !== undefined && <span className="rounded-full bg-[var(--cds-alpha-1)] px-1.5 font-mono text-[10px] leading-4 tabular-nums">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
