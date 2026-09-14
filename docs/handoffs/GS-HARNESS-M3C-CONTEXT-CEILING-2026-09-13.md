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

---

## Harvest (2026-09-14)

Workbench **0.4.14**. Context ceiling is visible before seat choice and while a lane runs.

### Ceiling table (as shipped)

| Lane | modelLabel | tokens | provenance |
| --- | --- | --- | --- |
| `codex` | gpt-5.6-sol | — | `unknown` |
| `claude` | fable | 200 000 | `native` (Anthropic / Claude Code default for recognised Claude models) |
| `kimi` | kimi-k3 | — | `unknown` |
| `cline` | glm-5.3 via cline | — | `unknown` |
| `cursor` | cursor-auto | — | `unknown` |
| `grok` | grok-4.6 | — | `unknown` |
| `glm-ollama` | glm-5.3 | 1 048 576 | `stated` |
| `glm-ollama-flash` | glm-5.3-flash | 1 048 576 | `stated` |
| `deepseek-ollama` | deepseek-v4.1-flash | 1 048 576 | `stated` |
| `deepseek-ollama-cc` | deepseek-v4.1-flash | 1 048 576 | `stated` (`gsd-cc-door.sh` / `CLAUDE_CODE_MAX_CONTEXT_TOKENS`; Workbench constant = verified Ollama `context_length`) |
| `glm-ollama-cc` | glm-5.3 | 1 048 576 | `stated` |

**Left `unknown` (no token count):** `codex`, `kimi`, `cline`, `cursor`, `grok` — not Claude Code seats, and the repo does not record a numeric window for them (Kimi is described only as “long-context”). Direct Ollama + CC-door seats are never `assumed-default`.

### Files changed

- `workbench-extension/src/services/contextCeiling.ts` — single source of truth + formatters
- `workbench-extension/src/services/claudeUsage.ts` — stream-json usage parser
- `workbench-extension/src/services/lanes.ts` — attach ceiling at discovery
- `workbench-extension/src/domain.ts` — `ContextCeiling` on `LaneSummary`; `context-usage` run event
- `workbench-extension/src/adapters/cliAdapter.ts` — emit usage from Claude-protocol assistant/result
- `workbench-extension/src/extension.ts` — forward `context-usage` to the webview
- `workbench-extension/src/lanesPanelModel.ts` — list/detail ceiling + meter fields
- `workbench-extension/media/workbench.js` / `lanes.js` / `workbench.css` — picker labels, meter UI, register rule
- `workbench-extension/test/contextCeiling.test.ts` + `test/fixtures/claude-stream-usage.jsonl` (reconstruction)
- `workbench-extension/test/{lanesDetail,ollamaCloud,privateRuntime}.test.ts`, `visual-harness.html`
- `workbench-extension/scripts/render-m3c-proofs.ts`
- `workbench-extension/package.json` `0.4.14`, `CHANGELOG.md`, root `README.md` Versions
- `distribution/generalstaff-workbench.vsix`
- Proofs: `docs/handoffs/GS-HARNESS-M3C-PROOF-{detail,seat-picker}-{paper,night}.png`

### Verification

- `npm run check` — **109/109**
- VSIX rebuilt via `npm run package:distribution`
- Proofs regenerated (detail meter `196.2k / 1.05M (19%)`; seat picker shows stated / native / unknown labels)

---

## Harvest 2 (0.4.15)

Workbench **0.4.15**. Claude-seat native ceiling corrected against Claude Code model-config § Extended context (`https://code.claude.com/docs/en/model-config.md`).

### Corrected ceiling table

| Lane / model | modelLabel | tokens | provenance |
| --- | --- | --- | --- |
| `claude` (Fable) | fable | 1 000 000 | `native` — “On models with a native 1M window, such as Sonnet 5 and the Fable models…” |
| Sonnet 5 | sonnet | 1 000 000 | `native` — “On the Anthropic API, Sonnet 5 always runs with the 1M context window.” |
| Opus | opus | 1 000 000 | `native`, note `1M on Max tiers` — “On Max, Team, and Enterprise plans, including both Team Standard and Team Premium seats, Opus is automatically upgraded to 1M context with no additional configuration.” (this operator: Max 20x) |
| Haiku | haiku | 200 000 | `native` (not in the native-1M set) |
| `codex` | gpt-5.6-sol | — | `unknown` |
| `kimi` | kimi-k3 | — | `unknown` |
| `cline` | glm-5.3 via cline | — | `unknown` |
| `cursor` | cursor-auto | — | `unknown` |
| `grok` | grok-4.6 | — | `unknown` |
| `glm-ollama` / flash / deepseek / CC doors | (unchanged) | 1 048 576 | `stated` |

Picker label for the Claude seat: **`fable · 1M context (native)`**.

### Files touched this pass

- `workbench-extension/src/services/contextCeiling.ts` — per-model native ceilings; remove single 200k Anthropic constant
- `workbench-extension/test/contextCeiling.test.ts` — fable/sonnet = 1M native; Claude 5-family must not read 200k
- `workbench-extension/media/workbench.js` — native label includes `(native)` / Max-tier note
- `workbench-extension/package.json` / lock → **0.4.15**; `CHANGELOG.md`; root `README.md` Versions
- Proofs regenerated; VSIX via `npm run package:distribution`

### Verification

- `npm run check` — **110/110**
- VSIX rebuilt to `distribution/generalstaff-workbench.vsix`

