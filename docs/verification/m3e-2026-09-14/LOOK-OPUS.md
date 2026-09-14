LOOK: PASS-WITH-DEFECTS
DEFECTS: 6

M3e LOOK seat — branch `cursor/m3e-meter-and-render-cc0c` (b7390a5 on 72eefaf/publish-v23).
Adversarial read of the four delivered PNGs, plus regenerated frames and DOM/CSS measurements
where a PNG could not settle a claim. Isolated worktree, removed at end. Nothing on the branch
was modified or committed.

---

## What is actually right (checked, not taken from the report)

- **The headline bug is fixed.** The strip reads `140.6k / 1M (14%)` — occupancy, not the old
  cumulative 91%. The bar is honest: track measures 178 device px, fill 26 device px = **14.6%**
  against a stated 14%.
- **13% vs 14% is not an error.** The brief is internally inconsistent — deliverable 1 says 13%
  (÷1,048,576), deliverable 2 says read the value the door exports (1,000,000 → 14%). The lane
  followed deliverable 2, the controlling one. Correct call.
- **Per-turn bubbles verified beyond the proof.** DOM enumeration of `.message-stream` children:
  1 user + **7 assistant** messages, each `message assistant complete` carrying exactly 1 tool
  card, 1 thinking card (6 of 7), 1 prose body, in order, then the receipt. Deliverable 4 holds
  across all seven turns, not just the two the PNG shows.
- **Error-state tool card is implemented and exercised** — 1 of the 7 cards carries
  `.status-error`; summary renders in iron-red: `Bash · git status --short && git log --oneline -3 · error`,
  body `Bash contains multiple operations and was refused by policy.` Legible, on-register.
- **Numbers are readably formatted** (k-suffix throughout: 140.6k, 132.5k, 1M).
- **The webview path in the proofs is real** — the harness serves the actual `media/workbench.js`
  and `media/workbench.css` and posts a real `state` message. The transcript pixels are the
  product's renderer, not a mock.

## Cleared after checking — do NOT log these as M3e defects

- **The 760px floor is inherited, not M3e.** `body { min-width: 760px }` at
  `media/workbench.css:225` is **byte-identical on base `72eefaf`**. Measured overflow
  (docScrollWidth vs clientWidth): 360px→400 over, 500→260, 600→160, 700→60, **800+→0**.
- **…and the narrow side-bar case does not apply to this surface.** The deck/transcript is
  `createWebviewPanel(…, ViewColumn.One)` — an **editor tab** (`src/extension.ts:83-86`). Only
  Lanes and Desk are side-bar views (`registerWebviewViewProvider`, secondary sidebar), and M3e's
  scope fence leaves them alone. The M3d 360px concern belongs to those, not here. A split editor
  below 760px does cut the meter and message right edges, but that is a pre-existing global floor.
- **The composer does not occlude the transcript.** `.composer { position: relative; z-index: 1 }`
  is in flow and `.message-stream` carries `padding: 25px 8px 35px`. The mid-glyph slice through
  `Read · <repo>/docs/handoffs/latest-session-note.md · ok` in `m3e-transcript-first.png` is the
  scroll-viewport edge in a top-scrolled state, not an overlap bug. Polish note only: there is no
  fade/scrim at that boundary, so the half-height glyph row reads as a rendering artifact at a
  glance — the exact impression this milestone exists to remove.

---

## Defects

**D1 — Tool results are flattened to one line and capped at 120 chars; "expanded" never shows the
full result.** `clipOneLine()` (`src/adapters/cliAdapter.ts:490-494`, called at :549, :561, :565)
runs `value.replace(/\s+/gu, ' ').trim()` then slices to 120 — every newline becomes a space.
Visible in `m3e-tool-card-expanded.png`: two `git log --oneline` rows render as one run-on line,
`aaa1111 chore: rebuild package bbb2222 docs: handoff notes`. Deliverable 3 asked for "expanded =
full command and result, scroll-capped". The CSS is already correct and ready —
`.tool-card-result { white-space: pre-wrap; max-height: 14rem; overflow: auto }`
(`workbench.css:1896-1912`) — but it can never fire, because the data is destroyed upstream. The
scroll-cap is dead code for results. This is multi-line tool output still reading as a run-on
string: the original "cryptic output" complaint, one layer down.

