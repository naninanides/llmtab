import { dedupKey } from "../../shared/hash.js";
import type { UsageRecord } from "../../shared/types.js";
import type { ParseContext, ParseOutcome, Parser } from "./types.js";

/**
 * Gemini CLI parser — `~/.gemini/tmp/**\/chunks.jsonl`.
 * Messages carry `usageMetadata`: promptTokenCount / candidatesTokenCount /
 * thoughtsTokenCount / cachedContentTokenCount.
 */

interface GeminiLine {
  timestamp?: unknown;
  message?: {
    model?: unknown;
    usageMetadata?: {
      promptTokenCount?: unknown;
      candidatesTokenCount?: unknown;
      thoughtsTokenCount?: unknown;
      cachedContentTokenCount?: unknown;
    };
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

export const geminiCliParser: Parser = {
  tool: "gemini-cli",
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
      const gl = obj as GeminiLine;
      const u = gl.message?.usageMetadata;
      if (!u) continue;

      const prompt = num(u.promptTokenCount);
      const candidates = num(u.candidatesTokenCount);
      const thoughts = num(u.thoughtsTokenCount);
      const cached = num(u.cachedContentTokenCount);
      if (prompt + candidates + thoughts === 0) continue;

      // promptTokenCount already includes cached tokens — split them out
      const timestamp = typeof gl.timestamp === "string" ? gl.timestamp : new Date(0).toISOString();
      const sessionId = ctx.sessionId ?? "unknown";
      const model = typeof gl.message?.model === "string" ? gl.message.model : "gemini";

      records.push({
        dedupKey: dedupKey(ctx.tool, sessionId, String(records.length), timestamp),
        tool: ctx.tool,
        model,
        inputTokens: prompt - cached,
        outputTokens: candidates + thoughts,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        reasoningTokens: thoughts,
        costUsd: 0,
        occurredAt: timestamp,
        project: ctx.project ?? null,
        sessionId,
      });
    }

    return { ok: true, records, linesRead, linesSkipped };
  },
};
