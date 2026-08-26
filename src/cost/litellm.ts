import fs from "node:fs";
import path from "node:path";
import { type DatabaseSync } from "node:sqlite";
import { llmtabHome } from "../shared/paths.js";
import {
  buildPriceIndex,
  computeCost,
  findRates,
  normalizeModelName,
  type PriceIndex,
} from "./match.js";
import { rebuildAllBuckets } from "../store/db.js";

const PRICE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface TrimmedPrice {
  i: number | null;
  o: number | null;
  cr: number | null;
  cw: number | null;
}
type PriceMap = Record<string, TrimmedPrice>;

function cachePath(): string {
  return path.join(llmtabHome(), "pricing-cache.json");
}

/**
 * Refresh flow (PRD FR-11): network fetch → 24 h disk cache → bundled
 * snapshot. `LLMTAB_OFFLINE=1` skips the network entirely.
 */
export async function refreshPricing(
  db: DatabaseSync,
): Promise<{ source: string; fetchedAt: string }> {
  const cached = readCache();
  const offline = process.env.LLMTAB_OFFLINE === "1";

  if (!offline && cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_MAX_AGE_MS) {
    upsertPricing(db, cached.prices, cached.fetchedAt);
    return { source: "cache", fetchedAt: cached.fetchedAt };
  }

  if (!offline) {
    try {
      const res = await fetch(PRICE_URL, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const raw = (await res.json()) as Record<string, Record<string, unknown>>;
        const prices = trimRaw(raw);
        const fetchedAt = new Date().toISOString();
        writeCache(prices, fetchedAt);
        upsertPricing(db, prices, fetchedAt);
        return { source: "network", fetchedAt };
      }
    } catch {
      // fall through to stale cache / bundled snapshot
    }
  }

  if (cached) {
    upsertPricing(db, cached.prices, cached.fetchedAt);
    return { source: "stale-cache", fetchedAt: cached.fetchedAt };
  }
  const fetchedAt = new Date(0).toISOString();
  upsertPricing(db, loadSnapshot(), fetchedAt);
  return { source: "bundled-snapshot", fetchedAt };
}

/** Bundled offline snapshot ships next to this module (src tree + dist copy). */
function loadSnapshot(): PriceMap {
  const url = new URL("./assets/pricing-snapshot.json", import.meta.url);
  return JSON.parse(fs.readFileSync(url, "utf8")) as PriceMap;
}

function trimRaw(raw: Record<string, Record<string, unknown>>): PriceMap {
  const out: PriceMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object") continue;
    const i = numOrNull(v.input_cost_per_token);
    const o = numOrNull(v.output_cost_per_token);
    if ((i ?? null) === null && (o ?? null) === null) continue;
    out[k] = {
      i,
      o,
      cr: numOrNull(v.cache_read_input_token_cost),
      cw: numOrNull(v.cache_creation_input_token_cost),
    };
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readCache(): { prices: PriceMap; fetchedAt: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as {
      fetched_at: string;
      prices: PriceMap;
    };
    if (raw.prices && typeof raw.fetched_at === "string") {
      return { prices: raw.prices, fetchedAt: raw.fetched_at };
    }
  } catch {
    // no cache yet
  }
  return null;
}

function writeCache(prices: PriceMap, fetchedAt: string): void {
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  fs.writeFileSync(cachePath(), JSON.stringify({ fetched_at: fetchedAt, prices }));
}

export function pricingCacheAgeMs(): number | null {
  const c = readCache();
  return c ? Date.now() - Date.parse(c.fetchedAt) : null;
}

/** Upserts normalized per-million rates into the pricing table. */
export function upsertPricing(db: DatabaseSync, prices: PriceMap, fetchedAt: string): void {
  const idx = buildPriceIndex(prices);
  const seen = new Set<string>();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO pricing (model, input_per_m, output_per_m, cache_read_per_m, cache_write_per_m, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [key, rates] of idx) {
    if (seen.has(key)) continue;
    seen.add(key);
    stmt.run(
      key,
      rates.inputPerM,
      rates.outputPerM,
      rates.cacheReadPerM,
      rates.cacheWritePerM,
      fetchedAt,
    );
  }
}

export interface ApplyPricingResult {
  pricedModels: string[];
  unpricedModels: string[];
  /** models used only by local runtimes (ollama) — $0 by design, FR-17 */
  localModels: string[];
}

interface RateRow {
  key: string;
  i: number;
  o: number;
  cr: number;
  cw: number;
}

/**
 * Backfills record costs from the pricing table and rebuilds all buckets
 * (TASK T3.4). Idempotent — safe to run after every sync.
 * Local models (all records from `ollama`) are priced $0 with a "local"
 * badge, never "unpriced" (PRD FR-17).
 */
export function applyPricing(db: DatabaseSync): ApplyPricingResult {
  const rows = db
    .prepare(
      "SELECT model AS key, input_per_m i, output_per_m o, cache_read_per_m cr, cache_write_per_m cw FROM pricing",
    )
    .all() as unknown as RateRow[];
  const idx: PriceIndex = new Map();
  for (const r of rows) {
    idx.set(r.key, { inputPerM: r.i, outputPerM: r.o, cacheReadPerM: r.cr, cacheWritePerM: r.cw });
  }

  const models = db
    .prepare(
      `SELECT model, SUM(CASE WHEN tool = 'ollama' THEN 1 ELSE 0 END) AS ollamaRows, COUNT(*) AS totalRows
       FROM usage_records GROUP BY model`,
    )
    .all() as unknown as Array<{ model: string; ollamaRows: number; totalRows: number }>;

  const priced: string[] = [];
  const unpriced: string[] = [];
  const local: string[] = [];

  for (const { model, ollamaRows, totalRows } of models) {
    if (ollamaRows === totalRows) {
      db.prepare("UPDATE usage_records SET cost_usd = 0 WHERE model = ?").run(model);
      local.push(model);
      continue;
    }
    const rates = findRates(idx, model);
    if (!rates) {
      unpriced.push(model);
      continue;
    }
    db.prepare(
      `UPDATE usage_records SET cost_usd = ROUND(
         (input_tokens * ? + output_tokens * ? + cache_read_tokens * ? + cache_write_tokens * ?) / 1000000.0, 10
       ) WHERE model = ?`,
    ).run(rates.inputPerM, rates.outputPerM, rates.cacheReadPerM, rates.cacheWritePerM, model);
    priced.push(model);
  }

  rebuildAllBuckets(db);
  return { pricedModels: priced, unpricedModels: unpriced, localModels: local };
}

export { computeCost, normalizeModelName };
