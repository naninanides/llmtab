import type { DatabaseSync } from "node:sqlite";
import { eachDay } from "../shared/time.js";
import type { Summary } from "../shared/types.js";

export interface Window {
  /** null = all time */
  fromMs: number | null;
  toMs: number;
}

const SELECT_TOTALS = `
  SELECT COALESCE(SUM(input_tokens),0) inputTokens,
         COALESCE(SUM(output_tokens),0) outputTokens,
         COALESCE(SUM(cache_read_tokens),0) cacheReadTokens,
         COALESCE(SUM(cache_write_tokens),0) cacheWriteTokens,
         COALESCE(SUM(reasoning_tokens),0) reasoningTokens,
         COALESCE(SUM(cost_usd),0) costUsd,
         COUNT(*) records,
         COUNT(DISTINCT session_id) conversations
  FROM usage_records
`;

function where(w: Window): string {
  if (w.fromMs === null) return "WHERE occurred_at <= ?";
  return "WHERE occurred_at >= ? AND occurred_at < ?";
}

function params(w: Window): Array<string> {
  const fromIso = new Date(w.fromMs ?? 0).toISOString();
  const toIso = new Date(w.toMs).toISOString();
  return w.fromMs === null ? [toIso] : [fromIso, toIso];
}

export function getSummary(db: DatabaseSync, w: Window): Summary {
  const r = db.prepare(`${SELECT_TOTALS} ${where(w)}`).get(...params(w)) as unknown as {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    costUsd: number;
    records: number;
    conversations: number;
  };
  return {
    ...r,
    totalTokens: r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens,
    unpriced: false,
  };
}

/** Models breakdown within a window. */
export function getModels(
  db: DatabaseSync,
  w: Window,
): Array<{
  model: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}> {
  return db
    .prepare(
      `SELECT model,
              SUM(input_tokens)+SUM(output_tokens)+SUM(cache_read_tokens)+SUM(cache_write_tokens) totalTokens,
              SUM(input_tokens) inputTokens, SUM(output_tokens) outputTokens,
              SUM(cache_read_tokens) cacheReadTokens, SUM(cache_write_tokens) cacheWriteTokens,
              SUM(cost_usd) costUsd
       FROM usage_records ${where(w)}
       GROUP BY model ORDER BY totalTokens DESC`,
    )
    .all(...params(w)) as never;
}

export function getTools(
  db: DatabaseSync,
  w: Window,
): Array<{ tool: string; totalTokens: number; costUsd: number }> {
  return db
    .prepare(
      `SELECT tool, SUM(input_tokens)+SUM(output_tokens)+SUM(cache_read_tokens)+SUM(cache_write_tokens) totalTokens,
              SUM(cost_usd) costUsd
       FROM usage_records ${where(w)} GROUP BY tool ORDER BY totalTokens DESC`,
    )
    .all(...params(w)) as never;
}

export function getProjects(
  db: DatabaseSync,
  w: Window,
): Array<{ project: string; totalTokens: number; costUsd: number }> {
  return db
    .prepare(
      `SELECT COALESCE(project,'(unknown)') project,
              SUM(input_tokens)+SUM(output_tokens)+SUM(cache_read_tokens)+SUM(cache_write_tokens) totalTokens,
              SUM(cost_usd) costUsd
       FROM usage_records ${where(w)} GROUP BY COALESCE(project,'(unknown)') ORDER BY totalTokens DESC LIMIT 20`,
    )
    .all(...params(w)) as never;
}

export interface DayRow {
  day: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  conversations: number;
}

const DAY_EXPR = "substr(occurred_at, 1, 10)";

/** Daily rollups over the requested window (UTC days). */
export function getDaily(db: DatabaseSync, w: Window): DayRow[] {
  return db
    .prepare(
      `SELECT ${DAY_EXPR} day,
              SUM(input_tokens) inputTokens, SUM(output_tokens) outputTokens,
              SUM(cache_read_tokens) cacheReadTokens, SUM(cache_write_tokens) cacheWriteTokens,
              SUM(reasoning_tokens) reasoningTokens,
              SUM(input_tokens)+SUM(output_tokens)+SUM(cache_read_tokens)+SUM(cache_write_tokens) totalTokens,
              SUM(cost_usd) costUsd,
              COUNT(DISTINCT session_id) conversations
       FROM usage_records ${where(w)}
       GROUP BY ${DAY_EXPR} ORDER BY day DESC`,
    )
    .all(...params(w)) as never;
}

/** GitHub-style heatmap data: per-day totals for the trailing `months`. */
export function getHeatmap(
  db: DatabaseSync,
  months: number,
): Array<{ day: string; totalTokens: number }> {
  const toMs = Date.now();
  const fromMs = toMs - months * 30 * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT ${DAY_EXPR} day, SUM(input_tokens)+SUM(output_tokens)+SUM(cache_read_tokens)+SUM(cache_write_tokens) totalTokens
       FROM usage_records WHERE occurred_at >= ? AND occurred_at <= ? GROUP BY ${DAY_EXPR}`,
    )
    .all(new Date(fromMs).toISOString(), new Date(toMs).toISOString()) as unknown as Array<{
    day: string;
    totalTokens: number;
  }>;

  // fill gaps so the grid has continuous days
  const byDay = new Map(rows.map((r) => [r.day, r.totalTokens]));
  return eachDay(fromMs, toMs).map((ms) => {
    const day = new Date(ms).toISOString().slice(0, 10);
    return { day, totalTokens: byDay.get(day) ?? 0 };
  });
}

/**
 * Models active in a window that have no pricing row (for the unpriced badge).
 * Local models (all records from `ollama`) are excluded — they get a "local"
 * badge instead, never "unpriced" (PRD FR-17).
 */
export function getUnpricedModels(db: DatabaseSync, w: Window): string[] {
  // The two per-model tests ("has any non-ollama record", "has any priced
  // record") ask about a model across all time, not within the window. Written
  // as correlated EXISTS they re-scanned the whole table once per candidate
  // row, which made /api/summary cost seconds and grow with the range. Grouping
  // the same facts once and joining is equivalent and runs in a single pass.
  return (
    db
      .prepare(
        `WITH win AS (
           SELECT DISTINCT model FROM usage_records WHERE ${where(w).slice(5)}
         ),
         facts AS (
           SELECT model,
                  SUM(CASE WHEN tool <> 'ollama' THEN 1 ELSE 0 END) nonOllama,
                  SUM(CASE WHEN cost_usd > 0 THEN 1 ELSE 0 END) priced
           FROM usage_records
           WHERE model IN (SELECT model FROM win)
           GROUP BY model
         )
         SELECT w.model FROM win w
         JOIN facts f ON f.model = w.model
         WHERE f.nonOllama > 0
           AND f.priced = 0
           AND NOT EXISTS (SELECT 1 FROM pricing p WHERE p.model IN (w.model, lower(w.model)))`,
      )
      .all(...params(w)) as unknown as Array<{ model: string }>
  ).map((r) => r.model);
}

/** Models active in a window whose records come exclusively from local runtimes (FR-17). */
export function getLocalModels(db: DatabaseSync, w: Window): string[] {
  return (
    db
      .prepare(
        `SELECT model, COUNT(*) AS totalRows, SUM(CASE WHEN tool = 'ollama' THEN 1 ELSE 0 END) AS ollamaRows
         FROM usage_records r
         WHERE ${where(w).slice(5)}
         GROUP BY model HAVING ollamaRows = totalRows`,
      )
      .all(...params(w)) as unknown as Array<{ model: string }>
  ).map((r) => r.model);
}
