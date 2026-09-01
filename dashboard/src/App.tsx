import { useEffect, useState, type ReactNode } from "react";
import { RangeProvider, useRange } from "@/hooks/useRange";
import { useAsync, Skeleton } from "@/hooks/useAsync";
import { api, rangeParam, type ModelRow, type RangeDef, type SummaryResponse, type ToolRow } from "@/api";
import { compact, cost, percent } from "@/format";
import { HeroCard, ModelCards, RangeTabs, StatCard } from "@/components/Cards";
import { TrendChart } from "@/components/TrendChart";
import { Heatmap } from "@/components/Heatmap";
import { DailyTable } from "@/components/DailyTable";
import { ProjectList, ToolBreakdown } from "@/components/ToolProject";
import { SyncFooter } from "@/components/SyncFooter";
import { QuotaCard, DashboardQuotaSection } from "@/components/QuotaCard";
import { TabStrip } from "@/components/pixel/TabStrip";
import { BlockMeter } from "@/components/pixel/BlockMeter";
import { resetLabel, worstWindow } from "@/quota";
import claudecodeSvg from "@lobehub/icons-static-svg/icons/claudecode.svg?raw";
import codexSvg from "@lobehub/icons-static-svg/icons/codex.svg?raw";
import geminicliSvg from "@lobehub/icons-static-svg/icons/geminicli.svg?raw";
import ollamaSvg from "@lobehub/icons-static-svg/icons/ollama.svg?raw";
import opencodeSvg from "@lobehub/icons-static-svg/icons/opencode.svg?raw";

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
        <div className="w-full bg-ground">
          <div className="mx-auto max-w-[360px] p-2">
            <PopoverView onOpenDashboard={() => setView("dashboard")} />
          </div>
        </div>
      ) : (
        <div className="min-h-screen w-full bg-bg">
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

type PopoverTab = "usage" | "quotas" | "sources";

function PopoverView({ onOpenDashboard }: { onOpenDashboard: () => void }): ReactNode {
  const [period, setPeriod] = useState<Period>("7d");
  const [syncing, setSyncing] = useState(false);
  const initialTab: PopoverTab = (() => {
    if (window.location.hash === "#models") return "sources";
    if (window.location.hash === "#quotas") return "quotas";
    return "usage";
  })();
  const [popoverTab, setPopoverTab] = useState<PopoverTab>(initialTab);
  const [sourcesSubTab, setSourcesSubTab] = useState<"sources" | "models">(() =>
    window.location.hash === "#models" ? "models" : "sources",
  );
  // Range resets to 7d on open, selected tab resets to Usage — popover stays stateless
  useEffect(() => {
    const onFocus = () => {
      setPeriod("7d");
      setPopoverTab("usage");
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const range = RANGE_FOR[period];
  const key = rangeParam(range);
  const summary = useAsync(() => api.summary(range), [key]);
  const daily = useAsync(() => api.daily(range), [key]);
  const tools = useAsync(() => api.tools(range), [key]);
  const models = useAsync(() => api.models(range), [key]);
  const quotas = useAsync(() => api.quotas(false), []);

  const s = summary.data;
  const err = summary.error ?? daily.error ?? tools.error ?? models.error;
  const toolRows = tools.data?.tools ?? [];
  const total = s?.totalTokens ?? 0;
  const localTokens = toolRows.filter((t) => LOCAL_TOOLS.has(t.tool)).reduce((a, t) => a + t.totalTokens, 0);
  const cloudRows = toolRows.filter((t) => !LOCAL_TOOLS.has(t.tool));
  const cloudTokens = cloudRows.reduce((a, t) => a + t.totalTokens, 0);
  const cloudCost = cloudRows.reduce((a, t) => a + t.costUsd, 0);
  const trend = deltaPct(s?.totalTokens, s?.previous?.totalTokens);

  const worst = worstWindow(quotas.data?.providers ?? []);
  const quotaDot = worst !== null && worst.pct >= 90;

  async function syncNow(): Promise<void> {
    setSyncing(true);
    try {
      await api.sync();
      summary.reload();
      daily.reload();
      tools.reload();
      models.reload();
      quotas.reload();
    } catch {
      // sync failures surface via the refreshed data / tray; keep the popover calm
    } finally {
      setSyncing(false);
    }
  }

  async function refreshQuotas(): Promise<void> {
    try {
      await api.quotas(true);
    } catch {
      // api.quotas force failure surfaces via error state
    }
    quotas.reload();
  }

  return (
    <div>
      <TabStrip
        tabs={[
          { id: "usage", label: "USAGE" },
          { id: "quotas", label: "QUOTAS", dot: quotaDot, dotLabel: "1 limit nearly reached" },
          { id: "sources", label: "SOURCES" },
        ]}
        active={popoverTab}
        onChange={(id) => setPopoverTab(id as PopoverTab)}
      />
      <div className="bevel">
        {/* Title bar: brand, a dithered drag region, and the range selector. */}
        <div className="flex items-center gap-[10px] bg-amber px-[10px] py-[8px] text-rail shadow-[inset_0_4px_0_0_rgba(255,255,255,0.35),inset_0_-4px_0_0_rgba(0,0,0,0.3)]">
          <span className="font-silkscreen text-[11px] tracking-[0.06em]">LLMTAB</span>
          <span
            className="h-[9px] flex-1 self-center opacity-30 [background-image:linear-gradient(45deg,currentColor_25%,transparent_25%,transparent_75%,currentColor_75%),linear-gradient(45deg,currentColor_25%,transparent_25%,transparent_75%,currentColor_75%)] [background-position:0_0,2px_2px] [background-size:4px_4px]"
            aria-hidden="true"
          />
          <PeriodToggle period={period} onChange={setPeriod} />
        </div>
        {err ? (
          <div className="p-5 text-center">
            <p className="text-sm font-medium text-alert">{err}</p>
            <button
              onClick={() => {
                summary.reload();
                daily.reload();
                tools.reload();
                models.reload();
              }}
              className="mt-3 px-4 py-1.5 bg-panel text-bone font-silkscreen text-[9px] tracking-[0.06em] shadow-[inset_0_3px_0_0_var(--lit),inset_3px_0_0_0_var(--lit),inset_0_-3px_0_0_var(--shade),inset_-3px_0_0_0_var(--shade)]"
            >
              RETRY
            </button>
          </div>
        ) : (
          <>
            {popoverTab === "usage" && (
              <div key="usage" className="panel-in p-[13px]">
                <span className="font-silkscreen text-[8px] tracking-[0.1em] text-muted">
                  &gt; TOKENS · {CAPTION[period].toUpperCase()}
                </span>

                {/* The readout. Amber because every token here is spend.
                    Compact (StyleGuide §7) so it never truncates at 360px —
                    the exact count follows below, where it has room. */}
                <div className="mt-1 font-vt323 text-[52px] leading-[0.9] text-amber tabular-nums">
                  {s ? compact(total) : "—"}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-[9px]">
                  <span className="font-vt323 text-[22px] leading-none text-amber tabular-nums">
                    {cost(s?.costUsd ?? 0)}
                    <span className="ml-[6px] font-silkscreen text-[8px] tracking-[0.1em] text-muted">EST</span>
                  </span>
                  {trend !== null && <TrendBadge pct={trend} />}
                </div>

                {s && total > 0 && (
                  <div className="mt-[6px] font-mono text-[10.5px] text-muted tabular-nums">
                    {total.toLocaleString("en-US")} tokens
                  </div>
                )}

                {/* Metered vs off-grid — the split that is the whole product thesis. */}
                <div className="mt-3 grid grid-cols-2 gap-[10px]">
                  <div className="bevel-in p-[10px_11px]">
                    <span className="flex items-center gap-[7px] font-silkscreen text-[8px] tracking-[0.06em] text-bone">
                      <i className="block h-2 w-2 shrink-0 bg-amber" aria-hidden="true" /> METERED
                    </span>
                    <div className="mt-[5px] truncate font-vt323 text-[30px] leading-none text-amber tabular-nums">
                      {tools.loading && !tools.data ? "—" : compact(cloudTokens)}
                    </div>
                    <div className="mt-[5px] font-silkscreen text-[8px] tracking-[0.1em] text-muted">
                      {cost(cloudCost)} EST
                    </div>
                  </div>
                  <div className="bevel-in p-[10px_11px]">
                    <span className="flex items-center gap-[7px] font-silkscreen text-[8px] tracking-[0.06em] text-bone">
                      <i className="block h-2 w-2 shrink-0 bg-cyan" aria-hidden="true" /> OFF-GRID
                    </span>
                    <div className="mt-[5px] truncate font-vt323 text-[30px] leading-none text-cyan tabular-nums">
                      {tools.loading && !tools.data ? "—" : compact(localTokens)}
                    </div>
                    <div className="mt-[5px] font-silkscreen text-[8px] tracking-[0.1em] text-muted">
                      {percent(localTokens, total)} · FREE
                    </div>
                  </div>
                </div>

                {/* The one number that can ruin an afternoon, without leaving Usage. */}
                {worst && (
                  <div className="bevel-in mt-[10px] p-[10px_11px]">
                    <div className="flex items-baseline justify-between gap-[10px]">
                      <span className="font-silkscreen text-[8px] tracking-[0.1em] text-muted">CLOSEST LIMIT</span>
                      <span
                        className={`font-silkscreen text-[8px] tracking-[0.1em] ${
                          worst.pct >= 90 ? "text-alert" : worst.pct >= 75 ? "text-amber" : "text-muted"
                        }`}
                      >
                        {worst.provider.displayName.toUpperCase()}
                        {resetLabel(worst.window.resetsAt, true)
                          ? ` · ${resetLabel(worst.window.resetsAt, true).toUpperCase()}`
                          : ""}
                      </span>
                    </div>
                    <BlockMeter pct={worst.pct} />
                    <div className="mt-[6px] flex items-baseline justify-between gap-[10px]">
                      <span className="text-[10.5px] text-muted">{worst.window.label}</span>
                      <b className="font-vt323 text-[15px] font-normal text-bone tabular-nums">
                        {Math.round(worst.pct)}%
                      </b>
                    </div>
                  </div>
                )}
              </div>
            )}

            {popoverTab === "quotas" && (
              <div key="quotas" className="panel-in p-3">
                <QuotaCard
                  providers={quotas.data?.providers ?? []}
                  loading={quotas.loading}
                  error={quotas.error}
                  onRetry={() => void refreshQuotas()}
                  fetchedAt={quotas.data?.fetchedAt ?? null}
                />
              </div>
            )}

            {popoverTab === "sources" && (
              <div key="sources" className="panel-in p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex gap-1">
                    {(["sources", "models"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setSourcesSubTab(t)}
                        className={`px-2.5 py-1 font-silkscreen text-[9px] tracking-[0.06em] shadow-[inset_0_2px_0_0_var(--lit),inset_2px_0_0_0_var(--lit),inset_0_-2px_0_0_var(--shade),inset_-2px_0_0_0_var(--shade)] ${
                          sourcesSubTab === t ? "bg-panel text-bone" : "bg-panel-2 text-muted hover:text-bone"
                        }`}
                      >
                        {t === "sources" ? "TOP SOURCES" : "TOP MODELS"}
                      </button>
                    ))}
                  </div>
                  {sourcesSubTab === "sources" ? (
                    <IconTerminal size={12} className="shrink-0 text-muted" />
                  ) : (
                    <IconBrain size={12} className="shrink-0 text-muted" />
                  )}
                </div>
                <div className="mt-2">
                  {sourcesSubTab === "sources" ? (
                    toolRows.length === 0 ? (
                      <p className="py-3 text-center font-mono text-xs text-muted">
                        {tools.loading ? "Loading…" : "No usage in this period yet."}
                      </p>
                    ) : (
                      <ul>
                        {[...toolRows]
                          .sort((a, b) => b.totalTokens - a.totalTokens)
                          .slice(0, 3)
                          .map((t, i) => (
                            <TopSourceRow key={t.tool} tool={t} idx={i} total={total} />
                          ))}
                      </ul>
                    )
                  ) : (models.data?.models.length ?? 0) > 0 ? (
                    <ul className="space-y-2">
                      {[...models.data!.models]
                        .sort((a, b) => b.totalTokens - a.totalTokens)
                        .slice(0, 3)
                        .map((m, i) => (
                          <TopModelRow key={m.model} model={m} idx={i} total={total} />
                        ))}
                    </ul>
                  ) : (
                    <p className="py-3 text-center font-mono text-xs text-muted">
                      {models.loading ? "Loading…" : "No models in this period yet."}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 p-3 pt-0">
              <button
                onClick={() => void syncNow()}
                disabled={syncing}
                className="flex items-center justify-center gap-2 bg-amber text-rail px-3 py-[9px] font-silkscreen text-[9px] tracking-[0.06em] shadow-[inset_0_3px_0_0_var(--lit),inset_3px_0_0_0_var(--lit),inset_0_-3px_0_0_var(--shade),inset_-3px_0_0_0_var(--shade)] active:shadow-[inset_0_3px_0_0_var(--shade),inset_3px_0_0_0_var(--shade),inset_0_-3px_0_0_var(--lit),inset_-3px_0_0_0_var(--lit)] disabled:opacity-60"
              >
                <IconRefresh size={12} className={syncing ? "animate-spin" : ""} />
                {syncing ? "SYNCING…" : "SYNC NOW"}
              </button>
              <button
                onClick={onOpenDashboard}
                className="flex items-center justify-center gap-2 bg-panel text-bone px-3 py-[9px] font-silkscreen text-[9px] tracking-[0.06em] shadow-[inset_0_3px_0_0_var(--lit),inset_3px_0_0_0_var(--lit),inset_0_-3px_0_0_var(--shade),inset_-3px_0_0_0_var(--shade)] active:shadow-[inset_0_3px_0_0_var(--shade),inset_3px_0_0_0_var(--shade),inset_0_-3px_0_0_var(--lit),inset_-3px_0_0_0_var(--lit)]"
              >
                <IconGrid size={12} /> DASHBOARD
              </button>
            </div>
            <div className="flex items-center justify-between px-3 py-2 shadow-[inset_0_3px_0_0_var(--shade)]">
              <button
                onClick={() => window.open(`${window.location.origin}/dashboard`, "_blank")}
                className="flex items-center gap-1.5 font-silkscreen text-[8px] tracking-[0.08em] text-muted hover:text-bone"
              >
                <IconExternal size={10} /> OPEN WEB APP
              </button>
              {IS_ELECTRON ? (
                <button
                  onClick={() => window.close()}
                  className="font-silkscreen text-[8px] tracking-[0.08em] text-muted hover:text-bone"
                >
                  {typeof navigator !== "undefined" && navigator.userAgent.includes("Windows") ? "EXIT" : "QUIT"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PeriodToggle({ period, onChange }: { period: Period; onChange: (p: Period) => void }): ReactNode {
  return (
    <div className="flex shrink-0" role="tablist" aria-label="Time range">
      {(["today", "7d", "30d"] as Period[]).map((p) => (
        <button
          key={p}
          role="tab"
          aria-selected={period === p}
          onClick={() => onChange(p)}
          className={`mr-[3px] px-[7px] py-[3px] font-silkscreen text-[8px] tracking-[0.06em] last:mr-0 ${
            period === p
              ? "bg-amber text-rail shadow-[inset_0_3px_0_0_var(--shade),inset_3px_0_0_0_var(--shade),inset_0_-3px_0_0_rgba(255,255,255,0.3),inset_-3px_0_0_0_rgba(255,255,255,0.3)]"
              : "bg-panel text-muted shadow-[inset_0_3px_0_0_var(--lit),inset_3px_0_0_0_var(--lit),inset_0_-3px_0_0_var(--shade),inset_-3px_0_0_0_var(--shade)] hover:text-bone"
          }`}
        >
          {p.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function TrendBadge({ pct }: { pct: number }): ReactNode {
  const up = pct >= 0;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-slate-800/90 px-1.5 py-0.5 text-[11px] font-semibold text-white dark:bg-slate-100/95 dark:text-slate-900"
      title="vs previous equal-length period"
    >
      {up ? <IconArrowUpRight size={11} /> : <IconArrowDownRight size={11} />}
      {Math.abs(Math.round(pct))}%
    </span>
  );
}

function TopSourceRow({ tool, idx, total }: { tool: ToolRow; idx: number; total: number }): ReactNode {
  const meta = TOOL_META[tool.tool];
  const Icon = meta?.Icon ?? IconTerminal;
  const isLocal = LOCAL_TOOLS.has(tool.tool);
  const pct = total > 0 ? Math.min(100, (tool.totalTokens / total) * 100) : 0;
  return (
    <li className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={15} className="shrink-0 text-slate-700 dark:text-slate-300" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-200">
            {meta?.label ?? tool.tool}
            {isLocal && <span className="ml-1 text-[10px] font-normal text-slate-500 dark:text-slate-400">local</span>}
          </span>
        </div>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-600 dark:text-slate-400">
          {percent(tool.totalTokens, total)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/40 dark:bg-white/10">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: MODEL_BAR_COLORS[idx % MODEL_BAR_COLORS.length] }}
        />
      </div>
    </li>
  );
}

const MODEL_BAR_COLORS = ["#34d399", "#38bdf8", "#2dd4bf", "#a78bfa", "#f59e0b"];

function TopModelRow({ model, idx, total }: { model: ModelRow; idx: number; total: number }): ReactNode {
  const pct = total > 0 ? Math.min(100, (model.totalTokens / total) * 100) : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-200" title={model.model}>
          {model.model}
        </span>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-600 dark:text-slate-400">
          {percent(model.totalTokens, total)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/40 dark:bg-white/10">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: MODEL_BAR_COLORS[idx % MODEL_BAR_COLORS.length] }}
        />
      </div>
      <div className="mt-0.5 text-right text-[11px] text-slate-600 dark:text-slate-400">
        {model.costUsd > 0
          ? `${cost(model.costUsd, { est: true })} est.`
          : "$0"}
      </div>
    </li>
  );
}

function LobeIcon({ src, size = 16, className }: { src: string; size?: number; className?: string }): ReactNode {
  return (
    <span
      className={className}
      style={{ width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      dangerouslySetInnerHTML={{
        __html: src
          .replace(/<svg[^>]*>/, `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="flex:none;line-height:1;width:100%;height:100%">`)
          .replace(/fill="[^"]*"/g, 'fill="currentColor"'),
      }}
    />
  );
}

const TOOL_META: Record<string, { label: string; Icon: (p: IconProps) => ReactNode }> = {
  "claude-code": {
    label: "Claude Code",
    Icon: (p) => <LobeIcon src={claudecodeSvg} size={p.size} className={p.className} />,
  },
  codex: {
    label: "Codex CLI",
    Icon: (p) => <LobeIcon src={codexSvg} size={p.size} className={p.className} />,
  },
  "gemini-cli": {
    label: "Gemini CLI",
    Icon: (p) => <LobeIcon src={geminicliSvg} size={p.size} className={p.className} />,
  },
  zcode: { label: "ZCode", Icon: IconZCode },
  opencode: {
    label: "OpenCode",
    Icon: (p) => <LobeIcon src={opencodeSvg} size={p.size} className={p.className} />,
  },
  ollama: {
    label: "Ollama",
    Icon: (p) => <LobeIcon src={ollamaSvg} size={p.size} className={p.className} />,
  },
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
  const quotas = useAsync(() => api.quotas(false), []);

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

          <DashboardQuotaSection providers={quotas.data?.providers ?? []} loading={quotas.loading} error={quotas.error} onRetry={() => quotas.reload()} />

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

function IconOpenCode(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="M16 18l6-6-6-6" />
      <path d="M8 6l-6 6 6 6" />
    </Icon>
  );
}

function IconZCode(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="M4 4h16" />
      <path d="M4 20h16" />
      <path d="M20 4L4 20" />
    </Icon>
  );
}

function IconClaude(p: IconProps): ReactNode {
  return (
    <Icon {...p}>
      <path d="M12 2L9 9l-7 1 5 5-1 7 6-3 6 3-1-7 5-5-7-1z" />
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
