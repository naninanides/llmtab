import fs from "node:fs";
import { llmtabHome } from "./paths.js";

/**
 * LLMTab user config at ~/.llmtab/config.json. Tolerant by design: a missing
 * or malformed file means defaults, never a crash (StyleGuide §9 error rule).
 */

export interface LlmtabConfig {
  /** Ollama reverse proxy enabled (FR-16, opt-in). */
  proxyEnabled?: boolean;
  /** Local listen port for the proxy. Default 11435. */
  proxyPort?: number;
  /** Upstream Ollama port. Default 11434. */
  ollamaPort?: number;
}

export const DEFAULT_PROXY_PORT = 11435;
export const DEFAULT_OLLAMA_PORT = 11434;

export function configPath(): string {
  return process.env.LLMTAB_CONFIG_PATH ?? `${llmtabHome()}/config.json`;
}

export function readConfig(): LlmtabConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as LlmtabConfig;
  } catch {
    // missing/unreadable → defaults
  }
  return {};
}

export function writeConfig(update: LlmtabConfig): LlmtabConfig {
  const next = { ...readConfig(), ...update };
  fs.mkdirSync(llmtabHome(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function proxyPort(config = readConfig()): number {
  const p = config.proxyPort;
  return typeof p === "number" && p > 0 ? p : DEFAULT_PROXY_PORT;
}

export function ollamaUpstreamPort(config = readConfig()): number {
  const p = config.ollamaPort;
  return typeof p === "number" && p > 0 ? p : DEFAULT_OLLAMA_PORT;
}
