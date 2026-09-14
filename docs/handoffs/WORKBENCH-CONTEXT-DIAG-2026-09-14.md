# Workbench context-meter + output-rendering diagnosis — 2026-09-14

Read-only diagnostic. Nothing was edited, committed, installed or launched. Every number below
comes from Ray's own glm-5.3 Workbench session of this morning.

## 0. The session under examination

**Transcript:** `/Users/rayweiss/.gs-seats/ollama-glm/projects/-Users-rayweiss-Desktop-Dev-Work-generalstaff-private/62822c1d-b4d8-423e-9592-34236abec88b.jsonl`
(109,865 bytes, mtime `Sep 14 06:51`). It is the only JSONL in the `ollama-glm` seat.

Seat identification chain:
- `generalstaff-private/scripts/gsd-cc-door.sh:35` — `CFG="${CLAUDE_CONFIG_DIR:-$HOME/.gs-seats/$DOOR}"`, door `ollama-glm`.
- `workbench-extension/src/services/lanes.ts:278-285` — `CC_DOOR_LAUNCHER` = that script; `lanes.ts:328` attaches it as the lane `executable`.
- `workbench-extension/src/services/ollamaCloud.ts:25` — `'glm-ollama-cc': { door: 'ollama-glm', model: 'glm-5.3' }`.
- `~/.gs-seats/ollama-glm/.claude.json` — `"firstStartTime": "2026-09-14T10:51:03.008Z"`, `"firstStartVersion": "2.1.267"`.

**Ray's actual prompt** (line 6, a 1,034-char Workbench-generated grounding preamble; his own words at the end):

> Operator request:
> Greetings GLM - please catch up with the latest session note and then touch base, this will be a test to see how you handle the seat here today.

**Shape:** 43 JSONL lines — `queue-operation` 2, `attachment` 12, `user` 8, `last-prompt` 3,
`atis-latch` 2, `assistant` 16. Wall clock 10:51:03Z → 10:51:38.416Z ≈ **35 seconds**.
**Model string on every assistant message: `glm-5.3`** (single distinct value; no silent fallback).

**Tool calls:** 7 `tool_use` — `Bash` ×6, `Read` ×1. 7 `tool_result`, **1 error** (line 36: the
Bash "contains multiple operations" refusal, which the model handled by re-issuing a single
command at line 38). No malformed tool input, no unparseable block, no `error` envelope.

**Compaction: NONE.** `isCompactSummary` appears zero times; `grep -c "auto-compact\|Context low\|context left"` = 0.

## 1. Per-turn usage (the real numbers)

| JSONL line | input | cache_read | cache_creation | output | occupancy (in+cr+cc) | timestamp |
|---|---|---|---|---|---|---|
| 12 | 131,519 | 960 | 0 | 239 | 132,479 | 10:51:12.092Z |
| 13 | 131,519 | 960 | 0 | 239 | 132,479 | 10:51:12.100Z |
| 16 | 129,856 | 0 | 0 | 0 | 129,856 | 10:51:14.641Z |
| 17 | 205 | 132,672 | 0 | 96 | 132,877 | 10:51:14.943Z |
| 18 | 205 | 132,672 | 0 | 96 | 132,877 | 10:51:15.002Z |
| 21 | 132,043 | 0 | 0 | 0 | 132,043 | 10:51:19.032Z |
| 22 | 132,043 | 0 | 0 | 0 | 132,043 | 10:51:19.836Z |
| 23 | 132,043 | 0 | 0 | 0 | 132,043 | 10:51:19.859Z |
| 27 | 2,395 | 132,928 | 0 | 589 | 135,323 | 10:51:20.202Z |
| 30 | 1,943 | 135,872 | 0 | 330 | 137,815 | 10:51:23.996Z |
| 31 | 1,943 | 135,872 | 0 | 330 | 137,815 | 10:51:23.999Z |
| 34 | 939 | 138,112 | 0 | 641 | 139,051 | 10:51:30.823Z |
| 35 | 939 | 138,112 | 0 | 641 | 139,051 | 10:51:30.827Z |
| 38 | 123 | 139,648 | 0 | 52 | 139,771 | 10:51:32.732Z |
| 41 | 136,627 | 0 | 0 | 0 | 136,627 | 10:51:34.986Z |
| 42 | 852 | 139,776 | 0 | 567 | 140,628 | 10:51:38.416Z |

