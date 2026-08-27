/**
 * Pure launcher decisions for `llmtab-desktop`, split out of bin.mjs so they
 * can be tested without spawning Electron.
 */
import os from "node:os";
import path from "node:path";

/**
 * Splits our own flags from the ones Electron should receive.
 *
 * A menu-bar app that holds the terminal hostage is a bug, so detaching is the
 * default and `--foreground` is the escape hatch for debugging. Everything else
 * is forwarded verbatim; anything after `--` belongs to the app, so a
 * `--foreground` there is passed through rather than consumed.
 */
export function parseArgs(argv) {
  const forward = [];
  let foreground = false;
  let appArgs = false;
  for (const arg of argv) {
    if (appArgs) {
      forward.push(arg);
      continue;
    }
    if (arg === "--") {
      appArgs = true;
      forward.push(arg);
      continue;
    }
    if (arg === "--foreground" || arg === "-F") {
      foreground = true;
      continue;
    }
    forward.push(arg);
  }
  return { foreground, forward };
}

/** Base state dir, mirroring src/shared/paths.ts (LLMTAB_HOME overrides). */
export function stateHome(env = process.env, home = os.homedir()) {
  return env.LLMTAB_HOME ?? path.join(home, ".llmtab");
}

/** Where a detached shell's stdout/stderr are appended. */
export function logFilePath(env = process.env, home = os.homedir()) {
  return path.join(stateHome(env, home), "desktop.log");
}
