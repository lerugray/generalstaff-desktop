# M5 — opus HARVEST + RE-GATE, round 4 (refute posture)

Gate run 2026-09-14 15:0x–15:4x EDT, Mac-Neo. Worktree `scratchpad/m5-wt`, fetched
`origin/cursor/m5-seat-experience-785d`, checked out **`0e75a55`** (round-3 gate base `d7fda8e`).

## VERDICT: SHIP — **0.4.18 may be built and installed for Ray's eyes**

Both hard blockers are gone and I proved each on the real door, not from the diff. One residue, new
this round and in the very row round 4 was sent to fix, is the top R5 item: the seat-identity chips
now collapse to two glyphs at BOTH widths. It costs Ray no control and no session — it is exactly
what his eyes are the gate for — so it does not hold the install.

## 1. Harvest

Two commits: `568f5c0` *fix(m5-r4): restore idle stdin.end + chip/meter layout at 760* and `0e75a55`
*test(m5-r4): harden queued follow-up lifecycle door harness*. Diff-stat `d7fda8e..0e75a55`:
`media/workbench.css` +28/-…, `src/adapters/cliAdapter.ts` +15/-…, `test/m5-seat-experience.test.ts`
+197 — 3 files, 226 insertions. **Fence clean:** every changed path is under `workbench-extension/`;
nothing in `docs/`, nothing in gs-private `scripts/`, no version bump, no VSIX.

## 2. Real count

`npm test` with `GS_CHROMIUM_EXECUTABLE=…/chromium_headless_shell-1243/…/chrome-headless-shell`,
`timeout -k 10 600`: **149/149 pass, 0 fail, 0 skipped.** (148 at R3 + 2 new lifecycle cases − the
deleted grep case.)

## 3. The R3 regression — fixed, and proven on the real door

**Code.** The idle-turn close is back in `flushHeldFollowUps` (`cliAdapter.ts:1207-1218`) with the
right guards — `!turnBusy && !awaitingFollowUpAck` — so a queued follow-up is still written before
the close. The comment now records why the open-forever version was wrong. The grep-test
`M1: live channel stays open across rounds (R2-6)` is **gone** (`grep` → no match), so nothing
pressures a future round to re-break it.

**New behavioural tests (they would have caught R3).** `M1: idle seat with nothing queued completes
within 5s (R4 lifecycle)` and `M1: queued follow-up delivers then round completes (R4 lifecycle)`
both drive the real `runCliAdapter` against a stub door via `installFakeDoor` and race
`run.completed` against a 5 s timeout, asserting the `complete` event, the `follow-up sent to seat`
status, and delivery (ack or a second turn-boundary) before the round ends. Only one `readFileSync`
remains in the whole file — the grep era is over.

**Real-door probe** (`scripts/gsd-cc-door.sh ollama-glm-flash`, extension argv, via `runCliAdapter`;
log `probe-lifecycle-r4.log.txt`):

- **A — idle run completes.** `Reply exactly PING`: assistant text and `turn-boundary` at +5.1 s,
  `complete` at +5.3 s — **0.16 s from turn-boundary to completion** (R3 never completed at all).
  `receipt.exitCode 0`. The completion is what clears `activeRuns` and posts the non-streaming
  delta, which is what sets `runLive.phase = 'idle'` and renders **"idle — your turn"** (that strip
  text is asserted by the M3 case and visible in every idle proof frame).
- **B — queued mid-turn, delivered, then completes.** `sleep 45` + enqueue at +12 s:
  `enqueueFollowUp` → **true** and `follow-up sent to seat` at +17.3 s · `Bash · 30s` (plain-words
  progress, R2-3) at +37.4 s · `woke on: Sleep for 45 seconds as requested` (R2-4 producer) at
  +52.5 s · **`follow-up delivered`** at +54.8 s · assistant **`SECOND-DELIVERED`** at +54.8 s ·
  `turn-boundary` +54.9 s · **`complete` +55.0 s**. Steering and the lifecycle now both hold in one
  run, on one process, with no respawn.

## 4. At 760 — measured, and my own R3 claim corrected

Live measurement at `0e75a55`, plus my own captures at both widths (round 4 shipped no new frames).

| | 1100×700 | 760×700 |
|---|---|---|
| `.send-button` / `.composer-gear` bottom vs viewport | **694 / 694 ≤ 700** ✔ | **694 / 694 ≤ 700** ✔ |
| chip row painted over the meter? | **no** | **no** |
| `Read only` (permission) | full, titled ✔ | full, titled ✔ |
| `GENERALSTAFF_ROOT` | rendered, right border shaved ~9 px | clipped away entirely |
| seat name / door | **"Gl" / "Ol"** | **"Gl"** / absent |

**Correction to my own round-3 finding.** I reported a "52 px overlap" of the root chip with the
meter from `getBoundingClientRect` alone. `.meta-chips` carries `overflow: hidden`, so the excess is
**clipped, never painted** — there is no collision at either width, in R3 or R4. The rect metric was
the wrong reference; the captures settle it. The real defect was always *clipping*, and it remains.

**R5-1 (top follow-up, not blocking).** Round 4 applied exactly the fix I recommended — nowrap,
`min-width: 0`, seat chip the only shrinkable member, `flex-shrink: 0` on the meter — but then also
pinned the meter to `max-width: 14rem` / `width: min(42%, 14rem)` and set every other chip to
`flex: 0 0 auto`. Net effect: the two *model-identity* chips absorb all the shrink and collapse to
two glyphs at deck width, where R2 still read "GLM 5.3…" / "Ollama Cloud …". On a Workbench whose
thesis is "the same experience, other models", the operator can no longer read which model or door
the seat is on without hovering. Fix: let the *session blurb* shrink first (it is already
`max-width: 40%`), give the seat chip a `min-width` floor of ~7rem, and drop the root chip to a
short glyph or move it into the ⚙ popover at < 900 px.

**R5-2 (carried).** The door chip is still absent at 760 and the root chip's right border is shaved
at 1100.

## 5. Anything beyond the brief

Nothing out of scope. The CSS touches only `.conversation-meta`, `.session-identity`, `.meta-chips`
and `.conversation-meta .lanes-context-meter` — the row it was sent to fix. The adapter diff is the
stdin block and its comment, nothing else. The test diff adds the fake-door harness
(`installFakeDoor` / `fakeLane` / `raceComplete`) and the two lifecycle cases, and removes the grep
case. No new dependency, no Lanes/Desk change, no `scripts/` change, no version bump.

## Everything else re-confirmed at `0e75a55`

Items 1-11 and M7 hold; R2-3/4/5/7 unchanged and R2-3 and R2-4 were both observed firing on the real
door in probe B. `scroll-stability-…T18-12-19.json` still `before: 240, after: 240, delta: 0`.
Steering, the two-phase chip, the pill anchor, the meter fill and the 70.9 % transcript share are all
untouched by this round's diff.

## Processes

Probe PID `30307` exited on its own and was confirmed gone; a live door-process count of `0` was
verified after the run. No pattern kills. Two scratch measurement scripts were written under
`workbench-extension/scripts/` and deleted; the checkout is otherwise clean.
