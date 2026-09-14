# desktop-cc-gui (ccgui) recon — 2026-09-14

Read-only verification of https://github.com/zhukunpenglinyutong/desktop-cc-gui as a candidate shell for a model-neutral Claude Code orchestrator seat. Source tree cloned to `/tmp/ccgui` at `27c3a9625` (tag describe `v1.0.0-3-g27c3a9625`). No PR; no merge.

## 1. Project snapshot

| Item | Finding |
|------|---------|
| License file | **None** in tree (`git ls-tree HEAD` has no LICENSE/COPYING). GitHub `/license` API 404; repo `license` field `null`. README claims “[MIT](…?tab=MIT-1-ov-file)” but that tab has no file behind it. **Meaning for forking: under default copyright, you have no granted right to copy, modify, or redistribute without the copyright holders’ permission until a real LICENSE lands.** |
| Stars / forks / open issues | **4197** / **374** / **296** (GitHub API, 2026-09-14) |
| Commits last 90 days | **~2932** (search API `committer-date:>2026-06-16`); very high cadence through mid-Sep 2026 |
| Contributors | **17** API entries, **16** humans (dominant: `chenxiangning`, `zhukunpenglinyutong`) |
| Primary languages | TypeScript (~1.90 MB), Rust (~1.25 MB), then CSS/HTML/JS/Shell |
| Tauri | **2** (`tauri = { version = "2" }`; `@tauri-apps/api` ^2) |
| Rust / Node | `rust-version = "1.77.2"` in Cargo.toml; README wants **Rust stable** + **Node ≥20** + **pnpm 10** (`packageManager: pnpm@10.29.3`). This VM needed **rustc/cargo 1.98.1** for crates using edition2024. |
| Platforms | macOS, Windows, Linux (README + release assets) |
| macOS binaries | v1.0.0 ships `ccgui_*_aarch64.dmg`, `ccgui_*_x86_64.dmg`, and `.app.tar.gz` + **minisign** `.sig` updater artifacts. CI (`.github/workflows/release.yml`) codesigns with Developer ID `kunpeng zhu (RLHBM56QRH)`, then **notarytool submit + stapler staple** on the DMG. Local script: `scripts/build-signed-macos.sh` / `pnpm build:mac:skip-notarize`. |
| Docs site | No GitHub Pages. Marketing/download site **https://www.mossx.ai/** (homepage field). In-repo docs: plugin guide + omp note only — not a product docs site. |

## 2. How Claude Code is invoked

Spawn is **not a PTY**. Each send builds a headless process:

- `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`
- permission via `--dangerously-skip-permissions` or `--permission-mode {default,plan,acceptEdits}`
- optional `--model <resolved>`, `--add-dir …`, and on continue **`--resume <session_id>`**
- prompt/images on **stdin** as stream-json; no `--session-id` flag for Claude
- effort maps only to `MAX_THINKING_TOKENS` in the child env

Env for Anthropic door vars is **not** assembled at spawn. Comments and `prepare_launch` state that channels live in each CLI’s native config; Claude spawn only adds thinking-budget env. The child **inherits the host process environment**. `CLAUDE_CONFIG_DIR` is honored wherever `engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude")` is used (settings apply + history discovery), but **only if the CC GUI process itself has that env set**.

**Per-session own env without global mutation: no.** Session rows have no provider/env bag. Channel switches rewrite shared CLI config (below). A stale EN UI string claims the opposite.

## 3. Provider channels (critical)

Presets: `src/features/settings/providerPresets.ts` (`PRESETS.claude`: 智谱GLM, Kimi, Kimi Coding, DeepSeek, MiniMax, Xiaomi, Bailian, LongCat, OpenCode Go, OpenRouter, …). Shape: `baseUrl`, `model`, optional `env` map (tier models, timeouts, compaction vars). App store: `~/.ccgui-next/config.json` (`CliConfig` sections).

**On enable/switch** (`set_current_provider` → `provider_files::apply`): the app **writes into the CLIs’ own files**, not spawn env:

