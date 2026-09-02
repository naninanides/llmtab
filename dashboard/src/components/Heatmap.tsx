import { useMemo, useState, type ReactNode } from "react";
import { compact } from "@/format";

interface HeatDay {
  day: string;
  totalTokens: number;
}

const CELL_STEPS = ["step-0", "step-1", "step-2", "step-3", "step-4"];

/** GitHub-style activity heatmap, 53×7 CSS grid (FR-26). */
export function Heatmap({ days }: { days: HeatDay[] }): ReactNode {
  const [hover, setHover] = useState<HeatDay | null>(null);
  const max = useMemo(() => Math.max(1, ...days.map((d) => d.totalTokens)), [days]);

  // group into week columns, Monday-first
  const weeks: HeatDay[][] = [];
  let week: HeatDay[] = new Array(7).fill(null).map(() => ({ day: "", totalTokens: -1 }));
  for (const d of days) {
    const dow = (new Date(d.day + "T00:00:00Z").getUTCDay() + 6) % 7; // Mon=0
    if (dow === 0 && week.some((c) => c.day !== "")) {
      weeks.push(week);
      week = new Array(7).fill(null).map(() => ({ day: "", totalTokens: -1 }));
    }
    week[dow] = d;
  }
  if (week.some((c) => c.day !== "")) weeks.push(week);

  return (
    <section className="glass rounded-panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Activity</h2>
        <div className="flex items-center gap-1 text-xs text-text-2" aria-label="Color scale: less to more">
          Less
          {CELL_STEPS.map((s) => (
            <span key={s} className={`h-3 w-3 rounded-[2px] heatmap-cell ${s}`} />
          ))}
          More
        </div>
      </div>
      <div className="mt-3 overflow-x-auto pb-1">
        <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridAutoColumns: "12px" }} role="img" aria-label="Daily token usage over the last 12 months">
          {weeks.map((w, wi) =>
            w.map((d, di) => (
              <div
                key={`${wi}-${di}`}
                className={`h-3 w-3 rounded-[2px] ${d.day ? cellClass(d.totalTokens, max) : "heatmap-empty"}`}
                title={d.day ? `${formatTitle(d)} · ${compact(d.totalTokens)} tokens` : ""}
                onMouseEnter={() => d.day && setHover(d)}
              />
            )),
          )}
        </div>
      </div>
      <div className="mt-2 h-4 text-xs tabular-nums text-text-2">{hover ? `${formatTitle(hover)} · ${compact(hover.totalTokens)} tokens` : ""}</div>
    </section>
  );
}

function formatTitle(d: HeatDay): string {
  return new Date(d.day + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function cellClass(v: number, max: number): string {
  if (v <= 0) return "heatmap-cell step-0";
  const t = v / max;
  if (t > 0.75) return "heatmap-cell step-4";
  if (t > 0.5) return "heatmap-cell step-3";
  if (t > 0.25) return "heatmap-cell step-2";
  return "heatmap-cell step-1";
}
