import { useEffect, useState, type ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { RangeProvider, useRange } from "@/hooks/useRange";
import { useAsync, Skeleton } from "@/hooks/useAsync";
import { api, rangeParam, type DayRow, type ModelRow, type RangeDef, type SummaryResponse, type ToolRow } from "@/api";
import { compact, cost, percent } from "@/format";
import { HeroCard, ModelCards, RangeTabs, StatCard } from "@/components/Cards";
import { TrendChart } from "@/components/TrendChart";
import { Heatmap } from "@/components/Heatmap";
import { DailyTable } from "@/components/DailyTable";
import { ProjectList, ToolBreakdown } from "@/components/ToolProject";
import { SyncFooter } from "@/components/SyncFooter";

const IS_ELECTRON = typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

type Period = "today" | "7d" | "30d";
type View = "popover" | "dashboard";

const RANGE_FOR: Record<Period, RangeDef> = {
  today: { kind: "today" },
  "7d": { kind: "7d" },
  "30d": { kind: "30d" },
};

const CAPTION: Record<Period, string> = {
  today: "Today total usage",
  "7d": "7d total usage",
  "30d": "30d total usage",
};

const LOCAL_TOOLS = new Set(["ollama"]);

export default function App(): ReactNode {
  const [view, setView] = useState<View>(() =>
    window.location.pathname.startsWith("/dashboard") ? "dashboard" : "popover",
  );

  return (
    <RangeProvider>
      {view === "popover" ? (
        <div className="min-h-screen w-full bg-gradient-to-b from-[#b4cdf4] via-[#92b3ee] to-[#6f9ce9]">
          <div className="mx-auto max-w-[360px] p-2">
            <PopoverView onOpenDashboard={() => setView("dashboard")} />
          </div>
        </div>
      ) : (
        <div className="min-h-screen w-full bg-[#eef2f9]">
          <div className="mx-auto max-w-page px-6 py-6">
            <DashboardView onBack={() => setView("popover")} />
          </div>
        </div>
      )}
    </RangeProvider>
  );
}

function deltaPct(cur: number | undefined, prev: number | undefined): number | null {
  if (cur === undefined || prev === undefined || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

/* ── Popover (reference design) ─────────────────────────────────────── */

function PopoverView({ onOpenDashboard }: { onOpenDashboard: () => void }): ReactNode {
  const [period, setPeriod] = useState<Period>("7d");
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<"sources" | "models">(() =>
    window.location.hash === "#models" ? "models" : "sources",
  );
  const range = RANGE_FOR[period];
  const key = rangeParam(range);
  const summary = useAsync(() => api.summary(range), [key]);
  const daily = useAsync(() => api.daily(range), [key]);
  const tools = useAsync(() => api.tools(range), [key]);
  const models = useAsync(() => api.models(range), [key]);

  const s = summary.data;
  const err = summary.error ?? daily.error ?? tools.error ?? models.error;
  const toolRows = tools.data?.tools ?? [];
  const total = s?.totalTokens ?? 0;
  const localTokens = toolRows.filter((t) => LOCAL_TOOLS.has(t.tool)).reduce((a, t) => a + t.totalTokens, 0);
  const cloudRows = toolRows.filter((t) => !LOCAL_TOOLS.has(t.tool));
  const cloudTokens = cloudRows.reduce((a, t) => a + t.totalTokens, 0);
  const cloudCost = cloudRows.reduce((a, t) => a + t.costUsd, 0);
  const trend = deltaPct(s?.totalTokens, s?.previous?.totalTokens);
  const cloudDelta = deltaPct(s?.costUsd, s?.previous?.costUsd);

  async function syncNow(): Promise<void> {
    setSyncing(true);
    try {
      await api.sync();
      summary.reload();
      daily.reload();
      tools.reload();
      models.reload();
    } catch {
      // sync failures surface via the refreshed data / tray; keep the popover calm
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="rounded-3xl border border-white/50 bg-white/25 shadow-2xl backdrop-blur-xl">
      {err ? (
        <div className="p-5 text-center">
          <p className="text-sm font-medium text-rose-900">{err}</p>
          <button
            onClick={() => {
              summary.reload();
              daily.reload();
              tools.reload();
              models.reload();
            }}
            className="mt-3 rounded-full bg-white/70 px-4 py-1.5 text-sm font-semibold text-slate-900 hover:bg-white"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="px-4 pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[38px] font-bold leading-none tracking-tight text-slate-900">
                  {s ? compact(total) : "—"}
                </div>
                <div className="mt-1 text-lg font-semibold leading-none text-slate-800">tokens</div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                    {CAPTION[period]}
                  </span>
                  {trend !== null && <TrendBadge pct={trend} />}
                </div>
              </div>
              <PeriodToggle period={period} onChange={setPeriod} />
            </div>
          </div>

          <div className="mt-1 h-10">
            <HeroChart days={daily.data?.days ?? []} />
          </div>

          <div className="border-t border-white/40 px-3 py-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl border border-white/40 bg-white/30 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">Local Est.</span>
                  <IconCpu size={14} className="shrink-0 text-slate-500" />
                </div>
                <div className="mt-2 truncate text-[22px] font-bold leading-none tracking-tight text-slate-900">
                  {tools.loading && !tools.data ? "—" : compact(localTokens)}
                </div>
                <div className="mt-1.5 text-[11px] text-slate-600">~{percent(localTokens, total)} of total</div>
              </div>
              <div className="rounded-2xl border border-white/40 bg-white/30 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">Cloud API</span>
                  <IconCloud size={14} className="shrink-0 text-slate-500" />
                </div>
                <div className="mt-2 truncate text-[22px] font-bold leading-none tracking-tight text-slate-900">
                  {tools.loading && !tools.data ? "—" : compact(cloudTokens)}
                </div>
                <div className="mt-1.5 flex items-start justify-between gap-1 text-[11px] text-slate-600">
                  <span>{cost(cloudCost, { est: true })} est. cost</span>
                  {cloudDelta !== null && <CostDelta pct={cloudDelta} />}
                </div>
              </div>
            </div>

            <div className="mt-2 rounded-2xl border border-white/40 bg-white/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex rounded-full bg-white/30 p-0.5">
                  {(["sources", "models"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-700 hover:text-slate-900"
                      }`}
                    >
                      {t === "sources" ? "Top Sources" : "Top Models"}
                    </button>
                  ))}
                </div>
                {tab === "sources" ? (
                  <IconTerminal size={14} className="shrink-0 text-slate-500" />
                ) : (
                  <IconBrain size={14} className="shrink-0 text-slate-500" />
                )}
              </div>

              {tab === "sources" ? (
                toolRows.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-600">
                    {tools.loading ? "Loading…" : "No usage in this period yet."}
                  </p>
                ) : (
                  <ul className="mt-1.5">
                    {[...toolRows]
                      .sort((a, b) => b.totalTokens - a.totalTokens)
                      .slice(0, 3)
                      .map((t) => (
                        <TopSourceRow key={t.tool} tool={t} />
                      ))}
                  </ul>
                )
              ) : (models.data?.models.length ?? 0) > 0 ? (
                <ul className="mt-1.5 space-y-2">
                  {[...models.data!.models]
                    .sort((a, b) => b.totalTokens - a.totalTokens)
                    .slice(0, 3)
                    .map((m, i) => (
                      <TopModelRow key={m.model} model={m} idx={i} total={total} />
                    ))}
                </ul>
              ) : (
                <p className="py-3 text-center text-xs text-slate-600">
                  {models.loading ? "Loading…" : "No models in this period yet."}
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-white/40 px-3 py-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => void syncNow()}
                disabled={syncing}
                className="flex items-center justify-center gap-2 rounded-full bg-white/60 py-2 text-[13px] font-semibold text-slate-900 transition hover:bg-white/85 disabled:cursor-wait disabled:opacity-60"
              >
                <IconRefresh size={14} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing…" : "Sync Now"}
              </button>
              <button
                onClick={onOpenDashboard}
                className="flex items-center justify-center gap-2 rounded-full bg-white/60 py-2 text-[13px] font-semibold text-slate-900 transition hover:bg-white/85"
              >
                <IconGrid size={14} /> Dashboard
              </button>
            </div>
            <div className="mt-2.5 flex items-center justify-between px-1">
              <button
                onClick={() => window.open(`${window.location.origin}/dashboard`, "_blank")}
                className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 transition hover:text-slate-900"
              >
                <IconExternal size={13} /> Open Web App
              </button>
              {IS_ELECTRON && (
                <button
                  onClick={() => window.close()}
                  className="text-[13px] font-medium text-slate-700 transition hover:text-slate-900"
                >
                  Quit
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PeriodToggle({ period, onChange }: { period: Period; onChange: (p: Period) => void }): ReactNode {
  return (
    <div className="flex shrink-0 rounded-full border border-white/50 bg-white/30 p-1">
      {(["today", "7d", "30d"] as Period[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            period === p ? "bg-white text-slate-900 shadow-sm" : "text-slate-700 hover:text-slate-900"
          }`}
        >
          {p === "today" ? "Today" : p}
        </button>
      ))}
    </div>
  );
}

function TrendBadge({ pct }: { pct: number }): ReactNode {
  const up = pct >= 0;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-slate-800/90 px-1.5 py-0.5 text-[11px] font-semibold text-white"
      title="vs previous equal-length period"
    >
      {up ? <IconArrowUpRight size={11} /> : <IconArrowDownRight size={11} />}
      {Math.abs(Math.round(pct))}%
    </span>
  );
}

function CostDelta({ pct }: { pct: number }): ReactNode {
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold ${up ? "text-rose-600" : "text-emerald-600"}`}
      title="cost vs previous equal-length period"
    >
      <svg width="7" height="7" viewBox="0 0 24 24" className={up ? "" : "rotate-180"} aria-hidden="true">
        <path d="M12 5l8 14H4z" fill="currentColor" />
      </svg>
      {Math.abs(Math.round(pct))}%
    </span>
  );
}

function TopSourceRow({ tool }: { tool: ToolRow }): ReactNode {
  const meta = TOOL_META[tool.tool];
  const Icon = meta?.Icon ?? IconTerminal;
  const isLocal = LOCAL_TOOLS.has(tool.tool);
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <Icon size={15} className="shrink-0 text-slate-700" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
        {meta?.label ?? tool.tool}
      </span>
      <span className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-900">
        {compact(tool.totalTokens)}
        {isLocal && <span className="ml-1 text-[11px] font-normal text-slate-500">local</span>}
      </span>
    </li>
  );
}

const MODEL_BAR_COLORS = ["#34d399", "#38bdf8", "#2dd4bf", "#a78bfa", "#f59e0b"];

function TopModelRow({ model, idx, total }: { model: ModelRow; idx: number; total: number }): ReactNode {
  const pct = total > 0 ? Math.min(100, (model.totalTokens / total) * 100) : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800" title={model.model}>
          {model.model}
        </span>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-600">
          {percent(model.totalTokens, total)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/40">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: MODEL_BAR_COLORS[idx % MODEL_BAR_COLORS.length] }}
        />
      </div>
      <div className="mt-0.5 text-right text-[11px] text-slate-600">{cost(model.costUsd, { est: true })} est.</div>
    </li>
  );
}

function HeroChart({ days }: { days: DayRow[] }): ReactNode {
  const ordered = [...days].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ tokens: d.totalTokens }));
  const data = ordered.length === 0 ? [{ tokens: 0 }, { tokens: 0 }] : ordered.length === 1 ? [ordered[0]!, ordered[0]!] : ordered;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f172a" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#0f172a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="tokens" stroke="#1e293b" strokeWidth={2} fill="url(#heroFill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const TOOL_META: Record<string, { label: string; Icon: (p: IconProps) => ReactNode }> = {
  "claude-code": { label: "Claude Code", Icon: IconSparkles },
  codex: { label: "Codex CLI", Icon: IconCode },
  "gemini-cli": { label: "Gemini CLI", Icon: IconGemini },
  zcode: { label: "ZCode", Icon: IconTerminal },
  opencode: { label: "OpenCode", Icon: IconTerminal },
  ollama: { label: "Ollama", Icon: IconCpu },
};

/* ── Full dashboard view ────────────────────────────────────────────── */

function DashboardView({ onBack }: { onBack: () => void }): ReactNode {
  const { range } = useRange();
  const summary = useAsync(() => api.summary(range), [range]);
  const daily = useAsync(() => api.daily(range), [range]);
  const models = useAsync(() => api.models(range), [range]);
  const tools = useAsync(() => api.tools(range), [range]);
  const projects = useAsync(() => api.projects(range), [range]);
  const heatmap = useAsync(() => api.heatmap(), []);

  const s = summary.data;
  const p = s?.previous;
  const delta = deltaPct;

  if (summary.error) {
    return <p className="py-8 text-center text-sm text-danger">{summary.error}</p>;
  }
  if (summary.loading && !summary.data) return <LoadingSkeleton />;

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex min-h-[40px] items-center gap-2 rounded-control border border-border bg-surface px-4 py-2 text-sm hover:bg-surface-2"
        >
          <IconArrowLeft size={15} /> Back
        </button>
        <h1 className="text-lg font-semibold">LLMTab</h1>
      </header>

      <div className="flex justify-center">
        <RangeTabs />
      </div>

      {s && (
        <>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6" aria-label="Totals for range">
            <StatCard label="Total" value={compact(s.totalTokens)} deltaPct={delta(s.totalTokens, p?.totalTokens)} />
            <StatCard label="Input" value={compact(s.inputTokens)} deltaPct={delta(s.inputTokens, p?.inputTokens)} />
            <StatCard label="Output" value={compact(s.outputTokens)} deltaPct={delta(s.outputTokens, p?.outputTokens)} />
            <StatCard label="Cache read" value={compact(s.cacheReadTokens)} deltaPct={delta(s.cacheReadTokens, p?.cacheReadTokens)} />
            <StatCard label="Cost" value={cost(s.costUsd, { est: true })} deltaPct={delta(s.costUsd, p?.costUsd)} />
            <StatCard label="Conversations" value={String(s.conversations)} deltaPct={null} />
          </section>

          <HeroCard
            totalTokens={s.totalTokens}
            costUsd={s.costUsd}
            unpricedModels={s.unpricedModels}
            localModels={s.localModels ?? []}
          />

          {models.data && models.data.models.length > 0 && (
            <ModelCards models={models.data.models} localModels={s.localModels ?? []} />
          )}

          {daily.data && <TrendChart days={daily.data.days.filter((d) => d.totalTokens > 0)} />}
          {heatmap.data && <Heatmap days={heatmap.data.days} />}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ToolBreakdown tools={tools.data?.tools ?? []} />
            <ProjectList projects={projects.data?.projects ?? []} />
          </div>

          {daily.data && daily.data.days.length > 0 && (
            <DailyTable days={[...daily.data.days].sort((a, b) => b.day.localeCompare(a.day))} />
          )}
        </>
      )}
      <SyncFooter />
    </main>
  );
}

function LoadingSkeleton(): ReactNode {
  return (
    <div className="space-y-4">
      <Skeleton className="mx-auto h-9 w-72 rounded-full" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/* ── Icons (lucide-style inline SVG) ────────────────────────────────── */

interface IconProps {
  size?: number;
  className?: string;
}

function Icon({ size = 16, className, children }: IconProps & { children: ReactNode }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function IconCpu(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
    </Icon>
  );
}

function IconCloud(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </Icon>
  );
}

function IconBrain(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </Icon>
  );
}

function IconTerminal(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
    </Icon>
  );
}

function IconCode(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </Icon>
  );
}

function IconSparkles(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9Z" />
      <path d="M19 3v4" />
      <path d="M21 5h-4" />
    </Icon>
  );
}

function IconGemini(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4Z" />
    </Icon>
  );
}

function IconRefresh(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Icon>
  );
}

function IconGrid(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Icon>
  );
}

function IconExternal(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Icon>
  );
}

function IconArrowUpRight(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </Icon>
  );
}

function IconArrowDownRight(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="m7 7 10 10" />
      <path d="M17 7v10H7" />
    </Icon>
  );
}

function IconArrowLeft(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </Icon>
  );
}
