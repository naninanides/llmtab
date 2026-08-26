/**
 * Claude Code auth — file-based (mirrors OpenUsage ClaudeAuthStore file probe)
 * Sources: ~/.claude/.credentials.json  (or $CLAUDE_CONFIG_DIR/.credentials.json)
 *          + $CLAUDE_CODE_OAUTH_TOKEN env (inference-only fallback, not used for quota)
 * Keychain sources are macOS-only and require Security.framework; we document
 * the path and fall through to file. See docs/providers/claude.md in OpenUsage.
 */
import fs from "node:fs";
import path from "node:path";
import { readJsonFile, resolveClaudeHome } from "./helpers.js";

export interface ClaudeOAuth {
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  expiresAt?: number | undefined;
  subscriptionType?: string | undefined;
  rateLimitTier?: string | undefined;
  scopes?: string[] | undefined;
}

export interface ClaudeAuth {
  oauth: ClaudeOAuth;
  source: "file" | "env";
  /** raw file payload for debugging */
  raw?: unknown;
  hasUsableToken: boolean;
}

interface CredentialsFile {
  claudeAiOauth?: ClaudeOAuth & { access_token?: string; refresh_token?: string; expires_at?: number };
}

function normalizeOAuth(raw: Record<string, unknown> | null | undefined): ClaudeOAuth | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const at = (m.accessToken ?? m.access_token) as string | undefined;
  const rt = (m.refreshToken ?? m.refresh_token) as string | undefined;
  const exp = (m.expiresAt ?? m.expires_at) as number | undefined;
  if (!at || typeof at !== "string" || at.trim() === "") return null;
  return {
    accessToken: at.trim(),
    refreshToken: typeof rt === "string" ? rt : undefined,
    expiresAt: typeof exp === "number" ? exp : undefined,
    subscriptionType: typeof m.subscriptionType === "string" ? (m.subscriptionType as string) : undefined,
    rateLimitTier: typeof m.rateLimitTier === "string" ? (m.rateLimitTier as string) : undefined,
    scopes: Array.isArray(m.scopes) ? (m.scopes as string[]) : undefined,
  };
}

export function loadClaudeAuth(): ClaudeAuth | null {
  // 1. credentials file (primary) — matches OpenUsage ClaudeAuthStore file probe
  const home = resolveClaudeHome();
  const file = path.join(home, ".credentials.json");
  const data = readJsonFile<CredentialsFile>(file);
  if (data) {
    const candidate = normalizeOAuth(data.claudeAiOauth as unknown as Record<string, unknown>);
    if (candidate) {
      return { oauth: candidate, source: "file", raw: data, hasUsableToken: true };
    }
  }

  // 2. env fallback — inference-only per OpenUsage, but still usable for display
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (envToken) {
    return {
      oauth: { accessToken: envToken },
      source: "env",
      hasUsableToken: true,
    };
  }

  // 3. No file, try keychain hint (we don't read Security.framework here)
  // If the user stores creds only in Keychain (rare), we surface no-auth
  // and the UI explains: run `claude` to re-auth so file is written.
  const legacyExists = [
    path.join(home, ".credentials.json"),
    path.join(home, "config.json"),
  ].some((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  void legacyExists;

  return null;
}
