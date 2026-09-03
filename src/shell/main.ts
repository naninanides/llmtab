import {
  app,
  Menu,
  Tray,
  BrowserWindow,
  nativeImage,
  nativeTheme,
  shell,
  screen,
  type MenuItemConstructorOptions,
} from "electron";
import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, writeConfig } from "../shared/config.js";

/**
 * LLMTab menu-bar shell (PRD FR-50…55).
 * Inspired by OpenUsage's menu-bar pins (Sources/docs/menu-bar.md):
 *  - Text title pinned next to the icon showing live today totals (compact
 *    tokens · cost), or a per-tool breakdown for starred tools.
 *  - Hides when no data (zero tokens) — fallback to icon only.
 *  - Left-click opens the popover/dashboard, right-click shows the context menu.
 *  - Up to 2 pinned tools (mirrors "At most 2 stars per provider").
 *
 * The main process orchestrates only: tray + popup window + server lifecycle.
 * All data flows through the same localhost API as any browser tab
 * (contextIsolation on, nodeIntegration off — StyleGuide §9).
 */

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let dashboardPort = 0;
let refreshTimer: NodeJS.Timeout | null = null;
let contextMenu: Menu | null = null;
let lastWorst: {
  provider: string;
  displayName: string;
  pct: number;
  resetMs: number | null;
  label: string;
} | null = null;

interface TodayTotals {
  tokens: number;
  costUsd: number;
  perTool: Array<{ tool: string; totalTokens: number }>;
}

