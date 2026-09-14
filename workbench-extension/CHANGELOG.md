# Changelog

## 0.4.16 — 2026-09-14

- Command Deck is the only surface opened on launch (full width). Lanes and Desk move to the secondary side bar as WebviewViews; editor-panel paths removed. Topbar toggles + `Ctrl/Cmd+Shift+L` / `Ctrl/Cmd+Shift+D`; immersive mode no longer closes the auxiliary bar.
- Remove the in-deck “Your model bench” grid; seat/model/ceiling stay on the composer picker. Deck stays readable at 1280 and 1024.
- Sessions tree in the Command side bar: Orchestrator / Projects / Archived, with New / Rename / Archive / Delete. Conversations storage `generalstaff.conversations.v2` with one-way v1 migration. Many orchestrator sessions; one active per scope. Deck topbar shows the active title + New session (`Ctrl/Cmd+Shift+N`).

## 0.4.15 — 2026-09-14

- Correct Claude-seat native ceilings: per-model, not one 200k constant. Fable and Sonnet are **1M native**; Opus is **1M on Max tiers** (operator on Max 20x); Haiku stays **200k**. Picker label reads `fable · 1M context (native)`.
- Cite Claude Code model-config § Extended context for the native-1M and Opus Max-tier upgrade wording.

## 0.4.14 — 2026-09-14

- Context ceiling on every seat: services-layer `contextCeiling` (tokens + provenance) attached at discovery — `stated` / `native` / `assumed-default` / `unknown`.
- Seat picker and model-bench cards show plain-words ceilings (e.g. `deepseek-v4.1-flash · 1.05M context (stated by launcher)`); assumed-default seats warn that Claude Code will compact at 200k.
- Lanes list + detail show the ceiling; Claude Code stream-json seats get a live used/ceiling meter (input + cache_read + cache_creation); otherwise ceiling only — never a fake used count.
- Register meter is a thin rule with a filled span; brass only for the warning state.

## 0.4.13 — 2026-09-13

- Ruling ping body is now `"<PACKET-NAME>: <verdict>"` (founding-spec closed shape).
- Opt-in **Attach ANNOTATE notes** checkbox on the ruling form when the packet has NOTES.txt / JSON export / ANNOTATE.html notes; notes append only when checked (default on when notes exist).
- Night-palette look audit: pixel-sample running/done row right edges (amber leak refutation) + detail folio rule-lines (not nested boxes); proofs include desk-night / detail-night.

## 0.4.12 — 2026-09-13

- Add the **Desk** panel: folio of `~/Desktop/handoff/` packets (one leaf per folder), WHAT-TO-JUDGE plate in a sandboxed iframe, ANNOTATE / Finder open actions, gate stamps, amber waiting badge.
- Closed ruling write set: `scripts/ping.sh -s <session> -t "<game>,ray,ruling" …` then sweep to `~/Documents/session-artifacts/` only on exit 0 (never a direct pings write).
- Lanes calibration: state word is plain text; dust vs quiet-grey luminance separated in all six palettes; elapsed/sha as edge marginalia; detail plate uses rules not nested boxes; no amber on persistent accents.

## 0.4.11 — 2026-09-13

- Lanes + Detail register pass: situation-map counters (chits) coloured by state — iron-red / dust / ink / quiet grey — with amber reserved for the badge count, failed/inconsistent attention marks, and unreachable-host rows.
- Drop dashboard chrome on Lanes (alert banner, summary counts line, host pills, state text badges); elapsed/sha stay marginalia; Detail reads as the counter turned over.

## 0.4.10 — 2026-09-13

- Lanes row select opens a read-only detail drawer: `detail` + `harvest` via the same Lane Desk CLI transport as status (`detail LANE --host HOST --lines 40 --json`, `harvest LANE --host HOST --json`).
- Bind host/tree/branch/WANT·HEAD/model/cap/elapsed, sentinel last lines, `run.status` tail, log lines from lane-desk only (no path opens), and harvest preview (files changed, dirty count, commits since WANT, battery).
- Disabled **Harvest…** affordance (tooltip M3+); stale-on-timeout and gone-lane retention with a gone marker; poll refreshes the selected card with the panel.

## 0.4.9 — 2026-09-13

- Add the read-only **Lanes** panel for detached Mac / home-PC runs: live `lanes_status` via the existing Lane Desk CLI transport, 30s poll while visible, manual refresh, partial-envelope tolerance.
- Situation-map register (Kriegspiel): shared Workbench palettes, counters coloured by state, amber only for attention; activity-bar Command + Lanes icons with an attention badge (no OS notifications).
- Open Command and Lanes side-by-side on launch; keep Workbench activity-bar icons visible in immersive mode while still hiding Explorer/panel chrome.

