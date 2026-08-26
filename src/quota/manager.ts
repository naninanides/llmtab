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

let cache: QuotaResponse | null = null;
let cacheAt = 0;
let inflight: Promise<QuotaResponse> | null = null;

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

  if (opts?.force !== true && fresh && cache) {
    // stale-while-revalidate: return cached, refresh in background
    if (!inflight) {
      inflight = fetchAll()
        .then((r) => {
          cache = r;
          cacheAt = Date.now();
          return r;
        })
        .finally(() => {
          inflight = null;
        });
      // don't await — return stale immediately
    }
    return cache;
  }

  if (inflight) return inflight;

  inflight = fetchAll().then((r) => {
    cache = r;
    cacheAt = Date.now();
    return r;
  }).finally(() => {
    inflight = null;
  });

  return inflight;
}

export function clearQuotaCache(): void {
  cache = null;
  cacheAt = 0;
}
