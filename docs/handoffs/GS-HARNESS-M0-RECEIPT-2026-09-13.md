# GS Harness M0 receipt (2026-09-13)

M0 per `docs/handoffs/GS-HARNESS-FOUNDING-SPEC-2026-09-13.md` §7: "Workbench on
`publish-v23` activates, Command still shows the pinned Orchestrator session plus the
existing seat list with live `LaneSummary.state` probes, and a documented probe
confirms the Ollama Claude toggle / CC-door endpoint is cloud-models-only (no local
model)."

Verified by this harvest pass, at merge sha `028c2eb` (chat-parity-all-seats merged
onto publish-v23), extension version 0.4.8.

## 1. Extension activates on publish-v23

`npm run check` — 84/84 tests pass, typecheck clean, esbuild compile clean
(`dist/extension.js` 139.8kb). VSIX rebuilt via `npm run package:distribution`
(`distribution/generalstaff-workbench.vsix`, 65.43 KB, 15 files). Installed into the
isolated `.workbench-data` profile via `scripts/make-launcher-app.sh`; confirmed
active in `.workbench-data/extensions/extensions.json`:
`lerugray.generalstaff-workbench` → `0.4.8`.

## 2. Live seat probe (`discoverLanes()`, read-only, no prompts sent)

Ran headlessly via `node --import tsx` against `src/services/lanes.ts`
`discoverLanes()` — the same live auth/entitlement probes Command uses for
`LaneSummary.state` (each runner's `probeArgs`/`probeAccept`, e.g. `codex login
status`, `cursor-agent status`, `kimi status`, `cline provider list`). Not a canned
fixture — actual subprocess calls against installed CLIs on this Mac.

| Seat | State | Notes |
|---|---|---|
| codex | available | `/opt/homebrew/bin/codex` |
| claude | available | `/Users/rayweiss/.local/bin/claude` (Claude Fable) |
| kimi | available | `/Users/rayweiss/.local/bin/kimi` |
| cline | **unavailable** | needs login or repair — see where-things-live.md cline entry |
| cursor | available | `/Users/rayweiss/.local/bin/cursor-agent` |
| grok | available | trial seat, Grok CLI primary (per 2026-09-13 lapse note this may flip to the Cursor fallback — probe reported `available` at time of run) |
| glm-ollama | available | Ollama Cloud flat sub |
| glm-ollama-flash | available | Ollama Cloud flat sub |
| deepseek-ollama | available | Ollama Cloud flat sub, 1M ctx + vision |
| deepseek-ollama-cc | available | Ollama Cloud CC-door (Claude Code harness) |
| glm-ollama-cc | available | Ollama Cloud CC-door |

10 of 11 seats available; `cline` is the one unavailable seat (matches its
provider-list probe failing — consistent with the standing cline entry in
`where-things-live.md`, which already flags it as needing occasional re-auth).
The Command surface's seat list and pinned Orchestrator session are unchanged by
the chat-parity merge (no edits to `extension.ts` seat-list wiring in this branch).

## 3. Ollama-app Claude-toggle — cloud-only check

Per the founding spec's "never start a local model from Workbench" rule and the
where-things-live.md Ollama-app entry (the local-inference ban / cloud-only rule):

```
$ du -sh ~/.ollama/models
0B   /Users/rayweiss/.ollama/models

$ ollama ps
Error: could not connect to ollama server, run 'ollama serve' to start it
```

Both checks are read-only (no `ollama pull`, no `ollama serve` invoked). Local
model store is empty (0B) and no local Ollama daemon is running — the Ollama app's
Claude-toggle door and the Workbench CC-door lanes can only be serving cloud models.
This reconfirms the standing `feedback_no_local_inference` rule: nothing in this
pass started or would start local inference.

## Scope note

This receipt covers M0 only (activation + seat-probe evidence + cloud-only check).
M1–M4 are out of scope for this harvest pass.
