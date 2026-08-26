export interface RangeDef {
  kind: "today" | "7d" | "30d" | "all" | "custom";
  from?: string;
  to?: string;
}

export function rangeParam(r: RangeDef): string {
  if (r.kind === "custom") return `${r.from},${r.to}`;
  return r.kind;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `API ${res.status}`);
  }
  return (await res.json()) as T;
}

async function post<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `API ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface SummaryResponse {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  conversations: number;
  records?: number;
  unpricedModels: string[];
  localModels?: string[];
  previous: Partial<SummaryResponse> | null;
}

export interface DayRow {
  day: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  conversations: number;
}

export interface ModelRow {
  model: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface ToolRow {
  tool: string;
  totalTokens: number;
  costUsd: number;
}

export interface ProjectRow {
  project: string;
  totalTokens: number;
  costUsd: number;
}

export interface QuotaWindow {
  label: string;
  used: number;
  limit: number;
  format: "percent" | "dollars" | "count";
  resetsAt: string | null;
  periodMs: number | null;
}

export interface QuotaProvider {
  provider: string;
  displayName: string;
  status: "ok" | "no-auth" | "error" | "rate-limited";
  plan?: string | null;
  windows: QuotaWindow[];
  warning?: string | null;
  error?: string | null;
  checkedAt: string;
}

export const api = {
  summary: (r: RangeDef) => get<SummaryResponse>(`/api/summary?range=${rangeParam(r)}`),
  daily: (r: RangeDef) => get<{ days: DayRow[] }>(`/api/daily?range=${rangeParam(r)}`),
  models: (r: RangeDef) => get<{ models: ModelRow[] }>(`/api/models?range=${rangeParam(r)}`),
  tools: (r: RangeDef) => get<{ tools: ToolRow[] }>(`/api/tools?range=${rangeParam(r)}`),
  projects: (r: RangeDef) =>
    get<{ projects: ProjectRow[] }>(`/api/projects?range=${rangeParam(r)}`),
  heatmap: () =>
    get<{ days: Array<{ day: string; totalTokens: number }> }>("/api/heatmap?months=12"),
  quotas: (force = false) =>
    get<{ providers: QuotaProvider[]; fetchedAt: string }>(`/api/quotas${force ? "?force=1" : ""}`),
  lastSync: () =>
    get<{
      lastSync: {
        finishedAt: string;
        recordsAdded: number;
        linesSkipped: number;
        entries: Array<{ tool: string; recordsAdded: number; linesSkipped: number }>;
      } | null;
    }>("/api/sync/last"),
  sync: () =>
    post<{
      ok: boolean;
      finishedAt: string;
      totalRecordsAdded: number;
      totalLinesSkipped: number;
      entries: Array<{ tool: string; recordsAdded: number; linesSkipped: number }>;
    }>("/api/sync"),
};
