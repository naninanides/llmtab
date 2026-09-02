import type { ReactNode } from "react";
import type { QuotaProvider } from "@/api";
import { barColor, resetLabel, pctForWindow, shouldDrawMeter, formatWindowValue, toneFor } from "@/quota";
import { BlockMeter } from "@/components/pixel/BlockMeter";

// Re-export for callers that imported from here (BlockMeter previously did)
export { barColor, resetLabel };

// ── Quotas tab panel — Phosphor, 360px popover ──────────────────────────

export function QuotaCard({
  providers,
  loading,
  error,
  onRetry,
  fetchedAt,
}: {
  providers: QuotaProvider[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  fetchedAt?: string | null;
}): ReactNode {
  const active = providers.filter((p) => p.status === "ok" && p.windows.length > 0);
  const needsAuth = providers.filter((p) => p.status === "no-auth");
  const errors = providers.filter((p) => p.status === "error" || p.status === "rate-limited");

  const checkedLabel = (() => {
    const iso = fetchedAt ?? providers[0]?.checkedAt ?? null;
    if (!iso) return null;
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return null;
    }
  })();

  if (loading && providers.length === 0) {
    return (
      <div className="bevel p-4 text-center">
        <div className="font-silkscreen text-[10px] tracking-[0.06em] text-muted">LIVE QUOTAS</div>
        <div className="mt-3 h-[10px] bg-panel-2" aria-hidden="true">
          <div className="h-full w-[55%] bg-amber-dim animate-pulse" />
        </div>
        <div className="mt-2 font-silkscreen text-[8px] tracking-[0.08em] text-muted">CLAUDE · 2 OF 5</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bevel">
        <div className="h-[26px] flex items-center px-3 bg-alert text-rail font-silkscreen text-[9px] tracking-[0.06em] shadow-[inset_0_3px_0_0_rgba(255,255,255,.35),inset_0_-3px_0_0_rgba(0,0,0,.3)]">
          QUOTAS · ERROR
        </div>
        <div className="p-4 text-center">
          <p className="text-[11.5px] leading-[1.55] text-alert">{error}</p>
          <button onClick={onRetry} className="mt-3 px-3 py-1 bg-panel text-bone font-silkscreen text-[9px] tracking-[0.06em] shadow-[inset_0_3px_0_0_var(--lit),inset_3px_0_0_0_var(--lit),inset_0_-3px_0_0_var(--shade),inset_-3px_0_0_0_var(--shade)]">
            RETRY
          </button>
        </div>
      </div>
    );
  }

  if (active.length === 0 && needsAuth.length > 0 && errors.length === 0) {
    return (
      <div className="bevel p-4 text-center">
        <div className="font-silkscreen text-[10px] tracking-[0.06em] text-bone">NO LIVE QUOTAS</div>
        <p className="mt-2 text-[11px] leading-[1.55] text-muted max-w-[32ch] mx-auto">
          Sign in to Claude Code, Codex or OpenCode, then refresh to read your limits.
        </p>
        <button onClick={onRetry} className="mt-3 px-3 py-1 bg-panel text-bone font-silkscreen text-[9px] tracking-[0.06em] shadow-[inset_0_3px_0_0_var(--lit),inset_3px_0_0_0_var(--lit),inset_0_-3px_0_0_var(--shade),inset_-3px_0_0_0_var(--shade)]">
          REFRESH
        </button>
      </div>
    );
  }

  // All failed — show each error provider as a row so nothing is hidden, then tip
  if (active.length === 0 && errors.length > 0) {
    return (
      <div className="bevel">
        <div className="p-[13px]">
          <div className="flex items-baseline justify-between gap-[10px] mb-3">
            <span className="font-silkscreen text-[8px] tracking-[0.1em] text-muted">&gt; LIVE QUOTAS</span>
            <button onClick={onRetry} className="font-silkscreen text-[8px] tracking-[0.1em] text-muted hover:text-bone">
              REFRESH
            </button>
          </div>
          <ul>
            {errors.map((p) => (
              <li key={p.provider} className="pt-[10px] mt-[10px] border-t-[3px] border-panel-2 first:mt-0 first:pt-0 first:border-0">
                <div className="flex items-baseline justify-between gap-[10px]">
                  <span className="font-silkscreen text-[10px] tracking-[0.06em] text-bone">{p.displayName.toUpperCase()}</span>
                  {p.plan && (
                    <span className="font-silkscreen text-[8px] tracking-[0.06em] px-[6px] py-[3px] bg-rail text-muted shadow-[inset_0_2px_0_0_var(--shade),inset_2px_0_0_0_var(--shade),inset_0_-2px_0_0_var(--lit),inset_-2px_0_0_0_var(--lit)]">
                      {p.plan.toUpperCase()}
                    </span>
                  )}
                </div>
                {/* A failed provider states one reason. `warning` only shows when
                    there is no `error` to supersede it — never both. */}
                <p className="mt-[6px] text-[11.5px] leading-[1.55] text-alert">
                  {p.error ?? p.warning ?? "No data"}
                </p>
              </li>
            ))}
          </ul>
          {needsAuth.length > 0 && (
            <p className="mt-[14px] pt-[12px] border-t-[3px] border-dotted border-panel-2 text-[11px] leading-[1.55] text-muted">
              Tip: sign in to {needsAuth.map((p) => p.displayName).join(", ")} to see more.
            </p>
          )}
        </div>
        <div className="flex items-center justify-between px-[13px] py-[8px] shadow-[inset_0_3px_0_0_var(--shade)]">
          <span className="font-silkscreen text-[8px] tracking-[0.08em] text-muted">
            {checkedLabel ? `CHECKED ${checkedLabel} · CACHED 5 MIN` : "CACHED 5 MIN"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bevel">
      <div className="p-[13px]">
        <div className="flex items-baseline justify-between gap-[10px] mb-3">
          <span className="font-silkscreen text-[8px] tracking-[0.1em] text-muted">&gt; LIVE QUOTAS</span>
          <button
            onClick={onRetry}
            className="font-silkscreen text-[8px] tracking-[0.1em] text-muted hover:text-bone"
            title="Refresh quotas (5-min cache, force bypass)"
          >
            REFRESH
          </button>
        </div>

        <ul>
          {active.map((p) => (
            <li key={p.provider} className="pt-[15px] mt-[15px] border-t-[3px] border-panel-2 first:mt-0 first:pt-0 first:border-0">
              <div className="flex items-baseline justify-between gap-[10px]">
                <span className="font-silkscreen text-[10px] tracking-[0.06em] text-bone">{p.displayName.toUpperCase()}</span>
                {p.plan && (
                  <span className="font-silkscreen text-[8px] tracking-[0.06em] px-[6px] py-[3px] bg-rail text-muted shadow-[inset_0_2px_0_0_var(--shade),inset_2px_0_0_0_var(--shade),inset_0_-2px_0_0_var(--lit),inset_-2px_0_0_0_var(--lit)]">
                    {p.plan.toUpperCase()}
                  </span>
                )}
              </div>
              <ul className="mt-[10px] space-y-[10px]">
                {p.windows.map((w) => {
                  const pct = pctForWindow(w);
                  const draws = shouldDrawMeter(w);
                  const tone = pct !== null ? toneFor(pct) : null;
                  const valText = formatWindowValue(w);
                  const reset = w.resetsAt ? resetLabel(w.resetsAt, true) : "";
                  return (
                    <li key={w.label}>
                      <div className="flex items-baseline justify-between gap-[10px]">
                        <span className="text-[11.5px] text-bone">{w.label}</span>
                        <span className={`text-[11px] tabular-nums ${tone === "crit" ? "text-alert" : tone === "warm" ? "text-amber" : "text-muted"}`}>
                          <b className={`font-vt323 text-[15px] font-normal mr-[2px] ${tone === "crit" ? "text-alert" : tone === "warm" ? "text-amber" : "text-bone"}`}>
                            {w.format === "percent" ? `${Math.round(pct ?? 0)}%` : w.format === "dollars" ? `$${w.used.toFixed(2)}` : String(w.used)}
                          </b>
                          {w.format === "percent" ? " used" : w.format === "dollars" ? (w.limit > 0 ? ` of $${w.limit.toFixed(0)}` : "") : " used"}
                          {reset ? ` · ${reset}` : ""}
                          {/* Keep full value accessible for screen readers */}
                          <span className="sr-only">{valText}{reset ? `, ${resetLabel(w.resetsAt, false)}` : ""}</span>
                        </span>
                      </div>
                      {draws && pct !== null && <BlockMeter pct={pct} />}
                    </li>
                  );
                })}
              </ul>
              {p.warning && <p className="mt-[7px] text-[11px] text-amber">{p.warning}</p>}
            </li>
          ))}
        </ul>

        {needsAuth.length > 0 && (
          <p className="mt-[14px] pt-[12px] border-t-[3px] border-dotted border-panel-2 text-[11px] leading-[1.55] text-muted">
            Tip: sign in to {needsAuth.map((p) => p.displayName).join(", ")} to see more.
          </p>
        )}
        {errors.length > 0 && (
          <p className="mt-[10px] text-[11.5px] leading-[1.55] text-alert">
            {errors
              .map((p) => `${p.displayName}: ${p.error ?? p.warning ?? "no data"}`)
              .join(" · ")
              .slice(0, 200)}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between px-[13px] py-[8px] shadow-[inset_0_3px_0_0_var(--shade)]">
        <span className="font-silkscreen text-[8px] tracking-[0.08em] text-muted">
          {checkedLabel ? `CHECKED ${checkedLabel} · CACHED 5 MIN` : "CACHED 5 MIN"}
        </span>
      </div>
    </div>
  );
}

export function DashboardQuotaSection(props: {
  providers: QuotaProvider[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}): ReactNode {
  const { providers, loading, error, onRetry } = props;
  const active = providers.filter((p) => p.status === "ok" && p.windows.length > 0);
  if (loading && providers.length === 0)
    return <div className="rounded-card border border-border bg-surface p-4 text-sm text-muted">Loading live quotas…</div>;
  if (error)
    return (
      <div className="rounded-card border border-border bg-surface p-4 text-sm text-danger">
        {error} <button onClick={onRetry} className="ml-2 underline">Retry</button>
      </div>
    );
  if (active.length === 0) {
    return (
      <section className="rounded-card border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Live quotas</h3>
        <p className="mt-1 text-sm text-muted">No live quota data. Sign in to Claude Code, Codex or OpenCode and hit Refresh.</p>
        <button onClick={onRetry} className="mt-3 rounded-control border border-border bg-surface-2 px-3 py-1 text-sm">
          Refresh quotas
        </button>
      </section>
    );
  }
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Live quotas</h3>
        <button onClick={onRetry} className="text-xs text-muted hover:text-text-1">
          Refresh
        </button>
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
                      <span className="tabular-nums">
                        {w.format === "percent"
                          ? `${Math.round(pct)}%`
                          : w.format === "dollars"
                            ? `$${w.used.toFixed(2)}`
                            : String(w.used)}
                        {w.resetsAt ? ` · ${resetLabel(w.resetsAt)}` : ""}
                      </span>
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
