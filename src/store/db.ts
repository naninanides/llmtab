import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "../shared/paths.js";

const MIGRATIONS: string[] = [
  // v1 — PLANING §5
  `
  CREATE TABLE IF NOT EXISTS usage_records (
    dedup_key TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    occurred_at TEXT NOT NULL,
    project TEXT,
    session_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_records_occurred ON usage_records(occurred_at);

  CREATE TABLE IF NOT EXISTS usage_buckets (
    bucket_start TEXT NOT NULL,
    tool TEXT NOT NULL,
    model TEXT NOT NULL,
    project TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    records INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_start, tool, model, project)
  );

  CREATE TABLE IF NOT EXISTS pricing (
    model TEXT PRIMARY KEY,
    input_per_m REAL NOT NULL,
    output_per_m REAL NOT NULL,
    cache_read_per_m REAL NOT NULL DEFAULT 0,
    cache_write_per_m REAL NOT NULL DEFAULT 0,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scan_state (
    source_path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    byte_offset INTEGER NOT NULL,
    last_synced_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    status TEXT NOT NULL,
    records_added INTEGER NOT NULL DEFAULT 0,
    lines_skipped INTEGER NOT NULL DEFAULT 0,
    detail_json TEXT
  );
  `,
];

export function openDb(filePath: string = dbPath()): DatabaseSync {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL;");
  for (let v = 0; v < MIGRATIONS.length; v++) {
    db.exec(MIGRATIONS[v] ?? "");
  }
}

/** Drops & recreates all bucket rows from raw records (derived data). */
export function rebuildAllBuckets(db: DatabaseSync): void {
  db.exec("DELETE FROM usage_buckets;");
  db.exec(`
    INSERT INTO usage_buckets (
      bucket_start, tool, model, project,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      reasoning_tokens, cost_usd, records
    )
    SELECT
      strftime('%Y-%m-%dT%H:%M:%S.000Z', (CAST(strftime('%s', occurred_at) AS INTEGER) / 1800) * 1800, 'unixepoch'),
      tool, model, COALESCE(project, ''),
      SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens),
      SUM(cache_write_tokens), SUM(reasoning_tokens), SUM(cost_usd), COUNT(*)
    FROM usage_records
    GROUP BY 1, tool, model, COALESCE(project, '');
  `);
}
