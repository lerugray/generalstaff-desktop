# GeneralStaff Workbench v2.1 — continuity and recovery implementation

**Date:** 2026-08-28
**Branch:** `codex/gs-workbench-v2-20260827`
**Base:** `3d6142f` (`Build conversation-first GeneralStaff Workbench`)

## Outcome

Workbench 2.1 turns the v2 conversation surface into a recoverable daily-use
loop. A conversation now resumes the provider's own session where the installed
CLI has a dependable non-interactive resume path, falls back to a bounded local
transcript elsewhere, exposes explicit recovery controls after failure, and can
render provider-raised choices as host-validated decision cards.

The existing safety posture remains load-bearing: every new conversation starts
in read mode, provider sessions are host-only, native resume is scoped to the
same lane, permission, and working directory, write access still requires host
consent, and no work was merged into or launched from the live branch.

## Continuity model

| Lane | Continuity | Provider mechanism | Live evidence this pass |
|---|---|---|---|
| Codex | native | `codex exec resume` with explicit sandbox/effort config | two-turn nonce memory and resumed read-boundary probes passed |
| Claude | native | host-assigned `--session-id`, then `--resume` | invocation shape and parsing tested; account deliberately not invoked |
| Kimi | native | `kimi --session SESSION_ID` | two-turn nonce memory probe passed |
| Cursor | native | `cursor-agent --resume CHAT_ID` | two-turn nonce memory probe passed |
| Cline | transcript | bounded recent conversation context | live single-turn adapter probe passed |

Cline 3.0.60 advertises `--id`, but its installed non-interactive JSON path
rejects resumed prompts before work begins. Workbench therefore does not claim
native continuity for that lane. Transcript fallback includes at most the last
12 messages and 30,000 characters.

Provider session identifiers live in a separate Memento key and are never
included in the webview conversation payload. A stored session can be reused
only by the exact conversation, lane, permission, and resolved working
directory that created it. Claude's host-assigned identifier is discarded if
the CLI fails before producing any stdout.

Each receipt labels the run as `new`, `native`, or `transcript`. Native resume
does not weaken the original permission boundary: if lane, permission, or cwd
does not match, Workbench starts or reconstructs a safe context instead.
Codex resume additionally reasserts `sandbox_mode="read-only|workspace-write"`
and `model_reasoning_effort="high"` through supported `-c` overrides; the child
process is spawned in the exact scoped cwd.

## Recovery and decisions

When the last assistant turn ends in error, the Recovery Desk offers:

- **Retry last command** — reuse a matching native session when one is safely
  available, otherwise use bounded transcript context;
- **Retry from transcript** — explicitly clear that lane's stored session and
  reconstruct bounded context;
- **Change lane** — focus routing without silently starting work.

A retry appends a labeled recovery attempt instead of duplicating the original
operator message.

Providers can emit up to three structured decision cards using a bounded
`<gs-decision>` JSON block. The host validates titles, questions, option counts,
unique option identifiers, and size limits; replaces provider identifiers with
host UUIDs; and records at most one answer. Malformed, duplicated, or oversized
blocks remain visible as ordinary assistant text. Choosing an option re-enters
the same conversation and permission boundary as an operator decision message.

## Verification evidence

- `npm run check`: TypeScript, webview syntax, 29 Node tests, and esbuild compile
  pass.
- `npm audit --omit=dev`: zero vulnerabilities.
- Tests cover native argv for all supported lanes, Cline's fail-closed native
  refusal, session parsing and redaction, exact session scoping, interrupted-run
  recovery, decision parsing and one-answer persistence, retry message
  validation, existing security boundaries, and Windows shim resolution.
- Production-adapter two-turn memory probes passed for Codex, Kimi, and Cursor;
  each retained one provider session and remembered a nonce. Cline's live normal
  probe returned one normalized response using `z-ai/glm-5.3-flash`.
- A disposable resumed Codex read-boundary probe requested a marker write under
  the production resume configuration, observed an operation denial, verified
  the marker remained absent, and returned `CODEX_RESUME_READ_BOUNDARY_OK`.
- No Claude request was sent, preserving the operator's exhausted Anthropic
  allowance; the final Fable review is routed through Cursor instead.
- The production Windows shim bundle ran under real Windows Node on the
  ThinkPad and returned `WINDOWS_SHIM_OK`. A prompt containing `&` round-tripped
  as one literal argument under both adapter and probe spawn paths, and its
  marker command was not executed.
- Browser QA exercised dashboard, active, decision, recorded-decision, error,
  automatic retry, transcript retry, disabled routing while running, and narrow
  layout states with no browser console errors.
- The VSIX installed and activated as
  `lerugray.generalstaff-workbench@0.2.1` in an isolated real VS Code 1.135
  profile. Its module loaded and all four commands registered without a
  GeneralStaff activation error; the first-run Workbench 2.1 surface was
  visually inspected.
- `distribution/generalstaff-workbench.vsix` contains 10 files and packages the
  compiled host plus media. SHA-256:
  `594e899871e77879039b7448795625223a3c955aeb7729276fa20bb052790a03`.

## Deliberate limits

- Cline uses transcript continuity until its CLI exposes a dependable
  non-interactive resume path.
- A full OS or extension-host crash can still outlive JavaScript process-tree
  cleanup until the provider exits or is terminated externally.
- Native session continuity is an implementation detail of installed local
  provider CLIs; Workbench fails closed to bounded reconstruction when a safe
  match is unavailable.
