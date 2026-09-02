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
        // Phosphor tokens
        ground: "var(--ground)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        rail: "var(--rail)",
        lit: "var(--lit)",
        shade: "var(--shade)",
        amber: "var(--amber)",
        "amber-dim": "var(--amber-dim)",
        cyan: "var(--cyan)",
        alert: "var(--alert)",
        bone: "var(--bone)",
        muted: "var(--muted)",
      },
      fontFamily: {
        silkscreen: ["Silkscreen", "monospace"],
        vt323: ["VT323", "monospace"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
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
