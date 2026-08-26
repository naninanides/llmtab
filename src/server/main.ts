import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../store/db.js";
import { detectTools } from "../ingest/detector.js";
import { parseRange } from "../shared/time.js";
import type { Window } from "./queries.js";
import {
  getDaily,
  getHeatmap,
  getLocalModels,
  getModels,
  getProjects,
  getSummary,
  getTools,
  getUnpricedModels,
} from "./queries.js";

const DEFAULT_PORT = 7878;

function resolveWindow(url: URL): Window | null {
  const rangeParam = url.searchParams.get("range") ?? "7d";
  const parsed = parseRange(rangeParam);
  if (!parsed) return null;
  return { fromMs: parsed.fromMs, toMs: parsed.toMs };
}

export function createServer(): http.Server {
  const db = openDb();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    void handle(req, res, url).catch(() => sendJson(res, 500, { error: "internal error" }));
  });

  async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    if (url.pathname.startsWith("/api/")) {
      return handleApi(res, url);
    }
    return serveStatic(res, url.pathname);
  }

  function handleApi(res: http.ServerResponse, url: URL): void {
    const json = (status: number, body: unknown): void => sendJson(res, status, body);

    switch (url.pathname) {
      case "/api/healthz":
        return json(200, { ok: true });
      case "/api/status":
        return json(200, { tools: detectTools() });
      case "/api/sync/last": {
        const row = db.prepare("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1").get() as
          | {
              started_at: string;
              finished_at: string;
              status: string;
              records_added: number;
              lines_skipped: number;
              detail_json: string | null;
            }
          | undefined;
        if (!row) return json(200, { lastSync: null });
        return json(200, {
          lastSync: {
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            status: row.status,
            recordsAdded: row.records_added,
            linesSkipped: row.lines_skipped,
            entries: row.detail_json ? JSON.parse(row.detail_json) : [],
          },
        });
      }
      case "/api/summary": {
        const w = resolveWindow(url);
        if (!w) return json(400, { error: "invalid range" });
        const summary = getSummary(db, w);
        // previous equal-length window for deltas (FR-21)
        let previous = null;
        if (w.fromMs !== null) {
          const len = w.toMs - w.fromMs;
          previous = getSummary(db, { fromMs: w.fromMs - len, toMs: w.fromMs });
          delete (previous as { records?: number }).records;
        }
        const unpricedModels = getUnpricedModels(db, w);
        const localModels = getLocalModels(db, w);
        return json(200, { ...summary, previous, unpricedModels, localModels });
      }
      case "/api/daily": {
        const w = resolveWindow(url);
        if (!w) return json(400, { error: "invalid range" });
        return json(200, { days: getDaily(db, w) });
      }
      case "/api/models": {
        const w = resolveWindow(url);
        if (!w) return json(400, { error: "invalid range" });
        return json(200, { models: getModels(db, w) });
      }
      case "/api/tools": {
        const w = resolveWindow(url);
        if (!w) return json(400, { error: "invalid range" });
        return json(200, { tools: getTools(db, w) });
      }
      case "/api/projects": {
        const w = resolveWindow(url);
        if (!w) return json(400, { error: "invalid range" });
        return json(200, { projects: getProjects(db, w) });
      }
      case "/api/heatmap": {
        const months = Math.min(Math.max(Number(url.searchParams.get("months") ?? 12), 1), 24);
        return json(200, { months, days: getHeatmap(db, months) });
      }
      default:
        return json(404, { error: "not found" });
    }
  }

  function serveStatic(res: http.ServerResponse, pathname: string): void {
    const root = staticRoot();
    const rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      // SPA fallback
      const index = path.join(root, "index.html");
      if (fs.existsSync(index)) return sendFile(res, index);
      return sendJson(res, 404, { error: "dashboard not built — run npm run build:dashboard" });
    }
    sendFile(res, file);
  }

  return server;
}

/** Serves the built dashboard; works both from repo layout and packaged dist. */
function staticRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "../../../dashboard-dist"), // dist/server → repo/dashboard-dist
    path.join(here, "../dashboard-dist"),
    path.join(process.cwd(), "dashboard-dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "index.html"))) return c;
  }
  return candidates[candidates.length - 1] ?? process.cwd();
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
};

function sendFile(res: http.ServerResponse, file: string): void {
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(file));
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Starts the API/dashboard server on the default port with automatic
 * fallback when busy (FR-4). Resolves with the actual port.
 */
export function startServer(port = DEFAULT_PORT, attempts = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && port < DEFAULT_PORT + attempts) {
        resolve(startServer(port + 1, attempts));
      } else {
        reject(err);
      }
    });
    server.listen(port, () => resolve(port));
  });
}
