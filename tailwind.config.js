/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        nexus: {
          ink: '#0b1118',
          graphite: '#121a23',
          steel: '#1d2a3a',
          mist: '#d5e2f2',
          teal: '#4cc7b8',
          aqua: '#6be7d4',
          brass: '#d7b26d',
        },
      },
      fontFamily: {
        sans: ['var(--font-body)'],
        body: ['var(--font-body)'],
        heading: ['var(--font-display)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      boxShadow: {
        frame: '0 0 0 1px rgba(120, 145, 175, 0.35), 0 18px 38px rgba(4, 10, 22, 0.55)',
        glow: '0 0 0 2px rgba(107, 231, 212, 0.6), 0 0 24px rgba(76, 199, 184, 0.4)',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(220%)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 1px rgba(122, 196, 255, 0.35)' },
          '50%': { boxShadow: '0 0 0 1px rgba(132, 215, 255, 0.95), 0 0 24px rgba(100, 176, 255, 0.6)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.4s linear infinite',
        pulseGlow: 'pulseGlow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
