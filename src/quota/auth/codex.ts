/* eslint-disable eqeqeq */
/**
 * Codex auth — file-based (mirrors OpenUsage CodexAuthStore)
 * Sources: $CODEX_HOME/auth.json else ~/.config/codex/auth.json else ~/.codex/auth.json
 */
import path from "node:path";
import fs from "node:fs";
import { readJsonFile, resolveCodexHome } from "./helpers.js";

export interface CodexAuth {
  accessToken: string;
  refreshToken?: string | undefined;
  accountId?: string | null | undefined;
  source: string; // file path
  hasUsableToken: boolean;
}

interface CodexAuthFile {
  OPENAI_API_KEY?: string;
  tokens?: { access_token?: string; refresh_token?: string; id_token?: string; account_id?: string };
  access_token?: string;
  refresh_token?: string;
  account_id?: string;
}

function extractToken(data: CodexAuthFile): { accessToken: string; refreshToken?: string | undefined; accountId?: string | null | undefined } | null {
  const at = data.access_token ?? data.tokens?.access_token;
  if (typeof at === "string" && at.trim() !== "") {
    const rt = (data.refresh_token ?? data.tokens?.refresh_token) as string | undefined;
    const aid = (data.account_id ?? data.tokens?.account_id) as string | undefined;
    const base: { accessToken: string; refreshToken?: string | undefined; accountId?: string | null | undefined } = {
      accessToken: at.trim(),
    };
    if (rt != null) base.refreshToken = rt;
    if (aid != null) base.accountId = aid;
    else if (aid === null) base.accountId = null;
    return base;
  }
  return null;
}

export function loadCodexAuth(): CodexAuth | null {
  const homes = [
    resolveCodexHome(),
    path.join(process.env.HOME ?? "", ".config", "codex"),
    path.join(process.env.HOME ?? "", ".codex"),
  ];
  const seen = new Set<string>();
  for (const home of homes) {
    const file = path.join(home, "auth.json");
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      if (!fs.existsSync(file)) continue;
      const data = readJsonFile<CodexAuthFile>(file);
      if (!data) continue;
      const tok = extractToken(data);
      if (tok) return { ...tok, source: file, hasUsableToken: true };
    } catch { /* unreadable */ }
  }
  // No file — keychain-only case (OpenUsage reads Keychain "Codex Auth") — surface no-auth
  return null;
}
