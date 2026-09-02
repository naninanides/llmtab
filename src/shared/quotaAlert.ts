import type { QuotaProviderSnapshot, QuotaWindow } from "../quota/types.js";

export function pctForWindow(w: QuotaWindow): number | null {
  if (w.format === "percent") return Math.max(0, Math.min(100, w.used));
  if (w.format === "dollars" && w.limit > 0) return Math.max(0, Math.min(100, (w.used / w.limit) * 100));
  return null;
}

export function resetLabelShort(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "resetting…";
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h${rm ? ` ${rm}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export interface WorstWindow {
  provider: QuotaProviderSnapshot;
  window: QuotaWindow;
  pct: number;
}

export function worstWindow(providers: QuotaProviderSnapshot[]): WorstWindow | null {
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
