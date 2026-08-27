# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — v2.1.0 work in progress

### Added

- **Menu-bar shell (Electron)** (PRD FR-50…56)
  - Tray icon (monochrome template) with live tooltip: today's tokens + est. cost; menu with per-tool quick stats, Sync now, Dashboard, Open in Browser, Launch-at-login toggle, Quit
  - Compact popup window (420×640) loading the same dashboard SPA; Esc/blur closes; single-instance lock focuses the existing window on second launch
  - Shell boots the local server itself (port-fallback preserved); `llmtab` default command now prefers the shell and falls back to serve+browser headless (`llmtab app` launches explicitly)
- **OpenCode provider** (passive SQLite reader)
  - Read-only open of `~/.local/share/opencode/opencode.db` with WAL-copy fallback; assistant rows mapped from the `message.data` JSON (tokens incl. cache read/write + reasoning, model, project cwd); `message.id` dedup keys keep syncs idempotent
- **Ollama provider** (local reverse proxy — Ollama persists no usage data anywhere)
  - `llmtab proxy`: forwards every request to the real server (:11435 → :11434), streams bodies through untouched, records only numeric usage fields from `/api/chat`, `/api/generate`, and OpenAI-compat responses (streaming-safe via final chunk)
  - Opt-in via config (`~/.llmtab/config.json`) so the shell/default command auto-start it; port conflicts fail with an actionable error instead of silently moving
  - Local models priced `$0` with a "local" badge, never "unpriced" (FR-17)
- **Doctor/status** — ollama shows proxy wiring state with setup hints; doctor verifies upstream reachability and that clients point at the proxy

### Changed

- Docs updated for the new delivery model and six-provider scope: PRD v1.1, PLANING M7/M8, StyleGuide menubar section, README supported-tools table

## [2.0.1] — 2026-08-27

### Fixed

- **Dashboard 404 after a global install.** `resolveStaticRoot()` looked for
  `dashboard-dist/` three directory levels above `dist/server`, which lands in
  `node_modules/` rather than the package root, so every `npm i -g llmtab`
  install answered `{"error":"dashboard not built"}`. The built dashboard was
  always in the tarball; only the lookup was wrong. It now anchors two levels
  up, which is the package root in both the repo and an installed copy, and is
  covered by tests over both layouts.

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
