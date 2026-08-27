/**
 * Claude Code auth — probes every store Claude Code actually writes to.
 * Sources, in priority order:
 *   1. $CLAUDE_CONFIG_DIR/.credentials.json (else ~/.claude/.credentials.json)
 *      — the store on Linux and Windows.
 *   2. macOS Keychain, generic password service "Claude Code-credentials"
 *      — the *default* store on darwin, where no credentials file is written.
 *      Read via /usr/bin/security so we need no Security.framework binding.
 *   3. $CLAUDE_CODE_OAUTH_TOKEN — inference-only per OpenUsage, but a token
 *      is better than nothing for display.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readJsonFile, resolveClaudeHome } from "./helpers.js";

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const KEYCHAIN_TIMEOUT_MS = 5_000;

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
  source: "file" | "keychain" | "env";
  /** raw payload for debugging */
  raw?: unknown;
  hasUsableToken: boolean;
}

export interface LoadClaudeAuthOptions {
  /** Defaults to the running platform. Injectable for tests. */
  platform?: NodeJS.Platform;
  /** Returns the raw Keychain payload, or null when absent. Injectable for tests. */
  readKeychain?: () => string | null;
}

interface CredentialsFile {
  claudeAiOauth?: ClaudeOAuth & {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
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
    subscriptionType:
      typeof m.subscriptionType === "string" ? (m.subscriptionType as string) : undefined,
    rateLimitTier: typeof m.rateLimitTier === "string" ? (m.rateLimitTier as string) : undefined,
    scopes: Array.isArray(m.scopes) ? (m.scopes as string[]) : undefined,
  };
}

/**
 * Reads the Claude Code generic password from the login keychain.
 *
 * macOS prompts for consent the first time a given binary reads this item;
 * the user grants it once ("Always Allow"). A denial exits non-zero, which we
 * treat as "no credentials here" rather than an error — the caller then falls
 * through to the env token and finally reports no-auth.
 */
function readKeychainRaw(): string | null {
  try {
    const res = spawnSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf8", timeout: KEYCHAIN_TIMEOUT_MS },
    );
    if (res.status !== 0) return null;
    const out = res.stdout?.trim();
    return out ? out : null;
  } catch {
    return null;
  }
}

function parseCredentialsPayload(raw: string | null): ClaudeOAuth | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const blob = (parsed as CredentialsFile | null)?.claudeAiOauth;
  return normalizeOAuth(blob as unknown as Record<string, unknown>);
}

export function loadClaudeAuth(options: LoadClaudeAuthOptions = {}): ClaudeAuth | null {
  const platform = options.platform ?? process.platform;
  const readKeychain = options.readKeychain ?? readKeychainRaw;

  // 1. credentials file — the store on Linux/Windows, and on macOS installs
  //    that predate Keychain storage.
  const file = path.join(resolveClaudeHome(), ".credentials.json");
  const data = readJsonFile<CredentialsFile>(file);
  if (data) {
    const candidate = normalizeOAuth(data.claudeAiOauth as unknown as Record<string, unknown>);
    if (candidate) {
      return { oauth: candidate, source: "file", raw: data, hasUsableToken: true };
    }
  }

  // 2. macOS Keychain — where Claude Code puts credentials on darwin.
  if (platform === "darwin") {
    const raw = readKeychain();
    const candidate = parseCredentialsPayload(raw);
    if (candidate) {
      return { oauth: candidate, source: "keychain", hasUsableToken: true };
    }
  }

  // 3. env fallback — inference-only per OpenUsage, but still usable for display.
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (envToken) {
    return {
      oauth: { accessToken: envToken },
      source: "env",
      hasUsableToken: true,
    };
  }

  return null;
}
