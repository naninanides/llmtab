/**
 * OpenCode auth — file-based (mirrors OpenUsage OpenCodeAuthStore)
 * Source: $OPENCODE_DATA_DIR/auth.json else $XDG_DATA_HOME/opencode/auth.json else ~/.local/share/opencode/auth.json
 * The key is `opencode-go` Bearer token for https://opencode.ai/zen/go/v1/usage
 */
import path from "node:path";
import fs from "node:fs";
import { readJsonFile, resolveOpencodeDataDir } from "./helpers.js";

export interface OpencodeAuth {
  apiKey: string;
  source: string;
  hasUsableToken: boolean;
}

export function loadOpencodeAuth(): OpencodeAuth | null {
  const dir = resolveOpencodeDataDir();
  const file = path.join(dir, "auth.json");
  // Also support LLMTAB_OPENCODE_DB_PATH override sibling? Check env token
  const envKey = process.env.OPENCODE_API_KEY?.trim() || process.env.OPENCODE_GO_KEY?.trim();
  if (envKey) {
    // env take precedence if valid
  }
  const data = readJsonFile<Record<string, unknown>>(file);
  if (data) {
    // Shape in OpenUsage: { "opencode-go": { key: "..." } } or flat?
    // Probe common shapes
    const direct = (data["opencode-go"] ?? data["opencode_go"] ?? data["opencode"]) as unknown;
    let key: string | undefined;
    if (typeof direct === "string") key = direct;
    else if (direct && typeof direct === "object") {
      const o = direct as Record<string, unknown>;
      key = (o.key ?? o.token ?? o.apiKey) as string | undefined;
    }
    // Fallback: top-level apiKey
    if (!key && typeof data.apiKey === "string") key = data.apiKey as string;
    if (!key && typeof data.token === "string") key = data.token as string;
    // Legacy: auth.json may be { key: "..." }
    if (!key && typeof data.key === "string") key = data.key as string;

    if (key && key.trim() !== "") {
      return { apiKey: key.trim(), source: file, hasUsableToken: true };
    }
  }
  // Also probe flat file opencode-go.key next to auth.json
  const keyFile = path.join(dir, "opencode-go.key");
  try {
    if (fs.existsSync(keyFile)) {
      const raw = fs.readFileSync(keyFile, "utf8").trim();
      if (raw) return { apiKey: raw, source: keyFile, hasUsableToken: true };
    }
  } catch { /* ignore */ }

  if (envKey) return { apiKey: envKey, source: "env:OPENCODE_API_KEY", hasUsableToken: true };
  return null;
}
