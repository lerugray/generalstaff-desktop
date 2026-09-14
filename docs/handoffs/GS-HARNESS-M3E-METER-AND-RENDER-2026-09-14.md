# GS Harness M3e — the context meter reads OCCUPANCY, the transcript shows what happened

GROUNDED (orchestrator, s118, 2026-09-14 07:2x EDT): repo HEAD `cfbea83` on `publish-v23` (0.4.16 installed into the
Workbench profile). The full diagnosis with file:line citations and the reproduction arithmetic is
`docs/handoffs/WORKBENCH-CONTEXT-DIAG-2026-09-14.md` (opus, read-only, same morning) — READ IT FIRST; every location
below is cited there. Ray's real glm-5.3 session transcript is the fixture:
`~/.gs-seats/ollama-glm/projects/-Users-rayweiss-Desktop-Dev-Work-generalstaff-private/62822c1d-b4d8-423e-9592-34236abec88b.jsonl`
(7 tool calls, 35 s, no compaction, no malformed tool_use; copy it into `test/fixtures/` with any secrets scrubbed).

RULING (Ray, s118): the Workbench must be "Claude Code desktop, but you can pick the model and each model gets its
maximum context." His glm-5.3 catch-up showed **91%** context and "cryptic output with tool calls". Diagnosis: the
seat used **140,628 tokens = 13.4%** of 1,048,576; the meter summed every call's input + cache_read
(957,944 / 1,048,576 = 91.36%). The model was fine; the renderer shows almost nothing.

## Deliverables (all four; each with a test)

1. **Meter = occupancy, never cumulative spend.** `parseClaudeStreamUsage` (claudeUsage.ts ~93-100) currently feeds
   the final `result` envelope's cumulative usage into the occupancy figure, overwriting every correct per-turn value
   (cliAdapter.ts ~759-762). Occupancy = the LAST assistant message's `input_tokens + cache_read_input_tokens +
   cache_creation_input_tokens`; percent = occupancy / stated ceiling. Keep cumulative spend as a SEPARATE figure
   labelled "session spend" in the tooltip — the number in the strip is occupancy. Unit test on the fixture: the
   meter must read 13% (140,628 / 1,048,576), never 91%, after the result envelope arrives.
2. **One denominator.** `scripts/gsd-cc-door.sh:50` exports `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000`;
   `contextCeiling.ts:76` divides by 1,048,576 (`CC_DOOR_STATED_CONTEXT_TOKENS`). Make the extension read the value
   the door actually exports (one source of truth; the door script's value is what Claude Code believes). Test:
   the ceiling the picker shows equals the exported value for every Ollama seat.
3. **Tool cards, not bare verbs.** `cliAdapter.ts ~769-771` emits `{type:'tool', text: name}`; `workbench.js ~671-674`
   lists them raw ("Bash, Read, Bash…"). Emit per `tool_use`: name + a one-line label (Bash: first 80 chars of the
   command; Read/Edit/Write: the path; Grep/Glob: the pattern; Agent: its description) and, on the matching
   `tool_result`, ok/error + the first line of the result (≤120 chars). Render each as a collapsible card in order,
   interleaved with the prose — collapsed = one line ("Bash · git log --oneline -8 · ok"), expanded = full command
   and result, scroll-capped. This is the Claude Code desktop shape; match it, do not invent a new one.
4. **One bubble per assistant turn; thinking shown, collapsed.** `extension.ts ~659-663` merges every turn's prose into
   one bubble and drops `thinking` (5,603 chars in the fixture). Render one bubble per turn in order with its tool
   cards; render thinking as a collapsed card ("Thinking · 5.6k chars", click to expand). Never drop it.
5. **Meter tooltip shows preamble vs added.** First-call occupancy (132,479 on the fixture = the rules chain) vs what
   the session added since (8,149). Two numbers, one line.

## Gates (run yourself; the orchestrator re-runs them)
- The extension's existing check suite unchanged and green (118/118 at M3d) PLUS new tests for 1-4 on the fixture.
- Build the VSIX (do NOT install it into `.workbench-data`; the orchestrator installs after the look + review).
- Headless render proof at DPR 2 of the transcript pane driven by the fixture: first screen, an expanded tool card,
  a collapsed thinking card, the meter strip + tooltip → PNGs under `docs/verification/m3e-2026-09-14/` with a
  one-paragraph WHAT-CHANGED.md. Muted Chromium, `--no-sandbox`, close via the handle in `finally`.

## Scope fence
No seat additions; no change to `gsd-cc-door.sh` beyond deliverable 2; no layout restructuring outside the
transcript pane and the meter (daily-driver surfaces are ADDITIVE ONLY — the deck, Lanes/Desk toggles, Sessions
sidebar and picker from M3b-M3d stay exactly as shipped); no dependency additions; no commits of secrets (scrub the
fixture). Commit on your branch with clear messages; do not merge.

## After you (orchestrator-side)
flash-vision look at the PNGs + opus adversarial code review (the s117 two-seat rule) → install 0.4.17 → M4: one
real CC-door orchestration turn per seat (the per-model "can it run a session fully" test Ray asked for).
