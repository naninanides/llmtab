/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Vitrine tokens ──
        void: "var(--void)",
        "mat-thin": "var(--mat-thin)",
        "mat-reg": "var(--mat-reg)",
        "mat-thick": "var(--mat-thick)",
        "mat-hud": "var(--mat-hud)",
        edge: "var(--edge)",
        "edge-hi": "var(--edge-hi)",
        "edge-lo": "var(--edge-lo)",
        "text-1": "var(--text-1)",
        "text-2": "var(--text-2)",
        "text-3": "var(--text-3)",
        accent: "var(--accent)",
        "accent-2": "var(--accent-2)",
        danger: "var(--danger)",
        warn: "var(--warn)",
        // token-type series — fixed mapping, never shuffled
        "c-input": "var(--c-input)",
        "c-output": "var(--c-output)",
        "c-cacheread": "var(--c-cacheread)",
        "c-cachewrite": "var(--c-cachewrite)",
        "c-reasoning": "var(--c-reasoning)",
        // quota thresholds — mirror barColor() in quota.ts
        "q-cool": "var(--q-cool)",
        "q-warn": "var(--q-warn)",
        "q-crit": "var(--q-crit)",

        // ── Legacy aliases — remapped to Vitrine values so components still
        //    compile while they are migrated one at a time. ──
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
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
        sans: [
          "Inter",
          "-apple-system",
          "SF Pro Text",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      borderRadius: {
        panel: "16px",
        card: "12px",
        control: "9px",
      },
      boxShadow: {
        lift: "var(--lift)",
      },
      maxWidth: {
        page: "1280px",
      },
    },
  },
  plugins: [],
};
