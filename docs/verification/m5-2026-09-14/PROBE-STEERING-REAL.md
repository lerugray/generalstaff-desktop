# M5 M1 — the REAL steering probe, run on Mac-Neo against `scripts/gsd-cc-door.sh ollama-glm-flash`

Run by the opus gate, 2026-09-14 16:47–16:54 UTC (12:47–12:54 EDT). This supersedes the lane's
`PROBE-STEERING.md`, whose verdict ("harness cannot accept mid-turn input on this door") was reached
in a VM with no door, no `claude` on PATH and no seat — i.e. it is a statement about the lane's
sandbox, not about the door. Classic [[suspect-your-usage-before-blaming-the-sub]].

## VERDICT

**The primary M1 mechanism WORKS on this door. The shipped implementation must change.**

- A mid-turn stream-json user line written to the live process's stdin **is accepted and enqueued by
  the harness** (`queue-operation: enqueue` + an `attachment/queued_command` carrying the text), and
  is **absorbed into the running turn at the tool-call boundary** —
  `queue-operation … "reason": "absorbed_mid_turn"` at the exact millisecond the `sleep 150` tool
  result returned. That is verbatim the behaviour the brief specified and the behaviour the chip
  promises ("delivered after the current tool call").
- A post-turn write on the same live process also works and is answered as a second turn in the same
  session with no respawn (probe 2).
- So the extension's `// Documented fallback: do not write mid-turn; flush at turn-boundary`
  (`cliAdapter.ts:1284`) withholds a capability the door actually has, on a false premise.

## Exact invocation (read out of `src/adapters/cliAdapter.ts:411-446`, the `glm-ollama-cc` branch)

```
bash /Users/rayweiss/Desktop/Dev Work/generalstaff-private/scripts/gsd-cc-door.sh ollama-glm-flash \
  -p --session-id <uuid> --model sonnet \
  --input-format stream-json --output-format stream-json --verbose \
  --permission-mode acceptEdits --effort high
```
stdin: one `{"type":"user","message":{"role":"user","content":[{"type":"text","text":…}]}}` line per
message (`streamJsonUserLine`), stdin held open. Door read first: it takes `<door> [claude args…]`,
sets `CLAUDE_CONFIG_DIR=~/.gs-seats/ollama-glm-flash`, runs seat-config-sync, and execs the real
`claude` with the Ollama credential injected. No credential was printed, logged or copied by this probe.
Driver: `probe.mjs` / `probe2.mjs` (scratchpad). Raw logs committed beside this file:
`probe-real.log.txt`, `probe2-real.log.txt` (renamed: `*.log` is gitignored).

## Probe 1 — mid-turn write during a live `sleep 150`

| wall clock | t | event |
|---|---|---|
| 16:47:53.540 | +0.0 s | msg1 written (`Run \`sleep 150\` … then say DONE-SLEEP`), `write()` → true |
| 16:47:57.084 | +3.6 s | assistant `tool_use` Bash `sleep 150` (the model chose `timeout:180000`) |
| 16:48:00.318 | +6.8 s | `system/task_started`, `is_backgrounded:false` |
| **16:48:13.542** | **+20.0 s** | **msg2 written mid-turn** (`reply exactly SECOND-DELIVERED…`), `write()` → **true**, no stdin error, `destroyed=false` |
| 16:48:27 / :57 / 16:49:27 | +33/63/93 s | `tool_progress` heartbeats, `elapsed_time_seconds` 30/60/90 |
| 16:50:27.346 | +153.8 s | `tool_result` "(Bash completed with no output)" |
| **16:50:27.353** | **+153.8 s** | **queue entry removed, `reason:"absorbed_mid_turn"`** |
| 16:50:30.978 | +157.5 s | assistant text: `DONE-SLEEP` |
| 16:50:31.084 | +157.6 s | `result/success`, `stop_reason:"end_turn"` |
| to 16:53 | +300 s | process alive, stdin open, **no further turn** |