app.on("second-instance", () => {
  showPopover(); // FR-53: single instance menampilkan popover yang sudah ada
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  // Tray-only on macOS: no Dock icon, just menu bar (like OpenUsage)
  if (process.platform === "darwin" && app.dock) app.dock.hide();

  // server lives in ../server/main.js relative to dist/shell/main.js
  const { startServer } = await import("../server/main.js");
  const { openDb } = await import("../store/db.js");
  const { runSync } = await import("../ingest/sync.js");
  const { startWatch } = await import("../ingest/watch.js");

  try {
    const db = openDb();
    runSync(db);
    dashboardPort = await startServer(7878);
    // keep totals fresh via the same watch loop that keeps the DB fresh (FR-55)
    startWatch(db, () => void refreshTray(db));
    void refreshTray(db);
    refreshTimer = setInterval(() => void refreshTray(db), 30_000);
    refreshTimer.unref?.();
  } catch (err) {
    console.error("LLMTab shell failed to start services:", err);
    app.quit();
    return;
  }

  // Set Dock icon on macOS
  const dockIcon = appIcon();
  if (process.platform === "darwin" && dockIcon && app.dock) {
    try {
      app.dock.setIcon(dockIcon);
    } catch {
      /* ignore */
    }
  }

  tray = new Tray(trayIcon());
  tray.setToolTip("LLMTab — loading…");
  rebuildMenu();

  // Single Popover Window: buat 1 instance sekali di bootstrap, hidden.
  // Left-click HANYA toggle popover (tanpa menu), right-click HANYA menu (hide popover).
  // Ini mencegah 2 layer muncul bersamaan seperti di screenshot.
  createPopoverWindow();
  tray.on("click", () => togglePopover());
  tray.on("right-click", () => {
    // Hide popover dulu agar tidak overlap 2 layer
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
    if (contextMenu && tray) tray.popUpContextMenu(contextMenu);
  });
  tray.on("double-click", () => togglePopover());
}

async function refreshTray(db: DatabaseSync): Promise<void> {
  try {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const fromIso = midnight.toISOString();
    const toIso = new Date(Date.now() + 60_000).toISOString();

    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens)+SUM(output_tokens)+SUM(cache_read_tokens)+SUM(cache_write_tokens),0) AS t,
              COALESCE(SUM(cost_usd),0) AS c
       FROM usage_records WHERE occurred_at >= ? AND occurred_at < ?`,
      )
      .get(fromIso, toIso) as unknown as { t: number; c: number } | undefined;

    const perTool = db
      .prepare(
        `SELECT tool, SUM(input_tokens)+SUM(output_tokens)+SUM(cache_read_tokens)+SUM(cache_write_tokens) AS totalTokens
       FROM usage_records WHERE occurred_at >= ? AND occurred_at < ?
       GROUP BY tool ORDER BY totalTokens DESC`,
      )
      .all(fromIso, toIso) as unknown as Array<{ tool: string; totalTokens: number }>;

    if (!tray) return;
    const tokens = Number(totals?.t ?? 0);
    const cost = Number(totals?.c ?? 0);
    // Quota alert — respect 5-min cache via getQuotas()
    try {
      const { getQuotas } = await import("../quota/manager.js");
      const { worstWindow } = await import("../shared/quotaAlert.js");
      const quotas = await getQuotas();
      const worst = worstWindow(quotas.providers);
      if (worst && worst.pct >= 90) {
        const resetMs = worst.window.resetsAt
          ? new Date(worst.window.resetsAt).getTime() - Date.now()
          : null;
        lastWorst = {
          provider: worst.provider.provider,
          displayName: worst.provider.displayName,
          pct: Math.round(worst.pct),
          resetMs: resetMs && resetMs > 0 ? resetMs : null,
          label: worst.window.label,
        };
      } else {
        lastWorst = null;
      }
    } catch {
      // quota fetch is best-effort
    }
    // Tooltip — on alert, Windows carries the sentence (no title API)
    if (lastWorst) {
      const short = lastWorst.resetMs !== null ? formatShortReset(lastWorst.resetMs) : "";
      const tip = `LLMTab — ${lastWorst.displayName} ${lastWorst.pct}% used${short ? `, resets in ${short}` : ""}`;
      tray.setToolTip(tip);
    } else {
      tray.setToolTip(`LLMTab — today: ${compact(tokens)} tokens ($${cost.toFixed(2)} est.)`);
    }
    applyTrayTitle();
    rebuildMenu(tokens, cost, perTool);
  } catch {
    // totals are cosmetic — never crash the shell over them
  }
}

function formatShortReset(ms: number): string {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h${rm ? ` ${rm}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

let lastToday: TodayTotals | null = null;

function rebuildMenu(
  tokens = -1,
  costUsd = 0,
  perTool: Array<{ tool: string; totalTokens: number }> = [],
): void {
  if (tokens >= 0 && tray) {
    lastToday = { tokens, costUsd, perTool };
    if (!lastWorst) {
      tray.setToolTip(`LLMTab — today: ${compact(tokens)} tokens ($${costUsd.toFixed(2)} est.)`);
    }
    applyTrayTitle();
  }
  const today = lastToday;
  const mb = readMenuBarConfig();
  const titleLines: string[] =
    today && today.tokens > 0
      ? [`Today: ${compact(today.tokens)} tokens`, `$${today.costUsd.toFixed(2)} est.`]
      : today
        ? ["Today: no usage yet"]
        : ["Loading…"];
  const template: MenuItemConstructorOptions[] = [
    ...titleLines.map((label) => ({ label, enabled: false as const })),
    ...(today?.perTool ?? []).map<MenuItemConstructorOptions>((t) => ({
      label: `   ${labelForTool(t.tool)} — ${compact(t.totalTokens)}`,
      enabled: false,
    })),
    { type: "separator" },
    { label: "Dashboard", click: () => showPopover() },
    { label: "Sync now", click: () => void syncNow() },
    {
      label: "Open in Browser",
      click: () => void shell.openExternal(`http://localhost:${dashboardPort}`),
    },
    { type: "separator" },
    ...(process.platform === "win32"
      ? []
      : [
          {
            label: "Menu Bar",
            submenu: [
              {
                label: "Show metrics in menu bar",
                type: "checkbox" as const,
                checked: (mb.mode ?? "icon-only") !== "icon-only",
                click: (item: { checked: boolean }) => {
                  updateMenuBarConfig({ mode: item.checked ? "text" : "icon-only" });
                  if (lastToday) applyTrayTitle();
                },
              },
              {
                label: "Show cost",
                type: "checkbox" as const,
                checked: mb.showCost !== false,
                enabled: (mb.mode ?? "icon-only") !== "icon-only",
                click: (item: { checked: boolean }) => {
                  updateMenuBarConfig({ showCost: item.checked });
                  if (lastToday) applyTrayTitle();
                },
              },
              { type: "separator" as const },
              {
                label: "Compact (total · cost)",
                type: "radio" as const,
                checked: (mb.style ?? "compact") === "compact",
                enabled: (mb.mode ?? "icon-only") !== "icon-only",
                click: () => {
                  updateMenuBarConfig({ style: "compact" });
                  if (lastToday) applyTrayTitle();
                },
              },
              {
                label: "Per-tool breakdown",
                type: "radio" as const,
                checked: mb.style === "per-tool",
                enabled: (mb.mode ?? "icon-only") !== "icon-only",
                click: () => {
                  updateMenuBarConfig({ style: "per-tool" });
                  if (lastToday) applyTrayTitle();
                },
              },
            ],
          } as MenuItemConstructorOptions,
        ]),
    {
      label: process.platform === "win32" ? "Start with Windows" : "Launch at Login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: process.platform === "win32" ? "Exit" : "Quit LLMTab", role: "quit" },
  ];
  // Jangan pakai tray.setContextMenu — itu bikin left-click di macOS otomatis
  // menampilkan menu bersamaan dengan popover (2 layer). Simpan manual,
  // hanya tampilkan di right-click via popUpContextMenu.
  contextMenu = Menu.buildFromTemplate(template);
}

async function syncNow(): Promise<void> {
  const { openDb } = await import("../store/db.js");
  const { runSync } = await import("../ingest/sync.js");
  const db = openDb();
  runSync(db);
  await refreshTray(db);
}

/** Where the popover should sit for a given height, anchored to the tray. */
function popoverAnchor(height?: number): { x: number; y: number } {
  const fallback = win ? win.getBounds() : { x: 0, y: 0, width: 300, height: 240 };
  if (!win || win.isDestroyed() || !tray) return { x: fallback.x, y: fallback.y };
  const trayBounds = tray.getBounds();
  const b = win.getBounds();
  const winBounds = { ...b, height: height ?? b.height };
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + 6);
  const margin = 8;
  const maxX = display.bounds.x + display.bounds.width - winBounds.width - margin;
  const minX = display.bounds.x + margin;
  x = Math.max(minX, Math.min(x, maxX));
  const isTop = trayBounds.y < display.bounds.y + display.bounds.height / 2;
  if (!isTop) y = Math.round(trayBounds.y - winBounds.height - 6);
  const maxY = display.bounds.y + display.bounds.height - winBounds.height - margin;
  y = Math.max(display.bounds.y + margin, Math.min(y, maxY));
  return { x, y };
}

function positionWindow(): void {
  if (!win || win.isDestroyed() || !tray) return;
  const trayBounds = tray.getBounds();
  const winBounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  // Posisikan tepat di bawah ikon tray, center horizontal (macOS menu bar di atas)
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + 6);
  const margin = 8;
  const maxX = display.bounds.x + display.bounds.width - winBounds.width - margin;
  const minX = display.bounds.x + margin;
  x = Math.max(minX, Math.min(x, maxX));
  const isTop = trayBounds.y < display.bounds.y + display.bounds.height / 2;
  if (!isTop) y = Math.round(trayBounds.y - winBounds.height - 6);
  const maxY = display.bounds.y + display.bounds.height - winBounds.height - margin;
  y = Math.max(display.bounds.y + margin, Math.min(y, maxY));
  win.setPosition(x, y, false);
}

