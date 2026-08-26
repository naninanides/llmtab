import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface FileDelta {
  path: string;
  /** byte offset to start reading from */
  startOffset: number;
  /** byte offset of the last complete newline in [startOffset, size) */
  endOffset: number;
  isNew: boolean;
  /** file size + mtime at scan time, committed with the new offset */
  size: number;
  mtimeMs: number;
}

export interface ScanOutcome {
  deltas: FileDelta[];
  filesUnchanged: number;
}

/** Recursively lists files under root matching nameFilter. */
export function discoverFiles(root: string, nameFilter?: (name: string) => boolean): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dirs never break sync (PRD US10)
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && (!nameFilter || nameFilter(e.name))) out.push(full);
    }
  }
  return out.sort();
}

function getScanState(db: DatabaseSync, p: string): { size: number; mtime: number; byte_offset: number } | undefined {
  return db
    .prepare("SELECT size, mtime, byte_offset FROM scan_state WHERE source_path = ?")
    .get(p) as { size: number; mtime: number; byte_offset: number } | undefined;
}

/**
 * Incremental delta computation against scan_state:
 * unchanged (size+mtime) → skip; otherwise read only new bytes.
 * endOffset stops at the last complete newline so partial lines are re-read next time.
 */
export function computeDeltas(db: DatabaseSync, files: string[]): ScanOutcome {
  const deltas: FileDelta[] = [];
  let filesUnchanged = 0;
  for (const file of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const prev = getScanState(db, file);
    if (prev && prev.size === stat.size && prev.mtime === Math.floor(stat.mtimeMs)) {
      filesUnchanged++;
      continue;
    }
    const startOffset = prev ? Math.min(prev.byte_offset, stat.size) : 0;
    if (startOffset >= stat.size) {
      filesUnchanged++;
      continue;
    }
    const endOffset = lastNewlineBoundary(file, startOffset, stat.size);
    if (endOffset <= startOffset) {
      filesUnchanged++;
      continue; // no complete new line yet
    }
    deltas.push({ path: file, startOffset, endOffset, isNew: !prev, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
  }
  return { deltas, filesUnchanged };
}

function lastNewlineBoundary(file: string, start: number, size: number): number {
  const CHUNK = 64 * 1024;
  const fd = fs.openSync(file, "r");
  try {
    let pos = size;
    while (pos > start) {
      const len = Math.min(CHUNK, pos - start);
      const buf = Buffer.alloc(len);
      pos -= len;
      fs.readSync(fd, buf, 0, len, pos);
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i] === 0x0a) return pos + i + 1;
      }
      // no newline found in this chunk — keep scanning backwards unless at start
      if (pos === start) return start;
      if (pos === 0) return 0;
    }
    return start;
  } finally {
    fs.closeSync(fd);
  }
}

/** Reads the byte range and commits the new offset to scan_state. */
export function readDelta(delta: FileDelta): string {
  const fd = fs.openSync(delta.path, "r");
  try {
    const len = delta.endOffset - delta.startOffset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, delta.startOffset);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

export function commitDelta(db: DatabaseSync, delta: FileDelta, fileSize: number, mtimeMs: number): void {
  db.prepare(
    `INSERT INTO scan_state (source_path, size, mtime, byte_offset, last_synced_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source_path) DO UPDATE SET
       size = excluded.size, mtime = excluded.mtime,
       byte_offset = excluded.byte_offset, last_synced_at = excluded.last_synced_at`,
  ).run(
    delta.path,
    fileSize,
    Math.floor(mtimeMs),
    delta.endOffset,
    new Date().toISOString(),
  );
}
