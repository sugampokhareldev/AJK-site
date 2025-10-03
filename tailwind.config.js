/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./booking.html", 
    "./admin.html",
    "./src/**/*.{html,js}"
  ],
  theme: {
    extend: {
      fontFamily: {
        'poppins': ['Poppins', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

