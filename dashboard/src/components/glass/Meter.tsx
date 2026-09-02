import type { ReactNode } from "react";
import { toneFor } from "@/quota";

const TONE_BG: Record<string, string> = {
  cool: "bg-q-cool",
  warm: "bg-q-warn",
  crit: "bg-q-crit",
};

/**
 * A quota bar. One continuous track rather than lit blocks — the value is a
 * proportion, not a count. Colour comes from `toneFor` so the thresholds stay
 * in one place (quota.ts). Decorative: the percentage is always also in text.
 */
export function Meter({
  pct,
  className = "",
  ...rest
}: { pct: number; className?: string } & React.HTMLAttributes<HTMLDivElement>): ReactNode {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`h-[6px] rounded-full overflow-hidden bg-[rgba(120,140,160,0.2)] ${className}`}
      aria-hidden="true"
      {...rest}
    >
      <i
        className={`block h-full rounded-full ${TONE_BG[toneFor(clamped)]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
