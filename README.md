# LLMTab

> Every token you burn, one click away. 100% local.

[![npm](https://img.shields.io/npm/v/llmtab-desktop?label=llmtab-desktop)](https://www.npmjs.com/package/llmtab-desktop)
[![npm](https://img.shields.io/npm/v/llmtab?label=llmtab)](https://www.npmjs.com/package/llmtab)
[![node](https://img.shields.io/node/v/llmtab)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/llmtab)](LICENSE)

LLMTab is a local-first LLM token usage & cost tracker that lives in your **menu bar**. Today's tokens and cost sit next to the clock; click for a full dashboard. Underneath, it scans the usage logs your AI coding tools already write to disk, captures local-model traffic from Ollama through a built-in proxy, and aggregates everything into a SQLite database on your own machine.

The tray app is `llmtab-desktop`. The engine behind it is also a standalone CLI (`llmtab`) if you'd rather skip Electron.

- No account · No API keys · No cloud
- Reads only token counts and metadata — **never** prompts or responses
- One command → your usage in under 30 seconds

## Install

**Requirements:** Node.js ≥ 22 (the store uses the built-in `node:sqlite`). macOS is the tested platform.

```bash
npm i -g llmtab-desktop
llmtab-desktop
```

That's it. An icon appears in your menu bar showing today's tokens and cost, and
the command hands your terminal straight back — the app keeps running after you
press Ctrl-C or close the terminal. Quit it from the tray menu.

`llmtab-desktop` pulls in the `llmtab` engine plus an Electron runtime (~200 MB).
npm links only the binaries of the package you name, so add `llmtab` too if you
also want the CLI on your PATH:

```bash
npm i -g llmtab-desktop llmtab
```

### Don't want Electron?

The engine ships as its own package with no GUI dependency — same dashboard,
served to your browser instead of a popup:

```bash
npm i -g llmtab      # ~700 KB
llmtab               # sync, then open localhost:7878
```

| Package          | Command          | Size    | What you get                                |
| ---------------- | ---------------- | ------- | ------------------------------------------- |
| `llmtab-desktop` | `llmtab-desktop` | ~200 MB | **Menu-bar app** (macOS-tuned) + the engine |
| `llmtab`         | `llmtab`         | ~700 KB | Engine, CLI and dashboard in your browser   |

For a one-off look with nothing installed: `npx llmtab`.

### Verify

```bash
llmtab-desktop --foreground     # run attached — startup errors go to your terminal
llmtab status                   # per-tool integration state
llmtab doctor                   # node, DB writability, sources, pricing cache, proxy wiring
```

A detached shell writes its output to `~/.llmtab/desktop.log`.

### From source

```bash
git clone https://github.com/naninanides/llmtab-v2.git
cd llmtab-v2
npm install
npm run build
npm run app                  # Electron tray shell against the local build
node dist/cli/main.js        # or drive the CLI directly
```

### Update / remove

```bash
npm i -g llmtab-desktop@latest llmtab@latest   # upgrade
llmtab uninstall                               # delete all local state (~/.llmtab)
npm rm -g llmtab-desktop llmtab                # remove the packages
```

Publishing new versions is documented in [`docs/PUBLISHING.md`](docs/PUBLISHING.md).

## In the menu bar

LLMTab auto-detects your installed tools, runs an incremental sync, and starts a
local server on port 7878 (with automatic fallback). The tray icon gives you:

- **Tray tooltip / menu header** — today's tokens + estimated cost
- **Dashboard** — compact popup window (Esc or blur closes it)
- **Open in Browser** — the same dashboard as a regular tab
- **Sync now** — force a rescan
- **Quit**

Running headless, or on a machine where you'd rather not pay for Electron?
`llmtab serve` skips the shell and just serves the dashboard URL.

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

| Command                       | What it does                                                             |
| ----------------------------- | ------------------------------------------------------------------------ |
| `llmtab-desktop`              | launch the menu-bar shell, detached from the terminal                    |
| `llmtab-desktop --foreground` | same, but attached — startup errors land in your terminal (`-F`)         |
| `llmtab`                      | sync → menu-bar app when the shell is installed, else serve + browser    |
| `llmtab sync`                 | manual incremental scan (`--verbose`, `--rebuild`)                       |
| `llmtab watch`                | keep the DB fresh via filesystem watchers                                |
| `llmtab serve`                | serve the dashboard without opening a browser (`-p <port>`)              |
| `llmtab proxy`                | run the Ollama capture proxy (`--off` to disable)                        |
| `llmtab status`               | per-tool integration state                                               |
| `llmtab doctor`               | health check: node, DB writability, sources, pricing cache, proxy wiring |
| `llmtab uninstall`            | remove all LLMTab state (`~/.llmtab`)                                    |

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

**I closed my terminal — did the tray app die?**
No. `llmtab-desktop` detaches on launch: it runs in its own process group, so
neither Ctrl-C nor closing the terminal reaches it. Quit it from the tray menu.
Its output goes to `~/.llmtab/desktop.log`.

**Windows/Linux support?**
Should work anywhere Node ≥ 20 runs, but macOS is the tested platform for v1 (the tray/popup shell is macOS-first).

## License

MIT