// Single Popover Window — hanya 1 instance, dibuat sekali di bootstrap.
// Dipanggil eager saat app ready, tidak pernah di event click tray.
function createPopoverWindow(): void {
  if (win && !win.isDestroyed()) return;
  if (!dashboardPort) return;
  const isMac = process.platform === "darwin";
  const icon = appIcon();
  const winOpts: Electron.BrowserWindowConstructorOptions = {
    width: 300,
    height: 420,
    show: false, // hidden sampai tray diklik
    frame: false, // REQUIRED: tidak ada frame agar seperti popover
    resizable: false, // REQUIRED
    skipTaskbar: true, // REQUIRED: jangan muncul di taskbar utama
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "LLMTab",
    ...(icon ? { icon } : {}),
    hasShadow: true,
    transparent: false,
    backgroundColor: isMac ? "#00000000" : nativeTheme.shouldUseDarkColors ? "#070A0F" : "#DFE6EE",
    thickFrame: false,
    movable: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (isMac) {
    (winOpts as Record<string, unknown>).titleBarStyle = "hiddenInset";
    (winOpts as Record<string, unknown>).vibrancy = "popover";
    (winOpts as Record<string, unknown>).type = "panel";
    winOpts.roundedCorners = true;
  }
  win = new BrowserWindow(winOpts);
  if (isMac) {
    win.setWindowButtonVisibility(false);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  // Auto-fit height to content — eliminates empty space when USAGE tab is short
  // (vs 640 fixed). Driven by a ResizeObserver in the renderer rather than a
  // poll: a 300ms tick meant a tab switch resized the window up to 300ms after
  // the content changed, which read as a lurch. The interval below is only a
  // safety net for the rare change an observer misses.
  let fitTimer: NodeJS.Timeout | null = null;

  // Upper bound for the popover. 640 was a flat constant that ignored the
  // display: two providers publishing three windows each need ~682px, so the
  // window stopped short and the quota list had to scroll even though there was
  // room on screen. Bound to the work area instead, leaving space for the menu
  // bar and a margin, and keep 640 as the floor of that bound so a short screen
  // still behaves as before.
  const workArea = screen.getPrimaryDisplay().workAreaSize.height;
  const MAX_POPOVER_H = Math.max(640, Math.min(900, workArea - 120));

  // Measuring the natural height of the content, not the laid-out height.
  //
  // The popover fills the window by design — that is what pins the tabs and the
  // footer while the quota list scrolls. The cost is that #root, body, the panel
  // and the tab body all end up sized by the window, so every candidate metric
  // is a fixed point: the measurement tracked the window instead of the content
  // and the frame could grow but never shrink back.
  //
  // The reliable way out is to ask the layout directly. Lift the constraint for
  // one synchronous reflow, read what the content actually wants, then put it
  // back before the frame is painted. The write/read/write happens inside a
  // single task, so nothing flickers.
  const MEASURE = `(() => {
    const shell = document.querySelector('[data-fit-shell]');
    const root = document.getElementById('root');
    if (!shell) {
      return Math.min(${MAX_POPOVER_H}, Math.max(240, root ? root.scrollHeight : 240));
    }
    const prevH = shell.style.height;
    const prevOverflow = shell.style.overflow;
    shell.style.height = 'auto';
    shell.style.overflow = 'visible';
    // Forces the reflow that makes the reads below reflect the unconstrained
    // layout rather than the cached one.
    const want = shell.scrollHeight;
    shell.style.height = prevH;
    shell.style.overflow = prevOverflow;
    return Math.min(${MAX_POPOVER_H}, Math.max(240, Math.round(want + 16)));
  })()`;

  // Reports height the moment content changes. Title-cased channel so it cannot
  // collide with anything the app logs.
  // Observes the panel, not #root. The popover is bounded to the window, so
  // #root is always exactly the window height and never resizes — watching it
  // meant the observer fell silent after the first grow and the window could
  // never shrink back when a shorter tab was selected. The panel does change
  // height, and a MutationObserver covers a tab swap that replaces the body
  // outright rather than resizing it.
  // Version the guard: the popover window is reused across opens, so a stale
  // observer installed by an earlier build would otherwise block this one from
  // ever being set up.
  const FIT_VERSION = 4;

  // Watches the tab body, not #root and not the panel. #root is pinned to the
  // window height by the popover layout so it never resizes, and the panel
  // element survives a tab switch — only the body inside it is swapped, so
  // that is the thing whose size actually tracks the selected tab. A
  // MutationObserver re-points the ResizeObserver whenever React replaces it.
  const OBSERVE = `(() => {
    const prev = window.__llmtabFit;
    if (prev && prev.v === ${FIT_VERSION}) return true;
    // Release everything the previous install held. Earlier versions stored
    // only { ro } or { ro, panel } and registered a document-level mousedown
    // listener they never removed, so each reload left another observer and
    // another listener attached — every tab switch then ran emit() once per
    // leaked observer, and the popover grew progressively less responsive the
    // longer the app stayed open. dispose() is now the single teardown path
    // and is stored on the state so any future version can call it blindly.
    if (prev) {
      try { prev.dispose && prev.dispose(); } catch {}
      try { prev.ro && prev.ro.disconnect(); } catch {}
      try { prev.mo && prev.mo.disconnect(); } catch {}
    }
    const state = { v: ${FIT_VERSION}, ro: null, mo: null, target: null, known: {}, last: 0, dispose: null };
    window.__llmtabFit = state;

    /** Which tab is selected, used as the cache key. */
    const currentTab = () => {
      const sel = document.querySelector('[role="tab"][aria-selected="true"]');
      return sel ? (sel.textContent || '').trim() : '';
    };
    // Latency is what makes the resize feel late, so the measurement is taken
    // synchronously in the same task as the DOM change and sent immediately.
    // MEASURE reads the layout under a lifted height constraint, which forces
    // its own reflow, so it already sees the committed tab rather than a
    // half-built one — the earlier double-rAF only added ~32ms before the
    // window could begin moving.
    //
    // A trailing rAF still fires once afterwards to catch anything that
    // settles late (a font swap, an image), coalesced so a burst of mutations
    // produces at most one extra resize.
    let trailing = false;
    // Only report a height that differs from the last one sent. Rapid
    // switching otherwise emitted the same value repeatedly — the prediction,
    // the measurement and the trailing correction all agree once a tab has
    // been seen — and each report crossed to the main process for nothing.
    const report = (h) => {
      if (typeof h !== 'number' || !isFinite(h)) return;
      if (state.last === h) return;
      state.last = h;
      try { console.debug('LLMTAB_FIT:' + h); } catch {}
    };
    const send = () => {
      try {
        const h = ${MEASURE};
        const tab = currentTab();
        if (tab) state.known[tab] = h;
        report(h);
      } catch {}
    };
    const emit = () => {
      send();
      if (trailing) return;
      trailing = true;
      requestAnimationFrame(() => {
        trailing = false;
        send();
      });
    };
    state.ro = new ResizeObserver(emit);
    const watch = () => {
      const target = document.querySelector('.panel-in') || document.querySelector('.glass-hud, .glass');
      if (target && target !== state.target) {
        if (state.target) { try { state.ro.unobserve(state.target); } catch {} }
        state.ro.observe(target);
        state.target = target;
      }
    };
    // Resize on the way in, not after. Clicking a tab whose height was measured
    // on a previous visit sends that height immediately, so the window is
    // already moving while React renders — the measurement afterwards only
    // corrects it if the content actually changed size.
    const onDown = (e) => {
      const tab = e.target && e.target.closest && e.target.closest('[role="tab"]');
      if (!tab) return;
      const label = (tab.textContent || '').trim();
      const h = state.known[label];
      if (typeof h === 'number') report(h);
    };
    document.addEventListener('mousedown', onDown, true);

    state.mo = new MutationObserver(() => { watch(); emit(); });
    state.dispose = () => {
      try { document.removeEventListener('mousedown', onDown, true); } catch {}
      try { state.ro && state.ro.disconnect(); } catch {}
      try { state.mo && state.mo.disconnect(); } catch {}
    };
    const root = document.getElementById('root');
    if (root) state.mo.observe(root, { childList: true, subtree: true });
    watch();
    emit();
    return true;
  })()`;

  // Every tab switch reports its height more than once — the prediction on
  // mousedown, the measurement after the render, and a trailing correction.
  // Applying each one resized the frame repeatedly, and switching quickly made
  // the window chase heights from tabs already left behind. Only the newest
  // target is worth applying, so writes are coalesced onto the next tick and
  // the intermediate values are dropped.
  let pendingHeight: number | null = null;
  let flushTimer: NodeJS.Timeout | null = null;

  const flushHeight = (): void => {
    flushTimer = null;
    const target = pendingHeight;
    pendingHeight = null;
    if (target === null) return;
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const [, curH] = win.getSize() as [number, number];
    // 4px deadband: ignore sub-pixel churn, act on real layout changes.
    if (curH !== undefined && Math.abs(curH - target) <= 4) return;

    // setBounds rather than setSize + setPosition: one compositor commit, so
    // the frame cannot tear between moving and resizing.
    const b = win.getBounds();
    const anchor = popoverAnchor(target);
    win.setBounds({ x: anchor.x, y: anchor.y, width: b.width, height: target }, false);
  };

  const applyHeight = (raw: unknown): void => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const target = Number(raw);
    if (!Number.isFinite(target) || target <= 0) return;
    pendingHeight = Math.round(target);

    const [, curH] = win.getSize() as [number, number];
    const settled = curH !== undefined && Math.abs(curH - pendingHeight) <= 4;
    if (settled) {
      // Already the right size — drop any scheduled write rather than let a
      // stale one fire after the user has landed.
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      return;
    }

    // Clicking through tabs faster than the frame can settle used to resize the
    // window once per tab passed through, which is the stutter. Restarting the
    // timer on every report means only the tab actually settled on is drawn.
    //
    // 45ms is above a comfortable rapid-click interval (~25ms) so a burst
    // collapses to one resize, and below the ~100ms at which a deliberate
    // single switch would start to feel like it lagged behind the click.
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushHeight, 45);
  };

  const fitPopoverHeight = async (): Promise<void> => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    try {
      applyHeight(await win.webContents.executeJavaScript(MEASURE, true));
    } catch {}
  };

  // The observer speaks through console messages — no preload, no IPC surface.
  // Electron 44 carries the details on the event object itself.
  win.webContents.on("console-message", (details) => {
    const message = details.message ?? "";
    if (message.startsWith("LLMTAB_FIT:")) applyHeight(message.slice(11));
  });

  const startFit = (): void => {
    if (fitTimer) clearInterval(fitTimer);
    // Was 300ms; the observer carries the real work now.
    fitTimer = setInterval(() => void fitPopoverHeight(), 2000);
    fitTimer.unref?.();
    void win?.webContents.executeJavaScript(OBSERVE, true).catch(() => {});
    void fitPopoverHeight();
  };
  const stopFit = (): void => {
    if (fitTimer) {
      clearInterval(fitTimer);
      fitTimer = null;
    }
  };
  win.on("show", () => startFit());
  win.on("hide", () => stopFit());
  win.webContents.on("did-finish-load", () => {
    if (win?.isVisible()) startFit();
  });
  // Blur otomatis hide — klik di luar popover menutup
  win.on("blur", () => {
    if (win?.isDestroyed() || !win?.isVisible()) return;
    if (win.webContents.isDevToolsOpened()) return;
    win.hide();
  });
  win.webContents.on("dom-ready", () => {
    void win?.webContents.executeJavaScript(
      `window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });`,
    );
  });
  win.on("closed", () => {
    stopFit();
    win = null;
  });
  void win.loadURL(`http://localhost:${dashboardPort}`);
}

