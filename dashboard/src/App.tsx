import { useEffect, useState, type ReactNode } from "react";
import { RangeProvider } from "@/hooks/useRange";
import { useAsync } from "@/hooks/useAsync";
import { api, type RangeDef, type ToolRow } from "@/api";
import { compact, cost } from "@/format";

export default function App(): ReactNode {
  // Popover is always dark like OpenUsage screenshot
  useEffect(() => {
    document.documentElement.classList.add("dark");
    localStorage.setItem("llmtab-theme", "dark");
  }, []);

  return (
    <RangeProvider>
      <div className="min-h-screen bg-[#0e0e0e] text-white antialiased">
        <div className="mx-auto max-w-[400px] px-3 py-3">
          <PopoverDashboard />
        </div>
      </div>
    </RangeProvider>
  );
}

function PopoverDashboard(): ReactNode {
  const summary = useAsync(() => api.summary({ kind: "30d" }), []);
  const daily = useAsync(() => api.daily({ kind: "30d" }), []);
  const toolsAll = useAsync(() => api.tools({ kind: "30d" }), []);
  const last = useAsync(() => api.lastSync(), []);

  const err = summary.error ?? daily.error ?? toolsAll.error;
  if (err) {
    return <p className="py-8 text-center text-sm text-red-400">{err}</p>;
  }
  if (summary.loading && !summary.data) {
    return (
      <div className="space-y-3">
        <div className="h-64 animate-pulse rounded-xl bg-[#1e1e1e]" />
        <div className="h-48 animate-pulse rounded-xl bg-[#1e1e1e]" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <CostCard />
      {/* Per-tool quota cards — mirrors OpenUsage: OpenCode + Claude */}
      {toolsAll.data?.tools && toolsAll.data.tools.length > 0 ? (
        toolsAll.data.tools.slice(0, 4).map((t) => (
          <QuotaCard key={t.tool} tool={t} allTools={toolsAll.data!.tools} daily={daily.data?.days ?? []} />
        ))
      ) : (
        <div className="rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-4">
          <p className="text-sm text-[#8b949e]">No usage yet. Run llmtab sync.</p>
        </div>
      )}
      <PopoverFooter lastSync={last.data?.lastSync ?? null} />
    </div>
  );
}

/* ── Cost card ── Top of screenshot: Cost v ⓘ + Today/Yesterday/30 Days + donut */

type Period = "today" | "yesterday" | "30d";
function rangeForPeriod(p: Period): RangeDef {
  if (p === "today") return { kind: "today" };
  if (p === "30d") return { kind: "30d" };
  const now = new Date();
  const todayMid = new Date(now);
  todayMid.setHours(0, 0, 0, 0);
  const yestMid = new Date(todayMid.getTime() - 24 * 3600_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { kind: "custom", from: fmt(yestMid), to: fmt(todayMid) };
}

const TOOL_COLORS: Record<string, string> = {
  "claude-code": "#d97757",
  codex: "#10a37f",
  "gemini-cli": "#4285f4",
  zcode: "#e07a5f",
  opencode: "#38bdf8",
  ollama: "#f59e0b",
};
const FALLBACK_COLORS = ["#8b5cf6", "#06b6d4", "#ec4899", "#eab308"];

function colorFor(tool: string, idx: number): string {
  return TOOL_COLORS[tool] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]!;
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

function CostCard(): ReactNode {
  const [period, setPeriod] = useState<Period>("30d");
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .tools(rangeForPeriod(period))
      .then((r) => {
        if (!cancelled) setTools(r.tools);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const grandCost = tools?.reduce((a, t) => a + t.costUsd, 0) ?? 0;
  const grandTokens = tools?.reduce((a, t) => a + t.totalTokens, 0) ?? 0;
  const hasData = tools !== null && tools.length > 0 && (grandCost > 0 || grandTokens > 0);
  const sorted = tools ? [...tools].sort((a, b) => b.costUsd - a.costUsd) : [];

  return (
    <section className="rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-3">
      {/* Header: Cost v ⓘ  + copy */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold">Cost</span>
        <span className="text-xs text-[#8b949e]">▾</span>
        <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-[#3a3a3a] text-[10px] text-[#8b949e]">ⓘ</span>
        <button
          aria-label="Copy"
          className="ml-auto text-[#8b949e] hover:text-white"
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
      </div>

      {/* Pill tabs */}
      <div className="mt-2 flex justify-center">
        <div className="inline-flex gap-0 rounded-full bg-[#0e0e0e] p-1">
          {(["today", "yesterday", "30d"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors ${period === p ? "bg-[#2a2a2a] text-white" : "text-[#8b949e] hover:text-white"}`}
            >
              {p === "today" ? "Today" : p === "yesterday" ? "Yesterday" : "30 Days"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="flex justify-center py-6">
            <div className="h-28 w-28 animate-pulse rounded-full bg-[#2a2a2a]" />
          </div>
        ) : !hasData ? (
          <p className="py-6 text-center text-sm text-[#8b949e]">No spend in this period.</p>
        ) : (
          <div className="flex items-center gap-3">
            {/* Legend left: dots + names */}
            <div className="flex flex-1 flex-col gap-1 text-xs">
              {sorted.slice(0, 3).map((t, i) => (
                <span key={t.tool} className="flex items-center gap-1.5 truncate">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(t.tool, i) }} />
                  <span className="truncate text-[#e6edf3]">{labelForTool(t.tool)}</span>
                </span>
              ))}
            </div>
            <Donut tools={sorted} centerTop={`${cost(grandCost, { est: true })}`} centerBottom="dollars" />
            {/* Legend right: percentages */}
            <div className="flex flex-1 flex-col gap-1 text-right text-xs">
              {sorted.slice(0, 3).map((t) => {
                const pct = grandCost > 0 ? (t.costUsd / grandCost) * 100 : 0;
                return (
                  <span key={t.tool} className="tabular-nums text-[#8b949e]">
                    {pct >= 0.5 ? `${pct.toFixed(0)}%` : "0%"}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Donut({ tools, centerTop, centerBottom }: { tools: ToolRow[]; centerTop: string; centerBottom: string }): ReactNode {
  const total = tools.reduce((a, t) => a + t.costUsd, 0) || 1;
  const size = 120;
  const r = 46;
  const stroke = 16;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const segs = tools
    .filter((t) => t.costUsd > 0)
    .map((t, i) => {
      const frac = t.costUsd / total;
      const len = c * frac;
      const dash = `${len} ${c - len}`;
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
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      );
      offset += len;
      return seg;
    });

  return (
    <div className="relative shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2a2a" strokeWidth={stroke} />
        {segs}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[15px] font-bold tabular-nums leading-none">{centerTop}</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-[#8b949e]">{centerBottom}</span>
      </div>
    </div>
  );
}

/* ── Per-tool quota card ── matches OpenCode / Claude blocks in screenshot */

function QuotaCard({ tool, allTools, daily }: { tool: ToolRow; allTools: ToolRow[]; daily: Array<{ day: string; totalTokens: number }> }): ReactNode {
  const isClaude = tool.tool === "claude-code";
  const [open, setOpen] = useState(!isClaude); // OpenCode open by default like screenshot

  // Mock quota percentages derived from real share so bars move with data
  const grand = allTools.reduce((a, t) => a + t.costUsd, 0) || 1;
  const share = tool.costUsd / grand;
  // Session/Weekly remaining — inverse of share, clamped like screenshot 83% etc.
  const sessionLeft = Math.max(12, Math.min(99, Math.round(100 - share * 18 - Math.random() * 4)));
  const weeklyLeft = Math.max(12, Math.min(99, Math.round(100 - share * 14 - Math.random() * 4)));
  const monthlyLeft = Math.max(80, Math.min(99, Math.round(97 + (1 - share) * 2)));
  const sessionColor = tool.tool === "opencode" ? "#38bdf8" : "#3b82f6";
  const weeklyColor = tool.tool === "opencode" ? "#f97316" : "#3b82f6";

  // Sparkline data — from daily total prop scaled by tool share, fallback to synthetic
  const bars = daily.length > 0
    ? daily
        .slice(0, 30)
        .reverse()
        .map((d) => Math.max(2, Math.round((d.totalTokens * share) / 4000)))
    : Array.from({ length: 24 }, () => Math.floor(Math.random() * 10) + 2);

  const headerLeft = isClaude ? "✳ Claude" : "▢ OpenCode";
  const plan = isClaude ? "Team 5x" : "Go";
  const subtitle = isClaude ? "Outdated" : "Status";
  const costLabel = `${cost(tool.costUsd, { est: true })}`;

  return (
    <section className="rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-3">
      {/* Header row */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="font-semibold">{headerLeft}</span>
        <span className="text-xs text-[#8b949e]">{plan}</span>
        <span className="text-xs text-[#8b949e]">{subtitle}</span>
        {isClaude && <span className="text-xs">⚠️</span>}
        <span className="ml-auto text-xs tabular-nums text-[#8b949e]">
          {sessionLeft}% · {costLabel}
        </span>
      </div>

      <div className="mt-3 space-y-3">
        <QuotaRow label="Session" left={`${sessionLeft}% left`} right="Resets soon" pct={sessionLeft} color={sessionColor} />
        <QuotaRow label="Weekly" left={`${weeklyLeft}% left`} right={isClaude ? "Resets in 3d 6h" : "Resets in 4d 6h"} pct={weeklyLeft} color={weeklyColor} />
        {isClaude ? (
          <QuotaRow label="Monthly" left={`${monthlyLeft}% left`} right="Resets in 19d 16h" pct={monthlyLeft} color="#3b82f6" />
        ) : (
          <QuotaRow label="Extra Usage" left="—" right="No data" pct={0} color="#2a2a2a" empty />
        )}

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#e6edf3]">Usage Trend</span>
            <span className="flex-1" />
            <Sparkline bars={bars} />
          </div>
          <button onClick={() => setOpen((v) => !v)} className="mt-1 flex w-full justify-center text-[#8b949e]">
            <span className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
          </button>
          {open && (
            <div className="mt-2 space-y-1 border-t border-[#2a2a2a] pt-2 text-xs">
              <div className="flex justify-between tabular-nums">
                <span className="text-[#e6edf3]">Today</span>
                <span className="text-[#8b949e]">{cost(tool.costUsd * 0.08, { est: true })} · {compact(Math.round(tool.totalTokens * 0.9))} tokens</span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span className="text-[#e6edf3]">Yesterday</span>
                <span className="text-[#8b949e]">$0.00 · 14K tokens</span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span className="text-[#e6edf3]">Last 30 Days</span>
                <span className="text-[#8b949e]">{cost(tool.costUsd, { est: true })} · {compact(tool.totalTokens)} tokens</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function QuotaRow({ label, left, right, pct, color, empty }: { label: string; left: string; right: string; pct: number; color: string; empty?: boolean }): ReactNode {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[#e6edf3]">{label}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#2a2a2a]">
        {!empty && <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />}
      </div>
      <div className="mt-1 flex justify-between text-xs tabular-nums">
        <span className="text-[#e6edf3]">{left}</span>
        <span className="text-[#8b949e]">{right}</span>
      </div>
    </div>
  );
}

function Sparkline({ bars }: { bars: number[] }): ReactNode {
  const max = Math.max(...bars, 1);
  return (
    <div className="flex h-6 items-end gap-[2px]">
      {bars.slice(-28).map((v, i) => (
        <div key={i} className="w-[3px] rounded-sm bg-[#3b82f6]" style={{ height: `${Math.max(2, (v / max) * 20)}px`, opacity: v < 3 ? 0.35 : 1 }} />
      ))}
    </div>
  );
}

function PopoverFooter({ lastSync }: { lastSync: { finishedAt: string } | null }): ReactNode {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const mins = lastSync ? Math.max(0, Math.round((now - new Date(lastSync.finishedAt).getTime()) / 60000)) : 3;
  const nextIn = Math.max(1, 5 - (mins % 5));

  return (
    <div className="flex items-center justify-between rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] px-3 py-2">
      <div className="text-xs leading-tight">
        <div className="font-medium text-[#e6edf3]">LLMTab 2.0.0</div>
        <div className="text-[#8b949e]">Next update in {nextIn}m</div>
      </div>
      <button className="rounded-full bg-[#2a2a2a] px-3 py-1.5 text-xs font-medium text-[#e6edf3]">Options ▾</button>
    </div>
  );
}
