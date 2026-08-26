import type { ReactNode } from "react";
import { useRange } from "@/hooks/useRange";
import type { RangeDef } from "@/api";
import { compact, cost, percent } from "@/format";

/** Segmented range control (FR-20) — one selection drives every view. */
export function RangeTabs(): ReactNode {
  const { range, setRange } = useRange();
  const options: Array<{ kind: RangeDef["kind"]; label: string }> = [
    { kind: "today", label: "Today" },
    { kind: "7d", label: "7d" },
    { kind: "30d", label: "30d" },
    { kind: "all", label: "All" },
  ];
  return (
    <div role="tablist" aria-label="Time range" className="flex items-center gap-1 rounded-full border border-border bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.kind}
          role="tab"
          aria-selected={range.kind === o.kind}
          onClick={() => setRange({ kind: o.kind })}
          className={`rounded-full px-4 min-h-[40px] text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            range.kind === o.kind ? "bg-surface-2 text-accent" : "text-text-2 hover:text-text-1"
          }`}
        >
          {o.label}
        </button>
      ))}
      <CustomRangeButton />
    </div>
  );
}

function CustomRangeButton(): ReactNode {
  const { range, setRange } = useRange();
  const isCustom = range.kind === "custom";
  if (isCustom) {
    return (
      <span className="flex items-center gap-1">
        <input
          type="date"
          aria-label="From date"
          value={range.from ?? ""}
          onChange={(e) => setRange({ kind: "custom", from: e.target.value, to: range.to ?? e.target.value })}
          className="rounded-control bg-surface-2 px-2 py-1 text-xs text-text-1"
        />
        <input
          type="date"
          aria-label="To date"
          value={range.to ?? ""}
          onChange={(e) => setRange({ kind: "custom", from: range.from ?? e.target.value, to: e.target.value })}
          className="rounded-control bg-surface-2 px-2 py-1 text-xs text-text-1"
        />
      </span>
    );
  }
  return (
    <button
      role="tab"
      aria-selected={false}
      onClick={() => setRange({ kind: "custom", from: "", to: "" })}
      className="rounded-full px-4 py-1.5 text-sm font-medium text-text-2 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      Custom
    </button>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  deltaPct: number | null;
}

/** Stat card with delta chip vs previous equal range (FR-21). */
export function StatCard({ label, value, deltaPct }: StatCardProps): ReactNode {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-text-2">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {deltaPct !== null && Number.isFinite(deltaPct) && <DeltaChip pct={deltaPct} />}
      </div>
    </div>
  );
}

export function DeltaChip({ pct }: { pct: number }): ReactNode {
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium ${up ? "text-accent" : "text-danger"}`} title="vs previous equal-length range">
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {Math.round(pct)}%
    </span>
  );
}

export function HeroCard({
  totalTokens,
  costUsd,
  unpricedModels,
}: {
  totalTokens: number;
  costUsd: number;
  unpricedModels: string[];
}): ReactNode {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-text-2">Total tokens</div>
      <div className="mt-1 text-4xl font-bold leading-tight tabular-nums">{compact(totalTokens)}</div>
      <div className="mt-1 flex items-center gap-2 text-sm text-text-2">
        <span>{cost(costUsd, { est: true })} est.</span>
        {unpricedModels.length > 0 && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400" title={unpricedModels.join(", ")}>
            unpriced: {unpricedModels.length} model{unpricedModels.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

export function ModelCards({
  models,
}: {
  models: Array<{ model: string; totalTokens: number; costUsd: number }>;
}): ReactNode {
  const grand = models.reduce((a, m) => a + m.totalTokens, 0);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {models.slice(0, 6).map((m) => (
        <div key={m.model} className="rounded-card border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold" title={m.model}>{m.model}</span>
            <span className="text-sm tabular-nums text-accent">{percent(m.totalTokens, grand)}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between text-sm tabular-nums text-text-2">
            <span>{compact(m.totalTokens)} tokens</span>
            <span>{m.costUsd > 0 ? cost(m.costUsd, { est: true }) : "—"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
