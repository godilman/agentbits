/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Cascadia Code', 'Consolas', 'monospace'],
        pixel: ['"Press Start 2P"', '"JetBrains Mono"', 'monospace']
      },
      colors: {
        canvas: '#09090b',
        // Lighter than Tailwind's #71717a, which is below 4.5:1 for small text on every panel background here (3.4–4.1);
        // this one is ≥ 4.8:1 on surface-3 and still a step below zinc-400.
        zinc: { 500: '#8b8b93' },
        surface: { DEFAULT: '#111113', 2: '#18181b', 3: '#1f1f23' },
        line: { DEFAULT: '#27272a', soft: '#1f1f23' },
        accent: { DEFAULT: '#6366f1', soft: '#818cf8', muted: '#312e81' }
      },
      boxShadow: {
        pop: '0 8px 30px -6px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)'
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } }
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'slide-in': 'slide-in .22s cubic-bezier(.2,.8,.2,1)',
        shimmer: 'shimmer 2.2s linear infinite'
      }
    }
  },
  plugins: []
}
