# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.1.1-beta.2] — 2026-09-03

### Fixed

- **`llmtab-desktop@beta` installed the stable CLI**, so the tray app ran the previous build: no version in the footer, and the Quotas tab still scrolling as one unit. The desktop package is a launcher — `bin.mjs` resolves the shell out of the `llmtab` package — so the CLI version is the app version, and its `^2.0.2` range excluded the prerelease. It now depends on `^2.1.1-0`, which admits it.
- The publish gate is strict again for prereleases. It was relaxed in beta.1 on the mistaken reasoning that a beta resolving to the stable CLI was an acceptable pairing; it is not, because the CLI carries the whole app.

## [2.1.1-beta.1] — 2026-09-03

Prerelease. Published to the `beta` dist-tag, so `npm install -g llmtab` still
installs the latest stable; use `llmtab@beta` to try this one.

### Added

- The running version is shown in both footers — centred in the popover, under the sync line in the browser dashboard. `/api/healthz` now returns it alongside `ok`.

### Fixed

- **Codex usage was recorded with no model name.** The parser never read the model, so every record stored `"unknown"` and the dashboard showed a nameless row carrying real tokens. Verified against Codex 0.153.0 logs: the model is on `turn_context.payload.model`, not `session_meta`, whose only model mention sits inside prompt text that must never be read. A model switch mid-session is now followed too.
- **Gemini dedup dropped turns across incremental syncs.** The occurrence counter restarted each sync, re-keying turns already stored so they collided on insert. Identity is now the line's absolute byte offset.
- **A row stored as `unknown` can now be renamed** by a later sync, one direction only, so data already captured by a broken parser is repaired rather than stuck.
- **The popover could not shrink back** when leaving a taller tab: every height it measured was sized by its own window, making the measurement a fixed point. It now measures the content with the constraint lifted.
- **Rapid tab switching stuttered** because each switch reported its height three times and every report resized the frame. Reports are de-duplicated and writes debounced, so only the tab settled on is drawn.
- **The popover degraded the longer it ran** — the fit observers and a document listener were never released, so each reopen left another set attached.
- Usage and Sources no longer inherit the Quotas height, and the quota list scrolls without dragging the tabs or footer with it.

### Changed

- Popover fit logic moved out of the main process into a typed, tested renderer module (StyleGuide §9); `src/shell/main.ts` drops ~130 lines of embedded JavaScript.
- Prereleases publish to the `beta` dist-tag instead of `latest`.

## [2.1.0] — 2026-09-02

### Added

- **`llmtab update`** — self-update from npm. Compares the running version against the registry and upgrades in place through whichever manager installed it (npm, pnpm, yarn, bun), bringing `llmtab-desktop` along when it is installed too. `--check` reports without installing; `-y` skips the prompt. Refuses to overwrite a local checkout or an `npx` run, and prints the command rather than guessing when the install layout is unrecognised.

### Fixed

- **`llmtab --version` reported `2.0.0` regardless of the installed version** — the number was hardcoded in the CLI. It now reads the package manifest.
- OpenCode ingestion stored zero tokens for turns caught mid-stream; see 2.0.6 notes for the race, now covered by regression tests.

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

## llmtab-desktop [2.0.3] — 2026-08-27

### Changed

- **`llmtab-desktop` now detaches from the terminal.** The launcher spawned
  Electron into its own process group with stdio redirected to
  `~/.llmtab/desktop.log`, so the prompt returns immediately, Ctrl-C no longer
  kills the tray app, and closing the terminal leaves it running. Previously the
  child shared the terminal's process group and the parent blocked waiting on
  it, which meant a menu-bar app held the shell hostage for its whole lifetime.
- `--foreground` (`-F`) keeps the old attached behavior for debugging. Every
  other argument is still forwarded to Electron verbatim, and anything after
  `--` belongs to the app.

## [2.0.6] — 2026-09-02

### Changed

- **Dashboard and popover restyled to "Vitrine"** — macOS vibrancy replaces the Phosphor/CRT theme across both shells
  - Three glass material tiers (`.glass-thin` / `.glass` / `.glass-thick` / `.glass-hud`) standing in for `NSVisualEffectView`, each with a specular top hairline and a shadow bottom hairline
  - Backdrop is generated from the user's own usage — the heatmap year and recent daily totals, defocused — so the wallpaper can never contradict the data
  - Type moves to Inter + JetBrains Mono via system stacks; the `public/fonts` WOFF2 files were all 0-byte placeholders, so no `@font-face` is declared and the popover still renders with no network
  - New `components/glass/` primitives (Panel, Meter, Button, Segmented, DataDesktop) replace `components/pixel/` (Bevel, BlockMeter, PixelButton, TabStrip)
  - Quota meters are one continuous track instead of lit blocks; thresholds still come from `barColor()`/`toneFor()` in `quota.ts`
  - Segmented controls animate the selected pill between tabs (transform-only, 260ms, disabled under reduced motion)
  - Popover narrows to 300px wide; StyleGuide Part I rewritten to match, Part II (code style) unchanged
  - Reduce Transparency and missing `backdrop-filter` both fall back to an opaque surface — nothing depends on blur to stay legible

### Fixed

- **`/api/summary` was seconds slow and got worse with wider ranges** — 3.9s at 30d, 5.1s for all-time, which made switching range in the popover feel stalled
  - `getUnpricedModels` used two correlated `EXISTS` subqueries that re-scanned the whole table once per candidate row (`EXPLAIN QUERY PLAN` showed a bare `SCAN` running 6,234 times). The same per-model facts are now grouped once and joined
  - today 0.39s → 0.02s · 7d 1.87s → 0.01s · 30d 3.87s → 0.01s · all 5.13s → 0.01s; output verified byte-identical at 1d/7d/30d/3650d
  - Added `idx_records_model` for per-model rollups (applied automatically via `CREATE INDEX IF NOT EXISTS`)
- Electron popover auto-fit measured `.bevel`, a primitive removed in the retheme, so the window could not size to its content; it now measures the glass panel
- Electron window forced a 360px width on every content resize, and its pre-paint fallback colours were still Phosphor

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
