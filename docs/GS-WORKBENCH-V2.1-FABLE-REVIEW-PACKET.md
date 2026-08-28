# GeneralStaff Workbench v2.1 — targeted Fable review packet

**Prepared:** 2026-08-28
**Review branch:** `codex/gs-workbench-v2-20260827`
**Delta base:** `3d6142f`
**Review posture:** sealed, read-only, no product edits
**Review lane:** Cursor-hosted `claude-fable-5-thinking-xhigh`

## Review request

Review the v2.1 delta from `3d6142f`, with the current repository instructions,
`docs/GS-WORKBENCH-V2-PRODUCT-CONTRACT.md`, the prior v2 sealed review and
re-verification, and
`docs/GS-WORKBENCH-V2.1-IMPLEMENTATION-NOTE.md` as context. Inspect the source
rather than relying on the implementation summary.

Return one of:

- `READY` — no material safety, correctness, or operator-workflow finding blocks
  this v2.1 delta;
- `NEEDS_REVISION` — one or more material findings should be corrected before
  this branch is considered complete.

Put material findings first, with exact paths and a concrete failure scenario.
Separate release-blocking findings from optional follow-up work. Do not edit,
execute, package, or otherwise mutate the sealed snapshot.

## Delta under review

1. **Provider-native continuity.** Codex, Claude, Kimi, and Cursor have
   lane-specific resume invocations. Provider session identifiers are captured
   from bounded known envelopes (or host-assigned for Claude), stored in
   extension global state, and scoped to exact conversation, lane, permission,
   and cwd.
2. **Bounded transcript fallback.** Cline deliberately uses recent transcript
   context because its installed non-interactive JSON resume path is not usable.
   Any unsafe/missing native-session match also reconstructs bounded context.
3. **Recovery Desk.** Failed assistant turns expose automatic retry, explicit
   transcript retry, and route-change controls. Retries do not duplicate the
   operator's original message.
4. **Structured decisions.** Provider blocks are parsed under strict count and
   size limits, re-identified by the host, persisted, and answerable once.
   Invalid structures remain ordinary text.
5. **Receipt and interface clarity.** Runs disclose `new`, `native`, or
   `transcript` continuity; recovery attempts and recorded choices are visible;
   route and permission controls are locked during an active run.
6. **Regression and packaging.** New tests, live probes, real Windows smoke,
   browser states, isolated VS Code activation, updated documentation, and a
   0.2.1 distribution VSIX are included.

## Boundaries that must remain true

- Every new-conversation path resets permission to read.
- Seat and permission remain independent.
- Native resume cannot cross permission or working-directory boundaries.
- Write execution still requires the host confirmation and a discovered sibling
  repository; the private GeneralStaff state root is never a write fallback.
- Kimi remains unavailable in read mode.
- Provider session identifiers, credentials, raw filesystem access, and a
  general command surface never enter the webview.
- CLI execution continues to use executable/argument arrays with fail-closed
  production shim resolution on Windows.
- Stop, output caps, redacted receipt evidence, CSP, preview-server containment,
  and bounded persistence remain intact.
- The branch is non-live and the review snapshot is sealed.

## Files to prioritize

- `workbench-extension/src/extension.ts`
- `workbench-extension/src/adapters/cliAdapter.ts`
- `workbench-extension/src/services/conversations.ts`
- `workbench-extension/src/services/decisions.ts`
- `workbench-extension/src/bridge/messages.ts`
- `workbench-extension/src/domain.ts`
- `workbench-extension/media/workbench.js`
- `workbench-extension/media/workbench.css`
- `workbench-extension/test/`
- `workbench-extension/scripts/probe-continuity.ts`
- `docs/GS-WORKBENCH-V2.1-IMPLEMENTATION-NOTE.md`

## Evidence class

The sealed reviewer should independently inspect source and tests. Live provider
memory probes, the real-Windows smoke, visual inspection, isolated VS Code
activation, package hash, and successful local commands are reported execution
evidence; they are documented so the reviewer can judge the claim boundary,
not as a substitute for source inspection.

