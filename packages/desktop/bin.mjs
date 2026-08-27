#!/usr/bin/env node
/**
 * llmtab-desktop — launches the LLMTab menu-bar shell.
 *
 * The shell itself lives in the `llmtab` package (`dist/shell/main.js`); this
 * package exists only to add the Electron runtime, which is far too large to
 * force on people who just want the CLI. We locate the installed `llmtab` via
 * normal Node resolution, so npm/pnpm/yarn layouts all work without guessing
 * at node_modules paths.
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

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

const child = spawn(resolveElectron(), [resolveShellEntry(), ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("error", (err) => die(`failed to launch Electron: ${err.message}`));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
