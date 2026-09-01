/** Quota snapshot types — mirrors OpenUsage ProviderSnapshot / MetricLine (src/quota/types.ts) */

export type QuotaStatus = "ok" | "no-auth" | "error" | "rate-limited";

export interface QuotaWindow {
  /** e.g. "Session" (5h), "Weekly", "Monthly", "Credits" */
  label: string;
  /** 0-100 for percent, or dollars/count for absolute */
  used: number;
  limit: number;
  /** "percent" | "dollars" | "count" */
  format: "percent" | "dollars" | "count";
  /** ISO-8601 reset time if applicable */
  resetsAt: string | null;
  /** period duration in ms, for pace calculations */
  periodMs: number | null;
}

export interface QuotaProviderSnapshot {
  provider: string; // "claude-code" | "codex" | "opencode" | ...
  displayName: string;
  status: QuotaStatus;
  plan?: string | null;
  windows: QuotaWindow[];
  warning?: string | null;
  error?: string | null;
  /** For status "rate-limited": how long the provider asked us to wait, in ms. */
  retryAfterMs?: number | null;
  checkedAt: string;
}

export interface QuotaResponse {
  providers: QuotaProviderSnapshot[];
  /** ms since last successful fetch per provider */
  fetchedAt: string;
}
