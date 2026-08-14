/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 薄荷绿 + 暖橙 主题
        brand: {
          50: '#EAF8F0',
          100: '#C5EFD5',
          200: '#94DFB0',
          300: '#5FCE89',
          400: '#3FB87A',
          500: '#2A9D63',
          600: '#1F7D4E',
          700: '#155D3A',
        },
        sun: {
          DEFAULT: '#FFB347',
          500: '#E08A1E',
        },
        danger: {
          DEFAULT: '#D94545',
          500: '#B83232',
        },
        bg: '#F7FAF8',
        ink: {
          DEFAULT: '#1F2937',
          soft: '#6B7280',
          ghost: '#9CA3AF',
        },
      },
      fontFamily: {
        sans: [
          '"PingFang SC"',
          '"Microsoft YaHei UI"',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 4px 16px -4px rgba(42, 157, 99, 0.12)',
        soft: '0 2px 8px -2px rgba(0, 0, 0, 0.06)',
      },
    },
  },
  plugins: [],
}
