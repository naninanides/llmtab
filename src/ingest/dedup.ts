import type { UsageRecord } from "../shared/types.js";

/** Filters intra-batch duplicates by composite dedup key (DB upsert handles cross-batch). */
export function dedupeRecords(records: UsageRecord[]): UsageRecord[] {
  const seen = new Set<string>();
  const out: UsageRecord[] = [];
  for (const r of records) {
    if (seen.has(r.dedupKey)) continue;
    seen.add(r.dedupKey);
    out.push(r);
  }
  return out;
}
