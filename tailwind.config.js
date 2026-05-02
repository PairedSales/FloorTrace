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
        // Dracula color scheme: https://draculatheme.com/
        chrome: {
          900: '#21222C', // Dracula darker variant (sidebars / deepest panels)
          800: '#282A36', // Dracula Background
          700: '#44475A', // Dracula Current Line (borders / dividers)
          600: '#6272A4', // Dracula Comment (muted elements)
        },
        accent: {
          DEFAULT: '#BD93F9', // Dracula Purple
          hover: '#A97EF0',   // Slightly darker purple
          muted: 'rgba(189, 147, 249, 0.15)',
          glow: 'rgba(189, 147, 249, 0.3)',
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
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
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
