import http from "node:http";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { dedupKey } from "../shared/hash.js";
import type { UsageRecord } from "../shared/types.js";
import { insertRecords } from "../store/records.js";
import { refreshBuckets } from "../store/buckets.js";

/**
 * Ollama reverse proxy (PRD FR-15/16).
 *
 * Ollama persists no usage data anywhere, so LLMTab captures it at the API
 * boundary: clients talk to this proxy (default :11435), which forwards every
 * request byte-for-byte to the real server (:11434) and streams responses
 * straight back. From each completed inference we read ONLY numeric usage
 * fields + model name; bodies are buffered transiently in memory for parsing
 * and never written to disk (PRD §10 privacy).
 *
 * Covered routes:
 * - POST /api/chat, /api/generate  → NDJSON stream; final `done:true` line
 *   carries prompt_eval_count / eval_count / model
 * - POST /v1/chat/completions      → OpenAI-compat; usage.prompt_tokens /
 *   usage.completion_tokens (non-stream JSON or SSE final chunk)
 */

export interface ProxyOptions {
  db: DatabaseSync;
  /** local listen port (default 11435); 0 = ephemeral (tests) */
  port?: number;
  /** upstream ollama port (default 11434) */
  upstreamPort?: number;
}

export interface ProxyHandle {
  server: http.Server;
  port: number;
  stop: () => Promise<void>;
}

const CAPTURED_PATHS = new Set(["/api/chat", "/api/generate", "/v1/chat/completions"]);

export function startOllamaProxy(opts: ProxyOptions): Promise<ProxyHandle> {
  const port = opts.port ?? 11435;
  const upstreamPort = opts.upstreamPort ?? 11434;
  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "llmtab proxy failure" }));
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const capture = req.method === "POST" && CAPTURED_PATHS.has(path);
    const requestId = capture ? randomUUID() : null;

    // transient in-memory body accumulation — never persisted
    let responseBody = "";
    let responded = false;

    const upstreamReq = http.request(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        responded = true;
        upstreamRes.on("data", (chunk: Buffer) => {
          if (capture) responseBody += chunk.toString("utf8");
        });
        upstreamRes.pipe(res);
        upstreamRes.on("end", () => {
          if (!capture || requestId === null) return;
          const status = upstreamRes.statusCode ?? 500;
          try {
            if (status >= 200 && status < 300) {
              const record = extractUsage(path, responseBody, requestId);
              if (record) {
                const unique = [record];
                insertRecords(opts.db, unique);
                refreshBuckets(opts.db, unique);
              }
            }
          } catch {
            // a malformed response must never break the proxied client
          } finally {
            responseBody = "";
          }
        });
      },
    );

    upstreamReq.on("error", () => {
      if (!responded) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `ollama not reachable on :${upstreamPort}` }));
        responded = true;
      } else {
        res.end();
      }
    });

    req.pipe(upstreamReq);
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const bound = typeof addr === "object" && addr !== null ? addr.port : port;
      resolve({
        server,
        port: bound,
        stop: () =>
          new Promise<void>((resolveStop) => {
            server.close(() => resolveStop());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

/** Pure: response body → usage fields only. Returns null when nothing usable. */
export function extractUsage(path: string, body: string, requestId: string): UsageRecord | null {
  const found = extractFields(path, body);
  if (!found) return null;

  const occurredAt = (found.createdAt ?? new Date()).toISOString();
  return {
    dedupKey: dedupKey("ollama", "proxy", requestId, occurredAt),
    tool: "ollama",
    model: found.model,
    inputTokens: Math.max(0, found.input),
    outputTokens: Math.max(0, found.output),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    occurredAt,
    project: null,
    sessionId: "proxy",
  };
}

function extractFields(
  path: string,
  body: string,
): { model: string; input: number; output: number; createdAt?: Date | undefined } | null {
  if (path === "/v1/chat/completions") return fromOpenAi(body);

  // /api/chat & /api/generate: NDJSON lines; last done:true chunk has totals.
  // A non-streaming response is a single JSON object with the same fields.
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = tryParse(lines[i] ?? "");
    if (obj && typeof obj === "object" && (obj as Record<string, unknown>).done === true) {
      return fromOllamaChunk(obj as Record<string, unknown>);
    }
  }
  return null;
}

function fromOllamaChunk(
  o: Record<string, unknown>,
): { model: string; input: number; output: number; createdAt?: Date | undefined } | null {
  const model = str(o.model);
  if (!model) return null;
  const input = intOf(o.prompt_eval_count);
  const output = intOf(o.eval_count);
  const createdRaw = str(o.created_at);
  const createdAt = createdRaw ? safeDate(createdRaw) : undefined;
  return { model, input, output, createdAt };
}

function fromOpenAi(
  body: string,
): { model: string; input: number; output: number; createdAt?: Date | undefined } | null {
  // non-streaming: one JSON object; streaming: SSE `data:` lines
  const candidates = body
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter((l) => l.length > 0 && l !== "[DONE]");
  const pool = candidates.length > 0 ? candidates : [body];

  for (let i = pool.length - 1; i >= 0; i--) {
    const obj = tryParse(pool[i] ?? "");
    if (!obj || typeof obj !== "object") continue;
    const o = obj as Record<string, unknown>;
    const usage = (o.usage && typeof o.usage === "object" ? o.usage : null) as Record<
      string,
      unknown
    > | null;
    if (!usage) continue;
    const model = str(o.model);
    if (!model) continue;
    const created = intOf(o.created);
    return {
      model,
      input: intOf(usage.prompt_tokens),
      output: intOf(usage.completion_tokens),
      createdAt: created > 0 ? new Date(created * 1000) : undefined,
    };
  }
  return null;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function intOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

function safeDate(s: string): Date | undefined {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
