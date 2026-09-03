import { dedupKey } from "../../shared/hash.js";
import type { UsageRecord } from "../../shared/types.js";
import type { ParseContext, ParseOutcome, Parser } from "./types.js";

/**
 * Codex CLI parser — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
 * Session metadata arrives in `session_meta` lines; usage in `token_count`
 * events. `last_token_usage` holds per-response deltas (never sum the
 * cumulative `total_token_usage`).
 */

interface CodexLine {
  timestamp?: unknown;
  type?: unknown;
  payload?: {
    type?: unknown;
    id?: unknown;
    request_id?: unknown;
    cwd?: unknown;
    /**
     * Model for the turn. Verified against Codex 0.153.0: this sits on
     * `turn_context`, not `session_meta` — the only model mention in
     * session_meta is inside the `base_instructions` prose, which is prompt
     * content and must never be read (PRD §10).
     */
    model?: unknown;
    info?: {
      last_token_usage?: Record<string, unknown>;
    };
  };
}

/** First argument that is a non-empty string, else null. */
function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

export const codexParser: Parser = {
  tool: "codex",
  parse(content: string, ctx: ParseContext): ParseOutcome {
    const records: UsageRecord[] = [];
    let linesRead = 0;
    let linesSkipped = 0;

    // session state carried across lines of one chunk
    let sessionId = "";
    let model = "unknown";
    let cwd: string | null = ctx.project ?? null;

    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (line === "") continue;
      linesRead++;

      let obj: unknown;
      try {
        obj = JSON.parse(line) as unknown;
      } catch {
        linesSkipped++;
        continue;
      }
      const cl = obj as CodexLine;
      if (cl.type !== "session_meta" && cl.type !== "event_msg" && cl.type !== "turn_context")
        continue;

      const p = cl.payload ?? {};
      const timestamp = typeof cl.timestamp === "string" ? cl.timestamp : "";

      if (cl.type === "session_meta") {
        // line-level type; payload carries id/cwd without its own type field
        if (typeof p.id === "string") sessionId = p.id;
        if (typeof p.cwd === "string" && !ctx.project) cwd = p.cwd;
        continue;
      }

      // `turn_context` names the model for the turns that follow it. The model
      // was previously never read at all, so every Codex record was stored as
      // "unknown" and showed in the dashboard as a nameless row.
      if (cl.type === "turn_context") {
        const named = firstString(p.model);
        if (named !== null) model = named;
        if (typeof p.cwd === "string" && !ctx.project) cwd = p.cwd;
        continue;
      }

      if (p.type !== "token_count" || !sessionId) continue;
      const last = p.info?.last_token_usage;
      if (!last) continue;

      const total = num(last.total_tokens);
      if (total === 0) continue; // empty updates carry no usage

      const inputTokens = num(last.input_tokens);
      const cached = num(last.cached_input_tokens);
      const output = num(last.output_tokens);
      const reasoning = num(last.reasoning_output_tokens);

      const reqId =
        typeof p.request_id === "string" ? p.request_id : typeof p.id === "string" ? p.id : "";
      records.push({
        dedupKey: dedupKey(
          ctx.tool,
          sessionId,
          reqId || String(linesRead),
          timestamp || String(linesRead),
        ),
        tool: ctx.tool,
        model,
        inputTokens: inputTokens - cached,
        outputTokens: output,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        reasoningTokens: reasoning,
        costUsd: 0,
        occurredAt: timestamp,
        project: cwd,
        sessionId,
      });
    }

    return { ok: true, records, linesRead, linesSkipped };
  },
};
