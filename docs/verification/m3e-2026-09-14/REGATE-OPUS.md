REGATE: INSTALL-WITH-NOTES
OPEN: 13 (blockers 0)

Seat: opus RE-GATE, refute posture, s118 M3e round 2. Detached worktree at `b1f5468`
(round 2 = `8dcc51d`,`c6de44f`,`5fa43ec`,`5fe3c57`,`b1f5468` on `b90ac79`). Read-only; one
mutant applied and reverted; worktree byte-clean; nothing committed.

NOTE ON THE BRANCH: the LOCAL `cursor/m3e-meter-and-render-cc0c` is stale at `b90ac79`.
Round 2 exists only on `origin/`. Anyone re-gating must fetch first.

## PART A — RE-LOOK (both viewports viewed)

| # | Item | Verdict | What I SEE / measured |
|---|---|---|---|
| D1 | Expanded tool card, full multi-line result | **FIXED** | `proof-tool-expanded-multiline-{1440,1100}`: result renders on 2 lines, `aaa1111 chore: rebuild package` / `bbb2222 docs: handoff notes`. The round-1 run-on line is gone. Preview stays 1-line ≤120ch (test binds). |
| D2 | Thinking vs tool distinguishable at a glance | **FIXED** | 7-turn frame: thinking = dashed border, transparent fill, *italic*, `◇` brass glyph. Tool = solid border, filled, upright mono, `▸` muted glyph. Distinct without reading the word. |
| D3 | Visible expand affordance | **FIXED** | `⟩` chevron leads every collapsible summary; `details[open] > summary > .card-chevron` rotates 45°. Seen on thinking, tool and error cards. |
| D4 | Collapsed summary in mono | **FIXED** | summaries render `SFMono-Regular` 11px (css:1893-1896). Visible in all frames. |
| D5 | Assistant prose contained | **FIXED** | prose sits in a bordered/filled `.assistant-bubble` (css:1869). Hierarchy now reads prose ≥ cards. |
| D6 | Meter label never wraps at 1100 | **FIXED** | `140.6k / 1M (14%)` on ONE line at both viewports. Track 366 CSS px @1440, **289 CSS px @1100** = the surviving `min-width:18rem` floor. Frame height 21 CSS px = single copy line. (Bar is still 2 CSS px tall — the "reads as a stray dash" half of D6 is untouched; contract only required no-wrap.) |
| G1 | Error-state tool card frame | **FIXED** | `proof-tool-error-*`: `⟩ ▸ Bash · git status --short && git log --oneline -3 · error` in rust ink. |
| G2 | Long result scroll-capped | **NOT PROVEN** | The delivered result is 2 lines (~28px) inside a 14rem cap. The cap is still never exercised by any frame. |
| G3 | Expanded thinking card | **NOT PROVEN** | Frame exists but is **8386×216 px** = a 4193-CSS-px strip of a 2125-char unbroken `AAAA…`/`EEEE…` filler run from the fixture. Nothing judgeable; see NEW-4. |
| G4 | First screen, 7 turns in order | **NOT PROVEN** | `proof-seven-turns-1440` shows **2** assistant turns + a 3rd card sliced mid-glyph by the scroll edge. At **1100 it shows 1** partial turn — the composer occupies ~60% of a 700px viewport. Capability IS proven by the MAJOR-1 test (7 bubbles from fixture); the frame the contract asked for was not delivered. |
| G5 | Real tooltip element | **FIXED** | `.lanes-context-hovercard` is a real DOM node (workbench.js:152) — bordered paper card, in-register type, shadow, wraps to 2-3 lines; no `title=` remains on the deck meter, and `render-m3e-proofs.ts:328` throws if it returns. |
| G6 | Proof exercises the real grouping path | **PARTIAL** | The harness now imports `reduceRunEventsToTurns`/`findToolBlockForResult` from production (render-m3e-proofs.ts:24-27) — no longer the harness's own. But `reduceRunEventsToTurns` is a *parallel reimplementation* of extension.ts's inline `ensureTurn` loop; the literal runtime path is still unrendered. |
| G7 | Two viewports | **FIXED** | 1440×900 + 1100×700 DPR2 delivered. Caveat: several are element-crops that differ by <30px, so the second viewport adds little except for the meter and seven-turns frames. |

## PART B — DELTA REVIEW

