import type { DatabaseSync } from "node:sqlite";
import { bucketStartIso } from "../shared/time.js";
import type { UsageRecord } from "../shared/types.js";

/**
 * Recomputes only the bucket rows touched by the given records
 * (derived data, always rebuildable from usage_records — PLANING §2 invariant).
 */
export function refreshBuckets(db: DatabaseSync, records: UsageRecord[]): void {
  if (records.length === 0) return;

  const keys = new Map<string, { start: string; end: string; tool: string; model: string; project: string }>();
  for (const r of records) {
    const start = bucketStartIso(r.occurredAt);
    const endMs = Date.parse(start) + 30 * 60 * 1000;
    const project = r.project ?? "";
    keys.set(`${start}\u0000${r.tool}\u0000${r.model}\u0000${project}`, {
      start,
      end: new Date(endMs).toISOString(),
      tool: r.tool,
      model: r.model,
      project,
    });
  }

  const del = db.prepare(
    "DELETE FROM usage_buckets WHERE bucket_start = ? AND tool = ? AND model = ? AND project = ?",
  );
  const ins = db.prepare(`
    INSERT INTO usage_buckets (
      bucket_start, tool, model, project,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      reasoning_tokens, cost_usd, records
    )
    SELECT ?, ?, ?, ?,
           COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
           COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(cache_write_tokens), 0),
           COALESCE(SUM(reasoning_tokens), 0), COALESCE(SUM(cost_usd), 0), COUNT(*)
    FROM usage_records
    WHERE tool = ? AND model = ? AND COALESCE(project, '') = ?
      AND occurred_at >= ? AND occurred_at < ?
  `);

  for (const k of keys.values()) {
    del.run(k.start, k.tool, k.model, k.project);
    ins.run(
      k.start,
      k.tool,
      k.model,
      k.project,
      k.tool,
      k.model,
      k.project,
      k.start,
      k.end,
    );
  }
}
