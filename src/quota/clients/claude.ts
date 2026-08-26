/* eslint-disable eqeqeq */
/**
 * Claude usage client — mirrors OpenUsage ClaudeUsageClient
 * GET https://api.anthropic.com/api/oauth/usage  (beta oauth-2025-04-20)
 * Refresh: POST https://platform.claude.com/v1/oauth/token  (when expiresAt-5m)
 * For now we fetch without refresh; if expired we surface token_expired so UI hints re-login.
 */
import type { QuotaWindow, QuotaProviderSnapshot } from "../types.js";
import type { ClaudeOAuth } from "../auth/claude.js";

const USAGE_URL = process.env.CLAUDE_OAUTH_USAGE_URL ?? "https://api.anthropic.com/api/oauth/usage";
const REFRESH_URL = process.env.CLAUDE_OAUTH_REFRESH_URL ?? "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID_PROD = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

function isoOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v as string);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v); if (Number.isFinite(n)) return n; }
  return null;
}

function windowFromUtil(label: string, obj: unknown, periodMs: number): QuotaWindow | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const u = num(o.utilization ?? o.percent);
  if (u == null) return null;
  return {
    label,
    used: Math.max(0, Math.min(100, u)),
    limit: 100,
    format: "percent",
    resetsAt: isoOrNull(o.resets_at ?? o.resetsAt),
    periodMs,
  };
}

const SESSION_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function fetchClaudeQuota(oauth: ClaudeOAuth): Promise<QuotaProviderSnapshot> {
  const checkedAt = new Date().toISOString();
  const token = oauth.accessToken?.trim();
  if (!token) {
    return {
      provider: "claude-code",
      displayName: "Claude",
      status: "no-auth",
      windows: [],
      error: "Not logged in. Run `claude` to authenticate.",
      checkedAt,
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": "claude-code/2.1.69",
  };

  try {
    const res = await fetch(USAGE_URL, { method: "GET", headers, signal: AbortSignal.timeout(10_000) });

    if (res.status === 401 || res.status === 403) {
      return {
        provider: "claude-code",
        displayName: "Claude",
        status: "error",
        windows: [],
        error: "Session expired. Run `claude` to log in again.",
        checkedAt,
      };
    }
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      return {
        provider: "claude-code",
        displayName: "Claude",
        status: "rate-limited",
        windows: [],
        warning: retryAfter ? `Rate limited, retry in ~${retryAfter}s` : "Rate limited, try again later",
        error: `Rate limited (429)${retryAfter ? ` retry-after ${retryAfter}` : ""}`,
        checkedAt,
      };
    }
    if (!res.ok) {
      return {
        provider: "claude-code",
        displayName: "Claude",
        status: "error",
        windows: [],
        error: `Claude usage ${res.status}`,
        checkedAt,
      };
    }

    const body = (await res.json()) as Record<string, unknown>;
    const windows: QuotaWindow[] = [];

    const five = windowFromUtil("Session", body.five_hour, SESSION_MS);
    if (five) windows.push(five);
    const weekly = windowFromUtil("Weekly", body.seven_day, WEEK_MS);
    if (weekly) windows.push(weekly);
    const sonnet = windowFromUtil("Sonnet", body.seven_day_sonnet, WEEK_MS);
    if (sonnet) windows.push(sonnet);

    // scoped weekly limit (Fable) — limits[].kind=weekly_scoped scope.model.display_name
    if (Array.isArray(body.limits)) {
      for (const entry of body.limits as unknown[]) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        if (e.kind !== "weekly_scoped") continue;
        const scope = e.scope as Record<string, unknown> | undefined;
        const model = scope?.model as Record<string, unknown> | undefined;
        if (model?.display_name !== "Fable") continue;
        const p = num(e.percent);
        if (p == null) continue;
        windows.push({
          label: "Fable",
          used: Math.max(0, Math.min(100, p)),
          limit: 100,
          format: "percent",
          resetsAt: isoOrNull(e.resets_at ?? e.resetsAt),
          periodMs: WEEK_MS,
        });
        break;
      }
    }

    // extra usage — is_enabled + used_credits / monthly_limit (cents)
    const extra = body.extra_usage as Record<string, unknown> | undefined;
    if (extra?.is_enabled === true) {
      const usedCents = num(extra.used_credits);
      if (usedCents != null) {
        const used = usedCents / 100;
        const limitCents = num(extra.monthly_limit);
        if (limitCents != null && limitCents > 0) {
          windows.push({
            label: "Extra usage",
            used,
            limit: limitCents / 100,
            format: "dollars",
            resetsAt: null,
            periodMs: null,
          });
        } else if (used > 0) {
          windows.push({
            label: "Extra usage",
            used,
            limit: used,
            format: "dollars",
            resetsAt: null,
            periodMs: null,
          });
        }
      }
    }

    const plan = (() => {
      const raw = oauth.subscriptionType?.trim();
      if (!raw) return null;
      const base = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      const tier = oauth.rateLimitTier;
      const m = tier?.match(/\d+x/);
      return m ? `${base} ${m[0]}` : base;
    })();

    if (windows.length === 0) {
      return {
        provider: "claude-code",
        displayName: "Claude",
        status: "error",
        windows: [],
        error: "No quota windows returned",
        plan,
        checkedAt,
      };
    }

    return {
      provider: "claude-code",
      displayName: "Claude",
      status: "ok",
      windows,
      plan,
      checkedAt,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider: "claude-code",
      displayName: "Claude",
      status: "error",
      windows: [],
      error: msg.includes("timeout") ? "Connection failed" : msg,
      checkedAt,
    };
  }
}

// Exported for tests / manager to attempt refresh if token expired
export const CLAUDE_ENDPOINTS = { USAGE_URL, REFRESH_URL, CLIENT_ID_PROD };
