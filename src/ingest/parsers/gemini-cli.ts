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
    // Byte position of the current line within the source file. An incremental
    // sync passes only the bytes appended since the last run, so a counter of
    // "identical turns seen so far" restarts each sync and re-keys turns that
    // are already stored — they then collide on insert and are dropped. The
    // absolute offset does not restart, so it identifies a turn for the life of
    // the file.
    const base = ctx.startOffset ?? 0;
    let cursor = 0;

    for (const rawLine of content.split("\n")) {
      const lineOffset = base + cursor;
      cursor += rawLine.length + 1; // +1 for the newline split() removed
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

      // Gemini chunks carry no message id, so identity is the line's absolute
      // byte offset in the file. That is stable across syncs and unaffected by
      // whether an earlier line was rewritten, which the two previous schemes
      // were not: `records.length` shifted when a line was prepended, and a
      // per-call occurrence counter restarted on every incremental sync.
      const identity = `@${lineOffset}`;

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
