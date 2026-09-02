/**
 * Popover view state that survives a close.
 *
 * The popover used to reset to Usage/7d on every open (StyleGuide §1b,
 * "remembers nothing"). In practice that fought the user: someone watching a
 * quota had to re-select the tab every time they glanced at it. It now
 * restores whatever you last looked at.
 *
 * localStorage rather than ~/.llmtab/config.json because the renderer is
 * sandboxed with no IPC channel. It is per-machine view state, not data — if
 * it is missing or corrupt the popover simply opens on the default.
 */

const KEY = "llmtab.popover.view";

export type PopoverTab = "usage" | "quotas" | "sources";
export type Period = "today" | "7d" | "30d";
export type SourcesSubTab = "sources" | "models";

export interface PopoverPrefs {
  tab: PopoverTab;
  period: Period;
  sourcesSubTab: SourcesSubTab;
}

export const DEFAULT_PREFS: PopoverPrefs = {
  tab: "usage",
  period: "7d",
  sourcesSubTab: "sources",
};

const TABS: readonly PopoverTab[] = ["usage", "quotas", "sources"];
const PERIODS: readonly Period[] = ["today", "7d", "30d"];
const SUBTABS: readonly SourcesSubTab[] = ["sources", "models"];

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Each field falls back independently, so a partial or hand-edited file still
 * restores what it can instead of discarding everything.
 */
export function readPrefs(): PopoverPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return DEFAULT_PREFS;
    const o = p as Record<string, unknown>;
    return {
      tab: pick(o.tab, TABS, DEFAULT_PREFS.tab),
      period: pick(o.period, PERIODS, DEFAULT_PREFS.period),
      sourcesSubTab: pick(o.sourcesSubTab, SUBTABS, DEFAULT_PREFS.sourcesSubTab),
    };
  } catch {
    // private mode, disabled storage, bad JSON — open on the default
    return DEFAULT_PREFS;
  }
}

export function writePrefs(prefs: Partial<PopoverPrefs>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...prefs }));
  } catch {
    // never let a failed write break the popover
  }
}
