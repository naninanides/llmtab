import type { ToolId, UsageRecord } from "../../shared/types.js";

export interface ParseContext {
  tool: ToolId;
  /** project path derived by the scanner (e.g. from directory layout) */
  project?: string | null;
  /** session id derived by the scanner (e.g. parent dir name) */
  sessionId?: string | null;
}

/**
 * StyleGuide §9: parsers are pure functions — no I/O inside.
 * Malformed lines never throw (PRD FR-8); they're skipped and counted.
 */
export type ParseOutcome =
  | {
      ok: true;
      records: UsageRecord[];
      linesRead: number;
      linesSkipped: number;
    }
  | { ok: false; reason: string };

export interface Parser {
  readonly tool: ToolId;
  parse(content: string, ctx: ParseContext): ParseOutcome;
}
