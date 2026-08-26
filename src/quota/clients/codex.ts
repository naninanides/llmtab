/* eslint-disable eqeqeq */
/**
 * Codex usage client — mirrors OpenUsage CodexUsageClient
 * GET https://chatgpt.com/backend-api/wham/usage  + optional ChatGPT-Account-Id
 * Headers may carry x-codex-primary-used-percent / x-codex-secondary-used-percent fallback
 */
import type { QuotaWindow, QuotaProviderSnapshot } from "../types.js";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v); if (Number.isFinite(n)) return n; }
  return null;
}

function isoFromReset(window: Record<string, unknown>, nowMs: number): string | null {
  const at = num(window.reset_at);
  if (at != null) {
    const ms = at < 1e12 ? at * 1000 : at;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const after = num(window.reset_after_seconds);
  if (after != null) {
    return new Date(nowMs + after * 1000).toISOString();
  }
  return null;
}

function periodMs(window: Record<string, unknown>): number | null {
  const s = num(window.limit_window_seconds);
  if (s != null) return s * 1000;
  return null;
}

const SESSION_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function classifyWindows(
  rateLimit: Record<string, unknown> | undefined,
  headerPercents: { primary: number | null; secondary: number | null },
  nowMs: number,
): QuotaWindow[] {
  const out: QuotaWindow[] = [];
  const primary = rateLimit?.primary_window as Record<string, unknown> | undefined;
  const secondary = rateLimit?.secondary_window as Record<string, unknown> | undefined;

  // OpenUsage classifies by limit_window_seconds first, then falls back to slot
  const candidates: Array<{ win: Record<string, unknown>; used: number | null; fallback: "session" | "weekly" }> = [
    {
      win: primary ?? {},
      used: num((primary as Record<string, unknown> | undefined)?.used_percent) ?? headerPercents.primary,
      fallback: "session",
    },
    {
      win: secondary ?? {},
      used: num((secondary as Record<string, unknown> | undefined)?.used_percent) ?? headerPercents.secondary,
      fallback: "weekly",
    },
  ];

  function exactKind(win: Record<string, unknown>): "session" | "weekly" | null {
    const ms = periodMs(win);
    if (ms === SESSION_MS) return "session";
    if (ms === WEEK_MS) return "weekly";
    return null;
  }

  for (const kind of ["session", "weekly"] as const) {
    const label = kind === "session" ? "Session" : "Weekly";
    const exact = candidates.find((c) => exactKind(c.win) === kind);
    const fallback = candidates.find((c) => exactKind(c.win) == null && c.fallback === kind);
    const cand = exact ?? fallback;
    if (!cand || cand.used == null) continue;
    const pMs = periodMs(cand.win) ?? (kind === "session" ? SESSION_MS : WEEK_MS);
    out.push({
      label,
      used: Math.max(0, Math.min(100, cand.used)),
      limit: 100,
      format: "percent",
      resetsAt: isoFromReset(cand.win, nowMs),
      periodMs: pMs,
    });
  }
  return out;
}

function sparkWindows(body: Record<string, unknown>, nowMs: number): QuotaWindow[] {
  const arr = body.additional_rate_limits;
  if (!Array.isArray(arr)) return [];
  const spark = (arr as unknown[]).find((e) => {
    if (!e || typeof e !== "object") return false;
    const o = e as Record<string, unknown>;
    const names = [o.limit_name, o.metered_feature].filter((x) => typeof x === "string").map((s) => (s as string).toLowerCase());
    return names.some((s) => s.includes("spark"));
  }) as Record<string, unknown> | undefined;
  if (!spark) return [];
  const rl = spark.rate_limit as Record<string, unknown> | undefined;
  if (!rl) return [];
  // Reuse same classifier but labels Spark / Spark Weekly
  const base = classifyWindows(rl, { primary: null, secondary: null }, nowMs);
  return base.map((w) => ({
    ...w,
    label: w.label === "Session" ? "Spark" : w.label === "Weekly" ? "Spark Weekly" : w.label,
  }));
}

function creditDollars(remaining: number): { count: number; usd: number } {
  const count = Math.max(0, Math.floor(remaining));
  return { count, usd: count * 0.04 };
}

export async function fetchCodexQuota(opts: {
  accessToken: string;
  accountId?: string | null | undefined;
}): Promise<QuotaProviderSnapshot> {
  const checkedAt = new Date().toISOString();
  const { accessToken, accountId } = opts;
  if (!accessToken?.trim()) {
    return {
      provider: "codex",
      displayName: "Codex",
      status: "no-auth",
      windows: [],
      error: "Not logged in. Run `codex` to authenticate.",
      checkedAt,
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken.trim()}`,
    Accept: "application/json",
    "User-Agent": "OpenUsage",
  };
  if (accountId?.trim()) headers["ChatGPT-Account-Id"] = accountId.trim();

  const nowMs = Date.now();
  try {
    const res = await fetch(USAGE_URL, { method: "GET", headers, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) {
      return {
        provider: "codex",
        displayName: "Codex",
        status: "error",
        windows: [],
        error: "Session expired. Run `codex` to log in again.",
        checkedAt,
      };
    }
    if (!res.ok) {
      return { provider: "codex", displayName: "Codex", status: "error", windows: [], error: `Codex usage ${res.status}`, checkedAt };
    }

    const body = (await res.json()) as Record<string, unknown>;
    const headerPercents = {
      primary: num(res.headers.get("x-codex-primary-used-percent")),
      secondary: num(res.headers.get("x-codex-secondary-used-percent")),
    };

    const windows: QuotaWindow[] = [];
    const rl = body.rate_limit as Record<string, unknown> | undefined;
    windows.push(...classifyWindows(rl, headerPercents, nowMs));
    windows.push(...sparkWindows(body, nowMs));

    // rate-limit reset credits — best-effort second fetch, fallback to embedded count
    let resetCount: number | null = null;
    let resetExpiries: string[] = [];
    try {
      const rcHeaders: Record<string, string> = { ...headers, "OpenAI-Beta": "codex-1", originator: "Codex Desktop" };
      const rcRes = await fetch(RESET_CREDITS_URL, { method: "GET", headers: rcHeaders, signal: AbortSignal.timeout(10_000) });
      if (rcRes.ok) {
        const rcBody = (await rcRes.json()) as Record<string, unknown>;
        const c = num(rcBody.available_count);
        if (c != null) {
          resetCount = Math.floor(c);
          if (Array.isArray(rcBody.credits)) {
            resetExpiries = (rcBody.credits as unknown[])
              .filter((x) => x && typeof x === "object" && (x as Record<string, unknown>).status !== "consumed")
              .map((x) => (x as Record<string, unknown>).expires_at)
              .filter((x): x is string => typeof x === "string")
              .map((s) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString(); })
              .filter((x): x is string => !!x)
              .sort();
          }
        }
      }
    } catch { /* best-effort */ }

    if (resetCount == null) {
      const embedded = body.rate_limit_reset_credits as Record<string, unknown> | undefined;
      const c = embedded ? num(embedded.available_count) : null;
      if (c != null) resetCount = Math.floor(c);
    }
    if (resetCount != null) {
      windows.push({
        label: "Rate Limit Resets",
        used: resetCount,
        limit: Math.max(resetCount, 1),
        format: "count",
        resetsAt: resetExpiries[0] ?? null,
        periodMs: null,
      });
    }

    // credits — body.credits.balance or header x-codex-credits-balance
    let bal: number | null = null;
    const credits = body.credits as Record<string, unknown> | undefined;
    if (credits) {
      const b = num(credits.balance);
      if (b != null) bal = b;
      else if (credits.has_credits === false) bal = 0;
    }
    if (bal == null) bal = num(res.headers.get("x-codex-credits-balance"));
    if (bal != null) {
      const { count, usd } = creditDollars(bal);
      windows.push({
        label: "Credits",
        used: usd, // leading dollar value; count as secondary in UI if needed
        limit: Math.max(usd, 1),
        format: "dollars",
        resetsAt: null,
        periodMs: null,
      });
      // also expose count as separate window if UI wants it
      void count;
    }

    const planRaw = typeof body.plan_type === "string" ? (body.plan_type as string).trim() : "";
    const plan = planRaw ? (planRaw.toLowerCase() === "prolite" ? "Pro 5x" : planRaw.toLowerCase() === "pro" ? "Pro 20x" : planRaw) : null;

    if (windows.length === 0) {
      return { provider: "codex", displayName: "Codex", status: "error", windows: [], error: "No quota windows returned", plan, checkedAt };
    }

    return { provider: "codex", displayName: "Codex", status: "ok", windows, plan, checkedAt };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { provider: "codex", displayName: "Codex", status: "error", windows: [], error: msg.includes("timeout") ? "Connection failed" : msg, checkedAt };
  }
}

export const CODEX_ENDPOINTS = { USAGE_URL, RESET_CREDITS_URL };
