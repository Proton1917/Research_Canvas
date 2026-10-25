// 依据 Open Claude UI 02d021fceaf2a907f9e63a8125621bdda1b85d60 的 code-examples/tailwind.config.js（MIT），
// 改为供应用合并的 preset；颜色改为引用 cds-theme.css 变量，字体使用本机可用的中英文字体。
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-mode="dark"]'],
  theme: {
    extend: {
      colors: {
        clay: {
          DEFAULT: 'var(--cds-clay)',
          hover: 'var(--cds-clay-hover)',
          light: 'var(--cds-clay-light)',
        },
        surface: {
          0: 'var(--cds-surface-0)',
          1: 'var(--cds-surface-1)',
          2: 'var(--cds-surface-2)',
          3: 'var(--cds-surface-3)',
          popover: 'var(--cds-surface-popover)',
        },
        ink: {
          DEFAULT: 'var(--cds-text-primary)',
          secondary: 'var(--cds-text-secondary)',
          muted: 'var(--cds-text-muted)',
        },
        line: {
          DEFAULT: 'var(--cds-border)',
          strong: 'var(--cds-border-strong)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
        serif: ['ui-serif', 'Songti SC', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        xs: 'var(--radius-xs, 2px)',
        sm: 'var(--radius-sm, 4px)',
        md: 'var(--radius-md, 6px)',
        lg: 'var(--radius-lg, 8px)',
        panel: 'var(--cds-panel-radius, 10px)',
        xl: 'var(--radius-xl, 12px)',
        '2xl': 'var(--radius-2xl, 16px)',
        bubble: 'var(--cds-message-bubble-radius, 18px)',
        composer: 'var(--cds-radius-composer, 20px)',
        pill: 'var(--df-radius-pill, 999px)',
      },
      boxShadow: {
        sm: 'var(--cds-shadow-sm)',
        md: 'var(--cds-shadow-md)',
        lg: 'var(--cds-shadow-lg)',
        popover: 'var(--cds-shadow-popover)',
        composer: 'var(--cds-shadow-composer)',
        'composer-hover': 'var(--cds-shadow-composer-hover)',
        'composer-focus': 'var(--cds-shadow-composer-focus)',
        'focus-glow': 'var(--cds-focus-shadow)',
        'drop-glow': 'var(--cds-shadow-drop-glow)',
        panel: 'var(--cds-panel-shadow)',
        'panel-hover': 'var(--cds-panel-shadow-hover)',
        '2xs': '0 1px 1px 0 rgba(0,0,0,0.05)',
      },
      animation: {
        'quiet-dot': 'timeline-quiet-dot 1.9s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'message-fade-up': 'message-fade-up 0.45s cubic-bezier(0.34, 1.3, 0.64, 1)',
        'clay-breathe': 'dframe-clay-breathe 2.4s infinite ease-in-out',
        'dot-pulse': 'dframe-dot-pulse 1.2s infinite ease-in-out',
        'shimmer-sweep': 'cds-skeleton-sweep 1.8s infinite cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