| Engine | Write target |
|--------|----------------|
| claude | `$CLAUDE_CONFIG_DIR/settings.json` (default **`~/.claude/settings.json`**) — merge `env` + optional `settingsConfig` keys |
| codex | `$CODEX_HOME/config.toml` + `auth.json` |
| kimi | `$KIMI_CODE_HOME/config.toml` |
| grok | `$GROK_HOME/config.toml` |
| backups | `~/.ccgui-next/provider-backups/<engine>/` |

No dedicated writer for `~/.claude.json` or hooks files; Claude apply can still **overwrite any non-`env` key** present in a channel’s `settingsConfig` (including `hooks` if supplied). Codex/kimi patches aim to preserve user `[[hooks]]`.

**Ollama Cloud door:** no named Ollama preset, but a **Custom** Claude channel already fits (`baseUrl` + token + model + freeform `env`). Put `https://ollama.com`, bearer token, `ANTHROPIC_DEFAULT_*_MODEL` tags, and `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000` in the channel env/JSON. Files: `ProviderDialog.tsx`, `useProviderForm.ts`, `ProviderFormSections.tsx`, `providerPresets.ts`, `config.rs`, `provider_files.rs`. **Activating that channel still materializes into `settings.json` under whatever `CLAUDE_CONFIG_DIR` the app process sees.**

## 4. Context window and compaction

- Meter: engine-reported usage (`input_tokens` / caches / `model_context_window`); Claude also updates from `compact_boundary` → `postTokens`.
- Fallback UI constant **200_000** when nothing reported (`ChatConversation.tsx`).
- **No per-session declared context window** in DB/`SessionMeta`.
- `CLAUDE_CODE_MAX_CONTEXT_TOKENS` / `CLAUDE_CODE_AUTO_COMPACT_WINDOW` appear as **channel `env` entries** (e.g. Kimi Coding preset) written into `settings.json`, not as app-level spawn settings. Compaction events update the usage meter; there is no first-class “compaction controls + visible compaction transcript row” product surface beyond that event handling.

## 5. Sessions

- List/pin/rename/delete via SQLite `sessions` in `~/.ccgui-next/app.db` + disk delete of transcript. Rename = `custom_title` only. **Archive is workspace-level**, not session-level. Search is **client-side** sidebar filter.
- Claude transcripts: `$CLAUDE_CONFIG_DIR/projects/<encoded-workspace>/<session_id>.jsonl` (NDJSON).
- Resume: reload UI state; next send passes `--resume <id>`.
- Concurrency: up to **16** concurrent engine runs (cross-engine).
- **Not pinned to provider channel** — only engine + optional remembered model string; resume uses whatever channel is currently materialized in CLI config.

## 6. Safety read

| Surface | Detail |
|---------|--------|
| Analytics | **Baidu Tongji** site id `daa60bcc45c658ee35054b93be3cf2e4` → `hm.baidu.com` (`hm.js` / `hm.gif`); deferred install in `main.tsx`; Linux native bridge in `baidu_tongji.rs`; CSP allows hm.baidu.com. Cookie state under `~/.ccgui-next/analytics/`. |
| Auto-update | Tauri updater → GitHub `…/releases/latest/download/latest.json` (minisign pubkey in `tauri.conf.json`). Separate CLI install/update via npm / vendor install scripts (`cli_lifecycle.rs`). |
| Global CLI rewrite | **By design** on channel switch — see §3. Red flag for any operator burned by silent `~/.claude` mutation. |
| Bundled CLIs | **None** (PATH / settings bin overrides). |
| Self-modifying hooks | No always-on hooks installer; `settingsConfig` merge can still write hook keys into Claude settings. |

## 7. Build check (this VM)

- Installed: webkit2gtk-4.1-dev and Tauri Linux deps (`apt` reported fuse3/xdg-desktop-portal errors but webkit pkg-config OK); **pnpm install** OK; upgraded Rust **1.83 → 1.98.1**.
- `cargo check` in `src-tauri`: **PASS** (~1m34s after deps). One unused-fn warning in `open_app.rs`. No signed release attempted. Wall time well under 25 minutes.

## 8. Gap list (four required additions)

