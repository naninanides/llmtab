import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OpencodeRow } from "./parsers/opencode.js";

/**
 * Read-only access to the OpenCode SQLite DB (`~/.local/share/opencode/opencode.db`)
 * with WAL-copy fallback when locked by a running instance — same mechanism as
 * ZCode (PRD §7 ingestion rule 5). Only usage metadata is selected; message
 * *content* lives in the `part` table which we never open.
 */

const SELECT_ROWS = `
  SELECT id, session_id, time_created, data
  FROM message
  WHERE time_created >= ? AND time_created < ?
  ORDER BY time_created, id
`;

export function openOpencodeDb(dbFile: string): DatabaseSync {
  try {
    return new DatabaseSync(dbFile, { readOnly: true });
  } catch {
    // locked or WAL-recovery needed → snapshot copy
    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "llmtab-opencode-")),
      "opencode.db",
    );
    for (const suffix of ["", "-wal", "-shm"]) {
      const src = dbFile + suffix;
      if (fs.existsSync(src)) fs.copyFileSync(src, tmp + suffix);
    }
    return new DatabaseSync(tmp, { readOnly: true });
  }
}

export interface RawOpencodeRow {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
}

/** Fetches assistant-message rows since `sinceMs`; parses the JSON data blob defensively. */
export function fetchOpencodeUsage(
  dbFile: string,
  sinceMs: number,
  untilMs: number,
): OpencodeRow[] {
  const db = openOpencodeDb(dbFile);
  try {
    const raw = db.prepare(SELECT_ROWS).all(sinceMs, untilMs) as unknown as RawOpencodeRow[];
    const rows: OpencodeRow[] = [];
    for (const r of raw) {
      const parsed = parseMessageData(r.data);
      // user messages (and anything without tokens) are not usage rows
      if (!parsed || parsed.role !== "assistant" || !parsed.tokens) continue;
      rows.push({
        id: r.id,
        session_id: r.session_id,
        time_created: r.time_created,
        role: parsed.role,
        modelID: typeof parsed.modelID === "string" ? parsed.modelID : null,
        providerID: typeof parsed.providerID === "string" ? parsed.providerID : null,
        cwd: cwdOf(parsed),
        tokens: normalizeTokens(parsed.tokens),
      });
    }
    return rows;
  } finally {
    db.close();
  }
}

interface ParsedMessageData {
  role?: unknown;
  modelID?: unknown;
  providerID?: unknown;
  path?: unknown;
  tokens?: unknown;
}

function parseMessageData(data: string): ParsedMessageData | null {
  try {
    const v = JSON.parse(data) as unknown;
    return v && typeof v === "object" ? (v as ParsedMessageData) : null;
  } catch {
    return null;
  }
}

function cwdOf(m: ParsedMessageData): string | null {
  const p = m.path;
  if (
    p &&
    typeof p === "object" &&
    "cwd" in p &&
    typeof (p as { cwd?: unknown }).cwd === "string"
  ) {
    return (p as { cwd: string }).cwd || null;
  }
  return null;
}

interface TokenShape {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

function normalizeTokens(t: unknown): TokenShape {
  const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
  const cache = (o.cache && typeof o.cache === "object" ? o.cache : {}) as Record<string, unknown>;
  return {
    input: num(o.input),
    output: num(o.output),
    reasoning: num(o.reasoning),
    cacheRead: num(cache.read),
    cacheWrite: num(cache.write),
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}
