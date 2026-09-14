# M5 — opus LOOK at the four proof frames (refute posture)

Viewed 2026-09-14 by the gate, all four PNGs opened directly (not described by a worker). Frames are
DPR 2: `2200×1400` = 1100×700 logical, `1520×1400` = 760×700 logical. Geometry below is in **original
frame pixels**; logical = ÷2.

## VERDICT: PASS-WITH-DEFECTS

The four things Ray complained about are visibly fixed: the composer is one row, the selects are
behind a ⚙, the transcript owns the pane, and a live strip says what the seat is doing. Two defects
are functional (1, 2); the rest are cosmetic.

## What passes

- **Live strip reads clearly** at both widths: `⟳ Bash · sleep 150 · 00:00 · run 00:00` with a Stop
  button at the right end. Tool name + command + per-call clock + run clock, one line, no wrap at 760.
- **Idle state reads exactly "idle — your turn"** in both idle frames, the send button reverts
  `Queue → Send`, and the placeholder reverts `Steer the seat… → Message the orchestrator…`. Asked
  for and delivered.
- **Composer is ONE row** at both widths — textarea single line, then a footer row holding only the ⚙
  and the send button. The five selects are collapsed; nothing wraps at 760. Compose-wrap is ~267 px
  (133 logical) ≈ 19% of the pane.
- **Transcript height, measured off the frame, not the DOM:** stream top (meta border) 253 px, stream
  bottom (strip top) 1133 px = **880 px of a 1246 px shell = 70.6%** at 1100×700; the sidebar frame
  measures the same. Meets the ≥70% MUST.
- **Meter/context row is legible:** `140.6k / 1.05M (13%)` at 1100 and `140k / 1.05M (13%)` at 760,
  both readable at 100%.
- **Delivery chip is legible** in both live frames: `QUEUED — DELIVERED AFTER THE CURRENT TOOL CALL`
  in small caps inside the operator bubble. (Its *truthfulness* is a code finding, not a look one —
  REVIEW-OPUS FINDING 4.)

## Defects

1. **The "↓ jump to latest" pill sits ON the activity strip — and covers Stop.** Both idle frames
   show the pill's rounded box drawn over the strip's top and right borders, extending past the
   strip's right edge. `workbench.css:2611-2615` hard-codes `position:absolute; right:18px;
   bottom:110px`, and the compose-wrap is ~133 logical px tall, so the pill lands inside it. The
   strip's right end is where **Stop** lives while a run is live, and the pill only appears when the
   operator has scrolled up — i.e. precisely mid-run, reading back. Geometry: pill left edge ≈ 1969 px
   (984 logical) vs Stop centred ≈ 2053 px (1026 logical) — overlap. Anchor the pill above
   `.conversation-compose-wrap` (or inside the stream), not at a fixed offset.
2. **The lane/door chip is unreadable at 1100 and GONE at 760.** At 1100 "Ollama Cloud CC door" wraps
   to four stacked words in a chip whose box grows *through* the `.conversation-meta` bottom border
   (verified on a 2× crop: the rule passes between the chip's side borders while the chip continues
   below it). At 760 the chip is not rendered at all — the operator cannot see which door the seat is
   on, which is the single most load-bearing fact in the row. Likely pre-existing M3e chrome rather
   than an M5 regression (M5 only rescoped the meter), but Ray sees it in these frames, so it is on
   the list. Fix: one-line the chip (`Ollama Cloud CC`), or `white-space:nowrap` + ellipsis + title,
   and let the row shrink the *session blurb* instead.
3. **A half-clipped glyph row sits at the stream's top edge.** In both live frames the first visible
   transcript line is cut horizontally ("Re-issuing as a single command." at 1100, a bare "d." at
   760) immediately under the meta row's border. It is ordinary scroll clipping — `.conversation-meta`
   has no background and is not sticky, so nothing is overlapping anything (I checked the CSS before
   asserting an overlap, and there is none) — but with a hard border directly above it, it reads as a
   rendering fault. A 12-16 px top mask/fade on the stream removes the impression.
4. **Both strip clocks read `00:00` in the live frames.** Correct for a frame captured at injection,
   so not a defect *in the frame* — but it means the frames do not actually evidence that the clocks
   tick, and the code walks the run clock from the first tool event rather than from send
   (REVIEW-OPUS FINDING 4). A second frame at t+90 s would have proven the MUST outright.
5. **Cosmetic, sidebar only, pre-existing:** the left rail truncates to "Orchestr…" / "Live seat ·…",
   and the meter's bar track runs to the frame's right edge with no gutter.

## Not found (checked for, absent)

No overlapping message text, no clipped bubbles, no clipped button labels, no wrapped composer row,
no select spill, no text outside a box anywhere but item 2, and no horizontal scrollbar at 760.