Claude Code writes one JSONL entry per content block, so a single API call appears 2-3 times with
the same usage (12/13, 17/18, 21/22/23, 30/31, 34/35). Ten distinct usage tuples; **seven of them
carry `output_tokens > 0`** — those seven are the real billed API calls. The four zero-output rows
(16, 21-23, 41) are the pre-cache placeholder records.

- **MAX single-call occupancy = 140,628 tokens** (line 42, the final turn).
  = **13.41 % of 1,048,576**; 70.31 % of 200,000.
- SUM `input_tokens` across all entries = 935,194; SUM `cache_read` = 1,227,584;
  SUM `cache_creation` = 0; SUM `output` = 3,820.

## 2. Reproducing Ray's 91 %

Take only the seven output-bearing calls — the ones Claude Code aggregates into its final
`result` envelope:

```
input      131,519 + 205 + 2,395 + 1,943 + 939 + 123 + 852        =   137,976
cache_read     960 + 132,672 + 132,928 + 135,872 + 138,112
             + 139,648 + 139,776                                  =   819,968
                                                        TOTAL     =   957,944

957,944 / 1,048,576 = 0.91357  ->  Math.round(...*100) = 91 %
```

**That is Ray's number, exactly.** For contrast: 957,944 / 1,000,000 = 96 %; the true peak
occupancy 140,628 / 1,048,576 = **13 %**.

So the meter was reporting **cumulative tokens spent over the whole session** as if it were
**current context occupancy**. The session never exceeded 13.4 % of its window, and never compacted.

### Where the bug lives

`workbench-extension/src/adapters/cliAdapter.ts:759-762`, in `normalizeCliLine`:

```
  if (speaksClaudeProtocol(laneId) && (type === 'result' || type === 'run_result')) {
    const usage = parseClaudeStreamUsage(safeLine);
    return usage ? { type: 'context-usage', usedTokens: usage.usedTokens } : undefined;
  }
```

`workbench-extension/src/services/claudeUsage.ts:93-100` then computes
`usedTokens = input + cache_read + cache_creation` from that `result` usage object.

The comment at `claudeUsage.ts:8-9` states the intended semantics correctly —
*"Current context size for a turn = input + cache_read + cache_creation on the latest assistant
(or result) usage object"* — but the assumption that `result` carries **the latest turn's** usage
is wrong: Claude Code's `result` envelope carries **session totals**. `claudeUsage.ts:11-12` even
records that the fixture was "a protocol-faithful reconstruction" because *"No live capture existed
in this workspace"* — the semantics were never checked against a real run.

The `result` line arrives **last**, so it overwrites every correct per-assistant value:
- `cliAdapter.ts:775` correctly pushes `{ type: 'context-usage', usedTokens }` per assistant message (140,628 on the final turn),
- `extension.ts:669-674` forwards it verbatim,
- `media/workbench.js:1036` `state.contextUsage[conversationId] = message.usedTokens` **replaces** (no accumulation bug in the webview),
- `media/workbench.js:106` `percent = Math.round((usedTokens / ceiling.tokens) * 100)`.

Everything downstream is correct. The single wrong input is the `result`-sourced number.

### Secondary denominator mismatch

- `gsd-cc-door.sh:50` exports `CLAUDE_CODE_MAX_CONTEXT_TOKENS="1000000"`.
- `contextCeiling.ts:76` `CC_DOOR_STATED_CONTEXT_TOKENS = OLLAMA_CLOUD_CONTEXT_TOKENS` = `1_048_576` (`ollamaCloud.ts:33`).

