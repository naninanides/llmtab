import { dedupKey } from "../../shared/hash.js";
import type { UsageRecord } from "../../shared/types.js";
import type { ParseContext } from "./types.js";

/**
 * ZCode — OpenCode-fork SQLite schema at `~/.zcode/cli/db/db.sqlite`.
 * Pure mapping of `model_usage` rows → records; the read itself lives in
 * `ingest/zcode-source.ts` (StyleGuide §9: parsers do no I/O).
 *
 * Native-turn filter (PRD §7.3): only completed Z.ai/GLM turns are counted,
 * so mirrored Claude/Codex sub-agent history is never double-counted.
 */

export interface ZcodeRow {
  id: string;
  session_id: string;
  model_id: string | null;
  provider_id: string | null;
  status: string;
  started_at: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export function isNativeZaiTurn(row: ZcodeRow): boolean {
  const model = (row.model_id ?? "").toUpperCase();
  const provider = (row.provider_id ?? "").toLowerCase();
  return model.startsWith("GLM") || provider.includes("zai");
}

/** Pure row → record mapping. */
export function mapZcodeRows(
  rows: ZcodeRow[],
  projects: Map<string, string>,
  ctx: ParseContext,
): UsageRecord[] {
  const records: UsageRecord[] = [];
  for (const r of rows) {
    if (!isNativeZaiTurn(r)) continue;
    if (r.status !== "completed") continue;

    records.push({
      dedupKey: dedupKey(ctx.tool, r.session_id, r.id, new Date(r.started_at).toISOString()),
      tool: ctx.tool,
      model: r.model_id ?? "unknown",
      inputTokens: Math.max(0, r.input_tokens),
      outputTokens: Math.max(0, r.output_tokens),
      cacheReadTokens: Math.max(0, r.cache_read_input_tokens),
      cacheWriteTokens: Math.max(0, r.cache_creation_input_tokens),
      reasoningTokens: Math.max(0, r.reasoning_tokens),
      costUsd: 0,
      occurredAt: new Date(r.started_at).toISOString(),
      project: projects.get(r.session_id) ?? null,
      sessionId: r.session_id,
    });
  }
  return records;
}
