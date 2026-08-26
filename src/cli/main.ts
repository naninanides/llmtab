#!/usr/bin/env node
import { exec } from "node:child_process";
import { Command } from "commander";
import { openDb, rebuildAllBuckets } from "../store/db.js";
import { runSync } from "../ingest/sync.js";
import { startWatch } from "../ingest/watch.js";
import { detectTools } from "../ingest/detector.js";
import { refreshPricing, applyPricing, pricingCacheAgeMs } from "../cost/litellm.js";
import { runDoctor } from "./doctor.js";
import { confirmUninstall, uninstall } from "./uninstall.js";

const program = new Command();

program.name("llmtab").description("Local-first LLM token usage & cost tracker.").version("2.0.0");

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} ${url}`, () => {}).unref();
}

program
  .command("sync")
  .description("Incrementally scan all detected sources and update the local database")
  .option("-v, --verbose", "per-file details")
  .option("--rebuild", "drop and recompute all bucket rollups from raw records")
  .action(async (opts: { verbose?: boolean; rebuild?: boolean }) => {
    const db = openDb();
    if (opts.rebuild) {
      rebuildAllBuckets(db);
      console.log("Buckets rebuilt from records.");
      return;
    }
    const result = runSync(db, { verbose: opts.verbose });
    for (const e of result.entries) {
      console.log(
        `${e.tool.padEnd(12)} ${e.recordsAdded} added · ${e.linesSkipped} skipped (${e.filesScanned} files)`,
      );
    }
    const pricing = await refreshPricing(db);
    const applied = applyPricing(db);
    const cacheAge = pricingCacheAgeMs();
    const ageH = cacheAge !== null ? cacheAge / 3_600_000 : null;
    console.log(
      `Pricing: ${pricing.source}${ageH !== null ? ` (${ageH.toFixed(1)}h old)` : ""}` +
        (applied.unpricedModels.length ? ` · unpriced: ${applied.unpricedModels.join(", ")}` : ""),
    );
    console.log(`Done: +${result.totalRecordsAdded} records, ${result.totalLinesSkipped} skipped lines.`);
  });

program
  .command("status")
  .description("Show per-tool integration state")
  .action(() => {
    for (const d of detectTools()) {
      console.log(`${d.tool.padEnd(12)} ${d.status}${d.reason ? ` — ${d.reason}` : ""}`);
    }
  });

program
  .command("watch")
  .description("Keep the database fresh by watching source directories (FR-5)")
  .action(() => {
    const db = openDb();
    const initial = runSync(db);
    console.log(
      `Initial sync: +${initial.totalRecordsAdded} records. Watching for changes… (Ctrl+C to stop)`,
    );
    startWatch(db, (result) => {
      if (result.totalRecordsAdded > 0 || result.totalLinesSkipped > 0) {
        const stamp = new Date().toLocaleTimeString();
        console.log(`[${stamp}] +${result.totalRecordsAdded} records (${result.totalLinesSkipped} skipped)`);
      }
    });
    process.on("SIGINT", () => process.exit(0));
  });

program
  .command("doctor")
  .description("Health check: node version, DB writability, sources, pricing cache (FR-6)")
  .action(() => {
    const db = openDb();
    const { checks, healthy } = runDoctor(db);
    for (const c of checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(18)} ${c.detail}`);
    }
    if (!healthy) process.exitCode = 1;
  });

program
  .command("uninstall")
  .description("Remove all LLMTab state (~/.llmtab). Never touches your AI tools' data.")
  .option("-f, --force", "skip confirmation prompt")
  .action(async (opts: { force?: boolean }) => {
    const ok = await confirmUninstall(undefined, opts.force ?? false);
    if (!ok) {
      console.log("Aborted.");
      return;
    }
    const { removed, path } = uninstall();
    console.log(removed ? `Removed ${path}` : `${path} not found — nothing to remove.`);
  });

program
  .command("serve")
  .description("Run the dashboard server without opening a browser")
  .option("-p, --port <port>", "port to listen on", Number)
  .action(async (opts: { port?: number }) => {
    const { startServer } = await import("../server/main.js");
    try {
      const port = await startServer(opts.port ?? 7878);
      console.log(`LLMTab dashboard → http://localhost:${port}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });

// FR-1: default command = sync → serve → open browser
program
  .action(async () => {
    const db = openDb();
    const result = runSync(db);
    await refreshPricing(db);
    applyPricing(db);
    console.log(`Synced: +${result.totalRecordsAdded} records.`);
    const { startServer } = await import("../server/main.js");
    const port = await startServer(7878);
    const url = `http://localhost:${port}`;
    console.log(`LLMTab dashboard → ${url}`);
    openBrowser(url);
    process.on("SIGINT", () => process.exit(0));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
