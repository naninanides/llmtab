import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { detectTool } from "./detector.js";
import { discoverFiles, computeDeltas, readDelta, commitDelta } from "./scanner.js";
import { claudeCodeParser, decodeClaudeProjectDir } from "./parsers/claude-code.js";
import { codexParser } from "./parsers/codex.js";
import { geminiCliParser } from "./parsers/gemini-cli.js";
import { mapZcodeRows } from "./parsers/zcode.js";
import { fetchZcodeUsage } from "./zcode-source.js";
import { mapOpencodeRows } from "./parsers/opencode.js";
import { fetchOpencodeUsage } from "./opencode-source.js";
import { opencodeDbPath } from "../shared/paths.js";
import type { Parser } from "./parsers/types.js";
import { dedupeRecords } from "./dedup.js";
import { insertRecords } from "../store/records.js";
import { refreshBuckets } from "../store/buckets.js";
import { toolSourceDir } from "../shared/paths.js";
import { TOOL_IDS, type SyncReportEntry, type SyncRun, type ToolId } from "../shared/types.js";

export interface SyncOptions {
  verbose?: boolean | undefined;
}

export interface SyncResult extends SyncRun {
  totalRecordsAdded: number;
  totalLinesSkipped: number;
}

const PARSERS: Partial<Record<ToolId, Parser>> = {
  "claude-code": claudeCodeParser,
  codex: codexParser,
  "gemini-cli": geminiCliParser,
};

const FILE_ROOTS: Record<string, string> = {
  "claude-code": ".claude/projects",
  codex: ".codex/sessions",
  "gemini-cli": ".gemini/tmp",
};

const SQLITE_DIRS: Partial<Record<ToolId, string>> = {
  zcode: ".zcode/cli/db",
};

/** detect → scan → parse → dedup → bucket (PRD FR-2). Never throws on bad lines. */
export function runSync(db: DatabaseSync, opts: SyncOptions = {}): SyncResult {
  const startedAt = new Date().toISOString();
  const entries: SyncReportEntry[] = [];
  let totalAdded = 0;
  let totalSkipped = 0;

  for (const tool of TOOL_IDS) {
    const entry = syncTool(db, tool);
    entries.push(entry);
    totalAdded += entry.recordsAdded;
    totalSkipped += entry.linesSkipped;
    if (opts.verbose) {
      console.log(
        `${tool}: files=${entry.filesScanned} added=${entry.recordsAdded} skipped=${entry.linesSkipped}`,
      );
    }
  }

  const finishedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO sync_runs (started_at, finished_at, status, records_added, lines_skipped, detail_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(startedAt, finishedAt, "ok", totalAdded, totalSkipped, JSON.stringify(entries));

  return {
    startedAt,
    finishedAt,
    status: "ok",
    entries,
    totalRecordsAdded: totalAdded,
    totalLinesSkipped: totalSkipped,
  };
}

function syncTool(db: DatabaseSync, tool: ToolId): SyncReportEntry {
  const detection = detectTool(tool);
  if (detection.status !== "active") {
    return { tool, filesScanned: 0, recordsAdded: 0, linesSkipped: 0 };
  }

  const parser = PARSERS[tool];
  const fileRoot = FILE_ROOTS[tool];
  if (parser && fileRoot) {
    return syncFileTool(db, tool, parser, fileRoot);
  }
  if (SQLITE_DIRS[tool]) {
    return syncZcode(db);
  }
  if (tool === "opencode") {
    return syncOpencode(db);
  }
  // ollama records arrive via the proxy at capture time — nothing passive to scan
  return { tool, filesScanned: 0, recordsAdded: 0, linesSkipped: 0 };
}

function syncFileTool(
  db: DatabaseSync,
  tool: ToolId,
  parser: Parser,
  rootRelative: string,
): SyncReportEntry {
  const root = toolSourceDir(tool, rootRelative);
  const files = discoverFiles(root, (n) => n.endsWith(".jsonl"));
  const { deltas } = computeDeltas(db, files);

  let added = 0;
  let skipped = 0;

  for (const delta of deltas) {
    try {
      const content = readDelta(delta);
      const ctx = { ...fileContext(tool, delta.path), startOffset: delta.startOffset };
      const outcome = parser.parse(content, ctx);
      if (!outcome.ok) {
        skipped += 1;
      } else {
        skipped += outcome.linesSkipped;
        const unique = dedupeRecords(outcome.records);
        added += insertRecords(db, unique);
        refreshBuckets(db, unique);
      }
      commitDelta(db, delta, delta.size, delta.mtimeMs);
    } catch {
      // a single unreadable file never breaks the whole sync (PRD US10)
      continue;
    }
  }

  return { tool, filesScanned: deltas.length, recordsAdded: added, linesSkipped: skipped };
}

function fileContext(
  tool: ToolId,
  filePath: string,
): { tool: ToolId; project: string | null; sessionId: string | null } {
  const parentDir = path.basename(path.dirname(filePath));
  switch (tool) {
    case "claude-code":
      // projects live in encoded dirs like `-Users-demo-project`
      return { tool, project: decodeClaudeProjectDir(parentDir), sessionId: parentDir };
    case "gemini-cli":
      // chunks.jsonl lives under ~/.gemini/tmp/<session-hash>/
      return { tool, project: null, sessionId: parentDir };
    default:
      // codex derives session/cwd from the content itself
      return { tool, project: null, sessionId: null };
  }
}

function syncZcode(db: DatabaseSync): SyncReportEntry {
  try {
    const dbFile = path.join(toolSourceDir("zcode", SQLITE_DIRS["zcode"] ?? ""), "db.sqlite");
    // full re-read each sync; composite dedup keys keep it idempotent
    const { rows, projects } = fetchZcodeUsage(dbFile, 0, Date.now() + 60_000);
    const records = mapZcodeRows(rows, projects, { tool: "zcode" });
    const unique = dedupeRecords(records);
    const added = insertRecords(db, unique);
    refreshBuckets(db, unique);
    return { tool: "zcode", filesScanned: 1, recordsAdded: added, linesSkipped: 0 };
  } catch (err) {
    console.error(`zcode sync failed: ${err instanceof Error ? err.message : String(err)}`);
    return { tool: "zcode", filesScanned: 0, recordsAdded: 0, linesSkipped: 0 };
  }
}

function syncOpencode(db: DatabaseSync): SyncReportEntry {
  try {
    const dbFile = opencodeDbPath();
    // full re-read each sync; message.id dedup keys keep it idempotent
    const rows = fetchOpencodeUsage(dbFile, 0, Date.now() + 60_000);
    const records = mapOpencodeRows(rows, { tool: "opencode" });
    const unique = dedupeRecords(records);
    const added = insertRecords(db, unique);
    refreshBuckets(db, unique);
    return { tool: "opencode", filesScanned: 1, recordsAdded: added, linesSkipped: 0 };
  } catch (err) {
    console.error(`opencode sync failed: ${err instanceof Error ? err.message : String(err)}`);
    return { tool: "opencode", filesScanned: 0, recordsAdded: 0, linesSkipped: 0 };
  }
}
