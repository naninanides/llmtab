/**
 * Popover auto-fit — reports the height the popover content wants so the
 * Electron shell can size the window to it.
 *
 * This lives in the renderer because it is layout logic, not window
 * orchestration (StyleGuide §9: the main process only orchestrates). It used to
 * ship as a template string executed via `executeJavaScript`, which put it
 * outside `strict`, eslint and the test runner.
 *
 * It talks to the shell through a `console.debug` line rather than IPC, which
 * keeps `contextIsolation: true` with no preload and no exposed surface. The
 * shell parses the prefix; nothing else reads it.
 */

/** Prefix the shell matches on. Changing it requires changing src/shell/main.ts. */
const CHANNEL = "LLMTAB_FIT:";

/** Padding around the panel, matching the popover wrapper's `p-2`. */
const PAGE_PADDING_PX = 16;

/** Smallest window the shell will draw; mirrors its own clamp. */
const MIN_HEIGHT_PX = 240;

export interface FitController {
  /** Measure now and report. */
  emit(): void;
  /** Release every listener and observer this controller installed. */
  dispose(): void;
}

/**
 * The height the content wants, independent of the window it is currently in.
 *
 * The popover fills its window by design — that is what pins the tabs and the
 * footer while the quota list scrolls — so `scrollHeight` on the shell, the
 * body or the panel all report the *current* window height. Reading any of them
 * makes the measurement a fixed point: the window can grow but never shrink.
 *
 * Lifting the height constraint for one synchronous reflow gives the real
 * answer, and restoring it before the browser paints means nothing flickers.
 */
export function measureNaturalHeight(maxHeight: number): number {
  const shell = document.querySelector<HTMLElement>("[data-fit-shell]");
  if (!shell) {
    const root = document.getElementById("root");
    return clamp(root ? root.scrollHeight : MIN_HEIGHT_PX, maxHeight);
  }

  const prevHeight = shell.style.height;
  const prevOverflow = shell.style.overflow;
  shell.style.height = "auto";
  shell.style.overflow = "visible";
  // Reading scrollHeight forces the reflow, so this sees the unconstrained
  // layout rather than a cached one.
  const want = shell.scrollHeight;
  shell.style.height = prevHeight;
  shell.style.overflow = prevOverflow;

  return clamp(want + PAGE_PADDING_PX, maxHeight);
}

/**
 * Clamps a raw content height into what the shell will accept. Exported so the
 * bounds are testable without a DOM — this is where an off-by-one would show up
 * as a window that will not shrink or one that overflows the display.
 */
export function clampHeight(value: number, maxHeight: number): number {
  if (!Number.isFinite(value)) return MIN_HEIGHT_PX;
  return Math.min(maxHeight, Math.max(MIN_HEIGHT_PX, Math.round(value)));
}

function clamp(value: number, maxHeight: number): number {
  return clampHeight(value, maxHeight);
}

/**
 * Decides whether a height is worth sending. Repeats are suppressed because
 * each report crosses to the main process, and a burst of identical values was
 * one of the things that made rapid tab switching stutter.
 */
export function shouldReport(height: number, lastSent: number): boolean {
  if (!Number.isFinite(height)) return false;
  return height !== lastSent;
}

/**
 * The tab arrow keys move to, mirroring the roving-tabindex wrap in
 * `Segmented`. Kept pure so the wrap-around is verifiable directly.
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0 || current < 0) return null;
  if (key !== "ArrowRight" && key !== "ArrowLeft") return null;
  const step = key === "ArrowRight" ? 1 : -1;
  return (current + step + count) % count;
}

/** Label of the selected tab, used to key the height cache. */
function selectedTabLabel(): string {
  const el = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  return el ? (el.textContent ?? "").trim() : "";
}

/**
 * Installs the reporter. Returns a controller whose `dispose` releases
 * everything — leaked observers made every tab switch do redundant work and the
 * popover grew less responsive the longer it stayed open.
 */
export function startPopoverFit(maxHeight: number): FitController {
  const root = document.getElementById("root");

  /** Last height sent, so an unchanged value never crosses to the shell. */
  let last = 0;
  /** Height each tab settled at, so revisiting one can resize before it renders. */
  const known = new Map<string, number>();
  /** Element currently observed for size changes. */
  let target: Element | null = null;
  /** Guards the trailing correction so a burst produces at most one extra. */
  let trailingQueued = false;

  const report = (height: number): void => {
    if (!shouldReport(height, last)) return;
    last = height;
    // eslint-disable-next-line no-console -- the shell's only channel; see file header
    console.debug(CHANNEL + String(height));
  };

  const send = (): void => {
    const height = measureNaturalHeight(maxHeight);
    const tab = selectedTabLabel();
    if (tab !== "") known.set(tab, height);
    report(height);
  };

  const emit = (): void => {
    send();
    if (trailingQueued) return;
    trailingQueued = true;
    // One trailing read catches anything that settles after commit — a font
    // swap, a late image — without delaying the first report.
    requestAnimationFrame(() => {
      trailingQueued = false;
      send();
    });
  };

  const resizeObserver = new ResizeObserver(() => emit());

  /**
   * Points the ResizeObserver at the tab body. `#root` is pinned to the window
   * height so it never resizes, and the panel survives a tab switch — only the
   * body inside it is replaced.
   */
  const watch = (): void => {
    const next =
      document.querySelector(".panel-in") ?? document.querySelector(".glass-hud, .glass");
    if (!next || next === target) return;
    if (target) resizeObserver.unobserve(target);
    resizeObserver.observe(next);
    target = next;
  };

  const mutationObserver = new MutationObserver(() => {
    watch();
    emit();
  });

  /**
   * Resize on the way in. Clicking a tab whose height is already known reports
   * it before React re-renders, so the window moves with the content instead of
   * chasing it a frame later.
   */
  const onPointerDown = (event: Event): void => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    const tab = el.closest('[role="tab"]');
    if (!tab) return;
    const height = known.get((tab.textContent ?? "").trim());
    if (height !== undefined) report(height);
  };

  /**
   * Keyboard users move between tabs with the arrow keys (StyleGuide §6), which
   * fires no pointer event — without this they would fall back to the slower
   * measure-after-render path the prediction exists to avoid.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const el = event.target;
    if (!(el instanceof Element) || !el.closest('[role="tab"]')) return;
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const index = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const nextIndex = nextTabIndex(index, event.key, tabs.length);
    if (nextIndex === null) return;
    const next = tabs[nextIndex];
    const height = next ? known.get((next.textContent ?? "").trim()) : undefined;
    if (height !== undefined) report(height);
  };

  document.addEventListener("mousedown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  if (root) mutationObserver.observe(root, { childList: true, subtree: true });
  watch();
  emit();

  const controller: FitController = {
    emit,
    dispose(): void {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (window.__llmtabFit === controller) window.__llmtabFit = undefined;
    },
  };

  // The shell's periodic safety net asks the renderer to re-report through
  // this handle rather than measuring on its side.
  window.__llmtabFit = controller;
  return controller;
}

declare global {
  interface Window {
    /**
     * Height ceiling the Electron shell will honour, injected before the app
     * loads. Absent in a browser tab, where the fit reporter is inert anyway.
     */
    __LLMTAB_MAX_H?: number;
    /** Live fit controller, so the shell can request a re-report. */
    __llmtabFit?: FitController;
  }
}
