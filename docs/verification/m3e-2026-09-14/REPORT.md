# M3e verification report — Round 3 (2026-09-14)

Branch: `cursor/m3e-meter-and-render-cc0c`. VSIX rebuilt, not installed. Do not merge.

## Check-suite tally

| | tests | result |
|---|---|---|
| Before M3e (M3d baseline) | 118/118 | green |
| After M3e Round 1 | 124/124 | green |
| After M3e Round 2 (`FIXLIST-R2.md`) | 134/134 | green |
| After M3e Round 3 (`FIXLIST-R3.md`) | **137/137** | green (`npm run check`) |

Round 3 adds binding tests in `workbench-extension/test/m3e-r3-fixlist.test.ts` (CODE 4/5/6) and tightens MINOR 5/8+9 in the R2 file.

## Round 3 CODE (all seven)

1. **Scope meter CSS** — `.lanes-context-meter` position/min-width and `.lanes-context-copy` nowrap live only under `.conversation-meta`. Lanes/Desk no longer inherit deck chrome.
2. **Delete duplicate legacy meter competition** — removed the second `.conversation-meta .lanes-context-meter` override; shared Lanes chrome kept once (flex/rule/fill/copy colour only).
3. **`overflow-wrap: anywhere`** on `.thinking-card-body` / `.tool-card-detail` / `.tool-card-result` / `.assistant-bubble`. Proof: `proof-unbroken-token-wrap-720.png` (2000-char token; body width ≤ pane).
4. **`capPersisted` rune-safe** — shares `clipAtRuneBudget` (UTF-16 budget, never splits surrogates). Test lands a high surrogate at the 8KB-1 boundary; unfixed `slice` fails, production passes.
5. **MINOR 9 test binds** — `clipOneLine` at `max=4` on five emoji (odd UTF-16 cut). Unfixed `slice(0,3)` retains a lone surrogate; production yields three runes + `…`.
6. **MINOR 5 reads the real door** — `scripts/gsd-cc-door.sh` exports `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1048576` (Ollama Cloud’s real window — the one allowed door change). `CC_DOOR_STATED_CONTEXT_TOKENS = 1_048_576`. Tests parse the script, not only the fixture mirror.
7. **Compaction explanation restored** — when the meter warns (`assumed-default`), `contextMeterTooltip` appends “Claude Code will compact at 200k unless the launcher states the window.” (matches `lanes.js`).

### Fence proof (CODE 1)

| Pane | before | after | identical? |
|---|---|---|---|
| Lanes @1440 | `proof-fence-lanes-before-1440.png` | `proof-fence-lanes-after-1440.png` | **yes** |
| Desk @1440 | `proof-fence-desk-before-1440.png` | `proof-fence-desk-after-1440.png` | **yes** |

## Round 3 PROOFS re-shot (G4 / G3 / G2)

| Frame | What changed | Files |
|---|---|---|
| **G4** | Composer collapsed so all catch-up turns fit on the first screen | `proof-seven-turns-{1440,1100}.png` |
| **G3** | Expanded thinking uses realistic multi-paragraph prose (no filler run) | `proof-thinking-expanded-{1440,1100}.png` |
| **G2** | Tool result long enough to overflow the 14rem cap (scrollbar visible) | `proof-tool-expanded-multiline-{1440,1100}.png` |

## Occupancy arithmetic (updated in R3)

- Peak occupancy **140,628** → **13%** of door ceiling **1,048,576** (was 14% of 1,000,000 before CODE 6).
- Preamble **132,479**; added **8,149**.
- Cumulative session spend **957,944** (old 91% bug) — meter still ignores it.
- Meter label example: `140.6k / 1.05M (13%)`.

## Mutants (unchanged from R2 — still caught)

| Mutant | Round 2+ |
|---|---|
| M2 — `needsNewBubble` forced false | **caught** |
| M3 — first-tool-wins correlation | **caught** |

## VSIX

- Filename: `generalstaff-workbench-0.4.17.vsix` (gitignored; under `workbench-extension/`)
- Package: `generalstaff-workbench@0.4.17`
- sha256: `39a081f0c1a8e2b7e9809d30db86109a607ca2444170f1956e177f26c91eaa17`
- Not installed into the Workbench profile.