function ensurePopoverWindow(): void {
  if (!win || win.isDestroyed()) createPopoverWindow();
}

// Toggle visibility — HANYA show/hide + positioning, TANPA new Window()
function togglePopover(): void {
  ensurePopoverWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) {
    win.hide();
    return;
  }
  positionWindow();
  win.show();
  win.focus();
}

// Selalu tampilkan (untuk menu Dashboard / second-instance), bukan toggle
function showPopover(): void {
  ensurePopoverWindow();
  if (!win || win.isDestroyed()) return;
  positionWindow();
  win.show();
  win.focus();
}

// ── Menu-bar title (OpenUsage "text style" pins) ──────────────────────

interface MenuBarConfig {
  mode?: "text" | "icon-only";
  showCost?: boolean;
  pinnedTools?: string[];
  style?: "compact" | "per-tool";
}

function readMenuBarConfig(): MenuBarConfig {
  try {
    const c = readConfig();
    return (c as { menuBar?: MenuBarConfig }).menuBar ?? {};
  } catch {
    return {};
  }
}

function updateMenuBarConfig(patch: MenuBarConfig): void {
  try {
    const cfg = readConfig() as { menuBar?: MenuBarConfig } & Record<string, unknown>;
    const next = { ...(cfg.menuBar ?? {}), ...patch };
    // enforce at most 2 pinned tools like OpenUsage
    if (next.pinnedTools && next.pinnedTools.length > 2)
      next.pinnedTools = next.pinnedTools.slice(0, 2);
    writeConfig({ menuBar: next } as never);
  } catch {
    // config write is best-effort
  }
}

