# M5 Round 3 — REPORT

Gate inputs: `REVIEW-OPUS-R2.md`, `LOOK-OPUS-R2.md` (kept the GATE-R2 test-harness fix).

## Verdict

R2-1 through R2-7 landed. Package stays **0.4.17** (no VSIX). Proofs re-shot at stamp `2026-09-14T18-12-19`.

## Fixes

| # | Status | Change |
|---|--------|--------|
| R2-1 | Done | Compose wrap `max-height: 22%` + `overflow: hidden`, stream `min-height: 70%`, tighter compact chrome. Asserted `send.getBoundingClientRect().bottom <= window.innerHeight` at 1100×700 and 760×700 (test + proof harness). Measured send.bottom ≈ 694 ≤ 700. |
| R2-2 | Done | `.permission-chip` / `.root-chip` exempt from ellipsis; both carry `title` with the full label. Behavioural test asserts no letter-clip + title match. |
| R2-3 | Done | `tool_progress` emits plain `Bash · 90s` (not `tool_progress Bash 90`); webview parses both and keeps the human line in the strip fallback. |
| R2-4 | Done | `woke on:` requires a `task_notification` / `task_complete` subtype; bare `status: completed` no longer claims the wake branch. |
| R2-5 | Done | Deleted the no-op `status` / `woke on:` branch in the stdout loop. |
| R2-6 | Done | Idle turn-boundary no longer `stdin.end()`s; the live channel stays open across rounds (Stop/dispose still closes). |
| R2-7 | Done | Proof harness uses `--mute-audio` and the same pinned/`GS_CHROMIUM_EXECUTABLE`/fail-loud resolve path as the GATE-R2 test fix. |

## Proofs (R3 stamp)

- Live / idle strip at 1100×700 and sidebar-760×700
- Meter 5 / 13 / 50%
- `scroll-stability-2026-09-14T18-12-19.json` — mid-scroll 240→240, streamRatio ≈ 0.709

## Tests

`npm test` in `workbench-extension`: **148/148**. `tsc --noEmit` clean.
