import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { detectTools } from "../ingest/detector.js";
import { dbPath, llmtabHome, toolSourceDir, opencodeDbPath } from "../shared/paths.js";
import { readConfig, proxyPort, ollamaUpstreamPort } from "../shared/config.js";
import { pricingCacheAgeMs } from "../cost/litellm.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Health check per FR-6: node, DB writability, source readability, pricing age, proxy (FR-16). */
export async function runDoctor(db: DatabaseSync): Promise<{ checks: Check[]; healthy: boolean }> {
  const checks: Check[] = [];

  // Node version
  const major = Number(process.versions.node.split(".")[0] ?? 0);
  checks.push({
    name: "node",
    ok: major >= 20,
    detail: `v${process.versions.node} ${major >= 20 ? "(>= 20 required)" : "(< 20 — too old)"}`,
  });

  // DB writable
  const dbFile = dbPath();
  try {
    fs.mkdirSync(llmtabHome(), { recursive: true });
    fs.accessSync(path.dirname(dbFile), fs.constants.W_OK);
    db.exec("CREATE TABLE IF NOT EXISTS _doctor_probe (x); DROP TABLE _doctor_probe;");
    checks.push({ name: "db", ok: true, detail: `${dbFile} writable` });
  } catch (err) {
    checks.push({
      name: "db",
      ok: false,
      detail: `${dbFile} not writable — ${err instanceof Error ? err.message : err}`,
    });
  }

  // Per-source readability
  for (const d of detectTools()) {
    if (d.status === "not-found") {
      checks.push({ name: `source:${d.tool}`, ok: true, detail: "not installed (skipped)" });
      continue;
    }
    if (d.status === "skipped") {
      checks.push({ name: `source:${d.tool}`, ok: false, detail: d.reason ?? "skipped" });
      continue;
    }
    const p = sourceFor(d.tool);
    let ok = true;
    let detail = p;
    try {
      if (fs.statSync(p).isFile()) {
        const fd = fs.openSync(p, "r");
        fs.closeSync(fd);
        detail += " readable";
      } else {
        fs.readdirSync(p);
        detail += " readable";
      }
    } catch {
      ok = false;
      detail += " NOT readable";
    }
    checks.push({ name: `source:${d.tool}`, ok, detail });
  }

  // Pricing cache age
  const age = pricingCacheAgeMs();
  if (age === null) {
    checks.push({ name: "pricing-cache", ok: false, detail: "no cache yet — run llmtab sync" });
  } else {
    const hours = age / 3_600_000;
    checks.push({
      name: "pricing-cache",
      ok: age < CACHE_MAX_AGE_MS,
      detail: `${hours.toFixed(1)}h old`,
    });
  }

  // Ollama proxy (FR-16): only meaningful when enabled
  const config = readConfig();
  if (config.proxyEnabled) {
    const port = proxyPort(config);
    const upstream = ollamaUpstreamPort(config);
    const upstreamOk = await reachable(`http://127.0.0.1:${upstream}/api/version`);
    checks.push({
      name: "proxy:listen",
      ok: true,
      detail: `enabled on 127.0.0.1:${port} (start via \`llmtab proxy\` or the menu-bar app)`,
    });
    checks.push({
      name: "proxy:upstream",
      ok: upstreamOk,
      detail: upstreamOk
        ? `ollama reachable on :${upstream}`
        : `nothing listening on :${upstream} — is ollama serve running?`,
    });
    checks.push({
      name: "proxy:client",
      ok: process.env.OLLAMA_HOST?.includes(String(port)) ?? false,
      detail: process.env.OLLAMA_HOST?.includes(String(port))
        ? `OLLAMA_HOST points at :${port}`
        : `OLLAMA_HOST does not point at :${port} — export OLLAMA_HOST=http://127.0.0.1:${port}`,
    });
  }

  return { checks, healthy: checks.every((c) => c.ok) };
}

function reachable(url: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function sourceFor(tool: string): string {
  switch (tool) {
    case "claude-code":
      return toolSourceDir(tool, ".claude/projects");
    case "codex":
      return toolSourceDir(tool, ".codex/sessions");
    case "gemini-cli":
      return toolSourceDir(tool, ".gemini/tmp");
    case "zcode":
      return path.join(toolSourceDir(tool, ".zcode/cli/db"), "db.sqlite");
    case "opencode":
      return opencodeDbPath();
    case "ollama":
      return toolSourceDir(tool, ".ollama");
  }
  return "";
}
