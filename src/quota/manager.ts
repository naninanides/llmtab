/* eslint-disable eqeqeq */
/**
 * Quota manager — 5-min stale-while-revalidate cache, parallel per-provider fetch
 * Mirrors OpenUsage refresh loop (docs/refreshing.md): batch every 5 min, 120s timeout per provider
 */
import type { QuotaProviderSnapshot, QuotaResponse } from "./types.js";
import { loadClaudeAuth } from "./auth/claude.js";
import { loadCodexAuth } from "./auth/codex.js";
import { loadOpencodeAuth } from "./auth/opencode.js";
import { fetchClaudeQuota } from "./clients/claude.js";
import { fetchCodexQuota } from "./clients/codex.js";
import { fetchOpencodeQuota } from "./clients/opencode.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 15_000;

/** Cooldown after a 429 when the provider gives no retry-after to go on. */
const DEFAULT_BACKOFF_MS = 10 * 60 * 1000;
/** Never sit out longer than this, however large a retry-after we are handed. */
const MAX_BACKOFF_MS = 60 * 60 * 1000;

let cache: QuotaResponse | null = null;
let cacheAt = 0;
let inflight: Promise<QuotaResponse> | null = null;
/** Epoch ms before which we will not call upstream again. 0 = no backoff. */
let backoffUntil = 0;

/**
 * A rate-limited provider means stop asking. Hold off until the longest
 * cooldown any provider reported, so a 429 gets a chance to expire instead of
 * being renewed by the next poll.
 */
function applyBackoff(providers: QuotaResponse["providers"]): void {
  const limited = providers.filter((p) => p.status === "rate-limited");
  if (limited.length === 0) {
    backoffUntil = 0;
    return;
  }
  const waits = limited.map((p) => p.retryAfterMs ?? DEFAULT_BACKOFF_MS);
  const wait = Math.min(Math.max(...waits), MAX_BACKOFF_MS);
  backoffUntil = Date.now() + wait;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function fetchAll(): Promise<QuotaResponse> {
  const fetchedAt = new Date().toISOString();

  const tasks: Promise<QuotaProviderSnapshot>[] = [];

  // Claude
  tasks.push(
    (async () => {
      const auth = loadClaudeAuth();
      if (!auth) {
        return {
          provider: "claude-code",
          displayName: "Claude",
          status: "no-auth" as const,
          windows: [],
          error: "Not logged in. Run `claude` to authenticate.",
          checkedAt: fetchedAt,
        };
      }
      return withTimeout(fetchClaudeQuota(auth.oauth), PROVIDER_TIMEOUT_MS, {
        provider: "claude-code",
        displayName: "Claude",
        status: "error" as const,
        windows: [],
        error: "Claude fetch timed out",
        checkedAt: fetchedAt,
      });
    })(),
  );

  // Codex
  tasks.push(
    (async () => {
      const auth = loadCodexAuth();
      if (!auth) {
        return {
          provider: "codex",
          displayName: "Codex",
          status: "no-auth" as const,
          windows: [],
          error: "Not logged in. Run `codex` to authenticate.",
          checkedAt: fetchedAt,
        };
      }
      return withTimeout(fetchCodexQuota({ accessToken: auth.accessToken, ...(auth.accountId != null ? { accountId: auth.accountId } : {}) }), PROVIDER_TIMEOUT_MS, {
        provider: "codex",
        displayName: "Codex",
        status: "error" as const,
        windows: [],
        error: "Codex fetch timed out",
        checkedAt: fetchedAt,
      });
    })(),
  );

  // OpenCode
  tasks.push(
    (async () => {
      const auth = loadOpencodeAuth();
      if (!auth) {
        return {
          provider: "opencode",
          displayName: "OpenCode",
          status: "no-auth" as const,
          windows: [],
          error: "Not logged in. Run `opencode auth login` or set OPENCODE_API_KEY.",
          checkedAt: fetchedAt,
        };
      }
      return withTimeout(fetchOpencodeQuota(auth.apiKey), PROVIDER_TIMEOUT_MS, {
        provider: "opencode",
        displayName: "OpenCode",
        status: "error" as const,
        windows: [],
        error: "OpenCode fetch timed out",
        checkedAt: fetchedAt,
      });
    })(),
  );

  const providers = await Promise.all(tasks);

  return { providers, fetchedAt };
}

export async function getQuotas(opts?: { force?: boolean }): Promise<QuotaResponse> {
  const now = Date.now();
  const fresh = cache && now - cacheAt < CACHE_TTL_MS;

  // A fresh cache is served as-is. Revalidating here would defeat the TTL:
  // the tray polls every 30s, so a background refresh on every hit meant
  // ~120 upstream requests an hour and providers rate-limiting us (429).
  if (opts?.force !== true && fresh && cache) return cache;

  // Rate-limited providers ask for a specific cooldown. Honour it: refetching
  // before `retry-after` elapses is what keeps a 429 alive.
  if (opts?.force !== true && cache && backoffUntil > now) return cache;

  if (inflight) return inflight;

  inflight = fetchAll().then((r) => {
    cache = r;
    cacheAt = Date.now();
    applyBackoff(r.providers);
    return r;
  }).finally(() => {
    inflight = null;
  });

  return inflight;
}

export function clearQuotaCache(): void {
  cache = null;
  cacheAt = 0;
  backoffUntil = 0;
}
