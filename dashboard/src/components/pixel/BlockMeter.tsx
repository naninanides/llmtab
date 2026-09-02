import type { ReactNode } from "react";
import { toneFor } from "@/quota";

const BLOCKS = 20;

export function BlockMeter({ pct, ...rest }: { pct: number } & React.HTMLAttributes<HTMLDivElement>): ReactNode {
  const clamped = Math.max(0, Math.min(100, pct));
  const lit = Math.round((clamped / 100) * BLOCKS);
  const tone = toneFor(clamped);
  return (
    <div className="flex gap-[2px] mt-[6px]" aria-hidden="true" {...rest}>
      {Array.from({ length: BLOCKS }).map((_, i) => (
        <i
          key={i}
          className={`block h-[10px] flex-1 ${i < lit ? (tone === "crit" ? "bg-alert" : tone === "warm" ? "bg-amber" : "bg-cyan") : "bg-panel-2"}`}
        />
      ))}
    </div>
  );
}
