import { useEffect, useState, type ReactNode } from "react";
import { RangeProvider, useRange } from "@/hooks/useRange";
import { useAsync, Skeleton } from "@/hooks/useAsync";
import { api } from "@/api";
import { HeroCard, ModelCards, RangeTabs, StatCard } from "@/components/Cards";
import { TrendChart } from "@/components/TrendChart";
import { Heatmap } from "@/components/Heatmap";
import { DailyTable } from "@/components/DailyTable";
import { ProjectList, ToolBreakdown } from "@/components/ToolProject";
import { SyncFooter, ToastStack, useToasts } from "@/components/SyncFooter";
import { compact, cost } from "@/format";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const stored = localStorage.getItem("llmtab-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App(): ReactNode {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("llmtab-theme", theme);
  }, [theme]);

  return (
    <RangeProvider>
      <div className="mx-auto max-w-page px-6 py-6">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">LLMTab</h1>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-text-2 sm:inline">100% local · est. costs</span>
            <button
              type="button"
              aria-label="Toggle theme"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="min-h-[40px] rounded-control border border-border bg-surface px-4 py-2 text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {theme === "dark" ? "☀ Light" : "☾ Dark"}
            </button>
          </div>
        </header>
        <main className="mt-5 space-y-6">
          <Dashboard />
        </main>
      </div>
    </RangeProvider>
  );
}

function Dashboard(): ReactNode {
  const { range } = useRange();
  const summary = useAsync(() => api.summary(range), [range]);
  const daily = useAsync(() => api.daily(range), [range]);
  const models = useAsync(() => api.models(range), [range]);
  const tools = useAsync(() => api.tools(range), [range]);
  const projects = useAsync(() => api.projects(range), [range]);
  const heatmap = useAsync(() => api.heatmap(), []);
  const { toasts, push, dismiss } = useToasts();

  const error = summary.error ?? daily.error ?? models.error ?? tools.error ?? projects.error;

  useEffect(() => {
    if (error) push(error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  if (error) {
    return (
      <>
        <ToastStack toasts={toasts} onRetry={summary.reload} />
        <LoadingSkeleton />
      </>
    );
  }
  if (summary.loading && !summary.data) return <LoadingSkeleton />;
  if (summary.data && summary.data.records === 0) return <EmptyState />;

  const s = summary.data;
  const p = s?.previous;
  const delta = (cur: number | undefined, prev: number | undefined): number | null =>
    cur !== undefined && prev !== undefined && prev > 0 ? ((cur - prev) / prev) * 100 : null;

  return (
    <>
      <div className="flex justify-center">
        <RangeTabs />
      </div>

      {!s ? (
        <LoadingSkeleton />
      ) : (
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
    </>
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

function EmptyState(): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-surface py-24 text-center">
      <div className="text-4xl">📊</div>
      <p className="mt-4 text-lg font-medium">No usage yet</p>
      <p className="mt-1 text-sm text-text-2">
        Run <code className="rounded bg-surface-2 px-1.5 py-0.5 text-accent">llmtab sync</code> to
        import your AI tool logs.
      </p>
      <p className="mt-1 text-xs text-text-2">
        LLMTab reads only token counts — never your prompts or responses.
      </p>
    </div>
  );
}
