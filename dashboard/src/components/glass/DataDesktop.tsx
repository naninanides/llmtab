import type { ReactNode } from "react";

/**
 * The desktop behind the glass is the user's own data: a year of daily totals
 * bucketed to the heatmap's five steps, blown up and defocused, with the recent
 * span as a bar silhouette along the bottom. Panels sample it, so the backdrop
 * is never decorative — it is the same numbers the panels report.
 *
 * Purely presentational and `aria-hidden`: every value here is also rendered as
 * text somewhere on the page.
 */
export function DataDesktop({
  steps,
  recent,
}: {
  /** One 0–4 step per day, oldest first — the same buckets the heatmap uses. */
  steps: number[];
  /** Recent daily totals, oldest first, for the bar silhouette. */
  recent: number[];
}): ReactNode {
  const peak = Math.max(1, ...recent);
  return (
    <div className="desktop-layer" aria-hidden="true">
      <div className="desktop-wash" />
      {steps.length > 0 && (
        <div
          className="absolute inset-0 z-[1] grid grid-flow-col grid-rows-7 gap-[0.9vw] px-[4vw] py-[6vh] blur-[30px] opacity-30"
        >
          {steps.map((v, i) => (
            <i key={i} className={`rounded-[22%] heatmap-cell step-${v}`} />
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="absolute left-0 right-0 bottom-0 z-[2] h-[46vh] flex items-end gap-[0.55vw] px-[3vw] blur-[38px] opacity-[0.26]">
          {recent.map((v, i) => (
            <b
              key={i}
              className="flex-1 rounded-t-[6px] bg-gradient-to-t from-accent to-transparent"
              style={{ height: `${12 + (v / peak) * 78}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
