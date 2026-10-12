/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '.comia-dark'],
  theme: {
    extend: {
      colors: {
        workspace: 'var(--comia-workspace)',
        panel: 'var(--comia-panel)',
        'panel-border': 'var(--comia-panel-border)',
        'ink': 'var(--comia-ink)',
        'ink-dim': 'var(--comia-ink-dim)',
        accent: 'var(--comia-accent)',
        'accent-soft': 'var(--comia-accent-soft)',
        paper: 'var(--comia-paper)',
      },
    },
  },
  plugins: [],
};
