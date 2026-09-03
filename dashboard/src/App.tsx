import { useEffect, useState, type ReactNode } from "react";
import { RangeProvider, useRange } from "@/hooks/useRange";
import { startPopoverFit } from "@/popover-fit";
import { useAsync, Skeleton } from "@/hooks/useAsync";
import {
  api,
  rangeParam,
  type ModelRow,
  type RangeDef,
  type SummaryResponse,
  type ToolRow,
} from "@/api";
import { compact, cost, percent } from "@/format";
import { HeroCard, ModelCards, RangeTabs, StatCard } from "@/components/Cards";
import { TrendChart } from "@/components/TrendChart";
import { Heatmap } from "@/components/Heatmap";
import { DailyTable } from "@/components/DailyTable";
import { ProjectList, ToolBreakdown } from "@/components/ToolProject";
import { SyncFooter } from "@/components/SyncFooter";
import { QuotaCard, DashboardQuotaSection } from "@/components/QuotaCard";
import { Segmented, Meter, Button, Panel, DataDesktop } from "@/components/glass";
import { resetLabel, worstWindow } from "@/quota";
import { readPrefs, writePrefs } from "@/prefs";
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

function stepsFrom(days: Array<{ totalTokens: number }>): number[] {
  const peak = Math.max(0, ...days.map((d) => d.totalTokens));
  if (peak <= 0) return days.map(() => 0);
  return days.map((d) => {
    if (d.totalTokens <= 0) return 0;
    const r = d.totalTokens / peak;
    return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
  });
}

/** The wallpaper behind the glass, drawn from the user's own year of usage. */
function Backdrop(): ReactNode {
  const heatmap = useAsync(() => api.heatmap(), []);
  const days = heatmap.data?.days ?? [];
  return <DataDesktop steps={stepsFrom(days)} recent={days.slice(-30).map((d) => d.totalTokens)} />;
}

