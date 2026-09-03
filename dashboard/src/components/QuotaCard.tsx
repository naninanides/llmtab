import { type ReactNode } from "react";
import type { QuotaProvider } from "@/api";
import {
  barColor,
  resetLabel,
  pctForWindow,
  shouldDrawMeter,
  formatWindowValue,
  toneFor,
} from "@/quota";
import { Meter, Button } from "@/components/glass";

// Re-export for callers that imported from here (BlockMeter previously did)
export { barColor, resetLabel };

// ── Quotas tab panel — Vitrine, 300px popover ───────────────────────────

/** Section header with the refresh action. */
function QuotaHead({ onRetry, count }: { onRetry: () => void; count?: number }): ReactNode {
  return (
    <div className="mb-[8px] flex items-center gap-[10px]">
      <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-text-3">
        Live quotas
      </span>
      {/* Say how many there are, so a provider below the fold is known to
          exist rather than simply missing. Whether the list actually scrolls
          depends on the window height, so this is not gated on a count. */}
      {count !== undefined && count > 1 && (
        <span className="text-[10px] text-text-3">{count} providers</span>
      )}
      <button
        onClick={onRetry}
        title="Refresh quotas (5-min cache, force bypass)"
        className="ml-auto text-[11px] font-medium text-accent-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2"
      >
        Refresh
      </button>
    </div>
  );
}

/** Provider name plus plan chip. */
function ProviderHead({ p }: { p: QuotaProvider }): ReactNode {
  return (
    <div className="mb-[9px] flex items-center gap-[7px]">
      <b className="text-[12px] font-semibold">{p.displayName}</b>
      {p.plan && (
        <span className="rounded-full border border-edge px-[6px] py-[2px] text-[9px] font-semibold uppercase tracking-[0.07em] text-text-3">
          {p.plan}
        </span>
      )}
    </div>
  );
}

