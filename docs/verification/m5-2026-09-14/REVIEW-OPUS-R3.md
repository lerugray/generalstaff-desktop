# M5 — opus RE-GATE, round 3 (refute posture)

Gate run 2026-09-14 14:3x–15:0x EDT, Mac-Neo, worktree `scratchpad/m5-wt` @ `3c6d48b`
(round-2 gate commit `30c7529`). Reference: `REVIEW-OPUS-R2.md`.

## VERDICT: STOP — **0.4.18 must not be built or installed for Ray**

R2-1 and R2-2's main half are genuinely fixed and the suite is really green. But **R2-6 — a
NON-BLOCKING optimisation I explicitly listed as "carried, acceptable" — was implemented in a way
that breaks the run lifecycle**: a round never ends, so the seat never returns to "idle — your turn".
That is M3's MUST and the operator-visible half of the defect M5 exists to cure.

**One-line fix:** restore the idle-turn stdin close in `flushHeldFollowUps`
(`cliAdapter.ts`, the block deleted at `30c7529..3c6d48b` — `if (!turnBusy && !awaitingFollowUpAck
&& !stdinClosed …) child.stdin.end()`), and delete the grep-test that now forbids it
(`test/m5-seat-experience.test.ts`, `M1: live channel stays open across rounds (R2-6)`).

## A. Real counts (browser present)

`GS_CHROMIUM_EXECUTABLE=…/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`

- `test/m5-seat-experience.test.ts` alone: **11/11 pass, 0 skip**, 2.1 s — the Playwright block runs
  and the R2-1 assertion (`fit.sendBottom <= fit.innerHeight`, then the gear, at 1100×700 and
  760×700) passes for real.
- `npm test`: **148/148 pass, 0 fail, 0 skipped.** The harvester's "147/148 + 1 SKIP" was the
  browserless run; the skip is the resolve-or-skip guard I added in round 2 doing its job.

## B. R2-1 / R2-2 on the new frames — measured, not eyeballed

Live browser measurement at `3c6d48b`, both viewports identical:

| | desktop 1100×700 | sidebar 760×700 |
|---|---|---|
| `.send-button` bottom vs viewport | **694 ≤ 700** ✔ | **694 ≤ 700** ✔ |
| `.composer-gear` bottom | **694 ≤ 700** ✔ | **694 ≤ 700** ✔ |
| stream share of shell | 0.709 ✔ | 0.709 ✔ |

The `…T18-12-19` frames agree: the Send button is a complete rounded box with its bottom border
inside the pane, and the ⚙ is whole. **R2-1 fixed.**

Chips, measured (`scrollWidth > clientWidth`, `title`):

| chip | desktop | sidebar | title |
|---|---|---|---|
| `Read only` (permission) | not clipped ✔ | not clipped ✔ | present ✔ |
| `GENERALSTAFF_ROOT` | not clipped ✔ | not clipped ✔ | present ✔ |
| `Ollama Cloud CC` (door) | clipped, titled | **not rendered at all** (box 0,0,0,0) | present |
| `GLM 5.3 · Workbench seat` | clipped, titled | clipped to ~"Gl", titled | present ✔ |

**R2-2's safety half is fixed** — the permission and root chips read in full at both widths, which was
the blocking part. Two residues, both non-blocking (hover recovers each):

- **R3-1 (new, visual): the chip row overflows its container and collides with the meter at 760.**
  `.meta-chips` measures l=307→r=440, but the root chip runs to r=504 while
  `.conversation-meta .lanes-context-meter` starts at l=452 — a **52 px overlap**, visible in the
  sidebar frames as the root chip disappearing under the meter bar. Exempting the chips from
  ellipsis removed their shrink without giving the row room. Fix: `flex-wrap: nowrap` +
  `min-width: 0` on the row with the *seat-name* chip as the only shrinkable member, or give the
  meter `flex-shrink: 0` and the row the remainder.
- **R3-2 (carried): the door chip still vanishes at 760** and the seat chip is down to ~2 glyphs.

## C. R2-3 … R2-7 spot-check (`30c7529..3c6d48b`)

