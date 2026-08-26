import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { detectTools } from "./detector.js";
import { toolSourceDir } from "../shared/paths.js";
import { runSync, type SyncResult } from "./sync.js";

const DEBOUNCE_MS = 1_000;

export interface WatchHandle {
  stop: () => void;
}

/** Directories to watch per active tool (zcode → the dir holding db.sqlite). */
function watchDirs(): string[] {
  const dirs = new Set<string>();
  for (const d of detectTools()) {
    if (d.status !== "active") continue;
    switch (d.tool) {
      case "claude-code":
        dirs.add(toolSourceDir(d.tool, ".claude/projects"));
        break;
      case "codex":
        dirs.add(toolSourceDir(d.tool, ".codex/sessions"));
        break;
      case "gemini-cli":
        dirs.add(toolSourceDir(d.tool, ".gemini/tmp"));
        break;
      case "zcode":
        dirs.add(toolSourceDir(d.tool, ".zcode/cli/db"));
        break;
    }
  }
  return [...dirs];
}

/**
 * Keeps the DB fresh via fs watchers + debounced incremental sync (FR-5).
 * The sync itself is synchronous and single-writer; overlapping watcher
 * events collapse into one queued run.
 */
export function startWatch(
  db: DatabaseSync,
  onChange?: (result: SyncResult) => void,
  debounceMs = DEBOUNCE_MS,
): WatchHandle {
  const watchers: Array<fs.FSWatcher> = [];
  let timer: NodeJS.Timeout | null = null;
  let pending = false;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    if (timer) {
      pending = true; // collapse bursts
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      try {
        const result = runSync(db);
        onChange?.(result);
      } catch (err) {
        console.error("watch sync failed:", err instanceof Error ? err.message : err);
      }
      if (pending && !stopped) {
        pending = false;
        schedule();
      }
    }, debounceMs);
    timer.unref?.();
  };

  for (const dir of watchDirs()) {
    try {
      const w = fs.watch(dir, { recursive: true }, () => schedule());
      w.on("error", () => {
        /* directory vanished mid-watch — sync still works on next trigger */
      });
      watchers.push(w);
    } catch {
      // unreadable source never breaks the watcher loop
    }
  }

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}
