# LLMTab

> Every token you burn, one click away. 100% local.

LLMTab is a local-first LLM token usage & cost tracker that lives on your **menu bar** (macOS taskbar). A lightweight core scans the usage logs your AI coding tools already write to disk, captures local-model traffic from Ollama via a built-in proxy, aggregates token counts into a local SQLite database, and shows a fast private dashboard in a popup window — or any browser.

- No account · No API keys · No cloud
- Reads only token counts and metadata — **never** prompts or responses
- `npx llmtab` → menu-bar app with your usage in under 30 seconds

## Quick start

```bash
npx llmtab
```

That's it. LLMTab auto-detects installed tools, runs an incremental sync, starts a local server on port 7878 (with automatic fallback), and puts an icon in your menu bar:

- **Tray tooltip / menu header** — today's tokens + estimated cost
- **Dashboard** — compact popup window (Esc or blur closes it)
- **Open in Browser** — the same dashboard as a regular tab
- **Sync now** — force a rescan
- **Quit**

Prefer the classic flow? `llmtab serve` skips the shell entirely and just serves the dashboard URL.

## Supported tools

| Tool            | Method                            | Source                                |
| --------------- | --------------------------------- | ------------------------------------- |
| **Claude Code** | Passive JSONL reader              | `~/.claude/projects/**/*.jsonl`       |
| **Codex CLI**   | Passive JSONL reader              | `~/.codex/sessions/**/*.jsonl`        |
| **Gemini CLI**  | Passive JSONL reader              | `~/.gemini/tmp/**/chunks.jsonl`       |
| **ZCode**       | Passive SQLite reader (read-only) | `~/.zcode/cli/db/db.sqlite`           |
| **OpenCode**    | Passive SQLite reader (read-only) | `~/.local/share/opencode/opencode.db` |
| **Ollama**      | Local reverse proxy (opt-in)      | see setup below                       |

Unknown/missing sources never break sync. ZCode totals are filtered to native Z.ai/GLM turns so mirrored Claude/Codex sub-agent history isn't double-counted. OpenCode sessions are picked up automatically from its own database — no configuration.

### Ollama one-time setup

Ollama doesn't write persistent usage data anywhere, so LLMTab captures it at the API boundary with a tiny reverse proxy:

```bash
llmtab proxy                                        # listens on 127.0.0.1:11435 → forwards to :11434
export OLLAMA_HOST=http://127.0.0.1:11435           # point clients at it once
llmtab proxy --off                                  # disable anytime
```

Every request is forwarded byte-for-byte and streamed straight back; only the numeric usage fields (`prompt_eval_count`, `eval_count`, model name) are recorded. Local models are tracked in tokens and cost **$0 by design** ("local" badge, never "unpriced").

## Dashboard

One selection drives every view:

- **Range tabs** — Today / 7d / 30d / All / Custom date pickers
- **Stat cards** — total, input, output, cache read, cost, conversations (with deltas vs the previous equal-length range)
- **Model breakdown** — share %, tokens, estimated cost per model
- **Usage trend** — daily stacked bars with input/output/cache series toggles
- **Activity heatmap** — GitHub-style, last 12 months
- **Daily table** — sortable, latest first
- **Tool & project attribution** — find token-hungry repos
- Dark/light theme, persisted; skeleton loaders; friendly empty states

Costs are estimates from the [LiteLLM community price list](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json), cached locally for 24h with a bundled offline fallback. Models without public prices show `$0` plus an "unpriced" badge rather than a wrong number; Ollama models show a "local" badge — free by design.

## CLI commands

| Command            | What it does                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| `llmtab`           | sync → menu-bar app (falls back to serve + browser when no display)      |
| `llmtab app`       | launch the Electron menu-bar shell                                       |
| `llmtab sync`      | manual incremental scan (`--verbose`, `--rebuild`)                       |
| `llmtab watch`     | keep the DB fresh via filesystem watchers                                |
| `llmtab serve`     | serve the dashboard without opening a browser (`-p <port>`)              |
| `llmtab proxy`     | run the Ollama capture proxy (`--off` to disable)                        |
| `llmtab status`    | per-tool integration state                                               |
| `llmtab doctor`    | health check: node, DB writability, sources, pricing cache, proxy wiring |
| `llmtab uninstall` | remove all LLMTab state (`~/.llmtab`)                                    |

Environment flags: `LLMTAB_OFFLINE=1` disables the daily pricing fetch entirely.

## Privacy principles

1. **No content, ever.** Parsers extract only tool, model, timestamp, token counts, session/request ids, and project paths. This is auditable in [`src/ingest/parsers/`](src/ingest/parsers). The Ollama proxy streams bodies through without storing them and records only numeric usage fields.
2. **Local-only by default.** The single outbound network call is the daily pricing-list fetch; it sends nothing about you. Disable with `LLMTAB_OFFLINE=1`. The Ollama proxy binds `127.0.0.1` only.
3. **Your machine, your data.** Everything lives in `~/.llmtab/db.sqlite`. `llmtab uninstall` removes it completely.

## How numbers stay accurate

- **Idempotent ingestion** — composite dedup keys `(tool, session_id, message_id, timestamp)` mean running sync twice adds zero records.
- **Incremental scanning** — per-file size/mtime/byte-offset state means large logs re-parse only new bytes.
- **Derived rollups** — 30-minute UTC buckets are rebuildable at any time via `llmtab sync --rebuild`.

## Development

```bash
npm install        # install workspaces
npm test           # vitest suite (parsers, dedup, buckets, costs, watch)
npm run lint       # eslint
npm run typecheck  # tsc strict, both packages
npm run dev        # dashboard dev server + CLI watch build
npm run build      # compile CLI + bundle SPA
```

Requires Node.js ≥ 20.

## FAQ

**Does this send my code anywhere?**
No. There is no cloud component. See privacy above.

**Why are costs "est."?**
Subscriptions bill flat rates, not tokens. LLMTab shows what your usage would have cost at published API prices.

**A model shows $0 / "unpriced". Why?**
Its price isn't in the community list yet. Tokens are still tracked; the badge tells you honestly instead of guessing. Ollama models are different — they're **local**, so $0 is correct, not a guess.

**Does the menu-bar app cost RAM?**
The Electron shell is the convenient path; if you prefer zero extra footprint, use `llmtab serve` (or `watch`) and open `localhost:7878` in a tab — same dashboard, no shell.

**Windows/Linux support?**
Should work anywhere Node ≥ 20 runs, but macOS is the tested platform for v1 (the tray/popup shell is macOS-first).

## License

MIT