export default function App(): ReactNode {
  const [view, setView] = useState<View>(() =>
    window.location.pathname.startsWith("/dashboard") ? "dashboard" : "popover",
  );

  // Report the height the popover wants so the shell can size its window. Only
  // the popover is bounded to a window; the dashboard is an ordinary page.
  useEffect(() => {
    if (view !== "popover") return;
    const max = Number(window.__LLMTAB_MAX_H) || 900;
    const fit = startPopoverFit(max);
    return () => fit.dispose();
  }, [view]);

  return (
    <RangeProvider>
      <Backdrop />
      {view === "popover" ? (
        // Bounded to the window so the page itself never scrolls. The shell
        // grows the window to fit content only up to 640px; past that the body
        // used to scroll, which dragged the tabs and footer along with it.
        // Constraining here keeps the chrome fixed and hands the overflow to
        // the one list that is meant to absorb it.
        <div data-fit-shell className="relative h-screen w-full overflow-hidden">
          <div className="relative z-10 mx-auto flex h-full max-w-[300px] flex-col p-2">
            <PopoverView onOpenDashboard={() => setView("dashboard")} />
          </div>
        </div>
      ) : (
        <div className="relative min-h-screen w-full">
          <div className="relative z-10 mx-auto max-w-page px-6 py-6">
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
  const [syncing, setSyncing] = useState(false);
  // Restore the last view. A #hash still wins — a deep link should land where
  // it points, not where you happened to be last time.
  const saved = readPrefs();
  const [period, setPeriod] = useState<Period>(saved.period);
  const [popoverTab, setPopoverTab] = useState<PopoverTab>(() => {
    if (window.location.hash === "#models") return "sources";
    if (window.location.hash === "#quotas") return "quotas";
    return saved.tab;
  });
  const [sourcesSubTab, setSourcesSubTab] = useState<"sources" | "models">(() =>
    window.location.hash === "#models" ? "models" : saved.sourcesSubTab,
  );

  // Persist on change so the state survives a close. The popover window is
  // reused rather than reloaded, so this is what makes the next open correct.
  useEffect(() => {
    writePrefs({ tab: popoverTab, period, sourcesSubTab });
  }, [popoverTab, period, sourcesSubTab]);
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
  const localTokens = toolRows
    .filter((t) => LOCAL_TOOLS.has(t.tool))
    .reduce((a, t) => a + t.totalTokens, 0);
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
    <div className="flex min-h-0 flex-1 flex-col">
      <Segmented
        className="mb-[9px] flex w-full shrink-0 [&>button]:min-w-0 [&>button]:flex-1"
        size="compact"
        tabs={[
          { id: "usage", label: "Usage" },
          { id: "quotas", label: "Quotas", dot: quotaDot, dotLabel: "1 limit nearly reached" },
          { id: "sources", label: "Sources" },
        ]}
        active={popoverTab}
        onChange={(id) => setPopoverTab(id as PopoverTab)}
      />
      <Panel material="hud" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Title bar: brand, a dithered drag region, and the range selector.
            Hidden on Quotas — those are live provider limits, so a time range
            means nothing there and the control would be dead. Usage and
            Sources both filter by it, so both keep it. */}
        {popoverTab !== "quotas" && (
          <div className="shrink-0 border-b border-edge px-[11px] py-[8px]">
            <div className="flex items-center gap-[8px]">
              <GaugeMark className="h-[16px] w-[16px] shrink-0 rounded-[5px]" />
              <span className="text-[12px] font-semibold tracking-[-0.01em]">LLMTab</span>
            </div>
            <PeriodToggle
              className="mt-[7px] flex w-full [&>button]:min-w-0 [&>button]:flex-1"
              period={period}
              onChange={setPeriod}
            />
          </div>
        )}
        {err ? (
          <div className="p-5 text-center">
            <p className="text-[13px] font-medium text-danger">{err}</p>
            <Button
              className="mt-3"
              onClick={() => {
                summary.reload();
                daily.reload();
                tools.reload();
                models.reload();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            {popoverTab === "usage" && (
              <div key="usage" className="panel-in min-h-0 shrink overflow-y-auto p-[11px]">
                <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-text-3">
                  {CAPTION[period]}
                </span>

                {/* The readout. Compact (StyleGuide §7) so it never truncates at
                    300px — the exact count follows below, where it has room. */}
                <div className="mt-[3px] text-[28px] font-semibold leading-[1.05] tracking-[-0.04em] tabular-nums">
                  {s ? compact(total) : "—"}
                </div>

                <div className="mt-[3px] flex flex-wrap items-center gap-[8px] text-[11px] text-text-2">
                  <span className="tabular-nums">
                    {cost(s?.costUsd ?? 0)} <span className="text-text-3">estimated</span>
                  </span>
                  {trend !== null && <TrendBadge pct={trend} />}
                </div>

                {s && total > 0 && (
                  <div className="mt-[5px] font-mono text-[10px] text-text-3 tabular-nums">
                    {total.toLocaleString("en-US")} tokens
                  </div>
                )}

                {/* Metered vs off-grid — the split that is the whole product thesis. */}
                <div className="mt-[11px] grid grid-cols-2 gap-[8px]">
                  <div className="glass-thin rounded-[10px] px-[9px] py-[8px]">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">
                      Metered
                    </span>
                    <div className="mt-[4px] truncate text-[15px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
                      {tools.loading && !tools.data ? "—" : compact(cloudTokens)}
                    </div>
                    <div className="mt-[3px] text-[11px] text-text-2 tabular-nums">
                      {cost(cloudCost)} est.
                    </div>
                  </div>
                  <div className="glass-thin rounded-[10px] px-[9px] py-[8px]">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">
                      Local
                    </span>
                    <div className="mt-[4px] truncate text-[15px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
                      {tools.loading && !tools.data ? "—" : compact(localTokens)}
                    </div>
                    <div className="mt-[3px] text-[11px] text-text-2">
                      {percent(localTokens, total)} · free
                    </div>
                  </div>
                </div>

                {/* The one number that can ruin an afternoon, without leaving Usage. */}
                {worst && (
                  <div className="glass-thin mt-[8px] rounded-[10px] px-[10px] py-[9px]">
                    <div className="flex items-baseline justify-between gap-[10px] text-[11px]">
                      <span className="min-w-0 truncate text-text-2">
                        Closest limit · {worst.provider.displayName} {worst.window.label}
                      </span>
                      <b className="shrink-0 text-[12px] font-semibold tabular-nums">
                        {Math.round(worst.pct)}%
                      </b>
                    </div>
                    <Meter pct={worst.pct} className="mt-[6px] h-[5px]" />
                    {resetLabel(worst.window.resetsAt) && (
                      <div className="mt-[4px] text-[10px] text-text-3">
                        {resetLabel(worst.window.resetsAt)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {popoverTab === "quotas" && (
              <div key="quotas" className="panel-in flex min-h-0 flex-1 flex-col justify-start p-3">
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
              <div key="sources" className="panel-in min-h-0 shrink overflow-y-auto p-3">
                <div className="flex items-center justify-between gap-2">
                  <Segmented
                    size="compact"
                    tabs={[
                      { id: "sources", label: "Top sources" },
                      { id: "models", label: "Top models" },
                    ]}
                    active={sourcesSubTab}
                    onChange={(id) => setSourcesSubTab(id as "sources" | "models")}
                  />
                  {sourcesSubTab === "sources" ? (
                    <IconTerminal size={12} className="shrink-0 text-text-3" />
                  ) : (
                    <IconBrain size={12} className="shrink-0 text-text-3" />
                  )}
                </div>
                <div className="mt-2">
                  {sourcesSubTab === "sources" ? (
                    toolRows.length === 0 ? (
                      <p className="py-3 text-center text-[12px] text-text-2">
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
                    <p className="py-3 text-center text-[12px] text-text-2">
                      {models.loading ? "Loading…" : "No models in this period yet."}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="grid shrink-0 grid-cols-2 gap-[7px] px-[11px] pb-[11px]">
              <Button
                className="min-w-0"
                variant="primary"
                onClick={() => void syncNow()}
                disabled={syncing}
              >
                <IconRefresh
                  size={12}
                  className={syncing ? "animate-spin motion-reduce:animate-none" : ""}
                />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
              <Button className="min-w-0" onClick={onOpenDashboard}>
                <IconGrid size={12} /> Dashboard
              </Button>
            </div>
            {/* `relative` so the version can centre on the footer itself.
                Sitting in the flex flow, `justify-between` spaced it against
                its neighbours instead — and since "Open web app" is wider than
                "Quit", it settled right of centre. */}
            <div className="relative flex shrink-0 items-center justify-between border-t border-edge px-[11px] py-[7px] text-[10px]">
              <button
                onClick={() => window.open(`${window.location.origin}/dashboard`, "_blank")}
                className="relative z-[1] flex items-center gap-1.5 text-text-3 hover:text-text-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2"
              >
                <IconExternal size={10} /> Open web app
              </button>
              <AppVersion className="pointer-events-none absolute left-1/2 -translate-x-1/2" />
              {IS_ELECTRON ? (
                <button
                  onClick={() => window.close()}
                  className="relative z-[1] text-text-3 hover:text-text-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2"
                >
                  {typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
                    ? "Exit"
                    : "Quit"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/**
 * Build the server is running. Rendered as plain text, not a control — it is
 * there to be read when reporting a problem, not clicked. Absent until the
 * request lands, and stays absent if it fails, so a footer never shows "v?".
 */
function AppVersion({ className = "" }: { className?: string }): ReactNode {
  const health = useAsync(() => api.health(), []);
  const version = health.data?.version;
  if (!version) return null;
  return (
    <span className={`tabular-nums text-text-3 ${className}`} title="LLMTab version">
      v{version}
    </span>
  );
}

const PERIOD_LABEL: Record<Period, string> = { today: "Today", "7d": "7d", "30d": "30d" };

function PeriodToggle({
  period,
  onChange,
  className = "shrink-0",
}: {
  period: Period;
  onChange: (p: Period) => void;
  className?: string;
}): ReactNode {
  return (
    <Segmented
      className={className}
      size="compact"
      tabs={(["today", "7d", "30d"] as Period[]).map((p) => ({ id: p, label: PERIOD_LABEL[p] }))}
      active={period}
      onChange={(id) => onChange(id as Period)}
    />
  );
}

/** The shipped brand mark: a gauge, matching assets/icons. */
function GaugeMark({ className = "" }: { className?: string }): ReactNode {
  return (
    <span
      className={`grid place-items-center bg-[#1a1f2a] text-accent-2 ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" fill="none" className="h-[70%] w-[70%]">
        <path
          d="M4 22a12 12 0 0 1 24 0"
          stroke="currentColor"
          strokeWidth="4.6"
          strokeLinecap="round"
        />
        <path
          d="M16.4 21.6l5.6-4.9"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <rect x="13.6" y="20.4" width="4.8" height="4.8" rx="1.2" fill="currentColor" />
      </svg>
    </span>
  );
}

function TrendBadge({ pct }: { pct: number }): ReactNode {
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-[3px] text-[11px] font-semibold tabular-nums ${
        up ? "text-accent-2" : "text-danger"
      }`}
      title="vs previous equal-length period"
    >
      {up ? <IconArrowUpRight size={11} /> : <IconArrowDownRight size={11} />}
      {Math.abs(Math.round(pct))}%
    </span>
  );
}

function TopSourceRow({
  tool,
  idx,
  total,
}: {
  tool: ToolRow;
  idx: number;
  total: number;
}): ReactNode {
  const meta = TOOL_META[tool.tool];
  const Icon = meta?.Icon ?? IconTerminal;
  const isLocal = LOCAL_TOOLS.has(tool.tool);
  const pct = total > 0 ? Math.min(100, (tool.totalTokens / total) * 100) : 0;
  return (
    <li className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={15} className="shrink-0 text-text-2" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">
            {meta?.label ?? tool.tool}
            {isLocal && <span className="ml-1 text-[10px] font-normal text-text-3">local</span>}
          </span>
        </div>
        <span className="shrink-0 text-[12px] font-semibold tabular-nums text-text-2">
          {percent(tool.totalTokens, total)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[rgba(120,140,160,0.2)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: MODEL_BAR_COLORS[idx % MODEL_BAR_COLORS.length] }}
        />
      </div>
    </li>
  );
}

const MODEL_BAR_COLORS = ["#34d399", "#38bdf8", "#2dd4bf", "#a78bfa", "#f59e0b"];

function TopModelRow({
  model,
  idx,
  total,
}: {
  model: ModelRow;
  idx: number;
  total: number;
}): ReactNode {
  const pct = total > 0 ? Math.min(100, (model.totalTokens / total) * 100) : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1"
          title={model.model}
        >
          {model.model}
        </span>
        <span className="shrink-0 text-[12px] font-semibold tabular-nums text-text-2">
          {percent(model.totalTokens, total)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[rgba(120,140,160,0.2)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: MODEL_BAR_COLORS[idx % MODEL_BAR_COLORS.length] }}
        />
      </div>
      <div className="mt-0.5 text-right text-[11px] text-text-2">
        {model.costUsd > 0 ? `${cost(model.costUsd, { est: true })} est.` : "$0"}
      </div>
    </li>
  );
}

function LobeIcon({
  src,
  size = 16,
  className,
}: {
  src: string;
  size?: number;
  className?: string;
}): ReactNode {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      dangerouslySetInnerHTML={{
        __html: src
          .replace(
            /<svg[^>]*>/,
            `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="flex:none;line-height:1;width:100%;height:100%">`,
          )
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
          <section
            className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6"
            aria-label="Totals for range"
          >
            <StatCard
              label="Total"
              value={compact(s.totalTokens)}
              deltaPct={delta(s.totalTokens, p?.totalTokens)}
            />
            <StatCard
              label="Input"
              value={compact(s.inputTokens)}
              deltaPct={delta(s.inputTokens, p?.inputTokens)}
            />
            <StatCard
              label="Output"
              value={compact(s.outputTokens)}
              deltaPct={delta(s.outputTokens, p?.outputTokens)}
            />
            <StatCard
              label="Cache read"
              value={compact(s.cacheReadTokens)}
              deltaPct={delta(s.cacheReadTokens, p?.cacheReadTokens)}
            />
            <StatCard
              label="Cost"
              value={cost(s.costUsd, { est: true })}
              deltaPct={delta(s.costUsd, p?.costUsd)}
            />
            <StatCard label="Conversations" value={String(s.conversations)} deltaPct={null} />
          </section>

          <HeroCard
            totalTokens={s.totalTokens}
            costUsd={s.costUsd}
            unpricedModels={s.unpricedModels}
            localModels={s.localModels ?? []}
          />

          <DashboardQuotaSection
            providers={quotas.data?.providers ?? []}
            loading={quotas.loading}
            error={quotas.error}
            onRetry={() => quotas.reload()}
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
      {/* Outside SyncFooter on purpose: that returns null before the first sync
          or when the request fails, and the build should still be readable. */}
      <div className="-mt-2 pb-6 text-xs text-text-3">
        LLMTab <AppVersion />
      </div>
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
