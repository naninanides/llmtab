import type { ToolId, UsageRecord } from "../../shared/types.js";

export interface ParseContext {
  tool: ToolId;
  /** project path derived by the scanner (e.g. from directory layout) */
  project?: string | null;
  /** session id derived by the scanner (e.g. parent dir name) */
  sessionId?: string | null;
  /**
   * Byte offset this content starts at within its source file. Incremental
   * syncs hand a parser only the bytes appended since the last run, so a
   * position within `content` is not unique across syncs; adding this makes
   * it absolute. Defaults to 0 for a whole-file parse.
   */
  startOffset?: number;
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
