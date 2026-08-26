import { useEffect, useState, type ReactNode } from "react";
import { api, type RangeDef, type ToolRow } from "@/api";
import { compact, cost } from "@/format";

/**
 * Total Spend card inspired by OpenUsage's screenshot (docs/dashboard.md #Total Spend).
 * - Capsule switcher: Today / Yesterday / 30 Days
 * - Donut ring with center total, legend with per-tool share
 * - Metric toggle: Cost vs Tokens (Cost is default, like OpenUsage)
 * Own data fetches so the period switcher is independent of the global Range.
 */

type Period = "today" | "yesterday" | "30d";
type Metric = "cost" | "tokens";

const TOOL_COLORS: Record<string, string> = {
  "claude-code": "#d97757", // terracotta like Claude
  codex: "#10a37f", // Codex / OpenAI green
  "gemini-cli": "#4285f4",
  zcode: "#1a73e8",
  opencode: "#0ea5e9",
  ollama: "#f59e0b",
};
const FALLBACK_COLORS = ["#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#94a3b8"];

function colorFor(tool: string, idx: number): string {
  return TOOL_COLORS[tool] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]!;
}

function rangeForPeriod(p: Period): RangeDef {
  if (p === "today") return { kind: "today" };
  if (p === "30d") return { kind: "30d" };
  // yesterday = custom [yesterday 00:00, today 00:00)
  const now = new Date();
  const todayMid = new Date(now);
  todayMid.setHours(0, 0, 0, 0);
  const yestMid = new Date(todayMid.getTime() - 24 * 3600_000);
  const toMid = todayMid;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { kind: "custom", from: fmt(yestMid), to: fmt(toMid) };
}

export function TotalSpendCard(): ReactNode {
  const [period, setPeriod] = useState<Period>("30d");
  const [metric, setMetric] = useState<Metric>("cost");
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const r = rangeForPeriod(period);
    api
      .tools(r)
      .then((res) => {
        if (cancelled) return;
        setTools(res.tools);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const hasData = tools !== null && tools.length > 0 && tools.some((t) => (metric === "cost" ? t.costUsd : t.totalTokens) > 0);
  const grandCost = tools?.reduce((a, t) => a + t.costUsd, 0) ?? 0;
  const grandTokens = tools?.reduce((a, t) => a + t.totalTokens, 0) ?? 0;
  const sorted = tools ? [...tools].sort((a, b) => (metric === "cost" ? b.costUsd - a.costUsd : b.totalTokens - a.totalTokens)) : [];

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      {/* Header: title + metric toggle (like OpenUsage Cost/CostMTok/Tokens pull-down) */}
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Total Spend</h2>
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] text-text-2"
          title="Spend & tokens from local logs — est. costs via LiteLLM pricing"
        >
          ⓘ
        </span>
        <button
          type="button"
          aria-label="Copy totals"
          className="ml-auto hidden text-text-2 hover:text-text-1 sm:inline"
          title="Share — copy totals to clipboard"
          onClick={() => {
            const text = `${compact(grandTokens)} tokens · ${cost(grandCost, { est: true })}`;
            void navigator.clipboard.writeText(text).catch(() => {});
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v3" />
          </svg>
        </button>
        <select
          aria-label="Metric"
          value={metric}
          onChange={(e) => setMetric(e.target.value as Metric)}
          className="rounded-full border border-border bg-surface-2 px-2 py-1 text-xs font-medium text-text-1"
        >
          <option value="cost">Cost</option>
          <option value="tokens">Tokens</option>
        </select>
      </div>

      {/* Capsule period switcher — Today / Yesterday / 30 Days (like screenshot) */}
      <div className="mt-3 flex justify-center">
        <div
          role="tablist"
          aria-label="Total spend period"
          className="inline-flex gap-1 rounded-full bg-surface-2 p-1"
        >
          {(["today", "yesterday", "30d"] as Period[]).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                period === p ? "bg-surface text-text-1 shadow-sm" : "text-text-2 hover:text-text-1"
              }`}
            >
              {p === "today" ? "Today" : p === "yesterday" ? "Yesterday" : "30 Days"}
            </button>
          ))}
        </div>
      </div>

      {/* Body: donut + legend or empty/loading */}
      <div className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="h-28 w-28 animate-pulse rounded-full bg-surface-2" />
          </div>
        ) : err ? (
          <p className="py-8 text-center text-sm text-danger">{err}</p>
        ) : !hasData ? (
          <p className="py-8 text-center text-sm text-text-2">No spend in this period.</p>
        ) : (
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <Donut
              tools={sorted}
              metric={metric}
              centerTop={metric === "cost" ? cost(grandCost, { est: true }) : compact(grandTokens)}
              centerBottom={metric === "cost" ? "dollars" : "tokens"}
              centerHover={`${metric === "cost" ? cost(grandCost, { est: true }) : compact(grandTokens) + " tokens"} · ${sorted.length} tools`}
            />
            <ul className="w-full flex-1 space-y-2">
              {sorted.slice(0, 6).map((t, i) => {
                const share = metric === "cost" ? (grandCost > 0 ? (t.costUsd / grandCost) * 100 : 0) : grandTokens > 0 ? (t.totalTokens / grandTokens) * 100 : 0;
                const display = metric === "cost" ? cost(t.costUsd, { est: true }) : compact(t.totalTokens);
                return (
                  <li key={t.tool} className="flex items-center gap-2 text-sm">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor(t.tool, i) }} />
                    <span className="flex-1 truncate font-medium capitalize">{labelForTool(t.tool)}</span>
                    <span className="tabular-nums text-text-2">{share.toFixed(0)}% ·</span>
                    <span className="tabular-nums font-medium">{display}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function labelForTool(tool: string): string {
  const m: Record<string, string> = {
    "claude-code": "Claude",
    codex: "Codex",
    "gemini-cli": "Gemini",
    zcode: "ZCode",
    opencode: "OpenCode",
    ollama: "Ollama",
  };
  return m[tool] ?? tool;
}

function Donut({
  tools,
  metric,
  centerTop,
  centerBottom,
  centerHover,
}: {
  tools: ToolRow[];
  metric: Metric;
  centerTop: string;
  centerBottom: string;
  centerHover: string;
}): ReactNode {
  const total = tools.reduce((a, t) => a + (metric === "cost" ? t.costUsd : t.totalTokens), 0);
  const size = 128;
  const r = 48;
  const stroke = 18;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const segments = tools
    .filter((t) => (metric === "cost" ? t.costUsd : t.totalTokens) > 0)
    .map((t, i) => {
      const v = metric === "cost" ? t.costUsd : t.totalTokens;
      const frac = total > 0 ? v / total : 0;
      const len = c * frac;
      // ensure tiny shares keep a visible sliver (like OpenUsage)
      const visibleLen = frac > 0 && frac < 0.02 ? c * 0.02 : len;
      const dash = `${visibleLen} ${c - visibleLen}`;
      const seg = (
        <circle
          key={t.tool}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colorFor(t.tool, i)}
          strokeWidth={stroke}
          strokeDasharray={dash}
          strokeDashoffset={-offset}
          strokeLinecap="butt"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      );
      offset += len;
      return seg;
    });

  return (
    <div className="relative shrink-0" title={centerHover}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block" role="img" aria-label="Spend share by tool">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        {segments}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[15px] font-bold leading-none tabular-nums">{centerTop}</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-text-2">{centerBottom}</span>
      </div>
    </div>
  );
}