**D2 — Thinking cards and tool cards are pixel-identical.** `workbench.css:1869-1876` puts
`.thinking-card, .tool-card` in a single rule block: same `1px solid var(--line)`, same 4px
radius, same `rgb(var(--surface-2-rgb) / 0.35)` fill, same 12px size, same `--paper-muted` ink.
Confirmed on the first screen — `Thinking · 691 chars` and `Bash · ls -la docs/handoffs | head -20 · ok`
differ only in their leading word. Distinct from prose: yes. Distinct from tool cards: **no.**

**D3 — No disclosure affordance in the collapsed resting state.** `summary { list-style: none }`
plus `::-webkit-details-marker { display: none }` (`workbench.css:1878-1889`) suppress the
triangle with no replacement chevron or glyph. The only affordances are `cursor: pointer` (hover)
and a `border-bottom` that appears *after* opening. Nothing on screen tells a first-time user that
any of these cards expand — against the milestone's own first-time-legibility goal.

**D4 — The collapsed summary is set in the prose face, not mono.** The summary inherits the card's
12px proportional face; only the expanded body uses `SFMono-Regular, Consolas, monospace` at 11px.
So the line the operator actually reads most of the time renders `ls -la docs/handoffs | head -20`
in a serif/sans. The brief said "This is the Claude Code desktop shape; match it" — desktop sets
the command in mono.

**D5 — Assistant prose is the only uncontained element in its own turn.** The user turn gets a
filled, bordered bubble; an assistant turn gets a header row, then bare prose on the page ground,
sandwiched between two bordered cards. The model's actual words are the least-emphasised thing in
the turn, and read as a caption between two boxes. Hierarchy is inverted relative to Claude Code
desktop, where prose is primary and cards are secondary/indented.

**D6 — The meter is very small and its label wraps even at 1100px.** Track measures 178 device px
= **89 CSS px wide × ~2 CSS px tall**; fill 13 CSS px. The label breaks to two lines
(`140.6k / 1M` / `(14%)`) at the proof's own width. At a glance the bar reads as a stray dash
rather than a gauge.

---

## Proof gaps (capability exists or is untested — not defects)

- **G1** No frame shows the **error-state tool card**, though the fixture contains one (1 of 7).
  I generated it: `scratchpad/lookerr/tool-card-ERROR.png`. It is fine.
- **G2** No frame shows a **long result being scroll-capped** — and none can, because of D1.
- **G3** No frame shows an **expanded thinking card**. "Never dropped, click to expand" is
  visually unproven; `m3e-thinking-collapsed.png` is a 1492×76 strip of the summary only.
- **G4** No frame shows **more than two assistant turns**; the fixture has seven. Closed by my DOM
  enumeration above.
- **G5** **The tooltip PNG is a harness mock.** `.meter-tooltip-proof` is defined only in
  `scripts/render-m3e-proofs.ts:213` and appears nowhere in `media/`. The shipped tooltip is a
  native `title=` attribute (`media/workbench.js:148`) — OS chrome, ~1s hover delay, system font,
  outside the Kriegspiel register entirely. The *content* is genuine (the script reads the live
  `title`), but the designed-looking box in the PNG does not exist in the product.
- **G6** The proof **re-derives the per-turn grouping** in `buildConversationFromFixture` rather
  than exercising `extension.ts:659-663`, which is where deliverable 4 actually lives. The
  webview/CSS half is real; the grouping half is the harness's own.
- **G7** **One viewport only** (1100×900 DPR2). No narrow or split-editor frame. Closed by my
  360/700px renders and the overflow-threshold measurement above.

---

## Recommendation

**Fix first, then install.** Three small, local changes, all inside the transcript pane:

1. **D1 (the one that matters):** stop flattening tool results. Keep `clipOneLine(…, 120)` for the
   *collapsed summary* preview only; pass the result through with newlines intact for the expanded
   body and let the existing `white-space: pre-wrap` + `max-height: 14rem; overflow: auto` do the
   scroll-capping the brief asked for. Then regenerate a proof with a genuinely long, multi-line
   result so G2 closes.
2. **D2/D3:** give `.thinking-card` its own treatment (dimmed/italic summary, or no fill) and add a
   visible chevron to both card types.
3. Ship D4–D6 as polish in the same pass if cheap; none of them block.

Everything else in M3e is sound, and the 91%→14% correction — the reason the milestone exists —
is real and correctly implemented.
