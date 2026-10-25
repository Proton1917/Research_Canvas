/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('./config/theme.cjs')],
  content: ['./index.html', './src/web/**/*.{ts,tsx}', './src/ui/**/*.{ts,tsx}', './src/research/**/*.{ts,tsx}'],
  corePlugins: { preflight: true },
};
