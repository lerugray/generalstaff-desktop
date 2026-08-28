# GeneralStaff Workbench v2.1 — initial sealed Fable review

**Date:** 2026-08-28  
**Reviewer:** Cursor-hosted `claude-fable-5-thinking-xhigh`  
**Candidate:** `81b0ef62fd628a70fe4c574c35e57d8cc5e81c9b`  
**Base:** `3d6142f`  
**Posture:** read-only review of a detached, clean worktree

## Verdict: `NEEDS_REVISION`

The reviewer found one release-blocking issue. The remainder of v2.1 was judged
well built: session selection was fail-closed and host-only, decision parsing
was strictly bounded and host-re-identified, recovery avoided duplicate
operator messages, and the v2 safety boundaries remained intact.

## Release-blocking finding

Codex native resume omitted explicit process-level permission and effort
configuration. Fresh runs specified `--sandbox read-only|workspace-write` and
`model_reasoning_effort="high"`, while `codex exec resume` relied on prompt text
and installed defaults. That made the read/write receipt potentially dishonest:
a locally configured write default could weaken a resumed read conversation,
while a read default could prevent a consented build turn from editing. The
nonce continuity probe did not exercise filesystem enforcement.

The reviewer asked for the supported resume-time configuration to be passed
explicitly, or for Codex native resume to be replaced by transcript fallback.
It also requested focused read/write argv assertions and a resumed read-boundary
probe that requests a write.

The reviewer noted that `-C` was absent too. Local CLI help established that
`codex exec resume` accepts `-c/--config`, but not `--sandbox` or `-C`; the
adapter already sets the child process `cwd` directly. The supported correction
is therefore an explicit resume-time `sandbox_mode` config override plus the
effort override, with exact spawn cwd retained.

## Verified boundaries

The review independently found these properties intact:

- every new-conversation path resets to read;
- provider sessions are stored outside the webview payload and selected only
  for the exact conversation, lane, permission, and cwd;
- host confirmation and a discovered repository remain required for writes;
- Kimi remains unavailable in read mode;
- structured decisions are bounded, host-identified, and answerable once;
- retries do not duplicate the operator message;
- interrupted streams reopen as recoverable errors;
- routing is locked during active runs;
- Windows argv execution, CSP, output/evidence caps, preview containment,
  process stopping, persistence bounds, and message validation remain intact.

## Non-blocking follow-ups

1. Reserve a conversation before the first awaited run-start operation to
   prevent two starts from racing.
2. Redact bare UUID-shaped Codex resume hints from receipt evidence.
3. Scope optimistic retry/decision acknowledgements to their conversation so
   unrelated notices neither unlock nor strand the UI.
4. Consider hiding raw `<gs-decision>` JSON while it is still streaming.
5. Do not turn decisions from failed runs into actionable cards unless that
   precedence is intentional.

The first, second, third, and fifth follow-ups were absorbed into the
remediation. Streaming-time decision-block concealment remains optional because
it is cosmetic and completion-time extraction is safe.

## Evidence classification

The reviewer inspected source and tests. Live lane probes, Windows smoke,
browser QA, isolated VS Code activation, local check output, and the package
hash were treated as reported execution evidence rather than re-run inside the
sealed review.
