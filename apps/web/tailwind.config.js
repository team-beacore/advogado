/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        tightest: '-0.03em',
      },
      colors: {
        // Neutros elegantes (grafite / carvão / off-white)
        gray: {
          50: '#f7f8fa',
          100: '#eef1f5',
          200: '#e0e5ec',
          300: '#c7cfda',
          400: '#98a3b3',
          500: '#6d7888',
          600: '#4e5866',
          700: '#39424f',
          800: '#252c37',
          900: '#151a21',
          950: '#0d1116',
        },
        // Azul-marinho / petróleo institucional
        brand: {
          50: '#eff4f9',
          100: '#dce6f1',
          200: '#b7cbe1',
          300: '#88a9c9',
          400: '#5482a9',
          500: '#2f5f8a',
          600: '#1f486e',
          700: '#193a58',
          800: '#142e46',
          900: '#102435',
          950: '#0a1723',
        },
        // Verde escuro sofisticado (apoio institucional)
        petrol: {
          50: '#eef5f3',
          100: '#d8e8e3',
          500: '#1f6b5b',
          600: '#175647',
          700: '#124338',
        },
        // Dourado/champagne — apenas detalhe
        gold: {
          50: '#fbf8f0',
          100: '#f4ecd8',
          200: '#e8dab5',
          300: '#d8c188',
          400: '#c5a75f',
          500: '#ac8c44',
          600: '#8c7035',
        },
        success: { 50: '#eff7f2', 100: '#dbeee3', 600: '#1c7a4f', 700: '#14603d' },
        danger: { 50: '#fdf2f2', 100: '#fadfdf', 600: '#b4352f', 700: '#8f2925' },
        warning: { 50: '#fdf7ec', 100: '#f8ead0', 600: '#9a6b12', 700: '#7c550d' },
        info: { 50: '#eff4fa', 100: '#dbe7f4', 600: '#2a5f96', 700: '#204a75' },
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 36, 53, 0.04), 0 1px 3px rgba(16, 36, 53, 0.06)',
        elevated: '0 10px 30px -12px rgba(16, 36, 53, 0.25), 0 2px 6px rgba(16, 36, 53, 0.06)',
        focus: '0 0 0 3px rgba(31, 72, 110, 0.15)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.98)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
