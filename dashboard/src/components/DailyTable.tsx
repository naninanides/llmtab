import { useMemo, useState, type ReactNode } from "react";
import type { DayRow } from "@/api";
import { compact, cost, dayLabel } from "@/format";
import { DeltaChip } from "./Cards";

type SortKey = keyof Pick<DayRow, "day" | "totalTokens" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "reasoningTokens" | "conversations">;

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: "day", label: "Date", numeric: false },
  { key: "totalTokens", label: "Total", numeric: true },
  { key: "inputTokens", label: "Input", numeric: true },
  { key: "outputTokens", label: "Output", numeric: true },
  { key: "cacheReadTokens", label: "Cached", numeric: true },
  { key: "reasoningTokens", label: "Reasoning", numeric: true },
  { key: "conversations", label: "Convs", numeric: true },
];

/** Sortable daily breakdown, latest first by default (FR-27). */
export function DailyTable({ days }: { days: DayRow[] }): ReactNode {
  const [sortKey, setSortKey] = useState<SortKey>("day");
  const [desc, setDesc] = useState(true);

  const sorted = useMemo(() => {
    const rows = [...days];
    rows.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const cmp = typeof va === "string" ? va.localeCompare(String(vb)) : Number(va) - Number(vb);
      return desc ? -cmp : cmp;
    });
    return rows;
  }, [days, sortKey, desc]);

  const prevTotal = sorted.length > 1 ? sorted[1]?.totalTokens ?? 0 : 0;

  function toggle(key: SortKey): void {
    if (key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(key);
      setDesc(true);
    }
  }

  return (
    <section className="glass rounded-panel p-4">
      <h2 className="text-base font-semibold">Daily breakdown</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-2">
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  aria-sort={sortKey === c.key ? (desc ? "descending" : "ascending") : undefined}
                  className={`${c.numeric ? "text-right" : ""} py-2 pr-3 font-medium`}
                >
                  <button onClick={() => toggle(c.key)} className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    {c.label}
                    {sortKey === c.key && <span className="ml-1">{desc ? "▼" : "▲"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((d, i) => (
              <tr key={d.day} className="border-b border-border/60 last:border-0 hover:bg-surface-2">
                <td className="py-1.5 pr-3">
                  <span>{dayLabel(d.day)}</span>
                  {i === 0 && sortKey === "day" && desc && d.totalTokens > 0 && (
                    <DeltaChip pct={prevTotal > 0 ? ((d.totalTokens - prevTotal) / prevTotal) * 100 : 100} />
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right font-medium">{compact(d.totalTokens)}</td>
                <td className="py-1.5 pr-3 text-right">{compact(d.inputTokens)}</td>
                <td className="py-1.5 pr-3 text-right">{compact(d.outputTokens)}</td>
                <td className="py-1.5 pr-3 text-right">{compact(d.cacheReadTokens)}</td>
                <td className="py-1.5 pr-3 text-right">{compact(d.reasoningTokens)}</td>
                <td className="py-1.5 pr-3 text-right">
                  {d.conversations}
                  {i === 0 && <span className="ml-2 text-text-2">{cost(d.costUsd, { est: true })}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
