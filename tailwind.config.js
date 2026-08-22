/** @type {import('tailwindcss').Config} */

// Tokens live in index.css as RGB channels so `<alpha-value>` works here and
// every opacity modifier in the app keeps functioning across both themes.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Fira Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Fira Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        shell:    token('shell'),
        panel:    token('panel'),
        'panel-2': token('panel-2'),
        raised:   token('raised'),
        sunken:   token('sunken'),
        line:     token('line'),
        'line-soft': token('line-soft'),
        surface:  token('surface'),

        fg:       token('fg'),
        'fg-2':   token('fg-2'),
        'fg-3':   token('fg-3'),
        'fg-dim': token('fg-dim'),

        accent: {
          DEFAULT: token('accent'),
          ink:     token('accent-ink'),
          strong:  token('accent-strong'),
        },

        ok:   token('ok'),
        warn: token('warn'),
        crit: token('crit'),
      },
      boxShadow: {
        sheet: 'var(--sheet-shadow)',
      },
      // Tints used for selected/active grounds. 12/15/35 are not on Tailwind's
      // default opacity scale, and `@apply` cannot fall back to an arbitrary
      // value the way a class attribute can — the build fails outright.
      opacity: {
        12: '0.12',
        15: '0.15',
        35: '0.35',
        45: '0.45',
      },
      // Only `fade-in` survives the docked shell: `slide-in-left` belonged to
      // the two panels that used to fly in over the canvas, `toast-in` to the
      // floating processing overlay the status bar replaced, and `toast-out`
      // was already unreferenced before that.
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
