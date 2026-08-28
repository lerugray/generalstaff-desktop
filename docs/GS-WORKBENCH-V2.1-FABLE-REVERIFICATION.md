# GeneralStaff Workbench v2.1 — sealed Fable re-verification

**Date:** 2026-08-28  
**Reviewer:** Cursor-hosted `claude-fable-5-thinking-xhigh`  
**Candidate:** `59d9cdb348e86127328af334d91a7526053ae648`  
**Remediation base:** `81b0ef62fd628a70fe4c574c35e57d8cc5e81c9b`  
**Posture:** read-only source and git inspection in a detached, clean worktree

## Verdict: `READY`

No material safety, correctness, or operator-workflow finding blocks this
candidate. The release-blocking Codex resume finding from the initial review is
resolved with supported current-invocation configuration, and the four absorbed
hardening items are implemented without material regression.

## Blocker resolution

The reviewer verified that each Codex native resume now explicitly passes:

```text
-c sandbox_mode="read-only|workspace-write"
-c model_reasoning_effort="high"
```

Read and consented-write modes are therefore asserted per invocation rather
than inherited from installed defaults. Resume contains no unsupported
`--sandbox` or `-C`; `runCliAdapter` supplies the exact host-scoped cwd directly
to the child process. Tests cover both sandbox values, high effort, the absence
of unsupported flags, and the session/stdin positions.

The reviewer also inspected the new disposable resume-boundary probe. It uses
the production `invocationFor` resume construction, requests a marker write,
fails if the marker exists, and reported `CODEX_RESUME_READ_BOUNDARY_OK` in the
execution evidence.

## Absorbed hardening

The reviewer found each remediation correct:

- `pendingRuns` closes the pre-registration double-start window, including the
  write-consent await and cleanup paths;
- bare UUID-shaped provider session hints are redacted before receipt evidence
  reaches the webview;
- rejection notices clear optimistic retry/decision state only for the matching
  conversation, and former silent start rejection paths now respond explicitly;
- decision extraction is gated to successful runs, leaving failures under the
  Recovery Desk.

## Package and boundary inspection

The reviewer independently recomputed the checked-in VSIX hash as
`594e899871e77879039b7448795625223a3c955aeb7729276fa20bb052790a03`
and found the packaged host and webview contain the remediated code. It also
spot-checked the read default, host-only provider sessions, write confirmation
and discovered-repository requirement, Kimi read refusal, CSP, and argv-array
execution. The test inventory matches the reported 29 tests across seven files.

## Optional follow-ups (non-blocking)

1. A future boundary probe could require an observable tool-attempt event as
   well as the absent marker and reported denial. The installed Codex lane did
   not expose that event even though it reported `Operation not permitted`.
2. The theoretically unreachable `answerDecision` store-race return could emit
   a scoped notice for completeness.
3. A pre-existing send-prompt rejection path can leave the webview's
   `pendingSend` flag set until reload. This predates the remediation and was not
   worsened by it.

These do not change the `READY` verdict.
