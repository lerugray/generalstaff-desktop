# M3e round 3 — short list (orchestrator, s118 2026-09-14 08:3x EDT). Read REGATE-OPUS.md first.
CODE (all small, all required):
1. Scope the two meter rules `.lanes-context-meter` (css:1968) and `.lanes-context-copy` (css:1984) — named in REGATE-OPUS.md NEW-1 — so they apply ONLY inside the transcript/deck meter (e.g. nest under `.conversation-meta`, per the regate's own fix suggestion). The Lanes and Desk panes are ratified and must render byte-identically to publish-v23 (prove with a before/after PNG diff of each pane at 1440).
2. Delete the duplicate legacy meter block the regate names (css:2937-2990, two competing definitions of the same selector — that duplication is how NEW-1 bled).
3. `overflow-wrap: anywhere` (and `word-break` as needed) on card bodies, prose bubbles and the thinking card (`.thinking-card-body`/`.tool-card-detail`/`.tool-card-result`, css:1946-1956, NEW-4) so a 2,000-char unbroken token cannot widen a card past the pane (prove: a frame with such a token, card width == pane width).
4. `capPersisted` must clip on a rune boundary (same helper as clipOneLine) — NEW-3: `cliAdapter.ts:501`'s `value.slice(0, max-1)` currently reintroduces the MINOR-9 surrogate-split bug at the 8KB boundary. Test at a boundary where max lands mid-surrogate.
5. MINOR 9's test must FAIL on the unfixed code: use max=4 (odd UTF-16 boundary) per the regate — `clipOneLine('😀😀😀😀', 3)` at max-1=2 is an even offset and passes on old AND new code, so it proves nothing.
6. MINOR 5's test must read the ceiling from the REAL `scripts/gsd-cc-door.sh` (parse the exported CLAUDE_CODE_MAX_CONTEXT_TOKENS) and assert it equals the extension's constant; then make them agree — set the door to 1048576 (the one allowed door change) OR the extension to 1000000; pick 1048576 (Ollama's real window) and say so in REPORT.md.
7. Restore the deck's "Claude Code will compact at 200k unless the launcher states the window" explanation (NEW-2) — add it to `contextMeterTooltip` (workbench.js:118-135) when `meter.warn`, matching what `lanes.js` still has.

PROOFS (re-shoot the three the regate could not judge):
- G4: a 7-turn first screen where all 7 turns are visible (collapse the composer or scroll the pane before the shot, both viewports — 1440x900 and 1100x700 DPR2).
- G3: an expanded thinking card with REALISTIC multi-paragraph content (not a filler token like the 2125-char unbroken AAAA/EEEE run the round-2 fixture used).
- G2: a multi-line result that actually hits the 14rem scroll cap (show the scrollbar).

Check suite green (134+ with the new tests); REPORT.md updated; commit in coherent checkpoints; push your branch. Do not merge.
