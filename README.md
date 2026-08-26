# LLMTab

> Every token you burn, in one tab. 100% local.

LLMTab is a local-first LLM token usage & cost tracker. A lightweight CLI scans the usage logs your AI coding tools already write to disk, aggregates token counts into a local SQLite database, and serves a fast private dashboard in your browser.

- No account · No API keys · No cloud
- Reads only token counts and metadata — **never** prompts or responses
- `npx llmtab` → dashboard open in under 30 seconds

## Quick start

```bash
npx llmtab
```

That's it. LLMTab auto-detects installed tools, runs an incremental sync, starts a local server on port 7878 (with automatic fallback), and opens your browser.

## Supported tools

| Tool | Method | Source |
|---|---|---|
| **Claude Code** | Passive JSONL reader | `~/.claude/projects/**/*.jsonl` |
| **Codex CLI** | Passive JSONL reader | `~/.codex/sessions/**/*.jsonl` |
| **Gemini CLI** | Passive JSONL reader | `~/.gemini/tmp/**/chunks.jsonl` |
| **ZCode** | Passive SQLite reader (read-only) | `~/.zcode/cli/db/db.sqlite` |

Unknown/missing sources never break sync. ZCode totals are filtered to native Z.ai/GLM turns so mirrored Claude/Codex sub-agent history isn't double-counted.

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

Costs are estimates from the [LiteLLM community price list](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json), cached locally for 24h with a bundled offline fallback. Models without public prices show `$0` plus an "unpriced" badge rather than a wrong number.

## CLI commands

| Command | What it does |
|---|---|
| `llmtab` | sync → serve → open the dashboard |
| `llmtab sync` | manual incremental scan (`--verbose`, `--rebuild`) |
| `llmtab watch` | keep the DB fresh via filesystem watchers |
| `llmtab serve` | serve the dashboard without opening a browser (`-p <port>`) |
| `llmtab status` | per-tool integration state |
| `llmtab doctor` | health check: node, DB writability, sources, pricing cache age |
| `llmtab uninstall` | remove all LLMTab state (`~/.llmtab`) |

Environment flags: `LLMTAB_OFFLINE=1` disables the daily pricing fetch entirely.

## Privacy principles

1. **No content, ever.** Parsers extract only tool, model, timestamp, token counts, session/request ids, and project paths. This is auditable in [`src/ingest/parsers/`](src/ingest/parsers).
2. **Local-only by default.** The single outbound network call is the daily pricing-list fetch; it sends nothing about you. Disable with `LLMTAB_OFFLINE=1`.
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
Its price isn't in the community list yet. Tokens are still tracked; the badge tells you honestly instead of guessing.

**Windows/Linux support?**
Should work anywhere Node ≥ 20 runs, but macOS is the tested platform for v1.

## License

MIT
