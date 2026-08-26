import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ZcodeRow } from "./parsers/zcode.js";

/**
 * Read-only access to the ZCode DB with WAL-copy fallback when the live
 * database is locked by a running instance (PLANING §11).
 */

const SELECT_ROWS = `
  SELECT id, session_id, model_id, provider_id, status, started_at,
         input_tokens, output_tokens, reasoning_tokens,
         cache_creation_input_tokens, cache_read_input_tokens
  FROM model_usage
  WHERE started_at >= ? AND started_at < ?
`;

const SELECT_PROJECTS = `SELECT id, directory FROM session`;

export function openZcodeDb(dbFile: string): DatabaseSync {
  try {
    return new DatabaseSync(dbFile, { readOnly: true });
  } catch {
    // locked or WAL-recovery needed → snapshot copy
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "llmtab-zcode-")), "db.sqlite");
    for (const suffix of ["", "-wal", "-shm"]) {
      const src = dbFile + suffix;
      if (fs.existsSync(src)) fs.copyFileSync(src, tmp + suffix);
    }
    return new DatabaseSync(tmp, { readOnly: true });
  }
}

/** Fetches native usage rows + project paths since `sinceMs`. */
export function fetchZcodeUsage(
  dbFile: string,
  sinceMs: number,
  untilMs: number,
): { rows: ZcodeRow[]; projects: Map<string, string> } {
  const db = openZcodeDb(dbFile);
  try {
    const rows = db.prepare(SELECT_ROWS).all(sinceMs, untilMs) as unknown as ZcodeRow[];
    const projects = new Map<string, string>();
    for (const s of db.prepare(SELECT_PROJECTS).all() as unknown as Array<{ id: string; directory: string | null }>) {
      if (s.directory) projects.set(s.id, s.directory);
    }
    return { rows, projects };
  } finally {
    db.close();
  }
}
