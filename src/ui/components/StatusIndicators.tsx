// 运行状态、加载状态与流式文本光标。
export function ClayBreatheDot({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`inline-flex select-none items-center gap-2 ${className}`}>
      <span className="size-2.5 shrink-0 rounded-full bg-clay animate-clay-breathe motion-reduce:animate-none" aria-hidden="true" />
      {label && <span className="text-xs font-medium text-ink-secondary">{label}</span>}
    </span>
  );
}

export function PulseRunningDot({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`inline-flex select-none items-center gap-2 ${className}`}>
      <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" style={{ animationDuration: '1.2s' }} />
        <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
      </span>
      {label && <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{label}</span>}
    </span>
  );
}

export function QuietDotsWave({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`inline-flex select-none items-center gap-2 ${className}`}>
      <span className="inline-flex items-center gap-[4px]" aria-hidden="true">
        {[0, 0.15, 0.3].map(delay => (
          <span key={delay} className="size-1.5 rounded-full bg-clay animate-quiet-dot motion-reduce:animate-none" style={{ animationDelay: `${delay}s` }} />
        ))}
      </span>
      {label && <span className="text-xs font-medium text-ink-muted">{label}</span>}
    </span>
  );
}

export function SkeletonShimmer({ width = '100%', height = '1rem', className = '' }: { width?: string | number; height?: string | number; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-[var(--cds-alpha-1)] ${className}`} style={{ width, height }}>
      <div
        className="absolute inset-0 -translate-x-full animate-shimmer-sweep motion-reduce:animate-none"
        style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)' }}
      />
    </div>
  );
}

export function StreamingCursor({ className = '' }: { className?: string }) {
  return <span className={`ml-0.5 inline-block h-[1.1em] w-[3px] animate-pulse rounded-[1px] bg-clay align-middle motion-reduce:animate-none ${className}`} aria-hidden="true" />;
}