## 0.4.8 — 2026-09-13

- Bring every non-Claude seat's chat normalize path to the same parity bar as 0.4.7: assistant bubbles carry only model prose; tool activity is a compact collapsible line; stream/progress/receipt envelopes never become prose.
- Codex (`item.*`): emit `command_execution` / `file_change` / MCP as tools; keep `aggregated_output` and patch bodies out of the bubble; map reasoning to status.
- Cursor / Grok-via-Cursor (`stream-json`): skip `model_call_id` duplicate flushes and untimestamped finals; name tools from `readToolCall` / `writeToolCall`; never surface read/write file bodies.
- Kimi: assistant `content` only; `tool_calls[].function.name` as activity; suppress `role:tool` bodies.
- Cline: `contentType:text` only for prose; tool `content_start` as activity; keep suppressing `run_result`.
- Direct Ollama API seats remain answer-only (no tool loop); `message.thinking` stays hidden.
- Pass expanded `~/Desktop/handoff` via `--add-dir` on Codex, Cursor, Kimi, Claude-protocol, and Cursor-backed Grok/Claude runners. Native Grok CLI and direct Ollama seats use the context attach picker only.
- Add protocol fixtures under `test/fixtures/*-tool-turn.jsonl` (and ollama JSON) with per-lane parity tests.

## 0.4.7 — 2026-09-13

- Stop Claude-protocol chat (`claude`, `deepseek-ollama-cc`, `glm-ollama-cc`) from leaking raw tool-input/tool-output payloads into the message bubble: assistant text is now extracted explicitly from `message.content[]` text blocks only, never the generic key-name crawl that could pick up a `tool_use` block's file content.
- Insert a paragraph break between assistant-text segments separated by tool activity, instead of gluing every turn's text into one run-on string.
- Enter sends from the composer; Shift+Enter inserts a newline; Cmd/Ctrl+Enter still sends.
- Make `~/Desktop/handoff` reachable without depending on a lane expanding a literal tilde path: pass it via `--add-dir` on Claude-protocol lane invocations, and add it (plus folder selection) to the context attach picker as a standing staging root.

## 0.4.6 — 2026-09-13

- Add the `DeepSeek V4.1 Flash (Ollama)` read-only direct-API seat, wired like the existing GLM seats and gated on the same authenticated catalog probe.
- Add two CC-door seats, `DeepSeek V4.1 Flash · Workbench seat` and `GLM 5.3 · Workbench seat`, which run the real Claude Code binary against Ollama Cloud's Anthropic-compatible endpoint. They are agentic, support the read and write boundaries and native session resume, and carry the operator's skills, user `CLAUDE.md`, project rules chain, memory and hooks — none of which a single-shot direct-API seat can.
- State the true 1,048,576-token context window on every Ollama seat. Claude Code assumes 200k for a model it does not recognise, so an unstated window silently discards four fifths of these models.
- Keep the Ollama credential out of extension state: CC-door seats spawn the private repository's `gsd-cc-door.sh` launcher, which reads `~/.generalstaff/.env` itself. A regression test asserts no lane summary can carry the key.
- Probe the Grok CLI with `grok models` so a signed-out CLI demotes to the Cursor Grok 4.6 runner at discovery instead of being discovered mid-run.
- Add the `generalstaff.grokRunner` setting (`auto` | `cursor`). Entitlement is not discoverable: probed live on 2026-09-13 the Grok CLI reported itself logged in while every request 402'd `personal-team-blocked:spending-limit` and echoed the prompt back to stdout — output indistinguishable from a real answer — and a real-request probe never returns because the CLI's leader process holds stdout open. Setting `cursor` pins the seat to the working Cursor door for the same model.
- Close stdin on every lane authentication probe. Provider CLIs in prompt mode block on an open stdin pipe, which turned fast probes into timeouts and left a dead runner selected.
- Add `scripts/make-launcher-app.sh`, which builds a double-clickable `GeneralStaff Workbench.app` carrying the original GeneralStaff Desktop icon.

## 0.4.5 — 2026-09-01

- Generalize operator identity in the Command Deck via the `generalstaff.operatorDisplayName` setting.
- Default-unset surfaces read "Needs You" and use a neutral avatar glyph; configured names personalize the attention queue and avatar initials.

## 0.4.4 — 2026-08-30

- Route the Grok 4.6 trial seat through the Grok subscription CLI as its primary runner.
- Retain the Cursor `cursor-grok-4.6-{effort}` named-model door as ordered discovery-time fallback.
- Enforce the verified Grok headless invocation contract: plain output before `-p`, provider-default effort, no model override, and `bypassPermissions` only for write-consented runs.
