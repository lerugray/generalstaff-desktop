# M3e round 2 — fix list (orchestrator, s118 2026-09-14 08:0x EDT)
Read REVIEW-OPUS.md (12 findings) and LOOK-OPUS.md (6 defects, 7 proof gaps) in this directory. Fix ALL of the following; the check suite must stay green and every fix below that names a test must add one that FAILS on the current code and PASSES after.
MUST (blocks install):
- REVIEW MAJOR 1: tests for deliverables 3 and 4 that exercise extension.ts's real bubble/correlation path — the mutants `needsNewBubble = false` and "break tool_use_id correlation" must each fail at least one test.
- REVIEW MAJOR 2: priorContext must hand the seat the same number of EXCHANGES as before M3e (count exchanges, not messages) — test with a 7-message run.
- REVIEW MAJOR 3: decision-card extraction must not duplicate text across blocks of one turn — test with a text→tool→text turn.
- LOOK D1: an EXPANDED tool card shows the FULL result (newlines preserved, scroll-capped at the existing 14rem) — clipOneLine applies to the collapsed line only; test + proof frame of a multi-line git log result expanded.
- LOOK G5: the meter tooltip must be a real element (hover card in the Workbench register), not a native `title=` attribute; proof frame of the real element.
- LOOK D2 + D3: thinking cards visually distinct from tool cards (different leading glyph/colour token, not just the word), and a visible expand affordance (chevron) on every collapsible card.
SHOULD (do in the same run):
- REVIEW MINOR 4 (output-only usage must not zero occupancy), 5 (the extension reads the ceiling from the SAME constant/env the door exports — add a test that fails if they diverge), 7 (redacted_thinking rendered as a collapsed placeholder, never dropped), 8 (cap persisted tool detail at 8 KB), 9 (clip on a rune boundary), 10 (post only the delta per turn), 12 (log errors from the event chain to the output channel).
- LOOK D4 (collapsed summary in mono), D5 (assistant prose gets its own contained bubble so hierarchy reads prose > cards), D6 (meter wide enough that the label never wraps at 1100px).
PROOFS (regenerate all, DPR 2, two viewports 1440x900 and 1100x700): first screen with 7 turns visible in order; an expanded multi-line tool result; an error-state tool card; an expanded thinking card; the real tooltip element; the meter at 14%. Update REPORT.md with before/after tallies, the mutant results (M2, M3 now failing), and the VSIX 0.4.17 sha256 (rebuild it; do not commit the .vsix).
FENCE unchanged: no seat additions, no door script changes beyond the ceiling constant, deck/Lanes/Desk/Sessions untouched, no new deps.
