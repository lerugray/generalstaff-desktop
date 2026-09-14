# GS harness — M3c: context ceiling visible on every seat (follow-up to M3b, 07be8f7)

Read first: `docs/handoffs/GS-HARNESS-M3B-2026-09-13.md`, `workbench-extension/src/services/ollamaCloud.ts`
(`OLLAMA_CLOUD_CONTEXT_TOKENS`, the CC-door table), `workbench-extension/src/services/lanes.ts` (how each
lane is spawned; the Ollama CC doors exec `scripts/gsd-cc-door.sh`, which sets
`CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000` before exec'ing `claude`), `media/lanes.js` + `media/workbench.js`
(where seats and lane detail render), and `README.md` §Versions.

## Why

The operator ran an Ollama Cloud model (deepseek-v4.1-flash, a 1,048,576-token model) through a Claude
Code seat that did not state the ceiling, and the session compacted at ~200k mid-catch-up — Claude Code
assumes 200k for any model name it does not recognise. He wants to see, before choosing a seat and while
a lane runs, exactly what context the seat has and how much of it is used. Nothing should be inferable
only from a launcher script.

## Deliverable (Workbench 0.4.14)

1. **A `contextCeiling` per lane definition**, single source of truth in the services layer (not the
   webview): the token count Claude Code will run with on that seat, and its *provenance* — one of
   `stated` (the launcher sets `CLAUDE_CODE_MAX_CONTEXT_TOKENS`; value = what it sets),
   `native` (an Anthropic model whose window the CLI knows; state the number the CLI uses),
   `assumed-default` (a model the CLI does not recognise and nothing states a ceiling; value 200,000),
   or `unknown` (a lane that is not Claude Code at all — cursor-agent, codex, kimi, cline: show the
   lane's own documented window if the repo already records it, else `unknown`). Do not guess numbers:
   for Anthropic models take the window from the CLI's own model listing if it is queryable, otherwise
   from the constants the repo already carries, and cite the source in a code comment.
2. **Seat picker**: every seat row/option shows the ceiling in plain words next to the model, e.g.
   `deepseek-v4.1-flash · 1.05M context (stated by launcher)` / `sonnet · 200k context` /
   `glm-5.3 via cline · context unknown`. An `assumed-default` seat gets a visible warning mark and a
   tooltip saying the CLI will compact at 200k unless the launcher states the window.
3. **Lane detail + Lanes list**: the ceiling and, when the lane is a Claude Code seat run with
   `--output-format stream-json`, a **live used/ceiling meter** — parse the per-message `usage`
   (input + cache_read + cache_creation tokens of the latest assistant turn = current context size) and
   show `used / ceiling (nn%)`, updating as events arrive. If the stream does not carry usage for a lane,
   show `ceiling only` — never a fake number. Verify the field names against a real stream-json sample
   before coding the parser; if no sample exists in the repo, build one from the CLI's documented event
   shape and mark the fixture as a reconstruction.
4. **Register**: stay inside the existing Kriegspiel paper/night register (rule lines, no new boxes);
   the meter is a thin rule with a filled span, brass only for the warning state, same type scale as the
   existing lane chits. No new colours.
5. Tests: unit tests for the ceiling table (every seat has a ceiling + provenance, no `assumed-default`
   Ollama seat), the usage parser (fixture), and the rendered strings. `npm run check` green (104 + new).
   Version 0.4.14, CHANGELOG entry, VSIX rebuilt (`npm run package:distribution`), proofs regenerated
   for the seat picker and a lane detail with the meter (paper + night), committed under
   `docs/handoffs/GS-HARNESS-M3C-PROOF-*.png`. Nothing outside `workbench-extension/`, `distribution/`,
   this doc and the proofs. Append a `## Harvest` section to this doc naming every file changed, the
   ceiling table as shipped, and any seat you left `unknown` and why. Push your branch.
