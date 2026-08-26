/**
 * Model→price matching (PRD FR-11 / TASK T3.3):
 * exact → normalized → alias → longest-prefix. Unmatched = unpriced ($0 + badge),
 * never a wrong number.
 */

export interface Rates {
  /** USD per million tokens */
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
}

export type PriceIndex = Map<string, Rates>;

/** Trims provider/region prefixes and date/variant suffixes for fuzzy matching. */
export function normalizeModelName(m: string): string {
  let s = m.toLowerCase().trim();
  // drop provider prefixes: "anthropic/", "azure_ai/FW-", "us.anthropic."
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  s = s.replace(/^(?:[a-z][a-z0-9_]*\.)+/, "");
  // strip variant/date suffixes: "-20250219", "@20251001", "-v1:0", ":0", "-251222"
  s = s.replace(/-?@?\d{8}(?=(-|$))/, "");
  s = s.replace(/-\d{6}(?=(-|$))/, "");
  s = s.replace(/-v1(:0)?$/, "");
  s = s.replace(/:0$/, "");
  return s;
}

function toRates(raw: {
  i: number | null;
  o: number | null;
  cr: number | null;
  cw: number | null;
}): Rates | null {
  if ((raw.i ?? null) === null && (raw.o ?? null) === null) return null;
  return {
    inputPerM: (raw.i ?? 0) * 1e6,
    outputPerM: (raw.o ?? 0) * 1e6,
    cacheReadPerM: (raw.cr ?? 0) * 1e6,
    cacheWritePerM: (raw.cw ?? raw.i ?? 0) * 1e6,
  };
}

/** Builds a search index from the trimmed LiteLLM snapshot shape. */
export function buildPriceIndex(
  prices: Record<string, { i: number | null; o: number | null; cr: number | null; cw: number | null }>,
): PriceIndex {
  const idx: PriceIndex = new Map();
  for (const [key, raw] of Object.entries(prices)) {
    const rates = toRates(raw);
    if (!rates) continue;
    idx.set(key.toLowerCase(), rates);
    idx.set(normalizeModelName(key), rates);
  }
  return idx;
}

export function findRates(idx: PriceIndex, model: string): Rates | null {
  const norm = normalizeModelName(model);
  // 1. exact / normalized
  const direct = idx.get(model.toLowerCase()) ?? idx.get(norm);
  if (direct) return direct;

  // 2. alias table (TASK T3.3)
  const alias = ALIASES[norm];
  if (alias) {
    const viaAlias = idx.get(alias) ?? idx.get(normalizeModelName(alias));
    if (viaAlias) return viaAlias;
  }

  // 3. longest prefix whose normalized form matches a word boundary of the model
  let best: Rates | null = null;
  let bestLen = 0;
  for (const [key, rates] of idx) {
    if (key.length <= bestLen) continue;
    if (norm.startsWith(key) && (norm.length === key.length || norm[key.length] === "-" || norm[key.length] === ".")) {
      best = rates;
      bestLen = key.length;
    }
  }
  return best;
}

/** Small curated alias list for names vendors report differently from LiteLLM keys. */
const ALIASES: Record<string, string> = {
  "claude-sonnet-4-5": "claude-sonnet-4-5",
  "gpt-5-codex": "gpt-5.1-codex",
};

/** Computes record cost from token counts and per-million rates. */
export function computeCost(
  r: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  rates: Rates,
): number {
  const cost =
    (r.inputTokens * rates.inputPerM +
      r.outputTokens * rates.outputPerM +
      r.cacheReadTokens * rates.cacheReadPerM +
      r.cacheWriteTokens * rates.cacheWritePerM) /
    1e6;
  return Math.round(cost * 1e10) / 1e10;
}
