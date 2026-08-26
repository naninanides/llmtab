import { dedupKey } from "../../shared/hash.js";
import type { UsageRecord } from "../../shared/types.js";
import type { ParseContext } from "./types.js";

/**
 * OpenCode — SQLite schema at `~/.local/share/opencode/opencode.db`
 * (verified against live DB, SQLite 3.51 writer). Assistant rows in the
 * `message` table carry a JSON `data` blob with token usage; the read itself
 * lives in `ingest/opencode-source.ts` (StyleGuide §9: parsers do no I/O).
 *
 * The `part` table (prompt/response content) is never opened — metadata only
 * per PRD §10. `message.id` is the natural dedup key (PRD §7 rule 3).
 */

export interface OpencodeRow {
  id: string;
  session_id: string;
  /** epoch ms */
  time_created: number;
  role: "assistant" | string;
  modelID: string | null;
  providerID: string | null;
  cwd: string | null;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
  costUsd: number;
}

/** Pure row → record mapping. */
export function mapOpencodeRows(rows: OpencodeRow[], ctx: ParseContext): UsageRecord[] {
  const records: UsageRecord[] = [];
  for (const r of rows) {
    if (r.role !== "assistant") continue;

    records.push({
      dedupKey: dedupKey(ctx.tool, r.session_id, r.id, new Date(r.time_created).toISOString()),
      tool: ctx.tool,
      model: r.modelID ?? "unknown",
      inputTokens: Math.max(0, r.tokens.input),
      outputTokens: Math.max(0, r.tokens.output),
      cacheReadTokens: Math.max(0, r.tokens.cacheRead),
      cacheWriteTokens: Math.max(0, r.tokens.cacheWrite),
      reasoningTokens: Math.max(0, r.tokens.reasoning),
      costUsd: typeof r.costUsd === "number" && Number.isFinite(r.costUsd) ? r.costUsd : 0,
      occurredAt: new Date(r.time_created).toISOString(),
      project: r.cwd,
      sessionId: r.session_id,
    });
  }
  return records;
}
