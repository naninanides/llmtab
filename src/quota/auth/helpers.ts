/* eslint-disable eqeqeq */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function home(): string {
  return os.homedir();
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function resolveClaudeHome(): string {
  const env = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (env) return path.resolve(env);
  return path.join(home(), ".claude");
}

export function resolveCodexHome(): string {
  const env = process.env.CODEX_HOME?.trim();
  if (env) return path.resolve(env);
  // OpenUsage checks CODEX_HOME, then ~/.config/codex, then ~/.codex
  const xdg = path.join(home(), ".config", "codex");
  if (fs.existsSync(path.join(xdg, "auth.json"))) return xdg;
  return path.join(home(), ".codex");
}

export function resolveOpencodeDataDir(): string {
  const env = process.env.OPENCODE_DATA_DIR?.trim();
  if (env) return path.resolve(env);
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) return path.join(path.resolve(xdg), "opencode");
  return path.join(home(), ".local", "share", "opencode");
}

export function isExpired(expiresAt: number | undefined | null, nowMs = Date.now(), skewMs = 5 * 60 * 1000): boolean {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return false;
  // expiresAt may be ms or seconds — heuristics: < 1e12 = seconds
  const ms = expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
  return ms - skewMs <= nowMs;
}