/** Footer: when the numbers were read, and that they are cached. */
function CheckedFoot({ label }: { label: string | null }): ReactNode {
  return (
    <div className="border-t border-edge px-[11px] py-[7px] text-[10px] text-text-3">
      {label ? `Read at ${label} · cached 5 min` : "Cached 5 min"}
    </div>
  );
}

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

  // Skeleton matching the final layout — never a spinner.
  if (loading && providers.length === 0) {
    return (
      <div>
        <QuotaHead onRetry={onRetry} />
        {[0, 1].map((i) => (
          <div key={i} className="glass-thin mb-[8px] rounded-[10px] px-[10px] py-[9px]">
            <div className="h-[12px] w-[38%] animate-pulse rounded bg-[rgba(120,140,160,0.22)]" />
            <div className="mt-[10px] h-[6px] w-full animate-pulse rounded-full bg-[rgba(120,140,160,0.18)]" />
            <div className="mt-[8px] h-[6px] w-full animate-pulse rounded-full bg-[rgba(120,140,160,0.18)]" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <QuotaHead onRetry={onRetry} />
        <div className="glass-thin rounded-[10px] p-4 text-center">
          <p className="text-[11.5px] leading-[1.55] text-danger">{error}</p>
          <Button className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Nothing signed in: an empty screen is an invitation to act.
  if (active.length === 0 && needsAuth.length > 0 && errors.length === 0) {
    return (
      <div>
        <QuotaHead onRetry={onRetry} />
        <div className="glass-thin rounded-[10px] p-4 text-center">
          <div className="text-[12px] font-semibold">No live quotas</div>
          <p className="mx-auto mt-2 max-w-[32ch] text-[11px] leading-[1.55] text-text-2">
            Sign in to Claude Code, Codex or OpenCode, then refresh to read your limits.
          </p>
          <Button className="mt-3" onClick={onRetry}>
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  // All failed — each error provider gets a row so nothing is hidden.
  if (active.length === 0 && errors.length > 0) {
    return (
      <div>
        <QuotaHead onRetry={onRetry} />
        {errors.map((p) => (
          <div key={p.provider} className="glass-thin mb-[8px] rounded-[10px] px-[10px] py-[9px]">
            <ProviderHead p={p} />
            {/* A failed provider states one reason. `warning` only shows when
                there is no `error` to supersede it — never both. */}
            <p className="text-[11.5px] leading-[1.55] text-danger">
              {p.error ?? p.warning ?? "No data"}
            </p>
          </div>
        ))}
        {needsAuth.length > 0 && (
          <p className="mt-[10px] text-[11px] leading-[1.55] text-text-2">
            Tip: sign in to {needsAuth.map((p) => p.displayName).join(", ")} to see more.
          </p>
        )}
        <CheckedFoot label={checkedLabel} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <QuotaHead onRetry={onRetry} count={active.length} />

      {/* Only this list scrolls. The panel is bounded by the window, so the
          providers absorb any overflow while the tabs, the refresh header and
          the action footer stay put. Nothing is filtered out — a quota you are
          about to hit has to stay reachable. */}
      <div className="-mr-[6px] min-h-0 flex-1 overflow-y-auto pr-[6px]">
        {active.map((p) => (
          <div key={p.provider} className="glass-thin mb-[8px] rounded-[10px] px-[10px] py-[9px]">
            <ProviderHead p={p} />
            <ul className="space-y-[8px]">
              {p.windows.map((w) => {
                const pct = pctForWindow(w);
                const draws = shouldDrawMeter(w);
                const tone = pct !== null ? toneFor(pct) : null;
                const valText = formatWindowValue(w);
                const reset = w.resetsAt ? resetLabel(w.resetsAt) : "";
                return (
                  <li key={w.label}>
                    <div className="flex items-baseline justify-between gap-[10px] text-[11px]">
                      <span className="text-text-2">{w.label}</span>
                      <b
                        className={`text-[12px] font-semibold tabular-nums ${
                          tone === "crit"
                            ? "text-danger"
                            : tone === "warm"
                              ? "text-warn"
                              : "text-text-1"
                        }`}
                      >
                        {w.format === "percent"
                          ? `${Math.round(pct ?? 0)}%`
                          : w.format === "dollars"
                            ? `$${w.used.toFixed(2)}${w.limit > 0 ? ` of $${w.limit.toFixed(0)}` : ""}`
                            : `${w.used} used`}
                        {/* Keep the full value available to screen readers. */}
                        <span className="sr-only">
                          {valText}
                          {reset ? `, ${reset}` : ""}
                        </span>
                      </b>
                    </div>
                    {draws && pct !== null && <Meter pct={pct} className="mt-[6px] h-[5px]" />}
                    {/* A count window has no published limit, so no meter is drawn
                      — say why rather than leaving a value with no context. */}
                    {!draws && w.format === "count" && (
                      <div className="mt-[3px] text-[10px] text-text-3">No published limit</div>
                    )}
                    {reset && <div className="mt-[4px] text-[10px] text-text-3">{reset}</div>}
                  </li>
                );
              })}
            </ul>
            {p.warning && <p className="mt-[7px] text-[11px] text-warn">{p.warning}</p>}
          </div>
        ))}
      </div>

      {needsAuth.length > 0 && (
        <p className="mt-[10px] text-[11px] leading-[1.55] text-text-2">
          Tip: sign in to {needsAuth.map((p) => p.displayName).join(", ")} to see more.
        </p>
      )}
      {errors.length > 0 && (
        <p className="mt-[10px] text-[11.5px] leading-[1.55] text-danger">
          {errors
            .map((p) => `${p.displayName}: ${p.error ?? p.warning ?? "no data"}`)
            .join(" · ")
            .slice(0, 200)}
        </p>
      )}
      <CheckedFoot label={checkedLabel} />
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
    return (
      <div className="glass rounded-panel p-4 text-[13px] text-text-2">Loading live quotas…</div>
    );

  if (error)
    return (
      <div className="glass rounded-panel p-4 text-[13px] text-danger">
        {error}{" "}
        <button onClick={onRetry} className="ml-2 underline">
          Retry
        </button>
      </div>
    );

  if (active.length === 0) {
    return (
      <section className="glass rounded-panel p-4">
        <h3 className="text-[14px] font-semibold">Live quotas</h3>
        <p className="mt-1 text-[13px] text-text-2">
          No live quota data. Sign in to Claude Code, Codex or OpenCode and hit Refresh.
        </p>
        <Button className="mt-3" onClick={onRetry}>
          Refresh quotas
        </Button>
      </section>
    );
  }

  return (
    <section className="glass rounded-panel p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold">Live quotas</h3>
        <button
          onClick={onRetry}
          className="text-[12px] text-text-2 hover:text-text-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2"
        >
          Refresh
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        {active.map((p) => (
          <div key={p.provider} className="glass-thin rounded-card p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-medium">{p.displayName}</span>
              {p.plan && <span className="text-[11px] text-text-3">{p.plan}</span>}
            </div>
            <ul className="mt-2 space-y-2">
              {p.windows.map((w) => {
                const pct = pctForWindow(w);
                const draws = shouldDrawMeter(w);
                return (
                  <li key={w.label}>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-text-2">{w.label}</span>
                      <span className="tabular-nums">
                        {formatWindowValue(w)}
                        {w.resetsAt ? ` · ${resetLabel(w.resetsAt)}` : ""}
                      </span>
                    </div>
                    {draws && pct !== null && <Meter pct={pct} className="mt-1 h-[5px]" />}
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
