# GeneralStaff Workbench v2.1 — Fable remediation record

**Date:** 2026-08-28  
**Initial verdict:** `NEEDS_REVISION` on candidate `81b0ef6`  
**Scope:** one blocking resume boundary plus four low-cost hardening findings

## Blocking correction

The Codex native resume invocation now passes supported current-invocation
configuration overrides:

```text
codex exec resume --json --model gpt-5.6-sol
  -c sandbox_mode="read-only|workspace-write"
  -c model_reasoning_effort="high"
  --skip-git-repo-check SESSION_ID -
```

`codex exec resume --help` confirms resume accepts `-c/--config`, but not the
fresh-run `--sandbox` or `-C` flags. The child is still spawned with the exact
conversation cwd, so directory selection does not depend on a stored session.
Adapter tests assert both read and write resume sandbox values and high effort.

The live `probe:codex-resume-boundary` check opens a disposable read-only Codex
session, resumes it with the production config arguments, requests one marker
write, verifies the turn reports the operation denied, verifies the marker was
not created, and removes the temporary directory. It prints
`CODEX_RESUME_READ_BOUNDARY_OK` only when the boundary holds.

## Absorbed hardening

- A host-side pending-run reservation now closes the pre-registration
  double-start window for prompts, retries, decisions, and routing changes.
- Receipt evidence now redacts bare UUID-shaped provider session hints.
- Run-start rejection notices carry a conversation id, so optimistic recovery
  state is cleared only for the request that failed; silent rejection paths now
  return an explicit notice.
- Decision cards are extracted only from successful runs, leaving failed output
  visible under the Recovery Desk instead of creating a competing action path.

## Verification after correction

- `npm run check`: passes (typecheck, webview syntax, 29 tests, compile).
- `npm run probe:codex-resume-boundary`: passes.
- `git diff --check`: passes.
- No Claude account request was sent. Re-verification remains routed through
  Cursor-hosted Fable.
