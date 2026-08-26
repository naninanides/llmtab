/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
        "text-1": "var(--text-1)",
        "text-2": "var(--text-2)",
        accent: "var(--accent)",
        danger: "var(--danger)",
      },
      borderRadius: {
        card: "12px",
        control: "8px",
      },
      maxWidth: {
        page: "1280px",
      },
    },
  },
  plugins: [],
};
