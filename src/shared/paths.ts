import os from "node:os";
import path from "node:path";

/** Base state dir (~/.llmtab); LLMTAB_HOME overrides for tests. */
export function llmtabHome(): string {
  return process.env.LLMTAB_HOME ?? path.join(os.homedir(), ".llmtab");
}

export function dbPath(): string {
  return process.env.LLMTAB_DB_PATH ?? path.join(llmtabHome(), "db.sqlite");
}

/** Per-tool source dirs; LLMTAB_<TOOL>_DIR overrides for tests. */
const TOOL_DIR_ENV: Record<string, string> = {
  "claude-code": "LLMTAB_CLAUDE_DIR",
  codex: "LLMTAB_CODEX_DIR",
  "gemini-cli": "LLMTAB_GEMINI_DIR",
  zcode: "LLMTAB_ZCODE_DIR",
  opencode: "LLMTAB_OPENCODE_DIR",
};

export function toolSourceDir(tool: string, relative: string): string {
  const env = TOOL_DIR_ENV[tool];
  const override = env ? process.env[env] : undefined;
  const home = process.env.HOME ?? "";
  return override ?? path.join(home, relative);
}

export function opencodeDbPath(): string {
  return (
    process.env.LLMTAB_OPENCODE_DB_PATH ??
    path.join(toolSourceDir("opencode", ".local/share/opencode"), "opencode.db")
  );
}
