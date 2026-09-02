import { useState, type ReactNode } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayRow } from "@/api";
import { compact, cost, shortDayLabel } from "@/format";

const SERIES = [
  { key: "inputTokens", label: "Input", color: "#3b82f6" },
  { key: "outputTokens", label: "Output", color: "#10b981" },
  { key: "cacheReadTokens", label: "Cache read", color: "#06b6d4" },
  { key: "cacheWriteTokens", label: "Cache write", color: "#8b5cf6" },
  { key: "reasoningTokens", label: "Reasoning", color: "#f59e0b" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

/** Daily stacked bar chart with series toggles (FR-25). */
export function TrendChart({ days }: { days: DayRow[] }): ReactNode {
  const [visible, setVisible] = useState<Set<SeriesKey>>(
    () => new Set(["inputTokens", "outputTokens", "cacheReadTokens"]),
  );
  const ordered = [...days].sort((a, b) => a.day.localeCompare(b.day));

  return (
    <section className="glass rounded-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Usage trend</h2>
        <div className="flex flex-wrap gap-1.5">
          {SERIES.map((s) => {
            const on = visible.has(s.key);
            return (
              <button
                key={s.key}
                aria-pressed={on}
                onClick={() =>
                  setVisible((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.key)) next.delete(s.key);
                    else next.add(s.key);
                    return next;
                  })
                }
                className={`rounded-full px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  on ? "bg-surface-2 text-text-1" : "text-text-2 opacity-60"
                }`}
              >
                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: s.color }} />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ordered} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="day" tickFormatter={shortDayLabel} tick={{ fontSize: 11 }} stroke="var(--text-3)" />
            <YAxis tickFormatter={(v: number) => compact(v)} tick={{ fontSize: 11 }} stroke="var(--text-3)" width={44} />
            <Tooltip
              formatter={(value, name) => [compact(Number(value)), labelFor(String(name))] as [string, string]}
              labelFormatter={(l) => shortDayLabel(String(l))}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            />
            {SERIES.filter((s) => visible.has(s.key)).map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.key} stackId="tokens" fill={s.color} maxBarSize={28} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="sr-only">{dailyTextSummary(ordered)}</p>
    </section>
  );
}

function labelFor(key: string): string {
  return SERIES.find((s) => s.key === key)?.label ?? key;
}

/** Chart numbers also exist as text (StyleGuide §6). */
function dailyTextSummary(days: DayRow[]): string {
  return days.map((d) => `${d.day}: ${d.totalTokens} tokens`).join("; ");
}
