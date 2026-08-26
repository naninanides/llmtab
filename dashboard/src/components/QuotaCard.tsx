import type { ReactNode } from "react";
import type { QuotaProvider } from "@/api";

function barColor(pct: number): string {
  if (pct >= 90) return "#ef4444";
  if (pct >= 75) return "#f59e0b";
  return "#38bdf8";
}

function resetLabel(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "resetting…";
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `resets in ${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `resets in ${h}h${rm ? ` ${rm}m` : ""}`;
  const d = Math.floor(h / 24);
  return `resets in ${d}d`;
}

export function QuotaCard({ providers, loading, error, onRetry }: {
  providers: QuotaProvider[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}): ReactNode {
  const active = providers.filter((p) => p.status === "ok" && p.windows.length > 0);
  const needsAuth = providers.filter((p) => p.status === "no-auth");
  const errors = providers.filter((p) => p.status === "error" || p.status === "rate-limited");

  if (loading && providers.length === 0) {
    return <div className="rounded-2xl border border-white/40 bg-white/30 p-3 text-center text-xs text-slate-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-400">Loading quotas…</div>;
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-white/40 bg-white/30 p-3 text-center dark:border-white/10 dark:bg-white/[0.06]">
        <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>
        <button onClick={onRetry} className="mt-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold dark:bg-white/15">Retry</button>
      </div>
    );
  }
  if (active.length === 0 && needsAuth.length > 0 && errors.length === 0) {
    return (
      <div className="rounded-2xl border border-white/40 bg-white/30 p-3 dark:border-white/10 dark:bg-white/[0.06]">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Live quotas</p>
        <p className="mt-1 text-xs leading-snug text-slate-600 dark:text-slate-400">
          No auth found. Sign in to Claude Code / Codex / OpenCode to see session & weekly limits here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/40 bg-white/30 p-3 dark:border-white/10 dark:bg-white/[0.06]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Live quotas</span>
        <button onClick={onRetry} className="text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white" title="Refresh quotas (5-min cache, use force to bypass)">Refresh</button>
      </div>

      {active.length === 0 && errors.length > 0 ? (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          {errors[0]?.error ?? "No live quota data."}
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {active.map((p) => (
            <li key={p.provider}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{p.displayName}</span>
                {p.plan && <span className="text-[11px] text-slate-500 dark:text-slate-400">{p.plan}</span>}
              </div>
              <ul className="mt-1 space-y-1.5">
                {p.windows.map((w) => {
                  const pct = w.format === "percent" ? Math.max(0, Math.min(100, w.used)) : 0;
                  const isPercent = w.format === "percent";
                  return (
                    <li key={w.label}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{w.label}</span>
                        <span className="text-[11px] tabular-nums text-slate-600 dark:text-slate-400">
                          {isPercent ? `${Math.round(pct)}% used` : w.format === "dollars" ? `$${w.used.toFixed(2)}` : `${w.used}`}
                          {isPercent && w.resetsAt ? ` · ${resetLabel(w.resetsAt)}` : ""}
                        </span>
                      </div>
                      {isPercent && (
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/40 dark:bg-white/10">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor(pct) }} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {p.warning && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{p.warning}</p>}
            </li>
          ))}
        </ul>
      )}

      {needsAuth.length > 0 && active.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Tip: sign in to {needsAuth.map((p) => p.displayName).join(", ")} to see more.
        </p>
      )}
      {errors.length > 0 && active.length > 0 && (
        <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
          {errors.map((p) => `${p.displayName}: ${p.error}`).join(" · ").slice(0, 200)}
        </p>
      )}
    </div>
  );
}

export function DashboardQuotaSection(props: { providers: QuotaProvider[]; loading: boolean; error: string | null; onRetry: () => void }): ReactNode {
  const { providers, loading, error, onRetry } = props;
  const active = providers.filter((p) => p.status === "ok" && p.windows.length > 0);
  if (loading && providers.length === 0) return <div className="rounded-card border border-border bg-surface p-4 text-sm text-muted">Loading live quotas…</div>;
  if (error) return <div className="rounded-card border border-border bg-surface p-4 text-sm text-danger">{error} <button onClick={onRetry} className="ml-2 underline">Retry</button></div>;
  if (active.length === 0) {
    return (
      <section className="rounded-card border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Live quotas</h3>
        <p className="mt-1 text-sm text-muted">No live quota data. Sign in to Claude Code, Codex or OpenCode and hit Refresh.</p>
        <button onClick={onRetry} className="mt-3 rounded-control border border-border bg-surface-2 px-3 py-1 text-sm">Refresh quotas</button>
      </section>
    );
  }
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Live quotas</h3>
        <button onClick={onRetry} className="text-xs text-muted hover:text-fg">Refresh</button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        {active.map((p) => (
          <div key={p.provider} className="rounded-control border border-border bg-surface-2 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">{p.displayName}</span>
              {p.plan && <span className="text-xs text-muted">{p.plan}</span>}
            </div>
            <ul className="mt-2 space-y-2">
              {p.windows.map((w) => {
                const pct = w.format === "percent" ? Math.max(0, Math.min(100, w.used)) : 0;
                return (
                  <li key={w.label}>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">{w.label}</span>
                      <span className="tabular-nums">{w.format === "percent" ? `${Math.round(pct)}%` : w.format === "dollars" ? `$${w.used.toFixed(2)}` : String(w.used)}{w.resetsAt ? ` · ${resetLabel(w.resetsAt)}` : ""}</span>
                    </div>
                    {w.format === "percent" && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor(pct) }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
