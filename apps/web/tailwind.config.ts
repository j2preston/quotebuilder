import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4f8',
          100: '#d9e5f0',
          200: '#b3cbdf',
          300: '#7da8c9',
          400: '#4e84b0',
          500: '#2E6DA4',
          600: '#265d8c',
          700: '#1E3A5F',
          800: '#182f4d',
          900: '#12253c',
        },
        success: '#16A34A',
        warning: '#D97706',
        danger:  '#DC2626',
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui',
          'sans-serif',
        ],
      },
      minHeight: { touch: '44px' },
    },
  },
  plugins: [],
} satisfies Config;
