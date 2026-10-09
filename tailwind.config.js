/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './app/**/*.{vue,js,ts,jsx,tsx}',
    './components/**/*.{vue,js,ts,jsx,tsx}',
    './layouts/**/*.{vue,js,ts,jsx,tsx}',
    './pages/**/*.{vue,js,ts,jsx,tsx}',
    './plugins/**/*.{vue,js,ts}',
    './app.vue',
  ],
  theme: {
    extend: {
      colors: {
        'theme-app': 'var(--color-bg-app)',
        'theme-header': 'var(--color-bg-header)',
        'theme-card': 'var(--color-bg-card)',
        'theme-pane': 'var(--color-bg-pane)',
        'theme-hover': 'var(--color-bg-hover)',
        'theme-border': 'var(--color-border)',
        'theme-border-active': 'var(--color-border-active)',
        'theme-text': 'var(--color-text-main)',
        'theme-muted': 'var(--color-text-muted)',
        'theme-accent': 'var(--color-accent)',
        'theme-accent-hover': 'var(--color-accent-hover)',
        'theme-accent-secondary': 'var(--color-accent-secondary)',
      },
    },
  },
  plugins: [],
}


