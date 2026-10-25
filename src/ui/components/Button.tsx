// 统一按钮尺寸、交互状态与主题色。
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  isLoading?: boolean;
}

const SIZE_STYLES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 rounded-md text-[11.5px] gap-1',
  sm: 'h-7 px-2.5 rounded-lg text-xs gap-1.5',
  md: 'h-8 px-3.5 rounded-lg text-sm gap-1.5',
  lg: 'h-10 px-5 rounded-xl text-[15px] gap-2 font-medium',
  icon: 'size-8 rounded-lg p-0',
  'icon-sm': 'size-7 rounded-lg p-0',
};

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-clay hover:bg-clay-hover text-white shadow-2xs font-medium',
  secondary: 'bg-[var(--cds-fill-secondary)] hover:bg-[var(--cds-fill-secondary-hover)] text-ink font-medium',
  ghost: 'bg-transparent hover:bg-[var(--cds-fill-ghost-hover)] text-ink-secondary hover:text-ink',
  outline: 'bg-transparent hover:bg-[var(--cds-fill-ghost-hover)] text-ink border border-line',
  danger: 'bg-red-600 hover:bg-red-700 text-white shadow-2xs font-medium',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', icon, iconPosition = 'left', isLoading = false, disabled = false, children, className = '', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap border-0 font-sans transition-[background-color,color,transform] duration-150 select-none outline-none active:scale-[0.98] focus-visible:shadow-focus-glow disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 ${SIZE_STYLES[size]} ${VARIANT_STYLES[variant]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        icon && iconPosition === 'left' && <span className="flex shrink-0 items-center justify-center leading-none">{icon}</span>
      )}
      {children != null && children !== false && <span className="truncate">{children}</span>}
      {!isLoading && icon && iconPosition === 'right' && <span className="flex shrink-0 items-center justify-center leading-none">{icon}</span>}
    </button>
  )
);
Button.displayName = 'Button';
