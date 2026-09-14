# M5 — opus RE-GATE, round 2 (refute posture)

Gate run 2026-09-14 13:47–14:2x EDT, Mac-Neo. Worktree `scratchpad/m5-wt` @ `c8a84cd`
(`a4aba83` = my round-1 gate commit). Reference: `FIXLIST-R2.md`.

## VERDICT: SHIP-WITH-FIXES — and **0.4.18 must NOT be installed for Ray yet**

Every FIXLIST item 1-11 and M7 is genuinely done; I verified the two that no test covers against the
real door. But round 2 introduced a **first-screen functional regression**: the Send/Queue button and
the ⚙ are clipped below the pane at both widths. Ray's first act in the Workbench is to type and
press Send. Two CSS-scale fixes (R2-1, R2-2) and it ships.

## A. The hang — cause found, test-only fix applied

**Cause: two independent faults, neither in the code under test.**

1. **This Mac has no chromium for playwright's pinned revision.** `playwright@1.55.0` resolves
   `chromium_headless_shell-1187`; `~/Library/Caches/ms-playwright` holds 1223 / 1234 / 1243 only.
   `chromium.launch()` throws in ~9 ms: *"Executable doesn't exist at …chromium_headless_shell-1187…"*.
2. **The test file then hung forever** because its HTTP fixture server is started *before* the launch
   while the close teardown is registered *after* it (old `test/m5-seat-experience.test.ts:166-174`).
   A thrown launch leaves the listener open, node's event loop never drains, and the *file* never
   exits — so one failed assertion presents as an infinite hang. The per-test timeout cannot catch
   it: the test has already finished.

Evidence: `node --import tsx --test --test-timeout=60000 test/m5-seat-experience.test.ts` printed
8 ✔ and 1 ✖ within ~3.5 s, then sat until `timeout` killed it at 180 s (`EXIT=124`,
"Interrupted while running").