The Workbench divides by a ceiling **4.86 % larger than the one the CLI was actually told**. The
comment at `contextCeiling.ts:70-75` acknowledges the divergence ("The handoff names `1000000`")
and chooses the larger number deliberately. It is not the cause of the 91 %, but every percentage
the meter prints is computed against a window the process does not have.

## 3. Does the 1M ceiling reach the seat? YES.

- `gsd-cc-door.sh:43-53` — a single `exec env … CLAUDE_CODE_MAX_CONTEXT_TOKENS="1000000" … claude "$@"`.
- The extension does **not** build its own claude invocation: `lanes.ts:328` sets the lane
  `executable` to the door script, and `cliAdapter.ts:378` passes the door name as `argv[0]`:
  `args: [ ollamaCcDoorFor(laneId).door, '-p', groundedPrompt, …, '--model', 'sonnet',
  '--output-format', 'stream-json', '--verbose', '--permission-mode', …, '--effort', effort ]`.
- `cliAdapter.ts:886-896` spawns with `env: { ...process.env, NO_COLOR, TERM, ...processSpec.env }` —
  it never strips or overrides the door's variables, because the door sets them *after* the spawn,
  inside its own `exec env`.
- `~/.gs-seats/ollama-glm/settings.json` contains no `CLAUDE_CODE_MAX_CONTEXT_TOKENS`
  (only `CLAUDE_CODE_SUBAGENT_MODEL: sonnet`, the SessionStart/PreToolUse hooks, `effortLevel: high`) —
  so no settings-level value can shadow the process env.

**Diff against the terminal wrapper** `generalstaff-private/scripts/ollama-claude.sh`:

| | `ollama-claude.sh` | `gsd-cc-door.sh` |
|---|---|---|
| max context | `:32` `CLAUDE_CODE_MAX_CONTEXT_TOKENS="${LANE_MAX_CONTEXT_TOKENS:-1000000}"` | `:50` `"1000000"` |
| model flag | `:34` `--model sonnet` | `cliAdapter.ts:386-387` `--model sonnet` |
| prompt | `:34` `-p "<pointer to $CFG/prompt.md>"` | `-p <inline grounded prompt>` |
| permission | `--permission-mode bypassPermissions` | `acceptEdits` / `plan` |

The context-window handling is **identical**. That is consistent with the evidence: yesterday's
terminal test and this morning's Workbench run both ran to ~140k with no compaction. The seat is
fine; only the display was wrong.

## 4. The "cryptic output": the renderer, not the model

**The model emitted nothing malformed.** All 7 `tool_use` blocks carry well-formed `input`
(`Bash`: `['command','description']`; `Read`: `['file_path']`). Zero parse failures across all 43
lines. Zero `isApiErrorMessage`. The one `is_error` result is Claude Code's own policy refusal of a
multi-operation Bash command, which the model then corrected. Its prose is clean — line 17:
*"6:51 AM EDT, Monday Sept 14. Newest note is s117 from yesterday — reading it now."*; line 42:
*"Catch-up done. Here's where things stand as of 6:51 AM EDT, Monday Sept 14…"*. It also produced
six `thinking` blocks (691, 73, 1,473, 943, 2,125, 298 chars).

**No raw JSON is rendered.** The claude-protocol path is explicitly defensive:
- `cliAdapter.ts:484-496` `claudeProtocolAssistantText` takes **only** `type === 'text'` blocks.
- `cliAdapter.ts:464-466` `nestedText` refuses to descend into `tool_use` / `tool_result`
  ("Never treat those payloads as assistant prose").
- `cliAdapter.ts:766-773` is the branch Ray's lane used (`speaksClaudeProtocol` includes
  `'glm-ollama-cc'`, `cliAdapter.ts:517-519`).

