import type { QuotaProvider, QuotaWindow } from "@/api";

// ── thresholds — single source of truth, mockup §3 / MD §5.1 ──
export function barColor(pct: number): string {
  if (pct >= 90) return "#ef4444";
  if (pct >= 75) return "#f59e0b";
  return "#38bdf8";
}

export type Tone = "cool" | "warm" | "crit";
export function toneFor(pct: number): Tone {
  if (pct >= 90) return "crit";
  if (pct >= 75) return "warm";
  return "cool";
}

// ── resetLabel ──
export function resetLabel(iso: string | null, short = false): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "resetting…";
  const m = Math.ceil(ms / 60000);
  let label: string;
  if (m < 60) label = `${m}m`;
  else {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h < 24) label = `${h}h${rm ? ` ${rm}m` : ""}`;
    else {
      const d = Math.floor(h / 24);
      label = `${d}d`;
    }
  }
  return short ? label : `resets in ${label}`;
}

// ── pct + meter ──
export function pctForWindow(w: QuotaWindow): number | null {
  if (w.format === "percent") return Math.max(0, Math.min(100, w.used));
  if (w.format === "dollars" && w.limit > 0) return Math.max(0, Math.min(100, (w.used / w.limit) * 100));
  return null;
}

export function shouldDrawMeter(w: QuotaWindow): boolean {
  return pctForWindow(w) !== null;
}

// ── formatting ──
export function formatWindowValue(w: QuotaWindow): string {
  if (w.format === "percent") {
    const pct = Math.round(Math.max(0, Math.min(100, w.used)));
    return `${pct}% used`;
  }
  if (w.format === "dollars") {
    const used = `$${w.used.toFixed(2)}`;
    if (w.limit > 0) return `${used} of $${w.limit.toFixed(0)}`;
    return used;
  }
  // count
  return `${w.used} used`;
}

// ── worst-window selector ──
export interface WorstWindow {
  provider: QuotaProvider;
  window: QuotaWindow;
  pct: number;
}

export function worstWindow(providers: QuotaProvider[]): WorstWindow | null {
  let best: WorstWindow | null = null;
  for (const p of providers) {
    if (p.status !== "ok") continue;
    for (const w of p.windows) {
      const pct = pctForWindow(w);
      if (pct === null) continue;
      if (!best || pct > best.pct) best = { provider: p, window: w, pct };
    }
  }
  return best;
}
