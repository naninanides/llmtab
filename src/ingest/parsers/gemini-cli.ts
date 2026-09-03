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
    // How many times an identical turn has already been seen in this file, so
    // two genuine repeats in the same second stay distinct without making the
    // key depend on position.
    const seen = new Map<string, number>();

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

      // Gemini chunks carry no message id, so identity is the turn's own
      // content plus how many identical turns preceded it. The previous key
      // used `records.length` — the ordinal among matched records — which
      // shifted whenever a line was prepended or an earlier line gained usage
      // between syncs, re-keying a turn already stored and counting it twice.
      const shape = `${model}:${prompt}:${candidates}:${thoughts}:${cached}`;
      const nth = seen.get(shape) ?? 0;
      seen.set(shape, nth + 1);
      const identity = nth === 0 ? shape : `${shape}#${nth}`;

      records.push({
        // Gemini chunks carry no message id, so identity is the turn's own
        // content: model plus the four counts, alongside session and timestamp.
        // The previous key used `records.length` — the ordinal among matched
        // records — which shifted whenever a line was prepended or an earlier
        // line gained usage between syncs, re-keying a turn already stored and
        // counting it twice.
        dedupKey: dedupKey(ctx.tool, sessionId, identity, timestamp),
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
