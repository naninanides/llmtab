# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0] — 2026-08-26

First release. Local-first LLM token usage & cost tracker for Claude Code, Codex CLI, Gemini CLI, and ZCode.

### Added

- **Ingestion**
  - Passive readers for Claude Code (JSONL), Codex CLI (JSONL), Gemini CLI (JSONL), and ZCode (SQLite, read-only with WAL-copy fallback)
  - Incremental byte-offset scanner driven by per-file size/mtime state — re-syncs read only new bytes
  - Composite dedup keys `(tool, session_id, message_id, timestamp)` → idempotent syncs
  - ZCode native-turn filter: only Z.ai/GLM turns counted; mirrored Claude/Codex sub-agent history excluded
  - Malformed/foreign log lines are skipped and reported, never thrown (FR-8)
- **Storage** — local SQLite at `~/.llmtab/db.sqlite`: raw records + rebuildable 30-minute UTC bucket rollups + pricing + scan state + sync-run log
- **Cost engine** — LiteLLM price list refresh with 24h disk cache and bundled offline snapshot (`LLMTAB_OFFLINE=1` disables network); exact → normalized → prefix model matching; unpriced models flagged honestly
- **Server & API** — local HTTP server on port 7878 with auto-fallback; JSON endpoints `summary`, `daily`, `models`, `tools`, `projects`, `heatmap`, `status`, `sync/last`, `healthz`; shared UTC range parsing (`today|7d|30d|all|from,to`)
- **Dashboard** — single-page tab UI: range tabs, stat cards with deltas, hero total, model cards, stacked trend chart with series toggles, GitHub-style 12-month heatmap, sortable daily table, tool & project attribution, dark/light theme, skeletons, empty state, error toasts, sync-report footer
- **CLI** — default command (sync → serve → open), plus `sync`, `watch`, `serve`, `status`, `doctor`, `uninstall`
