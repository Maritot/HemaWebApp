/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", "./public/**/*.html"],
  theme: {
    extend: {
      colors: {
        background: "#FDFBF7",
        surface: "#FFFFFF",
        primary: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706', // Core Hema Gold
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        textMain: "#1E293B",
        textMuted: "#64748B",
        borderLight: "#F1F5F9"
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(217, 119, 6, 0.08)',
      }
    },
  },
  plugins: [],
};
