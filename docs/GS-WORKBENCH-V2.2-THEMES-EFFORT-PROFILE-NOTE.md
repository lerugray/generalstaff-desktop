# GeneralStaff Workbench v2.2 — themes, effort, and provider profiles

**Date:** 2026-08-28  
**Branch:** `codex/gs-workbench-v2-20260827`  
**Base before this pass:** `230c869` (`Record Fable Workbench re-verification`)

## Outcome

Workbench 2.2 restores every palette from the legacy GeneralStaff Desktop,
exposes model-specific effort choices from the conversation composer through
the extension host to the provider argv and receipt, and makes both GPT-5.6 Sol
and Fable genuinely available on the current operator machine.

The implementation keeps one public application codebase. The recommended
public/private boundary is a versioned, declarative provider profile plus a
private non-secret bootstrap overlay—not a second private application fork.
That architecture is recorded in `GS-WORKBENCH-PROFILE-ARCHITECTURE.md`.

## Restored palettes

The rail now offers the six exact legacy GSD palettes and persists the selected
ID in VS Code webview state:

- Kriegspiel Paper
- Kriegspiel Night
- Linen Folio
- Map Vellum
- Iron Press
- Carbon Folio

Carbon Folio remains the Workbench default. Existing hardcoded dark-theme alpha
colors were replaced with semantic RGB variables so panels, borders, shadows,
status tones, and overlays translate with every palette rather than merely
changing the page background.

## Effort controls

The composer shows only the values supported by the selected non-interactive
CLI path. The webview corrects stale selections on a lane change; the message
validator and extension host reject invented values; and the adapter validates
again before building an argument array.

| Lane | Exposed values | Workbench default |
|---|---|---|
| Codex / GPT-5.6 Sol | minimal, low, medium, high, extra-high | high |
| Claude Fable | low, medium, high, extra-high, max | max; high for fast assist |
| Cline / GLM | none, low, medium, high, extra-high | high; medium for fast assist |
| Kimi K3 | provider default | provider default |
| Cursor Agent | provider default | provider default |

The receipt records the effective value rather than only the requested
`default` sentinel. Codex writes `model_reasoning_effort` through its supported
configuration override, Claude writes `--effort`, and Cline writes
`--thinking`.

## Fable and Codex availability

Codex discovery reports the local CLI authenticated through ChatGPT and the
adapter explicitly selects `gpt-5.6-sol` for both fresh and resumed runs.

The standalone Claude CLI was initially installed but logged out, which caused
the Cursor fallback to prove the lane during implementation. Ray then restored
the direct login; `claude auth status` now reports first-party `claude.ai`
authentication on the Max subscription. The Fable logical lane has two built-in
runners:

1. authenticated Claude CLI, using `--model fable`; then
2. authenticated Cursor Agent, requiring the exact Fable catalog entry and
   selecting `claude-fable-5-thinking-{effort}`.

On this machine discovery now selects the first runner, so Fable orchestration
uses the sunk-cost Anthropic subscription directly. The second runner remains a
verified fallback: it separately proves Cursor authentication and the required
Fable model before marking that path available. All five configured Workbench
lanes currently discover as available.

Provider-native sessions are now scoped to logical lane, concrete runner,
permission, and working directory. If Fable changes from Claude to Cursor or
back, the old provider session fails closed to bounded transcript continuity
instead of passing one provider's session ID to the other. Legacy stored
sessions without a runner also fail closed.

## Public/private boundary

The public VSIX should continue to own adapters, validation, safety rails,
themes, and setup UI. A future machine-scoped `providerProfilePath` should load
only allowlisted lane IDs, labels, model/effort defaults, runner preference, and
ordering. It must not accept executable paths, command templates, shell
fragments, credentials, or tokens.

Exceptional binary overrides belong only in a separate machine-scoped setting,
never in an imported or repository-carried profile, and still require the
built-in lane probe. The operator's private repository may carry a non-secret
profile template and launcher, while authentication remains with provider CLIs
and the operating-system keychain.

The schema and first-run setup are documented next scope, not silently claimed
as implemented in v2.2. Today the provider catalog still starts from the
operator-oriented built-in bench.

## Verification evidence

- `npm run check`: TypeScript, webview syntax, 32 Node tests, and esbuild
  compile pass.
- `npm audit --omit=dev`: zero vulnerabilities.
- Tests cover exact effort argv, host and webview validation, Fable-over-Cursor
  model selection and native resume shape, runner-scoped provider sessions,
  legacy fail-closed migration, all six palettes, accessible swatches, and
  existing security/continuity boundaries.
- Final live lane discovery reports Codex through `codex` and Claude Fable
  through the authenticated `claude` CLI on the Max subscription, with Codex,
  Fable, Kimi, Cline, and Cursor all available. The earlier Cursor discovery
  proved the fallback before direct Claude authentication was restored.
- Browser QA rendered all six palettes, exercised the model-dependent effort
  selector (including max-to-Codex correction), and checked a 900-pixel narrow
  layout with no horizontal overflow or console warnings/errors.
- A Cursor-hosted Fable 5 extra-high review first returned **NOT READY** after
  finding runner-blind native-session persistence. The fix added runner-scoped
  storage, separate Fable auth/catalog probes, and the stricter profile trust
  boundary. Fable re-ran the review and returned **READY**; its only residual
  doc wording note was corrected afterward.
- The final VSIX installed in a clean isolated VS Code profile and listed as
  `lerugray.generalstaff-workbench@0.2.2`.
- `distribution/generalstaff-workbench.vsix` contains 10 files. SHA-256:
  `089877b3f2cc77be113c9e973cacb4c66f765cc16367e4447144a32076c5e211`.

No live branch was merged, pushed, or launched.