function applyTrayTitle(): void {
  if (!tray) return;
  const isMac = process.platform === "darwin";
  const mb = readMenuBarConfig();
  // Alert path takes precedence at 90%+
  if (lastWorst) {
    const short = lastWorst.resetMs !== null ? formatShortReset(lastWorst.resetMs) : "";
    const alertLabel = short ? `${lastWorst.pct}% · ${short}` : `${lastWorst.pct}%`;
    if (isMac) {
      try {
        tray.setTitle(alertLabel);
      } catch {
        // setTitle only on macOS
      }
      tray.setImage(trayIcon());
    } else {
      // Windows: colour tray icon (not template) + tooltip already set
      tray.setImage(trayIcon(true));
      try {
        tray.setTitle("");
      } catch {
        // ignore
      }
    }
    return;
  }

  // Normal path — respect Menu Bar config. Icon-only is the default: the menu
  // bar stays quiet, and the numbers live in the tooltip, menu and popover.
  // Opt into the pinned text with "Show metrics in menu bar".
  if ((mb.mode ?? "icon-only") === "icon-only") {
    try {
      tray.setTitle("");
    } catch {}
    tray.setImage(trayIcon());
    return;
  }
  // No data yet — icon only
  if (!lastToday || lastToday.tokens <= 0) {
    try {
      tray.setTitle("");
    } catch {}
    tray.setImage(trayIcon());
    return;
  }

  const showCost = mb.showCost !== false;
  const style = mb.style ?? "compact";
  let title = "";
  if (style === "per-tool" && lastToday.perTool.length > 0) {
    const pinned = lastToday.perTool.slice(0, 2);
    title = pinned.map((t) => `${labelForTool(t.tool)} ${compact(t.totalTokens)}`).join(" · ");
    if (showCost) title += ` · $${lastToday.costUsd.toFixed(2)}`;
  } else {
    title = `${compact(lastToday.tokens)}`;
    if (showCost) title += ` · $${lastToday.costUsd.toFixed(2)}`;
  }

  if (isMac) {
    try {
      tray.setTitle(title);
    } catch {}
  }
  tray.setImage(trayIcon());
}

