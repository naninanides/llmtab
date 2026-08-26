import { createContext, useContext, useState, type ReactNode } from "react";
import type { RangeDef } from "@/api";

interface RangeState {
  range: RangeDef;
  setRange: (r: RangeDef) => void;
}

const RangeContext = createContext<RangeState | null>(null);

export function RangeProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<RangeDef>({ kind: "7d" });
  return <RangeContext.Provider value={{ range, setRange }}>{children}</RangeContext.Provider>;
}

export function useRange(): RangeState {
  const ctx = useContext(RangeContext);
  if (!ctx) throw new Error("useRange outside provider");
  return ctx;
}
