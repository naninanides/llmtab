import type { DatabaseSync } from "node:sqlite";
import type { UsageRecord } from "../shared/types.js";

/**
 * Idempotent insert: dedup_key is PRIMARY KEY → INSERT OR IGNORE.
 * Returns the number of newly added rows.
 */
export function insertRecords(db: DatabaseSync, records: UsageRecord[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO usage_records (
       dedup_key, tool, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens,
       cost_usd, occurred_at, project, session_id, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let added = 0;
  const now = new Date().toISOString();
  for (const r of records) {
    const res = stmt.run(
      r.dedupKey,
      r.tool,
      r.model,
      r.inputTokens,
      r.outputTokens,
      r.cacheReadTokens,
      r.cacheWriteTokens,
      r.reasoningTokens,
      r.costUsd ?? 0,
      r.occurredAt,
      r.project,
      r.sessionId,
      now,
    );
    added += Number(res.changes);
  }
  return added;
}
