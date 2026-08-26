import type { Range } from "./types.js";

/** 30-minute bucket size in milliseconds. */
export const BUCKET_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Floors an epoch-ms timestamp to the start of its 30-minute UTC bucket.
 */
export function bucketStart(tsMs: number): number {
  return Math.floor(tsMs / BUCKET_MS) * BUCKET_MS;
}

export function bucketStartIso(iso: string): string {
  return new Date(bucketStart(Date.parse(iso))).toISOString();
}

/**
 * Parses `today|7d|30d|all|from,to` into a concrete [fromMs, toMs) window.
 * Buckets are computed in UTC; `today` means the current UTC day.
 * Returns null when the string is not a valid range.
 */
export function parseRange(
  input: string,
  now: number = Date.now(),
): { fromMs: number | null; toMs: number } | null {
  const trimmed = input.trim();

  if (trimmed === "all") return { fromMs: null, toMs: now };
  if (trimmed === "today") {
    const d = new Date(now);
    const startUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return { fromMs: startUtc, toMs: now };
  }
  if (trimmed === "7d") return { fromMs: now - 7 * DAY_MS, toMs: now };
  if (trimmed === "30d") return { fromMs: now - 30 * DAY_MS, toMs: now };

  // custom: "from,to" (ISO dates)
  const parts = trimmed.split(",");
  if (parts.length !== 2) return null;
  const [fromStr, toStr] = parts.map((p) => p.trim());
  const fromMs = Date.parse(fromStr ?? "");
  let toMs = Date.parse(toStr ?? "");
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;
  // treat a bare date (YYYY-MM-DD) as end-of-day
  if (/^\d{4}-\d{2}-\d{2}$/.test(toStr ?? "")) toMs += DAY_MS - 1;
  if (toMs < fromMs) return null;
  return { fromMs, toMs };
}

/** Normalizes a parsed range string into the typed Range union. */
export function toRange(input: string): Range | null {
  const t = input.trim();
  if (t === "today" || t === "7d" || t === "30d" || t === "all") return { kind: t };
  const r = parseRange(t);
  if (r && r.fromMs !== null && r.toMs !== null) {
    return { kind: "custom", from: new Date(r.fromMs).toISOString(), to: new Date(r.toMs).toISOString() };
  }
  return null;
}

/**
 * Expands a range into the list of daily UTC day-starts it covers,
 * inclusive. Used by /api/daily and the heatmap.
 */
export function eachDay(fromMs: number | null, toMs: number): number[] {
  if (fromMs === null) return [];
  const days: number[] = [];
  const d = new Date(fromMs);
  d.setUTCHours(0, 0, 0, 0);
  for (let t = d.getTime(); t <= toMs; t += DAY_MS) {
    days.push(t);
  }
  return days;
}
