/** @type {import('tailwindcss').Config} */
export default {
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
        chrome: {
          900: '#0F172A',
          800: '#1E293B',
          700: '#334155',
          600: '#475569',
        },
        accent: {
          DEFAULT: '#F97316',
          hover: '#EA580C',
          muted: 'rgba(249, 115, 22, 0.15)',
          glow: 'rgba(249, 115, 22, 0.3)',
        },
      },
      animation: {
        'toast-in': 'toastIn 0.3s ease-out',
        'toast-out': 'toastOut 0.3s ease-in forwards',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in-left': 'slideInLeft 0.2s ease-out',
      },
      keyframes: {
        toastIn: {
          '0%': { opacity: '0', transform: 'translateX(-50%) translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(-50%) translateY(0)' },
        },
        toastOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
}
