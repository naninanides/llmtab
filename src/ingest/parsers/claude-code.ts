import { dedupKey } from "../../shared/hash.js";
import type { UsageRecord } from "../../shared/types.js";
import type { ParseContext, ParseOutcome, Parser } from "./types.js";

/**
 * Claude Code parser — reads `~/.claude/projects/<project>/*.jsonl`.
 * Extracts metadata only (PRD §10): model, timestamps, token counters, ids.
 * Assistant messages carry a `usage` block:
 *   { input_tokens, output_tokens,
 *     cache_creation_input_tokens, cache_read_input_tokens }
 */

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeAssistantLine {
  type?: unknown;
  sessionId?: unknown;
  requestId?: unknown;
  timestamp?: unknown;
  message?: {
    id?: unknown;
    model?: unknown;
    usage?: ClaudeUsage;
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

export const claudeCodeParser: Parser = {
  tool: "claude-code",
  parse(content: string, ctx: ParseContext): ParseOutcome {
    const records: UsageRecord[] = [];
    let linesRead = 0;
    let linesSkipped = 0;

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
      const cl = obj as ClaudeAssistantLine;

      // non-assistant lines (user/summary/progress) are expected — ignore quietly
      if (cl.type !== "assistant") continue;
      if (!cl.message || typeof cl.message !== "object" || !cl.message.usage) {
        linesSkipped++;
        continue;
      }
      // synthetic placeholder messages carry no real usage
      if (cl.message.model === "<synthetic>") continue;

      const sessionId = typeof cl.sessionId === "string" ? cl.sessionId : "";
      const messageId =
        typeof cl.message.id === "string"
          ? cl.message.id
          : typeof cl.requestId === "string"
            ? cl.requestId
            : "";
      const timestamp = typeof cl.timestamp === "string" ? cl.timestamp : "";
      if (!sessionId || !timestamp || (!messageId && !cl.requestId)) {
        linesSkipped++;
        continue;
      }

      const u = cl.message.usage ?? {};
      const record: UsageRecord = {
        dedupKey: dedupKey(ctx.tool, sessionId, messageId, timestamp),
        tool: ctx.tool,
        model: typeof cl.message.model === "string" ? cl.message.model : "unknown",
        inputTokens: num(u.input_tokens),
        outputTokens: num(u.output_tokens),
        cacheReadTokens: num(u.cache_read_input_tokens),
        cacheWriteTokens: num(u.cache_creation_input_tokens),
        reasoningTokens: 0, // included in output by Claude logs
        costUsd: 0, // filled by cost engine (M3)
        occurredAt: timestamp,
        project: ctx.project ?? null,
        sessionId,
      };
      records.push(record);
    }

    return { ok: true, records, linesRead, linesSkipped };
  },
};

/** Decodes the encoded project dir name (`-Users-foo-bar`) to a best-effort path. */
export function decodeClaudeProjectDir(dirName: string): string | null {
  if (!dirName.startsWith("-")) return null;
  return "/" + dirName.slice(1).replaceAll("-", "/");
}
