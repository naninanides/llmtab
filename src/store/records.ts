import type { DatabaseSync } from "node:sqlite";
import type { UsageRecord } from "../shared/types.js";

/**
 * Idempotent insert keyed on dedup_key (PRIMARY KEY).
 *
 * A stored row is normally left alone, so re-syncing the same source adds
 * nothing. The one exception is a row whose counters are all zero: providers
 * that stream a response can persist the record before the token counts land
 * (OpenCode does), and a sync that reads it in that window used to freeze the
 * zeros permanently. Such a row is overwritten as soon as a sync sees real
 * counts for it, which also repairs rows an earlier version already zeroed.
 *
 * A second, narrower repair covers a row stored as model 'unknown' while its
 * token counts were fine — a parser that failed to read the model name. Only
 * that direction is allowed.
 *
 * Both guards are deliberately one-directional — real counts never downgrade to
 * zero and a real model name is never replaced with 'unknown' — so this stays
 * idempotent: syncing twice still reports zero additions the second time.
 *
 * Returns the number of newly added rows (repairs are not counted as adds).
 */
export function insertRecords(db: DatabaseSync, records: UsageRecord[]): number {
  const stmt = db.prepare(
    `INSERT INTO usage_records (
       dedup_key, tool, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens,
       cost_usd, occurred_at, project, session_id, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dedup_key) DO UPDATE SET
       model = excluded.model,
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       cache_read_tokens = excluded.cache_read_tokens,
       cache_write_tokens = excluded.cache_write_tokens,
       reasoning_tokens = excluded.reasoning_tokens,
       cost_usd = excluded.cost_usd,
       recorded_at = excluded.recorded_at
     WHERE (
         -- A row persisted before its token counts landed: fill them in once a
         -- sync sees real ones.
         usage_records.input_tokens = 0
         AND usage_records.output_tokens = 0
         AND usage_records.cache_read_tokens = 0
         AND usage_records.cache_write_tokens = 0
         AND usage_records.reasoning_tokens = 0
         AND (excluded.input_tokens + excluded.output_tokens + excluded.cache_read_tokens
              + excluded.cache_write_tokens + excluded.reasoning_tokens) > 0
       )
       OR (
         -- A row stored without a model name, which a parser bug could produce
         -- even though its tokens were correct. Naming it is safe; the reverse
         -- never happens, so a real name is never overwritten with 'unknown'.
         usage_records.model = 'unknown'
         AND excluded.model <> 'unknown'
       )`,
  );
  const exists = db.prepare("SELECT 1 FROM usage_records WHERE dedup_key = ?");
  let added = 0;
  const now = new Date().toISOString();
  for (const r of records) {
    // `changes` cannot tell an insert from a repair, and callers count adds to
    // report sync results, so ask before writing.
    const seen = exists.get(r.dedupKey) !== undefined;
    stmt.run(
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
    if (!seen) added += 1;
  }
  return added;
}
