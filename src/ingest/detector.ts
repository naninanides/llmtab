import fs from "node:fs";
import path from "node:path";
import { TOOL_IDS, type Detection, type ToolId } from "../shared/types.js";
import { toolSourceDir, opencodeDbPath } from "../shared/paths.js";
import { readConfig, proxyPort, ollamaUpstreamPort } from "../shared/config.js";

/** Per-tool presence checks (PRD §7 paths). */
export function detectTools(): Detection[] {
  return TOOL_IDS.map((tool) => detectTool(tool));
}

export function detectTool(tool: ToolId): Detection {
  const p = sourcePath(tool);
  if (!p) return { tool, status: "skipped", reason: `unknown tool ${tool}` };
  if (tool === "ollama") return detectOllama(p);
  if (!fs.existsSync(p)) {
    return { tool, status: "not-found", reason: `${p} does not exist` };
  }
  return { tool, status: "active" };
}

/**
 * Ollama writes no persistent usage data — capture happens via the opt-in
 * reverse proxy (FR-15/16). Status reflects proxy state, not file presence.
 */
function detectOllama(ollamaDir: string): Detection {
  if (!fs.existsSync(ollamaDir)) {
    return { tool: "ollama", status: "not-found", reason: `${ollamaDir} does not exist` };
  }
  const config = readConfig();
  if (!config.proxyEnabled) {
    return {
      tool: "ollama",
      status: "skipped",
      reason: `proxy not enabled — run \`llmtab proxy\`, then set OLLAMA_HOST=http://127.0.0.1:${proxyPort(config)}`,
    };
  }
  return {
    tool: "ollama",
    status: "active",
    reason: `proxy :${proxyPort(config)} → upstream :${ollamaUpstreamPort(config)}`,
  };
}

function sourcePath(tool: ToolId): string | null {
  switch (tool) {
    case "claude-code":
      return toolSourceDir(tool, ".claude/projects");
    case "codex":
      return toolSourceDir(tool, ".codex/sessions");
    case "gemini-cli":
      return toolSourceDir(tool, ".gemini/tmp");
    case "zcode":
      // env/default points at the dir containing db.sqlite
      return path.join(toolSourceDir(tool, ".zcode/cli/db"), "db.sqlite");
    case "opencode":
      return opencodeDbPath();
    case "ollama":
      return toolSourceDir(tool, ".ollama");
  }
}
