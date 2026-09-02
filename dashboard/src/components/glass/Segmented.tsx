import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface TabDef {
  id: string;
  label: string;
  dot?: boolean;
  dotLabel?: string;
}

/**
 * Segmented control — the macOS idiom for switching between peer views.
 * Arrow keys move between tabs, matching platform behaviour. A `dot` marks a
 * tab that needs attention and always carries `dotLabel` in the accessible
 * name, so the state is never colour-only.
 *
 * The selected pill is a single element that slides between tabs rather than a
 * background that blinks from one button to the next. Its geometry is measured
 * from the buttons themselves, because the tabs are not equal width — "Usage"
 * and "Sources" differ, and a thirds assumption would drift.
 */
export function Segmented({
  tabs,
  active,
  onChange,
  className = "",
  size = "regular",
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  size?: "regular" | "compact";
}): ReactNode {
  const pad =
    size === "compact" ? "px-[11px] py-[6px] text-[11px]" : "px-[15px] py-[7px] text-[13px]";

  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  // Until the pill has been placed once, sliding from x=0 would read as the
  // indicator flying in from the left on first paint.
  const placed = useRef(false);

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-tab="${CSS.escape(active)}"]`);
    if (!el) return;
    setPill({ x: el.offsetLeft, w: el.offsetWidth });
  }, [active]);

  // Layout effect so the first paint already has the pill in the right place.
  useLayoutEffect(measure, [measure]);

  // Re-measure when the control resizes or fonts finish loading — a late font
  // swap changes label widths, which would leave the pill misaligned.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    for (const child of Array.from(list.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    if (pill && !placed.current) {
      // Let the initial position commit before transitions are allowed.
      const id = requestAnimationFrame(() => {
        placed.current = true;
      });
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [pill]);

  return (
    <div
      ref={listRef}
      role="tablist"
      className={`relative inline-flex gap-[3px] p-[3px] rounded-full glass-thin ${className}`}
    >
      {/* The sliding indicator. Transform-only so it animates on the compositor
          and cannot cost a layout pass — the popover resizes to its content, and
          a layout-animating pill would fight that. */}
      {pill && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute top-[3px] bottom-[3px] left-0 rounded-full
            bg-mat-thick shadow-[0_1px_0_var(--edge-hi)_inset,0_2px_6px_-3px_rgba(0,0,0,.5)]
            motion-reduce:transition-none ${
              placed.current
                ? "transition-[transform,width] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
                : ""
            }`}
          style={{ transform: `translateX(${pill.x}px)`, width: pill.w }}
        />
      )}

      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={selected}
            aria-label={t.dot && t.dotLabel ? `${t.label}, ${t.dotLabel}` : undefined}
            data-tab={t.id}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const idx = tabs.findIndex((x) => x.id === t.id);
              const dir = e.key === "ArrowRight" ? 1 : -1;
              const next = tabs[(idx + dir + tabs.length) % tabs.length]!;
              onChange(next.id);
              document
                .querySelector<HTMLElement>(`[role="tab"][data-tab="${next.id}"]`)
                ?.focus();
            }}
            className={`${pad} relative z-[1] inline-flex items-center justify-center gap-[6px] rounded-full font-medium whitespace-nowrap
              transition-colors duration-150 motion-reduce:transition-none
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2
              ${selected ? "text-text-1" : "text-text-2 hover:text-text-1"}`}
          >
            {t.label}
            {t.dot && (
              <i aria-hidden="true" className="w-[6px] h-[6px] rounded-full bg-danger flex-none" />
            )}
          </button>
        );
      })}
    </div>
  );
}
