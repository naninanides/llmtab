import {
  app,
  Menu,
  Tray,
  BrowserWindow,
  nativeImage,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import type { DatabaseSync } from "node:sqlite";

/**
 * LLMTab menu-bar shell (PRD FR-50…55).
 * The main process orchestrates only: tray + popup window + server lifecycle.
 * All data flows through the same localhost API as any browser tab
 * (contextIsolation on, nodeIntegration off — StyleGuide §9).
 */

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let dashboardPort = 0;
let refreshTimer: NodeJS.Timeout | null = null;

interface TodayTotals {
  tokens: number;
  costUsd: number;
  perTool: Array<{ tool: string; totalTokens: number }>;
}

app.on("second-instance", () => {
  showWindow(); // FR-53: single instance focuses existing window
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

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
  }
  const today = lastToday;
  const template: MenuItemConstructorOptions[] = [
    today
      ? {
          label: `Today: ${compact(today.tokens)} tokens · $${today.costUsd.toFixed(2)} est.`,
          enabled: false,
        }
      : { label: "Loading…", enabled: false },
    ...(today?.perTool ?? []).map<MenuItemConstructorOptions>((t) => ({
      label: `   ${t.tool} — ${compact(t.totalTokens)}`,
      enabled: false,
    })),
    { type: "separator" },
    { label: "Dashboard", click: showWindow },
    { label: "Sync now", click: () => void syncNow() },
    {
      label: "Open in Browser",
      click: () => void shell.openExternal(`http://localhost:${dashboardPort}`),
    },
    { type: "separator" },
    {
      label: "Launch at Login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: "Quit LLMTab", role: "quit" },
  ];
  tray?.setContextMenu(Menu.buildFromTemplate(template));
}

async function syncNow(): Promise<void> {
  const { openDb } = await import("../store/db.js");
  const { runSync } = await import("../ingest/sync.js");
  const db = openDb();
  runSync(db);
  await refreshTray(db);
}

function showWindow(): void {
  if (!dashboardPort) return;
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 420,
    height: 640,
    show: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "LLMTab",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win?.show());
  // FR-51: blur closes; Esc closes via tiny injected listener
  win.on("blur", () => win?.hide());
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