**Harness accepted the mid-turn write: YES** (no error on stdin; enqueued and journalled).
**Absorbed at the tool-call boundary: YES.**
**`SECOND-DELIVERED` appeared after `DONE-SLEEP`: NO** — the model (glm-5.3-flash) ended the turn on
the first instruction and never acted on the absorbed text. That is a *model-compliance* outcome on a
flash-tier seat, not a harness limitation, and it is the honest caveat on this probe: the channel
delivered, the small model ignored it. A retry on `ollama-glm` (glm-5.3) or with the follow-up phrased
as a correction rather than an appendix is the cheap confirmation, and the M2 seat-conduct block
("end every round…") is what makes compliance likely in real use.

### Seat transcript excerpt — `~/.gs-seats/ollama-glm-flash/projects/…-scratchpad-probe-cwd/5e335a1f-585f-4144-82ec-267a5f817392.jsonl`

```json
{"type":"queue-operation","operation":"enqueue","timestamp":"2026-09-14T16:48:13.543Z","sessionId":"5e335a1f-…"}
{"attachment":{"type":"queued_command","prompt":[{"type":"text","text":"after the sleep, reply exactly SECOND-DELIVERED and nothing else"}],"commandMode":"prompt","timestamp":"2026-09-14T16:48:13.542Z"},"type":"attachment","uuid":"07cccb5e-…","userType":"external","entrypoint":"claude-desktop","sessionId":"5e335a1f-…","version":"2.1.267"}
{"type":"queue-operation","operation":"remove","timestamp":"2026-09-14T16:50:27.353Z","sessionId":"5e335a1f-…","reason":"absorbed_mid_turn"}
```

This is the artifact the brief asked for and the lane could not produce.

## Probe 2 — post-turn write on the same live process (what the shipped code does)

| wall clock | t | event |
|---|---|---|
| 16:53:42.440 | +0.0 s | msg1 (`Reply exactly FIRST-TURN-OK…`) |
| 16:53:44.636 | +2.2 s | assistant `FIRST-TURN-OK` |
| 16:53:44.737 | +2.3 s | `result/success` |
| 16:53:44.940 | +2.5 s | **msg2 written 200 ms after the result envelope — exactly where `flushHeldFollowUps` writes** |
| 16:53:46.038 | +3.6 s | assistant `SECOND-DELIVERED` — same `session_id` 88bae08e, **no respawn** |

Transcript `88bae08e-….jsonl`: `user FIRST-TURN… / assistant FIRST-TURN-OK / user reply exactly
SECOND-DELIVERED… / assistant SECOND-DELIVERED`. Second turn cost 1.1 s with
`cache_read_input_tokens: 17920` — a fresh spawn pays the ~25 k preamble instead.

So the shipped hold-until-turn path **does work end-to-end**; it is simply the weaker of two working
options, and the one that leaves the FINDING-1 drop window open.

## How the extension handles a mid-run send, vs what the harness supports

`extension.ts:515-518` → `enqueueWhileRunning` (901-930): appends the operator's message with
`delivery:'queued'`, then calls `ActiveRun.enqueueFollowUp`. `cliAdapter.ts:1279-1288` pushes it onto
`heldFollowUps` and explicitly does **not** write; `flushHeldFollowUps` (1145-1170) writes one line
per `turn-boundary`, where `turn-boundary` is emitted from the `result` envelope
(`normalizeCliLine`, 986-995). So: **it holds until the end of the whole round, then writes.**

Against the probe: the harness supports the immediate write *and queues it for the operator* exactly
as Claude Code desktop does. The shipped behaviour is therefore (a) a needless one-round delay when
the round contains several tool calls, (b) a false chip ("after the current tool call"), and (c) the
only reason FINDING 1's drop window exists — a write that goes out while the process is demonstrably
live cannot be swallowed by a closed stdin.

**Required change (FIX 1):** write the follow-up to stdin immediately when the process is live; keep
`heldFollowUps` only as the fallback for a failed write; drive the chip from an observed
`assistant`/`result` event after the write, never from `write()` returning true. Nothing on stdout
announces the absorption (12 event types observed; no queue/absorb event), so the chip must stay
"sent" until the seat's next output.

## Processes

Every process this probe started was killed by PID: `5860`/`5873` (probe 1, `kill -TERM`, exit
confirmed) and `9100`/`9114` (probe 2). No pattern kills. No browser launched.