| Gap | Estimate | Touch points |
|-----|----------|--------------|
| **(a) Per-session provider profile snapshot** (base URL, token ref, env) frozen at session start | ~8–15 files / ~400–800 LOC | `db.rs` schema; `history/reader.rs` SessionMeta; `engine/mod.rs` + `claude.rs` spawn env injection; stop relying solely on `provider_files::apply` for multi-seat; chat store send path; settings UI “bind channel → session” |
| **(b) Per-session model capability snapshot** (editable context/output limits) | ~5–10 files / ~250–500 LOC | `session_models`/new table; composer + limits card; spawn/`settings.json` or env override; `usage.ts` meter denominator |
| **(c) Explicit compaction controls + visible compaction events** | ~4–8 files / ~200–400 LOC | channel/session env UI for `CLAUDE_CODE_*_COMPACT*`; timeline row for `compact_boundary` (today mostly usage-only); i18n |
| **(d) Instruction-corpus revision (rules-repo git SHA) per session** | ~3–6 files / ~150–300 LOC | record `git rev-parse` of rules root at session start; SessionMeta + transcript footer/sidebar; optional compare-on-resume |

## 9. Verdict

**YES-WITH-STEPS** — The operator can keep **zero writes to global `~/.claude`** only by launching the **entire CC GUI process** with `CLAUDE_CONFIG_DIR=<his isolated door dir>` (so `provider_files` and history resolve there), using **官方配置** with a pre-synced `settings.json` **or** a Custom Claude channel whose env matches the Ollama Cloud door (`ANTHROPIC_BASE_URL=https://ollama.com`, auth token, default model tags, `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000`, `claude --model sonnet` via the picker). Do not run the app with the env unset if any channel switch/official restore might run. Out of the box (default home, channel UI): the app **will** rewrite `~/.claude/settings.json`.

**Fork viability:** **Blocked / high legal risk** until a real LICENSE file exists. README’s MIT claim is not backed by a license artifact or GitHub license API metadata.

**Three biggest risks:**
1. **Silent global CLI config mutation** as the core provider-channel mechanism (operator’s known failure mode).
2. **No per-session provider freeze** — concurrent tabs/engines share one materialized Claude settings file; channel switch mid-flight affects all Claude sessions under that config dir.
3. **No LICENSE + call-home analytics (Baidu) + auto-update** — legal exposure plus third-party network surfaces on a seat meant for private rules/memory.

---

## Appendix — file:line citations

- Claude argv/stream-json/resume/effort env: `src-tauri/src/engine/claude.rs:48–119`, `136–150`
- No channel env at spawn; config-file model: `src-tauri/src/engine/mod.rs:941–943`, `1572–1584`; `provider_files.rs:1–21`, `73–76`, `447–491`, `498–508`
- `set_current_provider` applies files first: `src-tauri/src/config.rs:259–285`
- `CLAUDE_CONFIG_DIR` resolution: `src-tauri/src/engine/mod.rs:449–459`
- Presets + compaction env example + custom shape: `src/features/settings/providerPresets.ts:17–34`, `53–101`, `171–326`
- Context fallback 200k: `src/features/chat/components/ChatConversation.tsx:37–38`
- Usage / `model_context_window`: `src/features/chat/usage.ts:1–85`
- Sessions schema / rename / delete: `src-tauri/src/db.rs:436–451`; `history/reader.rs` list/rename/delete; Claude jsonl discovery: `history/scanner.rs:88–114`
- Concurrent runs: `src-tauri/src/engine/mod.rs:907–909`, `1546–1549`
- Baidu Tongji: `src/lib/analytics.ts:1–20`, `146+`; `src/main.tsx:32–40`; `src-tauri/src/baidu_tongji.rs`; CSP `src-tauri/tauri.conf.json:25`; updater endpoints `tauri.conf.json:58–65`
- App home paths: `src-tauri/src/paths.rs:10–45`
- Stale “never modify CLI config” copy: `src/i18n/en.ts` (`cliDialogNote`)
- Notarization: `.github/workflows/release.yml` (notarytool/stapler); `scripts/build-signed-macos.sh:1–40`
- License claim without file: `README.md:242–244`
