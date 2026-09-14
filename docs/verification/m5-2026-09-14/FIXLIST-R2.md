# M5 — FIXLIST-R2 (must change before 0.4.18 installs)

Gate verdicts: **REVIEW-OPUS SHIP-WITH-FIXES · LOOK-OPUS PASS-WITH-DEFECTS · PROBE the primary M1
mechanism WORKS, shipped implementation must change.** Items 1-6 are blocking; 7-11 are the same
round if cheap, else R3. Evidence paths in `REVIEW-OPUS.md`, `LOOK-OPUS.md`,
`PROBE-STEERING-REAL.md`.

| # | Item | Where | Why blocking |
|---|------|-------|--------------|
| 1 | **Write the mid-run follow-up to stdin immediately** when the process is live; keep `heldFollowUps` only as the fallback for a failed write. The harness enqueues it and absorbs it at the tool-call boundary (`absorbed_mid_turn`). | `cliAdapter.ts:1279-1288`, `flushHeldFollowUps` 1145-1170 | The shipped hold-until-round was chosen on a probe that never reached a door; it delays steering by a whole round and is the sole cause of item 2 |
| 2 | **`enqueueFollowUp` must report failure and fall through to `pendingFollowUps`** when stdin is closed | `cliAdapter.ts:1282`, `extension.ts:918-924` | A message typed in the window between the round's turn-boundary (stdin closes at 1161-1167) and `activeRuns.delete()` is appended, chipped "queued", and **silently lost forever** — the exact M5 defect, reborn |
| 3 | **Restore the context row in the in-conversation composer** ("＋ Reference local files" + pendingContext chips); it may live inside the ⚙ popover | `workbench.js:510` | Capability regression vs `publish-v23`: the operator can no longer attach a file/folder inside a chat |
| 4 | **Flip the delivery chip on an observed `assistant`/`result` event after the write, not on `write()` returning true**; word it "sent to the seat" until then | `cliAdapter.ts:1158`, `extension.ts:806-807` | Probe 1 proves `write()` can return true for a line the seat never acts on — the chip can lie to Ray |
| 5 | **Move the "↓ jump to latest" pill above `.conversation-compose-wrap`** (anchor to the stream, not `bottom:110px`) | `workbench.css:2611-2615` | The pill is drawn over the activity strip and covers the **Stop** button — and only appears when the operator has scrolled up mid-run |
| 6 | **Chip text / "woke on" honesty:** with item 1 landed, "delivered after the current tool call" becomes true — keep it; and either wire `system/task_notification` (`status:"completed"`, `summary`) into `normalizeCliLine` or delete the dead `woke on:` branch | `workbench.js:794, 1327`; `cliAdapter.ts` normalize | M3 ships a MUST clause with no producer anywhere in the pipeline |
| 7 | **Re-point the scroll-stability harness at a NON-ZERO mid-scroll position** and re-run; the current `{before:0, after:0}` is equally producible by the code M4 replaced | `scripts/render-m5-proofs.ts:224` | M4's only behavioural proof does not discriminate old from new |
| 8 | **Consume `tool_progress.elapsed_time_seconds`** for the strip's per-call clock and start the run clock at send, not at the first tool event | `cliAdapter.ts` normalize; `workbench.js:1318` | The strip's two clocks are client-side guesses and under-report the round |
| 9 | **Replace the six source-grep tests with behavioural ones** (JSDOM/Playwright asserting scroll invariance, composer height, strip text) | `test/m5-seat-experience.test.ts` | Six of ten new cases assert that a function *name* exists; they cannot fail on broken behaviour |
| 10 | **Meta-row chip legibility:** one-line the door chip (`Ollama Cloud CC`) or nowrap+ellipsis+title, and let the session blurb shrink; add a 12-16 px top mask/fade to the stream | `workbench.css` `.conversation-meta`, `.message-stream` | At 1100 the 4-line chip breaks through the row's bottom border; at 760 the door chip is not rendered at all |
| 11 | **Housekeeping:** merge the duplicate `.activity-strip` blocks (css:2557 + 2571); patch the strip's text node instead of replacing the node (and the Stop button) every second; drain `pendingFollowUps` on the outer `catch` path too | `workbench.css`, `workbench.js:1379`, `extension.ts:875-897` | Small, cheap, prevents the next stranded follow-up |
| — | **M7 (meter bar fill) — not attempted this run.** Confirmed absent from the diff; not ledgered as a defect. | — | Carried to the next round per the brief |

## Re-gate conditions

Items 1-6 land, `npm test` re-run by the orchestrator at the new HEAD, the proof harness re-run for
item 7 with fresh timestamped frames (including one live frame at t+60-90 s so the clocks are
evidenced), then a live `ollama-glm` seat re-probe of item 1 end-to-end — a mid-run steer that the
seat actually *answers*, with the `absorbed_mid_turn` line and the answer both quoted. Then 0.4.18,
then Ray's eyes. His verdict is the gate.
