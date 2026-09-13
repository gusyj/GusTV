/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./player.html", "./checker.html", "./src/**/*.js"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#0f1115",
        panel: "#171a21",
        border: "#262b36",
        ink: "#e8eaed",
        muted: "#9aa3b2",
        accent: "#5b8cff",
      },
    },
  },
  plugins: [],
};
