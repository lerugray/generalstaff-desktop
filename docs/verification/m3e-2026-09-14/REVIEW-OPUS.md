REVIEW: SHIP-WITH-FIXES
FINDINGS: 12 (blockers 0)

Seat: opus adversarial code review, s118 M3e. Branch `cursor/m3e-meter-and-render-cc0c`
(`7559f34` + `b7390a5`) vs `72eefaf`. Isolated worktree; main tree untouched; nothing committed.
Ray's real transcript (`~/.gs-seats/ollama-glm/.../62822c1d-….jsonl`) was read read-only as the
ground truth the fixture claims to reconstruct.

## Verdicts against the eight review questions

1. **Meter = occupancy — PASS** (one MINOR, #4). `cliAdapter.ts:908-913` emits `session-spend`
   for the `result` envelope; occupancy is pushed only when `usage?.source === 'assistant'`
   (`:921-923`). A late `result` cannot overwrite: the webview's handler sets
   `state.contextUsage` only when `usedTokens` is a number (`workbench.js:1105-1117`) and the
   spend post carries none. A `tool_result`-only turn routes to the new `type === 'user'` branch
   (`cliAdapter.ts:925-927`), which emits no usage — the meter is not zeroed. No NaN:
   `asNonNegInt` (`claudeUsage.ts:31-34`) coerces undefined/non-numeric/negative to 0, so a
   provider omitting cache fields yields input-only occupancy.
2. **Denominator — PASS** (one MINOR, #5). `contextCeiling.ts:76` `= 1_000_000`; the door still
   exports `1000000` (`gsd-cc-door.sh:50`, verified on disk, unchanged since `55616c4a`). Both
   CC-door seats agree; direct Ollama seats keep 1_048_576; native Claude/kimi/zai/cline seats
   untouched. The door script was not modified — scope fence held.
3. **Tests not tautological — PARTIAL** (MAJOR #1, MINOR #6). D1 is genuinely enforced (mutant
   below). Deliverables 3-4 are not.
4. **Tool cards — PASS** (MINORs #8, #9). Correlated by `tool_use_id`
   (`cliAdapter.ts:625-627` → `extension.ts:735-737`), order-based only as fallback; verified
   against the real transcript, where every `tool_use` carries `id: call_…` and every
   `tool_result` the matching `tool_use_id`. Write/Edit expose `file_path` only — the M3d
   payload-leak guard holds; no env values are echoed. Result preview capped at 120 chars.
   **No XSS:** every new injection site is `escapeHtml` (`workbench.js:65-72`, full & < > " ')
   or `renderText`, which escapes before splitting fences; the deck CSP is
   `default-src 'none'; script-src 'nonce-…'` with no `unsafe-inline`
   (`extensionPolicy.ts:99-119`, `extension.ts:1054`). A tool result containing `<script>` or
   `onerror=` renders as literal text.
5. **Bubbles + thinking — PASS** (MINOR #7). One bubble per `message.id`, content order
   preserved. `signature`-bearing thinking does not crash: Ray's real blocks are
   `type,thinking,signature` and render fine.
6. **Webview state/perf — PASS** (MINORs #10, #11). Per-event work is O(current turn), not a
   whole-transcript re-render. No new listeners → nothing leaks on re-open. `workbench.css` is
   shared with the Lanes and Desk webviews, but neither `lanes.js` nor `desk.js` uses
   `.message-body` or any new class — M3b-M3d panes untouched.
7. **Scope + hygiene — PASS.** Only permitted files plus `conversations.ts` (blocks
   persistence — necessary), `CHANGELOG.md`, `visual-harness.html` and the two updated test
   files. `package.json` = version bump + `proof:m3e` only; `package-lock.json` = the two
   version echoes. No `.vsix` added (`distribution/generalstaff-workbench.vsix` predates this
   branch). Fixture scrubbed: zero `sk-`/`Bearer`/home-path/email matches; the only "token"
   hits are the four usage field names; `cwd` is `<repo>`. `render-m3e-proofs.ts:331-399` uses
   `--mute-audio --disable-audio-output --no-sandbox`, DPR 2, `browser.close()` in `finally`.
8. **Else —** MAJORs #2 and #3, MINOR #12.

## Findings

1. **MAJOR — `src/extension.ts:652-676, 730-760`: deliverables 3 and 4 have zero test coverage.**
   The whole bubble-splitting and tool-correlation layer lives in `extension.ts`, which no test
   imports. Mutant 2 (`needsNewBubble = false` — reverts to one bubble per run) → **124/124
   green**. Mutant 3 (id correlation replaced by "first tool card wins") → **124/124 green**.
   The D4 test (`m3e-meter-and-render.test.ts:121-141`) asserts that distinct `turnId`s appear
   in the event stream — a property of `claudeProtocolAssistantEvents`, not of the code that
   creates bubbles. Fix: extract `ensureTurn` + the block reducer into a pure function
   (`(events) → ConversationMessage[]`) and assert 7 bubbles and 7 id-matched tool cards from
   the fixture; both mutants must then fail.
2. **MAJOR — `src/extension.ts:545-550`: the transcript-handoff window collapses ~4×.**
   `priorContext` takes `.slice(-12)` of messages with non-empty `text`. Before M3e a run was
   one assistant message; now Ray's real catch-up is 7, of which 4 carry no text block at all
   (verified: only lines 17, 22, 42 of the real transcript are `text`) and are filtered out —
   so one run eats 3-4 of the 12 slots instead of 1, and the handoff holds ~2-3 exchanges where
   it held ~6. Fires whenever there is no provider session: first run, lane switch, and the
   "retry with transcript" recovery path (`extension.ts:867-887`) — exactly where losing history
   hurts most. Fix: count one representative message per turn, or raise the slice to ~36 and let
   the existing `.slice(-30_000)` char clamp be the real bound.
3. **MAJOR — `src/extension.ts:833-835`: decision-card extraction duplicates prose.**
   `blocks.map(block => block.type === 'text' ? { ...block, text: finalText } : block)` writes
   the FULL extracted text into EVERY text block. A final turn shaped text → tool → text (or
   text → thinking → text) renders the whole message twice. Fix: replace the first text block
   and drop the rest — `let seen = false; blocks = blocks.filter(b => b.type !== 'text' || !seen
   && (seen = true))` then set that one block's text.
4. **MINOR — `src/services/claudeUsage.ts:52-57`: an output-only usage object zeroes the meter.**
   `hasKey` accepts `output_tokens` alone, so an assistant envelope carrying
   `usage: {output_tokens: N}` (the Anthropic `message_delta` shape) yields occupancy 0 and
   drives the strip to 0%. Not reachable today — every assistant line in Ray's real transcript
   carries `input_tokens` — but a provider variant or `--include-partial-messages` would hit it.
   Fix: require at least one of the three prompt-side keys before returning a `source:
   'assistant'` usage.
5. **MINOR — `src/services/contextCeiling.ts:76`: the "one source of truth" is a hardcoded
   copy.** The brief asked the extension to read what the door exports; it hardcodes `1_000_000`
   with a comment naming `gsd-cc-door.sh`. Nothing links them, and the door lives in another
   repo — if `:50` changes, the meter silently diverges again, which is the exact failure M3e
   exists to fix. Fix: a test that reads the export line from `gsd-cc-door.sh` (or a checked-in
   copy of it) and asserts equality with `CC_DOOR_STATED_CONTEXT_TOKENS`.
6. **MINOR — `test/fixtures/glm-catchup-m3e.jsonl`: synthetic, and shaped unlike the real
   stream.** The brief said to copy Ray's transcript scrubbed; the agent reconstructed one from
   the diagnosis arithmetic (and says so, `REPORT.md` + fixture line 1 — honest). But the real
   stream differs in three ways the fixture smooths away: one JSONL line per content block with
   `message.id` repeated (fixture: all blocks in one line); 3 text blocks, not 7 (the D4 test
   asserts `prose.length === 7`); and one id reused across two API calls (`msg_9215…` at lines
   21-23 and again at 27 with different usage), which silently merges two calls into one bubble.
   The parser handles all three — I traced each — but the tests certify a shape the CC door does
   not emit. Fix: add the real (scrubbed) transcript as a second fixture and re-run D3/D4
   against it.
7. **MINOR — `src/adapters/cliAdapter.ts:596-604`: `redacted_thinking` is silently dropped.**
   Type `redacted_thinking` carries `data`, not `thinking`, so it matches no branch and
   disappears — against the brief's "never dropped". Fix: emit a placeholder card
   ("Thinking · redacted").
8. **MINOR — `src/adapters/cliAdapter.ts:517-521`: tool `detail` is uncapped and persisted.**
   `detail = command` stores a whole Bash command (a heredoc writing a large file included) in
   `blocks`, which `conversations.ts:283-295` writes to disk. CSS caps the visible height at
   14rem so nothing freezes, but this is new unbounded data at rest — previously only the tool
   NAME was stored. Fix: `clipOneLine(command, 4000)` for `detail`.
9. **MINOR — `src/adapters/cliAdapter.ts:490-494`: `clipOneLine` splits surrogate pairs.**
   `line.slice(0, max - 1)` cuts by UTF-16 code unit, so an emoji or astral character at the
   boundary renders as a replacement glyph. Fix: `Array.from(line).slice(0, max - 1).join('')`.
10. **MINOR — `src/extension.ts:678`: a full-store post per assistant turn.** `ensureTurn` posts
    `{type:'conversations', conversations: this.store.all()}` — the entire store, now carrying
    every turn's blocks — once per turn. Seven posts on Ray's catch-up; quadratic on a long
    session with large `detail` strings. Fix: post only the affected conversation.
11. **MINOR — `media/workbench.css:1838-1839, 1852, 1861`: two non-additive restyles.**
    `.message-body { display: grid; gap: 10px }` kills margin-collapsing in every existing
    message including user bubbles, and `.message-body pre { max-height: 18rem; white-space:
    pre-wrap }` makes every previously-rendered code block wrap instead of scroll horizontally.
    Inside the transcript pane so within the fence, but it restyles already-shipped content —
    the looker should diff against the M3d screenshots before install.
12. **MINOR — `src/extension.ts:640-642`: the event chain swallows every error.**
    `eventChain.then(work).catch(() => undefined)` — a throw in any stream handler is discarded
    with no notice and no log; the bubble just stops updating. Fix: log the error and mark the
    message `'error'`.

## Mutants

- **M1 (required) — `cliAdapter.ts:910`, `session-spend` → `context-usage` (re-enable the result
  branch):** `node --import tsx --test test/m3e-meter-and-render.test.ts` → **4 pass, 2 fail**.
  D1 fails (`Expected values to be strictly equal: actual false, expected true`); D5 fails
  (`actual: 957944, expected: 140628`). Deliverable 1 is genuinely enforced.
- **M2 — `extension.ts:656`, `needsNewBubble = false`:** full suite → **124/124 pass**.
- **M3 — `extension.ts:735`, correlation → `blocks.find(b => b.type === 'tool')`:** full suite →
  **124/124 pass**.

All three reverted; the worktree is byte-clean against the branch.