function labelForTool(tool: string): string {
  const names: Record<string, string> = {
    "claude-code": "Claude Code",
    codex: "Codex CLI",
    "gemini-cli": "Gemini CLI",
    zcode: "ZCode",
    opencode: "OpenCode",
    ollama: "Ollama",
  };
  return names[tool] ?? tool;
}

/** App icon for Dock / window (512px PNG). Falls back to tray template if missing. */
function appIcon(): Electron.NativeImage | undefined {
  for (const p of iconCandidates("icon-512.png", "icon-256.png", "icon.png")) {
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  }
  return undefined;
}

function resolveIconPath(file: string): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, `../../build/icons/${file}`), // dev: dist/shell → build/icons
    path.join(here, `../build/icons/${file}`),
    path.join(here, `../../assets/icons/${file}`), // packaged assets
    path.join(process.cwd(), `build/icons/${file}`),
    path.join(process.cwd(), `assets/icons/${file}`),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function iconCandidates(...files: string[]): string[] {
  return files.map((f) => resolveIconPath(f)).filter((p): p is string => p !== null);
}

/** Monochrome template PNG so macOS tints it correctly in the menu bar. Guarded to darwin — on Windows a template image is a flat black silhouette. */
function trayIcon(alert = false): Electron.NativeImage {
  const p16 = resolveIconPath("tray-16.png");
  const p32 = resolveIconPath("tray-32.png");
  // Windows alert could ship a colour asset (e.g. tray-alert-16.png); fall back to normal icon as colour image
  const alertP16 = alert ? resolveIconPath("tray-alert-16.png") : null;
  const alertP32 = alert ? resolveIconPath("tray-alert-32.png") : null;
  const useP16 = alert && alertP16 ? alertP16 : p16;
  const useP32 = alert && alertP32 ? alertP32 : p32;
  if (useP16) {
    const icon = nativeImage.createFromPath(useP16);
    if (useP32) icon.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(useP32) });
    else if (p32 && !alert)
      icon.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(p32) });
    if (process.platform === "darwin") icon.setTemplateImage(true);
    return icon;
  }
  // fallback to embedded base64 (kept for packaged builds without icons)
  const icon = nativeImage.createFromDataURL(TEMPLATE_PNG_16);
  icon.addRepresentation({ scaleFactor: 2, dataURL: TEMPLATE_PNG_32 });
  if (process.platform === "darwin") icon.setTemplateImage(true);
  return icon;
}

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

// Monochrome speedometer glyphs, base64-encoded so no binary asset ships in the
// repo. Regenerate with build/icons/generate.mjs.
const TEMPLATE_PNG_16 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIklEQVR4nGNgGIrgPxTTx4D/DJgahrMB+BSPGkAvAwYGAAA3nUe5O1ArawAAAABJRU5ErkJggg==";
const TEMPLATE_PNG_32 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOElEQVR4nO3OwQkAMAgEQftv2lQQUIgPySzc95gIzZWXAQAA7AdUjwEAAADagNfHAAAAAABtwJ8dnkhgrkQbonQAAAAASUVORK5CYII=";

app.on("window-all-closed", () => {
  // stay alive in the tray
});

app.on("before-quit", () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
