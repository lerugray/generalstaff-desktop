# M5 — opus LOOK at the round-2 frames (refute posture)

Viewed 2026-09-14 by the gate: the seven `…2026-09-14T17-26-09.png` frames (four seat frames DPR 2 =
1100×700 and 760×700 logical, three meter frames at 5 / 13 / 50%). Geometry claims below are either
measured in original frame pixels or measured live in the browser at `c8a84cd` — none are eyeballed.

## VERDICT: PASS-WITH-DEFECTS → **do not put this build in front of Ray**

Round 1's five look defects are all genuinely fixed. Round 2 broke the one control Ray touches first.

## Fixed since round 1 (verified, not taken on trust)

1. **The jump pill is clear of the strip and of Stop.** In both idle frames it now sits above the
   "idle — your turn" strip with daylight between them. Confirmed by the behavioural assertion
   (`pillBottom <= wrapTop + 1`, `overlapsStop === false`) which I ran green against a real browser.
2. **The half-clipped glyph row at the top of the transcript is gone** — the 14 px mask means the
   first visible line now fades instead of being sliced under the meta border. "Re-issuing as a
   single command." reads cleanly in the live desktop frame.
3. **The door chip no longer breaks the meta row.** One line, ellipsis, full label on hover.
4. **"＋ Reference local files" is back in the chat composer** (visible in all four seat frames) —
   round 1's capability regression is closed.
5. **M7 reads correctly.** I measured the fill bar in the three meter PNGs: **38 / 96 / 370 px** at
   5 / 13 / 50% on a ~740 px track — 7.6 / 7.38 / 7.40 px per point, proportional within subpixel
   rounding, and the label on each frame states the same number.
6. Still good from round 1: one-row composer, gear popover, no select wrap, "idle — your turn",
   Queue/Send label swap, strip reading `Bash · sleep 150 · 00:00 · run 00:00`, transcript share
   (measured live: stream 441 px of a 622 px shell = **70.9%** at both widths).

## Defects

1. **The Send/Queue button is CUT OFF at the bottom of the pane — both widths.** Plainly visible in
   the sidebar idle frame (the button's bottom border and the ⚙'s lower half are sliced by the pane
   edge) and in the desktop live frame. Measured live: viewport 700, send-button bottom **710**,
   gear bottom **710**, composer bottom **721**, wrap capped at 137 px with `overflow: visible`.
   This is the first thing Ray will do — type, then reach for Send — and the target is 10 px off
   screen. Cause and fix in `REVIEW-OPUS-R2.md` R2-1 (the restored 30 px context row inside a cap
   tightened 26% → 22%).
2. **The meta chips are now shredded.** Desktop reads `GLM 5.3…` · `Ollama Cloud …` · **`R…`** ·
   `GENER…`; the sidebar reads `GLM …` · `R…` · `GEN…` with the door chip dropped entirely. Every
   chip measures `clipped: true`, and the two most load-bearing — the **permission** chip ("Read
   only" → "R…") and the repo-root chip — carry **no `title`**, so hovering recovers nothing. A
   one-letter permission indicator is a worse failure than the four-line wrap it replaced: Ray
   cannot see at a glance whether the seat may edit his repo.
3. **The pill now overlays transcript content instead of the strip.** In the sidebar idle frame it
   covers the "1m ago" timestamp of the last assistant turn. Correct by design (it is an overlay)
   and much better than covering Stop, but worth 8 px of right-side inset.
4. **Both strip clocks still read `00:00` in the live frames.** The clocks demonstrably tick — I
   watched `tool_progress Bash 30` / `Bash 60` arrive from the real door — but no frame evidences it.
   One capture at t+60 s would close this for good.
5. Cosmetic, carried: the left rail still truncates to "Orchestr…" / "Live seat ·…" at 760.

## Not found (checked for, absent)

No overlapping message text, no clipped bubbles anywhere in the transcript, no wrapped composer row,
no select spill, no horizontal scrollbar at 760, and no stale meter — the fill and the label agree in
all three meter frames.
