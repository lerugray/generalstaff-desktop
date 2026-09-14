# M3e verification report — Round 2 (2026-09-14)

Branch: `cursor/m3e-meter-and-render-cc0c`. VSIX rebuilt, not installed. Do not merge.

## Check-suite tally

| | tests | result |
|---|---|---|
| Before M3e (M3d baseline) | 118/118 | green |
| After M3e Round 1 | 124/124 | green |
| After M3e Round 2 (`FIXLIST-R2.md`) | 134/134 | green (`npm run check`) |

Round 2 adds 10 tests in `workbench-extension/test/m3e-r2-fixlist.test.ts`.

### Test titles

- MAJOR 1: reduceRunEventsToTurns yields 7 bubbles and 7 id-matched tool cards from the fixture
- MAJOR 1 mutant needsNewBubble=false collapses to one bubble (must fail this test)
- MAJOR 1 mutant first-tool-wins correlation mismatches tool ids (must fail this test)
- MAJOR 2: priorContext counts exchanges, so a 7-bubble run costs one slot
- MAJOR 3: decision text applies to the first text block only on text→tool→text turns
- LOOK D1: expanded tool result keeps newlines; clipOneLine is collapsed-only
- MINOR 4: output-only usage does not become assistant occupancy
- MINOR 5: CC_DOOR_STATED_CONTEXT_TOKENS matches the checked-in door export snippet
- MINOR 7: redacted_thinking becomes a collapsed thinking placeholder
- MINOR 8+9: tool detail is capped and clipOneLine respects rune boundaries

Fixtures: `test/fixtures/glm-catchup-m3e.jsonl`, `test/fixtures/gsd-cc-door-ceiling.env`.

## Mutants (REVIEW)

| Mutant | Round 1 | Round 2 |
|---|---|---|
| M1 — result envelope emitted as context-usage again | fails D1/D5 (as required) | still fails (unchanged) |
| M2 — `needsNewBubble` forced false / turn ids collapsed | **124/124 green (escaped)** | **caught** by MAJOR 1 mutant test |
| M3 — tool correlation → first tool card wins | **124/124 green (escaped)** | **caught** by MAJOR 1 mutant test |

Helpers in `src/services/runTranscript.ts`: `needsNewBubble`, `findToolBlockForResult`, `reduceRunEventsToTurns`, `applyDecisionTextToBlocks`, `buildPriorContextTranscript`, `countExchanges`. `extension.ts` calls the same helpers.

## MUST (FIXLIST-R2)

1. **REVIEW MAJOR 1** — Pure reducer path + mutants above.
2. **REVIEW MAJOR 2** — `buildPriorContextTranscript` / `countExchanges` count **exchanges**, not raw messages; a 7-bubble catch-up run costs one exchange slot.
3. **REVIEW MAJOR 3** — `applyDecisionTextToBlocks` writes decision prose into the **first** text block only (text→tool→text safe).
4. **LOOK D1** — Expanded tool card shows full `result` (newlines preserved, 14rem scroll); `clipOneLine` is collapsed-only. Proof: `proof-tool-expanded-multiline-*.png`.
5. **LOOK G5** — Meter tip is a real `.lanes-context-hovercard` (no `title=` on the meter). Proof: `proof-meter-tooltip-real-*.png`.
6. **LOOK D2 + D3** — Thinking cards visually distinct (dashed border + thinking glyph); tool cards use tool glyph; every collapsible has a visible `.card-chevron`. Proof: `proof-thinking-expanded-*.png`.

## SHOULD

- **MINOR 4** — Output-only usage rejected (no occupancy zero).
- **MINOR 5** — `CC_DOOR_STATED_CONTEXT_TOKENS` matches the checked-in door snippet (`1_000_000`).
- **MINOR 7** — `redacted_thinking` → collapsed thinking placeholder.
- **MINOR 8 + 9** — Tool detail capped at 8 KB; `clipOneLine` on rune boundaries.
- **MINOR 10** — Mid-run bubble split posts the affected conversation only (not the full store).
- **MINOR 12** — Event-chain errors go to the OutputChannel + notice (no silent swallow).
- **LOOK D4–D6** — Mono collapsed summaries; assistant prose in `.assistant-bubble`; meter wide enough at 1100px.

## Occupancy arithmetic (unchanged)

- Peak occupancy **140,628** → **14%** of door ceiling **1,000,000** (13% of 1,048,576).
- Preamble **132,479**; added **8,149**.
- Cumulative session spend **957,944** (old 91% bug) — meter no longer uses it.

## PNG proofs (DPR 2, viewports 1440×900 and 1100×700)

- `proof-meter-14pct-1100.png`
- `proof-meter-14pct-1440.png`
- `proof-meter-14pct.png`
- `proof-meter-tooltip-real-1100.png`
- `proof-meter-tooltip-real-1440.png`
- `proof-meter-tooltip-real.png`
- `proof-seven-turns-1100.png`
- `proof-seven-turns-1440.png`
- `proof-seven-turns.png`
- `proof-thinking-expanded-1100.png`
- `proof-thinking-expanded-1440.png`
- `proof-thinking-expanded.png`
- `proof-tool-error-1100.png`
- `proof-tool-error-1440.png`
- `proof-tool-error.png`
- `proof-tool-expanded-multiline-1100.png`
- `proof-tool-expanded-multiline-1440.png`
- `proof-tool-expanded-multiline.png`

Legacy Round-1 names (`m3e-transcript-first.png`, etc.) are 1440 copies for prior links.

## VSIX

- Filename: `generalstaff-workbench-0.4.17.vsix` (gitignored; built under `workbench-extension/`)
- Package: `generalstaff-workbench@0.4.17`
- sha256: `452b64f31bf9230cff137e0ee1d17da514d635cc7cf7f6be20443c93aea788b1`
- Not installed into the Workbench profile.
