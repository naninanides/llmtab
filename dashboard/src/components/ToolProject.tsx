import type { ReactNode } from "react";
import { compact, cost, percent } from "@/format";

/** Tool breakdown — horizontal share bars with legend (FR-24). */
export function ToolBreakdown({
  tools,
}: {
  tools: Array<{ tool: string; totalTokens: number; costUsd: number }>;
}): ReactNode {
  const grand = tools.reduce((a, t) => a + t.totalTokens, 0);
  const colors = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b"];
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">By tool</h2>
      {tools.length === 0 ? (
        <p className="mt-2 text-sm text-text-2">No usage in range.</p>
      ) : (
        <>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Token share by tool">
            {tools.map((t, i) => (
              <div key={t.tool} style={{ width: percent(t.totalTokens, grand), background: colors[i % colors.length] }} title={`${t.tool} · ${percent(t.totalTokens, grand)}`} />
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {tools.map((t, i) => (
              <li key={t.tool} className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: colors[i % colors.length] }} />
                <span className="flex-1">{t.tool}</span>
                <span className="tabular-nums text-text-2">{compact(t.totalTokens)} · {cost(t.costUsd, { est: true })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Top projects by tokens; full path in tooltip (FR-28). */
export function ProjectList({
  projects,
}: {
  projects: Array<{ project: string; totalTokens: number; costUsd: number }>;
}): ReactNode {
  const top = projects.filter((p) => p.project !== "(unknown)").slice(0, 8);
  const grand = projects.reduce((a, p) => a + p.totalTokens, 0);
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Top projects</h2>
      {top.length === 0 ? (
        <p className="mt-2 text-sm text-text-2">No project usage in range.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {top.map((p) => (
            <li key={p.project} className="text-sm" title={p.project}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{p.project.split("/").pop()}</span>
                <span className="tabular-nums text-text-2">{compact(p.totalTokens)}</span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: percent(p.totalTokens, grand) }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
