/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx}",
    "./app/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    colors: {
      'primary': '#214451',
      'default': '#2E3538',
      'user': '#EAEBE9',
      'assistant': '#F5F5F2',
      'white': '#FCFBF9',
      'background': '#FCFBF9',
      'accent': '#D17B0F',
      'border': 'oklch(0.922 0 0)',
      'ring': 'oklch(0.708 0 0)',
      'foreground': 'oklch(0.145 0 0)',
    },
    extend: {},
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}