**What Ray actually saw.** `cliAdapter.ts:769-771` converts each tool call to
`{ type: 'tool', text: name }` — **the bare tool name and nothing else**. Then:
- `extension.ts:675-681` forwards it as a `run-event`,
- `media/workbench.js:1041-1045` pushes `message.event.text` into a flat string list and sets
  `state.runStatus[conversationId] = message.event.text`,
- `media/workbench.js:669-676` renders a spinner whose `<summary>` is the run label and whose
  `<ol>` is `lines.map(line => '<li>' + escapeHtml(line) + '</li>')`.

So the activity strip for this catch-up read: `Bash`, `Read`, `Bash`, `Bash`, `Bash`, `Bash`, `Bash` —
seven bare verbs, no command, no path, no result, no success/failure mark. Claude Code's own UI
shows a collapsed card per call carrying the command and an output preview. Separately,
`extension.ts:659-663` concatenates every `text` block from every turn into one assistant bubble,
so the model's three interleaved progress lines and its final report merge into a single run-on
message with `\n\n` joins and no tool context between them.

Both effects together are what "cryptic with tool calls or whatever else" describes. There is no
raw-JSON leak, and no model defect.

Also worth noting: `thinking` blocks are dropped entirely (they are neither `text` nor `tool_use`),
so 5,603 characters of the model's reasoning — including its recovery from the Bash refusal — never
reach the operator in any form.

## 5. What actually filled the window

| | tokens | share of the 140,628 peak |
|---|---|---|
| First API call (system prompt + tool defs + skill index + CLAUDE.md chain + rules + memory + the 1,034-char prompt) | 132,479 | 94.2 % |
| Everything the catch-up itself added (7 tool calls, 7 results, all prose) | 8,149 | 5.8 % |

Static auto-loaded instruction files measured on disk:

| file / set | bytes | ≈ tokens (bytes/4) |
|---|---|---|
| `~/.claude/CLAUDE.md` (symlinked into the seat) | 4,807 | 1,202 |
| `generalstaff-private/CLAUDE.local.md` | 39,775 | 9,944 |
| `generalstaff-private/rules/*.md` | 347,793 | 86,948 |
| `memory/MEMORY.md` | 17,807 | 4,452 |
| **total** | **410,182** | **≈102,545** |

The remaining ≈29k of the first call is Claude Code's system prompt, the tool definitions and the
48-entry skill index (`~/.claude/skills`).

**Conclusion for the window question:** a GS catch-up on this seat costs ~132k of preamble and ~8k
of work. Against the stated 1M window that is 13 %. The seat is not "blowing through" its context;
the meter was reporting spend, not occupancy.

## 6. Smallest fixes

1. **`src/services/claudeUsage.ts` / `src/adapters/cliAdapter.ts`** — stop feeding the `result`
   envelope into the meter. Either drop the `type === 'result'` branch from
   `parseClaudeStreamUsage` (`claudeUsage.ts:93-100`), or make `normalizeCliLine`'s result branch
   (`cliAdapter.ts:759-762`) return `undefined` instead of a `context-usage` event. The per-assistant
   path at `cliAdapter.ts:774-775` already produces the correct occupancy. Fixes 91 % → 13 %.
2. **`src/services/contextCeiling.ts:76`** — set `CC_DOOR_STATED_CONTEXT_TOKENS` to the value the
   launcher actually exports (`1_000_000`), or raise `gsd-cc-door.sh:50` to `1048576`. Pick one;
   the meter must divide by the window the CLI was told.
3. **`claudeProtocolToolNames` (`cliAdapter.ts:498-510`)** — return a short label per call
   (`Bash — <description or first line of command>`, `Read — <basename>`) instead of the bare name,
   and have `media/workbench.js` `renderContextMeter`'s sibling activity list (`workbench.js:671-674`)
   mark completion/failure per entry. That is the whole distance between the current strip and
   Claude Code's tool cards.
4. Optional: surface `thinking` blocks behind a collapsed toggle in the same `<details>`, so the
   seat's reasoning is inspectable when a run goes sideways.
