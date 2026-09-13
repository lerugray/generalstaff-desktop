# Workbench chat polish — 2026-09-13

Ray used the DeepSeek seat (`deepseek-ollama-cc` lane, door `ollama-deepseek`,
`deepseek-v4.1-flash` via Ollama Cloud, run through the real `claude` binary per
`gsd-cc-door.sh`) today and reported three problems. Root causes below are grounded in the
actual source at commit bae7089; fix each, then verify against the acceptance criteria.

## 1. Chat output "kind of a mess ... except for the end"

**Root cause A — `normalizeCliLine` in `workbench-extension/src/adapters/cliAdapter.ts`
(~line 463-537).** For Claude-protocol lanes (`claude`, `deepseek-ollama-cc`, `glm-ollama-cc`),
every `type: "assistant"` stream-json envelope falls through to the generic `nestedText()`
extractor (line 442), which recursively pulls the first string found under
`text|result|content|message|delta` at ANY depth. A `tool_use` content block whose `input`
happens to contain a `content` key (e.g. the Write tool's `{file_path, content}`) gets its raw
file payload extracted as if it were assistant prose and appended to the chat. There is no
per-tool allowlist — it's a blind key-name match.

**Root cause B — `extension.ts` (~line 468-473).** `appendOutput(event.text)` concatenates
EVERY `assistant-delta` event for the whole run into one ever-growing string with no
separator, and that single string is rendered as one message body. Claude Code's tool loop
fires a fresh `assistant` envelope per turn (each preamble, each tool call, each follow-up),
so the visible bubble is the raw concatenation of every turn's text — preambles, leaked tool
payloads, and the final answer glued together with nothing distinguishing them. The final
turn's text lands last, which is exactly the part Ray called "the end ... I understood."

**Fix:**
- In `nestedText`, only descend into `tool_use` blocks far enough to reject them outright —
  a `tool_use` content block should never contribute to `assistant-delta` text at all (tool
  activity already has its own path: the `type: 'tool'` RunEvent → `run-event` postMessage →
  `state.runStatus` line in `media/workbench.js`). Make the assistant-text extraction for
  Claude-protocol lanes explicit: walk `record.message.content[]`, take only blocks where
  `block.type === 'text'`, join those. Drop the generic fallback for these three lane IDs (keep
  it for lanes without a machine-readable protocol, e.g. the raw-JSON-parse-failure path at
  line 469-471).
- In `extension.ts`, do not concatenate raw turn text blindly. Either (a) start a new
  message/paragraph boundary per `assistant` envelope (e.g. `appendOutput` inserts `\n\n` when
  the previous emit was not immediately continuous), or (b) collapse intermediate-turn text
  into the same compact status line tool/status events already use, and reserve the growing
  chat bubble for the FINAL turn's text only, promoting earlier "thinking out loud" text into
  the collapsible activity line instead of the permanent transcript.

## 2. Enter did not send; Shift+Enter should be newline

**Root cause — `media/workbench.js` line 840-844.** The only keydown handler on `#prompt` is:
```js
if (event.target.id === 'prompt' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
  event.preventDefault();
  issueCommand();
}
```
Only Cmd/Ctrl+Enter sends. Plain Enter falls through to the textarea's default behavior
(insert a newline) — which reads as "Enter did nothing."

**Fix:** swap the semantics to the standard chat convention:
```js
if (event.target.id === 'prompt' && event.key === 'Enter' && !event.shiftKey && !event.altKey) {
  event.preventDefault();
  issueCommand();
}
// Shift+Enter: no preventDefault — let the textarea insert its default newline.
```
Keep Cmd/Ctrl+Enter working too (harmless alias) if easy, but plain Enter-to-send and
Shift+Enter-for-newline is the acceptance bar.

## 3. Seat "had trouble seeing/accessing the Desktop handoff folder" (~/Desktop/handoff)

**Investigated and ruled out:** macOS TCC. `TCC.db` shows `com.microsoft.VSCode` already holds
`kTCCServiceSystemPolicyDesktopFolder` at `auth_value=2` (allowed) — VS Code itself, and thus
its extension host and any child process it spawns (node → `gsd-cc-door.sh` → `claude`), is NOT
blocked from reading `~/Desktop`. This is NOT a grant Ray needs to click. Do not add a TCC
permission-request flow for this.

**Likely root cause:** no directory-scoping flag (`--add-dir` or similar) is passed for any
lane in `cliAdapter.ts`'s `invocationFor()`, so a lane's ability to read a path outside the
command target's `cwd` depends entirely on the model correctly emitting an absolute,
already-expanded path in its own Read/Glob tool calls. `deepseek-v4.1-flash` (a flash-tier
model) is the class most likely to mishandle a `~`-prefixed path literally (tool calls are not
shell-expanded — a literal `~/Desktop/handoff` string will not resolve to `$HOME/Desktop/handoff`
unless the model or the tool layer expands it) or to hedge/refuse on an out-of-repo path it
reads as "outside my workspace."

**Answered 2026-09-13:** Claude Code's Read/Glob tools do **not** expand a literal `~/…`
path (anthropics/claude-code#7605, #11521). That alone explains failed handoff reads when the
model emits a tilde path. Fix shipped: absolute `--add-dir` for `~/Desktop/handoff` when the
folder exists, plus an attach-picker hint (folders allowed; Desktop/handoff is a standing
context root).

**Fix:**
- Confirm whether Claude Code's Read/Glob tools expand a literal `~` in the path argument. If
  not, this is enough on its own to explain the symptom — no code change needed beyond #2/#3
  below, but flag it precisely so the next session doesn't re-litigate it.
- The extension already has a context-attach picker (`vscode.window.showOpenDialog` calls at
  `extension.ts` ~612 and ~656, feeding `state.pendingContext` in `workbench.js`). Surface this
  as the documented way to hand a lane an out-of-repo path — e.g. a placeholder hint under the
  composer ("Attach a file/folder to reference paths outside this project") — so Ray doesn't
  have to rely on the model resolving `~/Desktop/handoff` unaided.
- Optionally, pass a configurable `--add-dir` (or lane-specific extra-directories list) that
  always includes `~/Desktop/handoff` for every lane, since it's Ray's standing staging surface
  per `decisions-arrive-staged.md` — this would fix it structurally rather than per-model.

## Acceptance criteria
- Enter sends; Shift+Enter inserts a newline; Cmd/Ctrl+Enter still sends (optional but harmless).
- A chat run against any Claude-protocol lane (claude / deepseek-ollama-cc / glm-ollama-cc)
  renders ONLY the model's actual assistant text in the growing message bubble, streamed
  cleanly, with no raw tool-input/tool-output JSON or file-content leakage; tool activity
  (Read/Write/Bash calls etc.) shows only as the existing compact one-line status indicator.
- Either the Read/Glob `~`-expansion question is answered and documented, or the attach-picker
  hint ships so Ray has a reliable way to point a lane at `~/Desktop/handoff` (or any
  out-of-repo path) without depending on the model's own path handling.
- Do not commit. Leave the working tree for the orchestrator to review and commit.
