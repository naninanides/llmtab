import fs from "node:fs";
import path from "node:path";
import { TOOL_IDS, type Detection, type ToolId } from "../shared/types.js";
import { toolSourceDir } from "../shared/paths.js";

/** Per-tool presence checks (PRD §7 paths). */
export function detectTools(): Detection[] {
  return TOOL_IDS.map((tool) => detectTool(tool));
}

export function detectTool(tool: ToolId): Detection {
  const p = sourcePath(tool);
  if (!p) return { tool, status: "skipped", reason: `unknown tool ${tool}` };
  if (!fs.existsSync(p)) {
    return { tool, status: "not-found", reason: `${p} does not exist` };
  }
  return { tool, status: "active" };
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
  }
}