- **R2-3 DONE.** `normalizeCliLine` now emits `` `${tool} · ${seconds}s` `` (e.g. `Bash · 30s`), and
  the webview sets the strip fallback to the same human string instead of the jargon form. Probed
  live in round 2's successor run: the string reaching the UI is plain words.
- **R2-4 DONE.** The bare `record.status === 'completed'` escape hatch is gone; a task-notification
  subtype is now required, with a test asserting a `status:completed` record does **not** claim the
  wake branch.
- **R2-5 DONE.** The empty `else if (… startsWith('woke on:'))` branch is deleted.
- **R2-6 IMPLEMENTED, AND IT IS THE STOP.** See below.
- **R2-7 DONE.** `scripts/render-m5-proofs.ts` gained the same resolve-or-skip + `--mute-audio`
  treatment as the test.

### R2-6 — why "keep the channel open" broke the seat

`flushHeldFollowUps` no longer ends stdin at an idle turn boundary, so the door process never exits.
`runCliAdapter`'s `completed` promise resolves on `child.once('close')`, and `extension.ts` deletes
`activeRuns` only in that promise's `.finally()`. Nothing else signals the end of a round.

**Probed against the real door** (`scripts/gsd-cc-door.sh ollama-glm`, same adapter path as the
Workbench; log `probe-lifecycle-r3.log.txt`): prompt "Reply exactly PING", assistant text and
`turn-boundary` at **+3.0 s**, then **no completion for 70 s** with `claude -p … --input-format
stream-json` still resident (PID confirmed, killed by PID). Consequences, all operator-visible:

1. The strip never flips to **"idle — your turn"** (M3 MUST) — Ray sees a live spinner forever.
2. The send button stays labelled **"Queue"**; the composer never returns to its idle placeholder.
3. The run's receipt/evidence is never written, and `pendingRuns`/`activeRuns` never clear, so Stop
   becomes the only way to end a round.
4. The process leaks per conversation until Stop.

The steering channel itself keeps working — that is the point of the change — but the cost is the
whole round-completion signal. Round 2 marked this item **non-blocking and acceptable as-is**; the
correct version decouples "round over" from "process exited" (emit idle on `turn-boundary`, keep the
child, close on dispose or an idle timeout) — a design change, not a round-3 tweak. Until then,
revert.

**Aggravating: the new test locks the regression in.** `M1: live channel stays open across rounds
(R2-6)` is a **source grep** — `assert.ok(!/Round complete and nothing queued/.test(src))` plus a
match on the new comment — i.e. exactly the anti-pattern rounds 1 and 2 removed, and it asserts the
*absence* of the correct code. Whoever fixes the lifecycle will be told by a green-suite rule to
re-break it. Delete it with the revert.

## D. The two superseded assertions

1. **`deepEqual([{status:'tool_progress Bash 90'}])` → `[{status:'Bash · 90s'}]` — legitimate.**
   Same strength (exact deepEqual on the emitted event), and it tracks R2-3, which I asked for. The
   webview parses both forms. Accept.
2. **`maxHeight` regex `/2[0-9]%|\d+px/` → `/(?:2\d|30)%|\d+px/` — legitimate but now decoration.**
   It widens the allowed cap to accommodate the R2-1 layout fix; the computed value I measured is
   still `22%`, so the widened alternative is never exercised. The real guarantee is the new
   `sendBottom <= innerHeight` / `gearBottom <= innerHeight` pair, which is strictly stronger than
   any cap pattern. Accept; consider dropping the maxHeight match entirely.

Neither supersession weakens a MUST.

## Everything else re-confirmed at `3c6d48b`

Items 1-5, 7-11 and M7 all still hold (round-2 evidence unchanged; the R3 diff does not touch the
steering write path, the chip flips, the pill anchor, the scroll harness or the meter fill).
`scroll-stability-…T18-12-19.json` again reports `before: 240, after: 240, delta: 0` at both widths.
Fence clean: no `scripts/` change in gs-private, no version bump, no VSIX.

## Processes

Every process this gate started was killed by PID (`27860`, `27879`); no pattern kills, no browser
launched outside the muted headless harness. Two scratch measurement scripts were written into
`workbench-extension/scripts/` and deleted; the only worktree modification left is round 2's
test-harness fix.
