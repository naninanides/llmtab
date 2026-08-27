#!/usr/bin/env node
/**
 * llmtab-desktop — launches the LLMTab menu-bar shell.
 *
 * The shell itself lives in the `llmtab` package (`dist/shell/main.js`); this
 * package exists only to add the Electron runtime, which is far too large to
 * force on people who just want the CLI. We locate the installed `llmtab` via
 * normal Node resolution, so npm/pnpm/yarn layouts all work without guessing
 * at node_modules paths.
 *
 * The shell is a menu-bar app, so it detaches by default: the prompt comes
 * straight back, Ctrl-C no longer kills it, and closing the terminal leaves it
 * running. Pass --foreground (-F) to keep it attached for debugging.
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { logFilePath, parseArgs } from "./launcher.mjs";

const require = createRequire(import.meta.url);

function die(message, hint) {
  console.error(`llmtab-desktop: ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

function resolveShellEntry() {
  let pkgJsonPath;
  try {
    pkgJsonPath = require.resolve("llmtab/package.json");
  } catch {
    die("cannot find the `llmtab` package.", "Reinstall with: npm i -g llmtab-desktop");
  }
  const entry = path.join(path.dirname(pkgJsonPath), "dist", "shell", "main.js");
  if (!existsSync(entry)) {
    die(
      `the installed llmtab has no shell build at ${entry}.`,
      "This usually means llmtab was installed from source without running its build.",
    );
  }
  return entry;
}

function resolveElectron() {
  let electronPath;
  try {
    electronPath = require("electron");
  } catch {
    die("cannot find the `electron` runtime.", "Reinstall with: npm i -g llmtab-desktop");
  }
  // electron's main export is the path to its binary; inside an Electron
  // runtime it is the API object instead, which means we were run wrong.
  if (typeof electronPath !== "string") {
    die("`electron` did not resolve to a binary path.");
  }
  if (!existsSync(electronPath)) {
    die(
      `the electron binary is missing at ${electronPath}.`,
      "Its postinstall download may have been skipped or blocked by a proxy.",
    );
  }
  return electronPath;
}

/**
 * Opens the detached shell's log in append mode, creating the state dir if the
 * CLI has never run. A log we cannot open is not worth aborting the launch for
 * — the app matters more than its diagnostics — so fall back to discarding.
 */
function openLog() {
  const file = logFilePath();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    return { fd: openSync(file, "a"), file };
  } catch {
    return { fd: "ignore", file: null };
  }
}

const { foreground, forward } = parseArgs(process.argv.slice(2));
const args = [resolveShellEntry(), ...forward];
const electron = resolveElectron();

if (foreground) {
  const child = spawn(electron, args, { stdio: "inherit" });
  child.on("error", (err) => die(`failed to launch Electron: ${err.message}`));
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
} else {
  // `detached` puts the shell in its own process group, so the terminal's
  // Ctrl-C (SIGINT to the foreground group) and its SIGHUP on close no longer
  // reach it. Redirecting stdio frees the prompt; unref lets us exit first.
  const { fd, file } = openLog();
  const child = spawn(electron, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.on("error", (err) => die(`failed to launch Electron: ${err.message}`));
  child.unref();
  const where = file ? ` · log: ${file}` : "";
  console.log(`llmtab-desktop: started in the background (pid ${child.pid})${where}`);
  console.log("  stop it from the tray menu; run with --foreground to keep it attached.");
}
