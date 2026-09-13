# Workbench chat parity across ALL seats (Ray, 2026-09-13: "the same thing should maybe apply to all different models as well")

Grounded: 0.4.7 (e09cf2c) = docs/handoffs/workbench-chat-polish-2026-09-13.md landed — clean assistant text for the Claude-protocol lanes (claude / deepseek-ollama-cc / glm-ollama-cc), Enter sends / Shift+Enter newline (global), ~/Desktop/handoff via --add-dir + picker.

## Scope
Bring every OTHER seat's chat rendering to the same standard: codex (`codex exec` JSON events), cursor-agent (stream-json), the direct Ollama API adapter (glm-5.3 / glm-5.3-flash / deepseek-v4.1-flash seats), grok runner (cursor-backed), and any other lane in `workbench-extension/src/adapters/`. For each lane:
1. Capture ONE real fixture of its raw output for a tool-heavy turn (a turn that reads a file and writes a file) into `workbench-extension/test/fixtures/<lane>-tool-turn.jsonl` (no credentials, no repo secrets; scrub paths to `<repo>`); run it through the adapter's normalize path.
2. Assert: the chat bubble contains ONLY the model's assistant prose per turn; tool calls/results render as the compact collapsible activity line (never as prose); paragraph breaks when prose follows tool activity; no raw JSON, no file contents, no progress spam, no duplicated final answer.
3. Fix each adapter that fails, in the same style as `cliAdapter.ts` normalizeCliLine for the Claude protocol (text blocks only; tool_use/tool_result hard-rejected; stream/progress events mapped to status, not prose).
4. Handoff folder: confirm every lane that can take an allowed-dir gets `~/Desktop/handoff` (expanded) — codex `--add-dir`/sandbox config, cursor `--add-dir` or its allowlist, direct-API seats get it in the context picker only (say so in the doc).
5. Tests: one adapter test per lane on its fixture; `npm run check` green; bump to 0.4.8; rebuild the VSIX (vsce) and re-run scripts/make-launcher-app.sh. Commit on your branch. Do not touch master (the working branch is publish-v23).
Report per lane: REAL FIX / ALREADY CLEAN / NOT APPLICABLE with file:line.

---

## Status — 0.4.8 landed on this branch

`npm run check` green. Fixtures live under `workbench-extension/test/fixtures/`. Live CLI capture was unavailable in this cloud environment (no `codex` / `cursor-agent` / `kimi` / `cline` / `grok` on PATH); fixtures are protocol-faithful reconstructions from public stream-json / `codex exec --json` docs, scrubbed to `<repo>`, covering a Read+Write tool turn each.

### Per-lane report

| Lane | Verdict | Where | Notes |
|---|---|---|---|
| `claude` / `deepseek-ollama-cc` / `glm-ollama-cc` | ALREADY CLEAN (0.4.7) | `cliAdapter.ts:764–786` (Claude branch inside `normalizeCliLine`); `speaksClaudeProtocol` `:516` | Explicit `message.content[]` text blocks only; `--add-dir` via `extraAddDirArgs` at `cliAdapter.ts:277` / `:394`. |
| `codex` | REAL FIX | `normalizeCodexLine` `cliAdapter.ts:541–601`; dispatch `:788` | Tools from `command_execution` (started) + `file_change` / MCP; `aggregated_output` never becomes prose; reasoning → status. `--add-dir` at `:205` / `:227`. Fixture: `test/fixtures/codex-tool-turn.jsonl`. |
| `cursor` (also Claude/Grok-via-Cursor `protocolLaneId`) | REAL FIX | `normalizeCursorLine` `cliAdapter.ts:603–632`; `cursorToolCallName` `:526–539`; dispatch `:790` | Skip `model_call_id` duplicate flushes + untimestamped finals + `result`; tools named from `*ToolCall` keys on `started` only; read/write bodies never prose. `--add-dir` at `:248` / `:330` / `:362`. Fixture: `test/fixtures/cursor-tool-turn.jsonl`. |
| `kimi` | REAL FIX | `normalizeKimiLine` `cliAdapter.ts:676–701`; dispatch `:791` | Assistant `content` only; `tool_calls[].function.name` → tool line; `role:tool` bodies dropped. `--add-dir` at `:295`. Fixture: `test/fixtures/kimi-tool-turn.jsonl`. |
| `cline` | REAL FIX | `normalizeClineLine` `cliAdapter.ts:703–737`; dispatch `:792` | `contentType:text` → prose; tool `content_start` → activity; `run_result` / `content_end` suppressed; tool input/output never crawled. Handoff: context picker only (`-c` cwd; no `--add-dir`). Fixture: `test/fixtures/cline-tool-turn.jsonl`. |
| `grok` native CLI | NOT APPLICABLE (structured tools) | plain path in `normalizeCliLine` `cliAdapter.ts:746–748`; JSON quiet at `:795–800` | `--output-format plain` — whole lines are prose by design; no tool JSON. Handoff: context picker only (no `--add-dir` contract). Fixture: `test/fixtures/grok-tool-turn.jsonl`. |
| `grok` via Cursor | REAL FIX (inherits cursor) | spawn sets `protocolLaneId = 'cursor'` `cliAdapter.ts:867`; `--add-dir` at `:362` | Same normalize as cursor. |
| `glm-ollama` / `glm-ollama-flash` / `deepseek-ollama` | ALREADY CLEAN / NOT APPLICABLE (no tool loop) | `answerFromOllamaChatCompletion` `ollamaCloudAdapter.ts:35–49` | Single-shot chat; only `message.content` surfaces; `thinking` withheld. Handoff: **context attach picker only** (`standingContextRoots` / Desktop/handoff). Fixture: `test/fixtures/ollama-tool-turn.json`. |

### Handoff folder (`~/Desktop/handoff`)

- Shared helper: `extraAddDirArgs` → `['--add-dir', <absolute path>]` when the folder exists — `handoffPaths.ts:24–27`.
- Wired on: codex, cursor, kimi, claude, CC-doors, cursor-backed claude/grok.
- Picker-only: direct Ollama API seats, native Grok CLI, cline (cwd-scoped).

### Packaging

- Version **0.4.8** (`package.json`).
- VSIX: `npm run package:distribution` → `distribution/generalstaff-workbench.vsix` (rebuilt).
- `scripts/make-launcher-app.sh`: re-run; exited because this Linux cloud agent has no `/Applications/Visual Studio Code.app` (macOS-only script). No launcher-app internals changed.