| Finding | Verdict | file:line |
|---|---|---|
| MAJOR 1 bubble/correlation coverage | **FIXED** | helpers `src/services/runTranscript.ts:8,20`; **imported and called by the real path** `extension.ts:20-25, 665, 752`. Owner's M2/M3 caught (132/134, 133/134) — consistent with the one binding assertion in each mutant test. |
| MAJOR 2 priorContext exchanges | **FIXED** | `runTranscript.ts:131` `buildPriorContextTranscript`; single call site `extension.ts:554` feeds normal run, lane switch AND transcript-retry (`retryRun`→`startRun`). My mutant caught it (below). |
| MAJOR 3 decision-card duplication | **FIXED** | `runTranscript.ts:101` `applyDecisionTextToBlocks`; `extension.ts:844`. Test asserts exactly 1 text block on text→tool→text. |
| MINOR 4 output-only usage | **FIXED** | `claudeUsage.ts:52-59`. Dead code left: after the early return `hasKey` is always true, so `if (!hasKey)` is unreachable. |
| MINOR 5 ceiling one-source-of-truth | **PARTIAL** | `test/fixtures/gsd-cc-door-ceiling.env` + test. I checked the PRIMARY source: real `gsd-cc-door.sh:50` still exports `1000000` — value is correct today. But the test compares two in-repo copies and pins `1_000_000` literally; the real door lives in generalstaff-private and nothing checks it. Divergence risk reduced, not closed. |
| MINOR 7 redacted_thinking | **FIXED (cosmetic gaps)** | `cliAdapter.ts:615-619` emits the placeholder; never throws. But it renders **"Thinking · 19 chars"** (the placeholder string's own length), and `.is-redacted` has **no CSS** — the class is inert. |
| MINOR 8 persisted tool detail | **FIXED** | `cliAdapter.ts:497-503` `capPersisted` 8192, applied to `detail` (:552) **and** to the new full `result` (:656) — the new field did not escape the cap. |
| MINOR 9 rune-safe clip | **PARTIAL — test is NON-BINDING** | Fix at `cliAdapter.ts:490-495` is correct. Its test uses `clipOneLine('😀😀😀😀', 3)`; `max-1 = 2` is an EVEN UTF-16 offset, so the OLD code also yields no replacement char. Verified in node: assertion passes on old AND new. A discriminating case is `max = 4`. FIXLIST required fail-before/pass-after — this one does not. |
| MINOR 10 delta post | **FIXED** | `extension.ts:685-691` posts `{type:'conversation'}`; webview upserts by id at `workbench.js:1064-1071`. No miss/duplicate: the post carries the whole conversation, `enqueueEvent` serialises, and `postState()` re-posts full state on reveal, so a webview reconnect re-syncs. |
| MINOR 12 error chain | **FIXED** | `extension.ts:643-648` → notice + OutputChannel. |

### Mutant (mine) — priorContext exchange counting
Applied to `runTranscript.ts:143`: `if (message.role === 'user')` → `if (true)`, i.e. every
message becomes its own exchange (pre-M3e message counting). Baseline `m3e-r2-fixlist.test.ts`
= 10/10 green. **Mutant = 9 pass / 1 fail** — `MAJOR 2: priorContext counts exchanges` fails:
transcript degrades to `'GeneralStaff: turn 2\n\nGeneralStaff: turn 4\n\nGeneralStaff: turn 6'`,
ejecting every operator line. The MAJOR 2 fix is genuinely gated. Reverted; tree byte-clean.

### What round 2 may have BROKEN (new, not in REVIEW/LOOK)
- **NEW-1 (fence) Lanes-pane selector bleed.** New UNSCOPED `.lanes-context-meter {position:relative; min-width:16rem}` (css:1968) and `.lanes-context-copy {white-space:nowrap}` (css:1984) land in a stylesheet the **Lanes and Desk** webviews also load (`lanesPanel.ts:334`, `deskPanel.ts:233`), and `lanes.js:84` renders `.lanes-context-meter`. Cascade detail: the *legacy* duplicates at css:2946/2971 sit LATER and re-win `display/flex-direction/gap/margin/color`, so only `position`, `min-width:16rem` and `nowrap` actually leak. Low impact (global `body{min-width:760px}` already floors these panes) but it is a change to panes the fence declared untouched. Fix: scope both under `.conversation-meta`.
- **NEW-2 Deck lost the compaction explanation.** `workbench.js:145` dropped `title="Claude Code will compact at 200k unless the launcher states the window."` from the ⚠, and `contextMeterTooltip` (:118-135) never adds it — so the deck's warn glyph is now unexplained. `lanes.js` still has it. Add the sentence to the hovercard when `meter.warn`.
- **NEW-3 `capPersisted` reintroduces the MINOR 9 bug.** `cliAdapter.ts:501` uses `value.slice(0, max-1)` — verified in node to split a surrogate pair at the 8 KB boundary (tail `"aa\ud83d…"`). Same class as the bug round 2 just fixed one function above.
- **NEW-4 Horizontal blow-out on unbroken tokens.** `.thinking-card-body/.tool-card-detail/.tool-card-result` (css:1946-1956) set `pre-wrap` but no `overflow-wrap/word-break`. The product's own proof measured a card laying out **4193 CSS px** inside a 1440px viewport. Pre-existing, exposed by round 2's fixture — but a real `redacted_thinking` payload, a base64 blob or a minified line would hit it. Add `overflow-wrap:anywhere`.
- **NEW-5 a11y/dead attr.** `data-meter-tip="1"` is consumed by nothing; no `aria-describedby` ties the meter to `role="tooltip"`, so the hovercard is keyboard-reachable (`tabindex=0` + `:focus-within`) but not announced.
- **Tautology note:** both "mutant" tests build a mutant *inside the test file* and assert about it; only one real assertion in each (`needsNewBubble('a','b',true)`, `findToolBlockForResult(blocks, secondId)`) actually binds production code. They do bind — but the scaffolding around them proves nothing.

### Cleared (checked, not defects)
XSS: the full result is escaped — `workbench.js:185` `<div class="tool-card-result">${escapeHtml(resultBody)}</div>`; `escapeHtml` (:65-72) covers `& < > " '`; deck CSP has no `unsafe-inline`. Tooltip: CSS-only `:hover/:focus-within`, no listener → nothing leaks on re-render, dismisses on blur. `redacted_thinking` never throws. No new deps; `contextCeiling.ts` unchanged in round 2.

## M5 carry-overs
- Scope the two shared meter rules under `.conversation-meta`; delete the duplicate legacy blocks at css:2937-2990 (two competing definitions of the same selector is how this bled).
- `overflow-wrap:anywhere` on card bodies; re-shoot G3 with real prose, and G2 with a result long enough to exercise the 14rem cap.
- Deliver the 7-turn first-screen frame, or drop the requirement — at 1100×700 the composer leaves room for ~1 turn, which is itself the finding worth ruling on.
- Re-point MINOR 5 at the real `gsd-cc-door.sh`, or add a CI check that the fixture still mirrors it.
- Re-do the MINOR 9 test at `max = 4`; rune-safe `capPersisted`.
- `.is-redacted` styling + report "redacted" instead of "19 chars".
