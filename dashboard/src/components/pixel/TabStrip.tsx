import type { ReactNode } from "react";

export interface TabDef {
  id: string;
  label: string;
  dot?: boolean;
  dotLabel?: string;
}

export function TabStrip({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}): ReactNode {
  return (
    <div role="tablist" className="flex gap-[3px] px-[3px] relative z-[2]">
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={selected}
            aria-label={t.dot && t.dotLabel ? `${t.label}, ${t.dotLabel}` : t.label}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const idx = tabs.findIndex((x) => x.id === t.id);
                const dir = e.key === "ArrowRight" ? 1 : -1;
                const next = tabs[(idx + dir + tabs.length) % tabs.length]!;
                onChange(next.id);
                // focus next tab
                const el = document.querySelector<HTMLElement>(`[role="tab"][data-tab="${next.id}"]`);
                el?.focus();
              }
            }}
            data-tab={t.id}
            className={`px-[13px] pt-[7px] pb-[8px] inline-flex items-center gap-[7px] font-silkscreen text-[9px] tracking-[0.06em] shadow-[inset_0_3px_0_0_var(--lit),inset_3px_0_0_0_var(--lit),inset_-3px_0_0_0_var(--shade)] transition-[background-color,color] duration-100 ease-out motion-reduce:transition-none ${
              selected
                ? "bg-panel text-bone -mb-[3px] pb-[11px]"
                : "bg-panel-2 text-muted hover:text-bone"
            }`}
          >
            {t.label}
            {t.dot && <i aria-hidden="true" className="w-[7px] h-[7px] bg-alert flex-none" />}
          </button>
        );
      })}
    </div>
  );
}
