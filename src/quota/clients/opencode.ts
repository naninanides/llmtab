/* eslint-disable eqeqeq */
/**
 * OpenCode quota client — mirrors OpenUsage OpenCodeUsageClient
 * GET https://opencode.ai/zen/go/v1/usage  Bearer opencode-go key
 * Returns { usage: { rolling, weekly, monthly: { percent, resetsAt } } }  (percent 0-100)
 */
import type { QuotaProviderSnapshot, QuotaWindow } from "../types.js";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

const SESSION_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function clampPercent(n: number): number { return Math.max(0, Math.min(100, n)); }

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v); if (Number.isFinite(n)) return n; }
  return null;
}

function isoOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v as string);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function windowFrom(label: string, raw: unknown, periodMs: number): QuotaWindow {
  if (!raw || typeof raw !== "object") throw new Error(`invalid ${label}`);
  const o = raw as Record<string, unknown>;
  const p = num(o.percent);
  if (p == null) throw new Error(`invalid ${label} percent`);
  return {
    label,
    used: clampPercent(p),
    limit: 100,
    format: "percent",
    resetsAt: isoOrNull(o.resetsAt ?? o.resets_at),
    periodMs,
  };
}

export async function fetchOpencodeQuota(apiKey: string): Promise<QuotaProviderSnapshot> {
  const checkedAt = new Date().toISOString();
  if (!apiKey?.trim()) {
    return {
      provider: "opencode",
      displayName: "OpenCode",
      status: "no-auth",
      windows: [],
      error: "Not logged in. Run `opencode auth login` to authenticate.",
      checkedAt,
    };
  }

  try {
    const res = await fetch(USAGE_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 401 || res.status === 403) {
      const bodyText = await res.text().catch(() => "");
      let errType: string | null = null;
      try {
        const j = JSON.parse(bodyText) as Record<string, unknown>;
        const e = j.error as Record<string, unknown> | undefined;
        if (e?.type && typeof e.type === "string") errType = e.type as string;
      } catch { /* not json */ }
      return {
        provider: "opencode",
        displayName: "OpenCode",
        status: "error",
        windows: [],
        error: errType ? `${errType}: ${bodyText.slice(0, 300)}` : "OpenCode auth failed. Check opencode-go key.",
        checkedAt,
      };
    }

    if (!res.ok) {
      return { provider: "opencode", displayName: "OpenCode", status: "error", windows: [], error: `OpenCode usage ${res.status}`, checkedAt };
    }

    const body = (await res.json()) as Record<string, unknown>;
    const usage = body.usage as Record<string, unknown> | undefined;
    if (!usage) throw new Error("invalid response: missing usage");

    const windows: QuotaWindow[] = [
      windowFrom("Session", usage.rolling, SESSION_MS),
      windowFrom("Weekly", usage.weekly, WEEK_MS),
      windowFrom("Monthly", usage.monthly, MONTH_MS),
    ];

    return { provider: "opencode", displayName: "OpenCode", status: "ok", windows, checkedAt };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider: "opencode",
      displayName: "OpenCode",
      status: "error",
      windows: [],
      error: msg.includes("timeout") ? "Connection failed" : msg,
      checkedAt,
    };
  }
}

export const OPENCODE_ENDPOINTS = { USAGE_URL };
