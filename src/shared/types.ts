/**
 * Core domain types shared by ingestion, storage, cost engine, server and dashboard.
 * StyleGuide §8: prefer interfaces for object shapes; discriminated unions over flags.
 */

export const TOOL_IDS = ["claude-code", "codex", "gemini-cli", "zcode"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface UsageRecord {
  /** hash(tool, session_id, msg_id|req_id, ts) — idempotency key */
  dedupKey: string;
  tool: ToolId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** computed at insert; recomputed when pricing refreshes */
  costUsd: number | null;
  /** ISO-8601 UTC */
  occurredAt: string;
  project: string | null;
  sessionId: string;
}

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

/** Range accepted by every endpoint & CLI surface (PRD FR-13). */
export type Range =
  | { kind: "today" }
  | { kind: "7d" }
  | { kind: "30d" }
  | { kind: "all" }
  | { kind: "custom"; from: string; to: string };

export interface Summary extends TokenTotals {
  totalTokens: number;
  costUsd: number;
  unpriced: boolean;
  conversations: number;
  records: number;
}

export type DetectStatus = "active" | "not-found" | "skipped";

export interface Detection {
  tool: ToolId;
  status: DetectStatus;
  reason?: string;
}

export interface SyncReportEntry {
  tool: ToolId;
  filesScanned: number;
  recordsAdded: number;
  linesSkipped: number;
}

export interface SyncRun {
  startedAt: string;
  finishedAt: string;
  status: "ok" | "error";
  entries: SyncReportEntry[];
}
