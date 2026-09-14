# M5 — opus GATE code review (refute posture)

Gate run 2026-09-14 12:46–13:3x EDT on Mac-Neo. Worktree `scratchpad/m5-wt`, branch
`cursor/m5-seat-experience-785d` @ `33ab5f3` over `publish-v23` (`28d24e9`).
Diff reviewed: `git diff publish-v23..HEAD -- workbench-extension` (20 files, +1170/-109).
Baseline re-run by me: **`npm test` 147/147 pass, exit 0** (matches the lane's claim).

## VERDICT: SHIP-WITH-FIXES

The four blocking items are FIX 1–4 in `FIXLIST-R2.md`. Nothing here needs a redesign; FIX 1 is a
three-line change that the real probe (`PROBE-STEERING-REAL.md`) shows is both available and better
than what shipped.

## Mutants run (both restored; tree verified clean afterwards, 10/10 green again)

| # | Mutant | Result |
|---|--------|--------|
| A | `media/workbench.js:1310` — incremental render reverted: `patchContextMeter(message.conversationId)` → `render()` | **RED** — `M4 … must not full-render` (AssertionError, context-usage handler) |
| B | `src/adapters/cliAdapter.ts:188` — seat-conduct block removed from `promptForSeat`'s return | **RED** — `M2 … did not match /SEAT CONDUCT:/` |

Exactly 2 of 10 M5 cases failed, each the intended one. But see FINDING 5: mutant A only went red
because the test greps the *source text* of the handler, not because any behaviour changed.

## Per-MUST

**M1 Steering channel — DOES the brief's thing, by the WRONG mechanism.** Invocation is correct
(`-p` with the prompt moved off argv onto stdin as one stream-json user line, `--input-format
stream-json`, `keepStdinOpen`, `steering:'hold-until-turn'`; `cliAdapter.ts:289-320, 411-446`), and
`extension.ts:515-518` no longer answers a mid-run send with "already has a lane running"
(`enqueueWhileRunning`, 901-930). Tested by a real behavioural test (argv/stdin shape, 10 cases).
**But** `cliAdapter.ts:1284` deliberately withholds the write until the `result` envelope, on the
strength of a probe that never reached a door. My probe proves the harness accepts and *absorbs* a
mid-turn write (FIX 1). Two further defects, FINDINGS 1 and 3.

**M2 Seat conduct — PASS.** `SEAT_CONDUCT` (157-165) is inserted before `Operator request:`; all
four brief clauses are present verbatim-in-substance, incl. the 60 s sleep ban and
`run_in_background`. Behavioural test, mutant-confirmed.

**M3 Live activity strip — PARTIAL.** Tool + first line + per-call mm:ss + run total + "idle — your
turn" all render (frames prove it). The "woke on: <task> finished" clause is **dead code**:
`workbench.js:1327` tests a regex against status text that nothing in the pipeline ever produces —
`grep -n 'task_notification\|woke on' src/` returns nothing. The producer exists in the live stream
(`system/task_notification`, `status:"completed"`, `summary:"Sleep for 150 seconds"` — captured in
my probe log) and is simply not normalized. FINDING 4.

**M4 Incremental rendering — PASS in code, UNPROVEN by its proof.** `run-event`, `context-usage`,
`notice` and `notes` all patch (`patchActivityStrip` 887, `patchContextMeter` 917, `patchNoticeOnly`
938); auto-follow is gated on `state.stickToBottom`; the pill exists. Two caveats: the
scroll-stability artifact does not discriminate old from new code (FINDING 5), and a delivery-chip
update still triggers a full `render()` via the `conversations` post (`extension.ts:940`) — low
frequency, acceptable, noted only so nobody claims the hot paths are *all* patched.

**M5 Composer sizing — PASS, with a capability regression.** One row (`rows="1"`), `resize:none`,
auto-grow capped at 6 lines (`fitComposer` 906-914), five selects behind a ⚙ popover with
`flex-wrap:nowrap`. I measured the transcript share independently off the frames: stream 880 px of a
1246 px shell = **0.706** at 1100×700, and the same at the 760 sidebar — ≥70%, matching the lane's
0.709. **The regression:** `workbench.js:510` wrapped the context row in `compact ? '' : …`, which
deletes the "＋ Reference local files" button *and* the `pendingContext` chips from the in-conversation
composer. At `publish-v23` that row was unconditional (`git show publish-v23:…/workbench.js:503-508`).
M5 asked for the *selects* to collapse; nothing asked for the attach affordance to go. FINDING 2.

**M6 carry-overs — PASS.** Meter chrome is scoped (`.conversation-meta .lanes-context-meter` /
`.aux-view …`, css:2014-2025) and the unscoped legacy block is gone; `overflow-wrap:anywhere`
asserted on all four card bodies; `.thinking-card.is-redacted` present; rune-safe `capPersisted`
retained. **One door confirmed:** `test/fixtures/gsd-cc-door-ceiling.env` is deleted and both
`m3e-r2-fixlist.test.ts:185` and `m5-seat-experience.test.ts:104` read
`../scripts/gsd-cc-door.sh` — repo-relative, which resolves to
`/Users/rayweiss/Desktop/Dev Work/generalstaff-private/scripts/gsd-cc-door.sh` in a normal clone (I
read that file directly: `CLAUDE_CODE_MAX_CONTEXT_TOKENS="1048576"`). Repo-relative is the right
choice over a hard-coded absolute path; the mirror-must-not-exist assertion keeps it honest.

**M7** — absent from this run, as stated. Confirmed absent, not ledgered.

## Findings, worst first

**FINDING 1 (blocking) — a mid-run message can be silently swallowed forever.**
`cliAdapter.ts:1282`: `enqueueFollowUp` returns early when `stdinClosed`, and the caller
(`extension.ts:918-924`) has already appended the operator's message with `delivery:'queued'` and
cannot tell the enqueue failed — it does *not* fall through to `pendingFollowUps`. `stdinClosed`
becomes true at the **first** turn boundary with an empty queue (`1161-1167`), i.e. the instant every
round ends, while the child is still exiting and `activeRuns` still holds the run. So a message typed
in that window (exactly when a human types — "it just finished, one more thing") is appended to the
transcript, chipped "queued", and never delivered, never re-run, never errored. This is the M5 defect
reborn in a nicer costume. Fix: have `enqueueFollowUp` return a boolean and fall through to
`pendingFollowUps` (auto-start after exit) on false.

**FINDING 2 (blocking) — the chat composer lost file/folder referencing.** `workbench.js:510`, above.
Restore the context row in compact mode (it may live inside the ⚙ popover, but it must exist).

**FINDING 3 (blocking) — the "delivered" chip is asserted on a `write()`, not on consumption.**
`cliAdapter.ts:1158` emits `status:'follow-up delivered'` immediately after `writeStdinLine` returns
true, and `extension.ts:806-807` flips the chip on that string. My probe 1 proves `write()` can
return `true` for a line the model never acts on. Nothing in the stdout stream announces consumption
(no queue/absorb event on stdout — verified over 12 event types), so drive the flip off the next
`assistant`/`result` event after the write, and word the chip as "sent to the seat" until then.

**FINDING 4 (blocking, small) — chip text promises behaviour the code does not deliver.**
`workbench.js:794` — "queued — delivered after the current tool call". Shipped code delivers after
the whole *round*. With FIX 1 applied the promise becomes true (the harness absorbs at the tool
boundary — `absorbed_mid_turn`); without it, the wording must change. Same node: M3's "woke on"
regex (FINDING 4b) has no producer; wire `system/task_notification` in `normalizeCliLine` or delete
the branch. `tool_progress` heartbeats carry authoritative `elapsed_time_seconds` and are likewise
ignored — the strip's per-call clock is a client-side guess, and its "run" clock starts at the first
tool event (`ensureRunLive`, 1318), not at send, so it under-reports the round.

**FINDING 5 (non-blocking, methodological) — M3/M4/M5's tests are source greps, and the scroll proof
is vacuous.** Six of the ten new cases `readFileSync` `workbench.js`/`workbench.css` and assert that
a function *name* or a CSS string exists; they cannot fail on broken behaviour, only on renamed
identifiers. Worse, `scripts/render-m5-proofs.ts:224` sets `stream.scrollTop = 0` and then asserts
`after === before`: at the top, the **old** full-rebuild path also restores `oldScrollTop = 0`
(`wasNearBottom` is false there), so the artifact `{before:0, after:0, delta:0}` is equally
producible by the code M4 replaced. Re-point the harness at a **non-zero mid-scroll** position, where
the old rAF heuristic actually raced. Likewise `streamRatio` is identical to 16 digits at both
widths because `.conversation-compose-wrap` is capped in *percent* — it measures the CSS constant,
not the layout. (I verified the 70% independently off the frame pixels, so the claim stands; the
*method* doesn't.)

**FINDING 6 (non-blocking) — the live channel closes after one round, at a real cost.**
`1161-1167` ends stdin at the first empty turn boundary, so every follow-up after a completed round
pays a fresh spawn and a fresh ~25 k-token preamble. My probe measured the alternative: a second turn
on a still-open stdin answered in **1.1 s** with `cache_read_input_tokens: 17920`. Worth a later
round (keep stdin open for an idle grace period), not a blocker.

**FINDING 7 (non-blocking) — housekeeping.** `.activity-strip` is declared twice
(`workbench.css:2557` and `2571`) — merge. `patchActivityStrip` replaces the strip node once per
second (`workbench.js:1379`), which also replaces the Stop button under the operator's cursor; patch
the text node instead. `extension.ts:875-885` drains `pendingFollowUps` only in `.finally()` of the
run promise, so a follow-up queued against a run that dies in the outer `catch` (887-897) strands.

## Regression risk to Lanes/Desk

Low and bounded. The only cross-pane change is the meter scoping (M6), which narrows selectors
rather than widening them, and `.aux-view .lanes-context-meter` keeps the Lanes copy styled. No
`src/services/lanes*`/desk files are touched; `npm test` includes the Lane-Desk isolation and palette
suites, both green. The `notes` handler no longer full-renders (`workbench.js:1353`) and only patches
`#project-note`; if any other surface renders `state.notes`, it will now go stale until the next
render — I found no other consumer, but it is the one place a Desk/Lanes-adjacent staleness could hide.
