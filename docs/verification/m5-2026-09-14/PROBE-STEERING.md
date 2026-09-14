# M5 M1 — Steering probe (2026-09-14)

## Verdict

**Harness cannot accept mid-turn input on this door in this environment.** The mandatory live probe against `scripts/gsd-cc-door.sh` / the `ollama-glm` seat did not reach a running Claude Code process. The documented fallback is therefore in force:

> the extension HOLDS the message and writes it the instant the current turn ends, on the SAME live process (not a new spawn) — the operator must never see "already has a lane running" again.

Implemented as `--input-format stream-json` + open stdin + `steering: 'hold-until-turn'` on Claude-protocol lanes (`claude`, `glm-ollama-cc`, `deepseek-ollama-cc`). Mid-run messages are queued in the adapter and flushed on `turn-boundary` (Claude `result` envelope). Composer stays enabled; delivery chips show `queued` → `delivered`.

## Probe command intent

1. Start a run whose first tool call is `sleep 150`.
2. At t+20s (probe used t+5s under a 25s wall timeout once the door was known absent), send a second stream-json user line.
3. Prove the second message lands in the seat's own transcript jsonl after sleep returns.

## Probe verbatim

```
=== M5 M1 STEERING PROBE 2026-09-14T16:39:09Z ===
host=cursor user=ubuntu pwd=/workspace

--- candidate doors ---
PATH=/home/ubuntu/Desktop/Dev Work/generalstaff-private/scripts/gsd-cc-door.sh
ls: cannot access '/home/ubuntu/Desktop/Dev Work/generalstaff-private/scripts/gsd-cc-door.sh': No such file or directory
PATH=/workspace/scripts/gsd-cc-door.sh
-rwxr-xr-x 1 ubuntu ubuntu 518 Sep 14 16:25 /workspace/scripts/gsd-cc-door.sh
PATH=/home/ubuntu/.gs-seats/ollama-glm-flash
ls: cannot access '/home/ubuntu/.gs-seats/ollama-glm-flash': No such file or directory
PATH=/home/ubuntu/.gs-seats/ollama-glm
ls: cannot access '/home/ubuntu/.gs-seats/ollama-glm': No such file or directory

--- which claude / ollama ---
--: line 20: type: claude: not found

--- attempt: in-repo door with sleep-style stream-json (expect fail: no claude) ---
USING_DOOR=/workspace/scripts/gsd-cc-door.sh
stdin_line_bytes=186
wrote first message at 16:39:09; waiting 5s for mid-run follow-up
--- stdout (first 40 lines) ---
--- stderr (first 40 lines) ---
/workspace/scripts/gsd-cc-door.sh: line 12: exec: claude: not found

--- seat transcript search ---
=== END PROBE ===
```

Raw log: `probe-raw.log`.

## Door jsonl excerpt

**None.** No seat transcript was produced — `claude` is not on PATH, `generalstaff-private/scripts/gsd-cc-door.sh` is absent, and `~/.gs-seats/ollama-glm*` does not exist in this VM. There is no jsonl excerpt to commit.

## Fallback contract (what shipped)

| Piece | Behaviour |
|-------|-----------|
| Invocation | `-p --input-format stream-json --output-format stream-json`; prompt on stdin as one `{"type":"user",...}` line |
| Stdin | Kept open for the live process |
| Mid-run send | Extension appends a user message with `delivery: 'queued'` and calls `ActiveRun.enqueueFollowUp` |
| Delivery | Adapter holds until `turn-boundary`, then writes the next stream-json user line on the **same** stdin; chip → `delivered` |
| Idle | With no held follow-ups, stdin is closed so the door can exit; strip reads idle via run completion |
| Non-steerable lanes | Message is held and auto-started as the next run after the current process exits (still never "already has a lane running") |

Re-run this probe on a machine with the private door + credentials before claiming live mid-turn acceptance; until then the hold-until-turn fallback is the supported path.
