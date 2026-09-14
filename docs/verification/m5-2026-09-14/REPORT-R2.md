# M5 Round 2 — REPORT

Gate inputs: `FIXLIST-R2.md`, `REVIEW-OPUS.md`, `LOOK-OPUS.md`, `PROBE-STEERING-REAL.md`, plus M7 from `origin/publish-v23` handoff.

## Verdict

Round-2 fixes for FIXLIST items 1–11 and M7 are landed. Package version remains **0.4.17** (no VSIX). Proof harness re-run at stamp `2026-09-14T17-26-09` with non-zero mid-scroll and meter frames.

## FIXLIST-R2

| # | Status | Evidence |
|---|--------|----------|
| 1 | Done | `cliAdapter.ts` writes mid-run follow-ups to stdin immediately; `heldFollowUps` only on soft write failure |
| 2 | Done | `enqueueFollowUp` returns `false` when stdin is closed → `pendingFollowUps` + operator notice; never silently dropped |
| 3 | Done | Compact composer still renders the local-files context row |
| 4 | Done | Chip stays `queued` until write; flips to `sent` on successful stdin write; `delivered` only after observed assistant/result |
| 5 | Done | Jump pill prepended inside `.conversation-compose-wrap` with `bottom: calc(100% + 8px)` |
| 6 | Done | `system/task_notification` → `woke on: …`; chip text honest |
| 7 | Done | Scroll harness uses mid-scroll (`before=240`); `scroll-stability-2026-09-14T17-26-09.json` |
| 8 | Done | `tool_progress` elapsed consumed; run clock starts at send |
| 9 | Done | Playwright behavioural UI test replaces source-grep cases (`test/m5-seat-experience.test.ts`) |
| 10 | Done | Door chip one-line + ellipsis; stream top mask fade |
| 11 | Done | Merged activity-strip CSS; strip text patched in place; `pendingFollowUps` drained on outer catch via `startPendingFollowUp` |
| M7 | Done | CSP-safe `data-meter-fill` + `applyMeterFills`; frames `proof-meter-{5,13,50}pct-1100x700-2026-09-14T17-26-09.png` |

## SEAT CONDUCT

Clause (e): acknowledge and act on operator messages queued mid-round at the next turn boundary before continuing prior work.

## Proofs (R2 stamp)

- Live strip + composer: `proof-live-strip-composer-1100x700-2026-09-14T17-26-09.png`, sidebar twin
- Idle strip: `proof-idle-strip-*-2026-09-14T17-26-09.png`
- Meter 5/13/50%: `proof-meter-*-1100x700-2026-09-14T17-26-09.png`
- Scroll: `scroll-stability-2026-09-14T17-26-09.json` — mid-scroll 240→240, streamRatio ≈ 0.709

## Tests

`npm test` in `workbench-extension`: **146/146** pass. `tsc --noEmit` clean.

## Not done here

- Live ollama-glm re-probe of mid-run steer (orchestrator / Mac-Neo)
- Version bump / VSIX (orchestrator after gate)
