import {
  app,
  Menu,
  Tray,
  BrowserWindow,
  nativeImage,
  shell,
  screen,
  type MenuItemConstructorOptions,
} from "electron";
import type { DatabaseSync } from "node:sqlite";
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

// Short labels for the menu-bar strip, like OpenUsage's provider glyphs.
// Kept to 2 chars so "CC 8.2K · CX 1.1K" still fits in the strip.
const TOOL_SHORT: Record<string, string> = {
  "claude-code": "CC",
  codex: "CX",
  "gemini-cli": "GC",
  zcode: "ZC",
  opencode: "OC",
  ollama: "OL",
};

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
    tray.setToolTip(`LLMTab — today: ${compact(tokens)} tokens ($${cost.toFixed(2)} est.)`);
    applyTrayTitle(tokens, cost, perTool);
    rebuildMenu(tokens, cost, perTool);
  } catch {
    // totals are cosmetic — never crash the shell over them
  }
}

let lastToday: TodayTotals | null = null;

function rebuildMenu(
  tokens = -1,
  costUsd = 0,
  perTool: Array<{ tool: string; totalTokens: number }> = [],
): void {
  if (tokens >= 0 && tray) {
    lastToday = { tokens, costUsd, perTool };
    tray.setToolTip(`LLMTab — today: ${compact(tokens)} tokens ($${costUsd.toFixed(2)} est.)`);
    applyTrayTitle(tokens, costUsd, perTool);
  }
  const today = lastToday;
  const mb = readMenuBarConfig();
  const titleLabel =
    today && today.tokens > 0
      ? `Today: ${compact(today.tokens)} tokens · $${today.costUsd.toFixed(2)} est.`
      : today
        ? "Today: no usage yet"
        : "Loading…";
  const template: MenuItemConstructorOptions[] = [
    {
      label: titleLabel,
      enabled: false,
    },
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
    // OpenUsage-inspired: Icon Style sub-menu (Text vs Icon only)
    {
      label: "Menu Bar",
      submenu: [
        {
          label: "Show metrics in menu bar",
          type: "checkbox",
          checked: mb.mode !== "icon-only",
          click: (item) => {
            updateMenuBarConfig({ mode: item.checked ? "text" : "icon-only" });
            if (lastToday) applyTrayTitle(lastToday.tokens, lastToday.costUsd, lastToday.perTool);
          },
        },
        {
          label: "Show cost",
          type: "checkbox",
          checked: mb.showCost !== false,
          enabled: mb.mode !== "icon-only",
          click: (item) => {
            updateMenuBarConfig({ showCost: item.checked });
            if (lastToday) applyTrayTitle(lastToday.tokens, lastToday.costUsd, lastToday.perTool);
          },
        },
        { type: "separator" },
        {
          label: "Compact (total · cost)",
          type: "radio",
          checked: (mb.style ?? "compact") === "compact",
          enabled: mb.mode !== "icon-only",
          click: () => {
            updateMenuBarConfig({ style: "compact" });
            if (lastToday) applyTrayTitle(lastToday.tokens, lastToday.costUsd, lastToday.perTool);
          },
        },
        {
          label: "Per-tool breakdown",
          type: "radio",
          checked: mb.style === "per-tool",
          enabled: mb.mode !== "icon-only",
          click: () => {
            updateMenuBarConfig({ style: "per-tool" });
            if (lastToday) applyTrayTitle(lastToday.tokens, lastToday.costUsd, lastToday.perTool);
          },
        },
      ],
    },
    {
      label: "Launch at Login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: "Quit LLMTab", role: "quit" },
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
  const winOpts: Electron.BrowserWindowConstructorOptions = {
    width: 360,
    height: 640,
    show: false, // hidden sampai tray diklik
    frame: false, // REQUIRED: tidak ada frame agar seperti popover
    resizable: false, // REQUIRED
    skipTaskbar: true, // REQUIRED: jangan muncul di taskbar utama
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "LLMTab",
    hasShadow: true,
    transparent: false,
    backgroundColor: isMac ? "#00000000" : "#1a1a1a",
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
    if (next.pinnedTools && next.pinnedTools.length > 2) next.pinnedTools = next.pinnedTools.slice(0, 2);
    writeConfig({ menuBar: next } as never);
  } catch {
    // config write is best-effort
  }
}

function applyTrayTitle(tokens: number, cost: number, perTool: Array<{ tool: string; totalTokens: number }>): void {
  if (!tray) return;
  // OpenUsage strip hides metrics with no data — fallback to icon only
  if (tokens <= 0) {
    tray.setTitle("");
    return;
  }
  const mb = readMenuBarConfig();
  if (mb.mode === "icon-only") {
    tray.setTitle("");
    return;
  }
  const title = formatTrayTitle(tokens, cost, perTool, mb);
  // setTitle is macOS-only; on other platforms it's a no-op but harmless.
  // "monospaced" renders a smaller fixed-width variant, keeping the strip compact.
  try {
    tray.setTitle(title, { fontType: "monospaced" });
  } catch {
    // older Electron or non-macOS may throw
  }
}

function formatTrayTitle(
  tokens: number,
  cost: number,
  perTool: Array<{ tool: string; totalTokens: number }>,
  mb: MenuBarConfig,
): string {
  const showCost = mb.showCost !== false;
  const style = mb.style ?? "compact";
  if (style === "per-tool" && perTool.length > 0) {
    // Show up to 2 pinned tools (or top 2 by tokens if none pinned), like OpenUsage's 2 stars per provider
    const pinned = mb.pinnedTools?.length ? mb.pinnedTools : perTool.slice(0, 2).map((p) => p.tool);
    const rows = pinned
      .map((tool) => perTool.find((p) => p.tool === tool))
      .filter((r): r is (typeof perTool)[number] => Boolean(r && r.totalTokens > 0))
      .slice(0, 2);
    if (rows.length === 0) return "";
    // Two starred metrics from same provider stack as labeled pair — here two tools
    // Render as "CC 8.2K · CX 1.1K" (no cost in per-tool mode to keep it short, like OpenUsage bars)
    const parts = rows.map((r) => `${TOOL_SHORT[r.tool] ?? r.tool.slice(0, 2).toUpperCase()} ${compact(r.totalTokens)}`);
    // If only one tool has data, append total so strip isn't empty
    if (rows.length === 1 && perTool.length === 1) {
      return showCost ? `${parts[0]} · $${cost.toFixed(2)}` : parts[0] ?? "";
    }
    return parts.join(" · ");
  }
  // Compact: single total + optional cost (Text style: provider icon + values)
  return showCost ? `${compact(tokens)} · $${cost.toFixed(2)}` : compact(tokens);
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

/** Monochrome template PNG so macOS tints it correctly in the menu bar. */
function trayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromDataURL(TEMPLATE_PNG_16);
  icon.addRepresentation({ scaleFactor: 2, dataURL: TEMPLATE_PNG_32 });
  icon.setTemplateImage(true);
  return icon;
}

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

// Monochrome bar-chart glyphs, base64-encoded so no binary asset ships in the
// repo. Regenerate with scripts/make-tray-icon.py.
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