**Lane-owed fix, applied by me, TEST FILE ONLY (uncommitted, in the worktree):** register the server
teardown before the launch (+ `closeAllConnections()`), add `--mute-audio` (standing no-speakers
rule — the lane's launch omitted it, as does `scripts/render-m5-proofs.ts:257`, which is still owed),
and resolve the browser as: pinned build if present → `GS_CHROMIUM_EXECUTABLE` → `t.skip` with the
install hint. A missing browser can now never hang or lie.

**Real counts, both measured by me at `c8a84cd`:**
- `npm test` with the installed chromium 1243: **146/146 pass, 0 fail, 0 skip, 15.5 s.**
- `npm test` without it: **145 pass + 1 skip**, no hang (file exits in 0.38 s).
So the lane's "146/146" is true — it just could not be produced on this host.

## D. The 147 → 146 delta, by name

Only `test/m5-seat-experience.test.ts` changed (`git diff --stat a4aba83..c8a84cd -- test/`), 10
cases → 9. Every other file is untouched, so 137 + 10 = 147 and 137 + 9 = 146.

**Removed (5, all source-grep cases):** `M5: composer CSS is one-row auto-grow with no manual
resize` · `M4: run-event / context-usage / notice patch without full innerHTML rebuild hooks` ·
`M3: live activity strip helpers exist` · `M1 UI: composer stays enabled while running; delivery
chips exist` · `M6: overflow-wrap anywhere remains on card bodies`. (`M6: .is-redacted styling
present; ceiling mirror deleted` was rewritten as `M6: ceiling mirror deleted; real door still
1048576`, dropping its `.is-redacted` assertion.)

**Added (4):** `M3: system/task_notification normalizes to woke-on status` · `M3: tool_progress
carries authoritative elapsed seconds` · `M7: meter percent equals occupancy/ceiling for 5%, 13%,
50%` · `M4/M5/M7 UI: mid-scroll stable, compact context row, meter fill, strip text` (Playwright).

Net −1. **Coverage actually lost:** `.thinking-card.is-redacted` and `overflow-wrap: anywhere` are
no longer asserted anywhere (`grep -rl` in `test/` → nothing), nor is `resize: none` / `.composer-gear`.
All three are still present in the CSS (2 / 3 / 1 occurrences), so nothing regressed — but the M6
carry-overs are now unguarded. Cheap to re-add as two assertions inside the surviving M6 case.
Everything the deletions covered on the M1 side *is* now asserted behaviourally
(`#prompt:not([disabled])`, `.delivery-chip.queued`, `.delivery-chip.sent`, `.context-row`).

## B. FIXLIST-R2 verification

| # | Verdict | How I verified |
|---|---------|----------------|
| 1 | **DONE, proven on the real door** | `writeFollowUpNow` (`cliAdapter.ts:1185`) writes immediately; `heldFollowUps` only on a failed write. My probe drove the **real adapter** against `scripts/gsd-cc-door.sh ollama-glm` (glm-5.3): mid-turn `enqueueFollowUp` at +15.0 s → **true**, and the seat answered **`SECOND-DELIVERED`** at +64.7 s in the same process, no respawn. Log: `probe-adapter-steer-r2.log.txt`. This also closes round 1's caveat (flash ignored the absorbed text; glm-5.3 acts on it). |
| 2 | **DONE, probed** | Same probe, after the run completed: `enqueueFollowUp` → **false**. `extension.ts:953-975` then notices the operator *and* pushes to `pendingFollowUps`, drained in `.finally()` **and** in the outer `catch` (FIX 11), via `startPendingFollowUp`, which reuses the existing bubble (`appendUser: false`) instead of duplicating it. The silent-swallow window is closed. |
| 3 | DONE | Context row is unconditional again (`workbench.js:519`); the hint stays non-compact. Asserted behaviourally and visible in the new frames. **But it is the 30 px that causes R2-1 below.** |
| 4 | **DONE, probed** | Two-phase chip. Probe sequence: `follow-up sent to seat` at +15.0 s (on the write) → `follow-up delivered` at +64.7 s, immediately before the assistant text. `awaitingFollowUpAck` also blocks the stdin close while a follow-up is outstanding. Chip can no longer claim delivery on a bare `write()`. |
| 5 | DONE | Pill prepended into `.conversation-compose-wrap` + `bottom: calc(100% + 8px)`; the UI test asserts `pillBottom <= wrapTop+1` and `overlapsStop === false`, and I ran it green. The test's DOM setup matches the live code (both prepend into the wrap) — checked, not assumed. |
| 6 | **DONE, fires on the real door** | `system/task_notification` → `status: "woke on: …"`. My probe: `woke on: Sleep for 60 seconds` at +63.3 s. Wording note: the strip renders `woke on: X finished`, giving "woke on: Sleep for 60 seconds finished". |
| 7 | DONE | `scroll-stability-…T17-26-09.json` now `before: 240, after: 240, delta: 0` at both viewports, and the test throws if `before < 1`. The vacuous 0→0 proof is gone. |
| 8 | **DONE, fires on the real door** | `tool_progress Bash 30` / `Bash 60` observed at +33.2 / +63.2 s; run clock now starts at send (`issueCommand`). |
| 9 | DONE, with the coverage note in §D | 5 grep cases out, 4 real ones in, incl. a Playwright case that measures scroll, ratio, meter fill and pill geometry. |
| 10 | **DONE but OVER-APPLIED → R2-2** | Door chip is one line with a title, and the stream now carries a 14 px top mask (the half-clipped glyph row is gone). But the ellipsis rules hit every chip: see R2-2. |
| 11 | DONE | Duplicate `.activity-strip` block merged; `patchActivityStrip` now patches the line/spinner/Stop in place instead of replacing the node each second; outer-catch drain added. |
| M7 | **DONE, measured off the frames** | CSP-safe `data-meter-fill` + `applyMeterFills` (CSSOM), called from `render()` and `patchContextMeter`. I measured the fill in the three proof PNGs: **38 / 96 / 370 px** for 5 / 13 / 50% — 7.6 / 7.38 / 7.40 px per point, i.e. proportional within subpixel rounding on a ~740 px track. The test independently asserts `|fill − percent| ≤ 1` and the `(N%)` label at all three. |

## Findings (round 2)

**R2-1 (BLOCKING, functional) — the Send/Queue button and the ⚙ are clipped off the bottom of the
pane at 1100×700 AND at 760×700.** Measured in the browser at `c8a84cd` (both widths identical):
viewport 700, `.send-button` bottom **710**, `.composer-gear` bottom **710**,
`.conversation-compose-wrap .composer` bottom **721**, wrap `max-height: 22%` (137 px) with
`overflow: visible`. The composer's content is 123 px starting at y=597, so 21 px hangs below the
fold and the primary control is unusable by mouse. Cause is arithmetic: FIX 3 restored the 30 px
context row *inside* a wrap whose cap was simultaneously tightened 26% → 22%
(`workbench.css:2552`). Round 1's build fit (93 px of composer, button fully inside the frame).
Note why no test caught it: the suite asserts `wrapShare <= 0.32` and `streamRatio >= 0.65`, both of
which stay true precisely *because* the overflow escapes the capped box. Fix: give the wrap
`max-height: 30%` (or `min-height: max-content` up to a cap) and assert
`send.bottom <= window.innerHeight` at both viewports.

**R2-2 (BLOCKING, legibility/safety) — all four meta chips are ellipsis-clipped and three carry no
`title`.** Measured `clipped: true` on every chip at both widths: `GLM 5.3 · Workbench seat` (title
present), `Ollama Cloud CC` (title present), **`Read only` → renders "R…" with NO title**,
**`GENERALSTAFF_ROOT` → "GEN…" with NO title**. At 760 the door chip drops out of the row
altogether again. The permission chip is the operator's read-only-vs-can-edit indicator — reducing
it to one letter is worse than the 4-line wrap it replaced. Fix: exempt `.permission-chip` and
`.root-chip` from the ellipsis rule (they are short by construction), keep the door chip's
`flex: 0 1 11rem`, and add `title` to both.

**R2-3 (non-blocking) — `tool_progress` is carried as a parseable jargon string.** The adapter emits
`status: "tool_progress Bash 30"` and the webview re-parses it with
`/^tool_progress\s+(\S+)\s+(\d+)/`. It also lands in `state.runStatus`, which is the activity strip's
fallback line — so a `tool_progress` arriving with no preceding `tool` event (resumed run, re-render)
would show Ray "tool_progress Bash 30 · 01:23". Carry the elapsed in a typed field
(`{type:'tool-progress', tool, seconds}`) or sanitise the fallback.

**R2-4 (non-blocking) — the `woke on:` branch is a loose net.** `normalizeCliLine` treats *any*
`type === 'system'` record with `record.status === 'completed'` as a wake-up even when the subtype
does not match, and `return`s, so such an event can never reach another handler. Require the subtype
match.

**R2-5 (non-blocking) — dead branch.** `cliAdapter.ts:1259-1261`: `else if (event.type === 'status'
&& event.text.startsWith('woke on:')) { /* comment only */ }` does nothing; delete it.

**R2-6 (non-blocking, carried) — the live channel still closes at the first idle turn boundary**, so
each follow-up after a completed round pays a fresh spawn (~25 k preamble) instead of the 1.1 s
same-process turn my probes measured. Round-1 FINDING 6, unchanged and still acceptable.

**R2-7 (non-blocking, test debt, mine to hand back)** — `scripts/render-m5-proofs.ts` still launches
chromium without `--mute-audio`, and the proof harness will hit the same pinned-revision wall on this
Mac; give it the same resolve-or-skip treatment as the test.

## Regression risk to Lanes/Desk

Unchanged from round 1 and still low: the R2 CSS touches `.meta-chips`, `.session-identity`,
`.message-stream`, `.conversation-compose-wrap`, `.composer.compact .context-row` and `.jump-latest`
only. `applyMeterFills` is additive and also runs on `patchContextMeter`, so the Lanes-side meter
(`.aux-view .lanes-context-meter`) keeps its fill. Full suite green, including the Lane-Desk
isolation and palette cases.
