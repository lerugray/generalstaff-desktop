# GeneralStaff Workbench v2 — sealed review packet

**Prepared:** 2026-08-27
**Review branch:** `codex/gs-workbench-v2-20260827`
**Base branch:** `master`
**Review posture:** read-only; no product edits during the review

## Review request

Evaluate the candidate against `docs/GS-WORKBENCH-V2-PRODUCT-CONTRACT.md` and
the repository instructions. Inspect the included source rather than relying on
this summary. Return one of:

- `READY` — no material safety, correctness, or operator-workflow finding blocks
  the candidate vertical slice;
- `NEEDS_REVISION` — one or more material findings should be corrected first.

List findings in descending impact with exact paths and a concrete failure
scenario. Separate release-blocking findings from optional follow-up work. Do
not change files.

## Candidate shape

The candidate is a first-party VS Code 1.135 extension plus an isolated
workspace/profile launcher. It is not a Code OSS source fork. Its default
surface is a custom conversation-first Command Deck; editor, Markdown preview,
local browser preview, and terminal remain supporting instruments.

The extension reads GeneralStaff's private `state/` tree and sibling repository
map. It dispatches requests to authenticated local subscription CLIs through a
common adapter, streams normalized events, persists bounded conversations and
operator notes in VS Code global state, and records run receipts.

## Permission and data boundaries

- New conversations start `read` regardless of the previously selected mode.
- Seat (`orchestrate`, `build`, etc.) and permission (`read`, `write`) are
  independent.
- Enabling write permission requires a host-owned modal confirmation; consent,
  lane, model label, working directory, time, exit state, and bounded redacted
  evidence are recorded.
- A write run requires a discovered sibling project repository and uses that
  repository as cwd. It never falls back to the GeneralStaff private state repo.
- Read runs use provider plan/read-only flags. Kimi is not offered in read mode:
  its current CLI rejects non-interactive prompt plus plan mode. Its prompt mode
  is offered only after explicit write consent.
- The webview has a restrictive CSP and a validated message allowlist. It never
  receives provider credentials or a filesystem API.
- Processes use executable/argument arrays. Windows `.cmd`/`.bat` shims use a
  static PowerShell launcher with the executable and argument array passed as
  base64 JSON in a child-only environment variable; operator text is not
  command source.
- Stop sends process-group TERM and escalates to KILL after four seconds (or
  uses recursive forced `taskkill` on Windows).
- HTML artifacts are served by an extension-owned random-token localhost server
  with path containment, no-store, nosniff, no-referrer, and restrictive CSP.
- Output is clipped at 200,000 characters. Receipt evidence is clipped to 80
  redacted lines of 800 characters each. Streaming deltas are not persisted on
  every event.

## Current adapters

| Lane | Read | Write | Seat notes | Probe result on this machine |
|---|---:|---:|---|---|
| Codex / GPT-5.6 Sol high | yes | yes | all five seats | read probe exit 0 |
| Claude Fable | yes | yes | all five seats | CLI installed; local account not authenticated; this sealed review uses the authenticated remote seat |
| Kimi for Coding / K3 subscription | no | yes | orchestrate/build | isolated-temp write-consented prompt probe exit 0 |
| Cline / GLM | yes | yes | all five seats | read probe exit 0; lane reported `z-ai/glm-5.3-flash` |
| Cursor Agent auto | yes | yes | build/review/verify | read probe exit 0 |

Cursor's stream format was checked against live output: timestamped assistant
events are deltas; its untimestamped accumulated assistant and final result
envelopes are suppressed. No generic text-equality dedupe is used. Claude's
known terminal result envelope is similarly suppressed after stream events.

## Evidence produced before review

- `npm run check`: TypeScript check, webview JavaScript parse, 19 Node tests,
  and esbuild compile pass.
- Tests cover bridge validation, path containment, extended credential
  redaction, conversation/note persistence, fleet parsing, invocation arrays,
  Windows shim encoding, process-group stop, lane envelope normalization, and
  hardened local preview serving.
- `distribution/generalstaff-workbench.vsix` packages successfully with license
  notice, extension manifest, compiled host, and media.
- The VSIX installs and activates as `lerugray.generalstaff-workbench` in an
  isolated real VS Code 1.135 profile; the extension-host log has no activation
  error.
- Browser QA exercised dashboard, conversation completion, failure receipt,
  local context attachment, note persistence, edit-consent presentation,
  in-thread route changes, draft preservation/clearing, receipt disclosure, and
  laptop-width layout. A real VS Code window was also inspected with supporting
  panes both hidden and open.

## Known limitations presented for judgment

1. Windows discovery and safe `.cmd` invocation have unit coverage but have not
   been run on a Windows host during this session.
2. Kimi cannot offer the product's read-only boundary and is therefore visible
   only after edit access is selected.
3. Conversation continuity is implemented by persisted transcript handoff, not
   provider-native session resume. There is no dedicated Retry button yet; the
   operator can continue in the same conversation or issue a new command.
4. The current slice uses subscription CLIs. Direct OpenAI-compatible provider
   adapters named in the longer-term contract are not part of this slice.
5. Structured fleet attention items exist, but provider-raised decisions are
   currently rendered as normalized activity/text rather than a dedicated
   decision-card event.
6. Process cleanup is owned on normal stop, panel close, and extension disposal.
   A full OS or extension-host crash can still outlive the JavaScript cleanup
   path until the child exits or is externally terminated.
7. The package targets VS Code `^1.135.0`; the newest published `@types/vscode`
   available to the local package manager during implementation was 1.134.

## Files to prioritize

- `docs/GS-WORKBENCH-V2-PRODUCT-CONTRACT.md`
- `workbench-extension/src/extension.ts`
- `workbench-extension/src/adapters/cliAdapter.ts`
- `workbench-extension/src/services/lanes.ts`
- `workbench-extension/src/services/conversations.ts`
- `workbench-extension/src/services/previewServer.ts`
- `workbench-extension/src/services/processInvocation.ts`
- `workbench-extension/src/bridge/messages.ts`
- `workbench-extension/src/security/`
- `workbench-extension/media/workbench.js`
- `workbench-extension/test/`
- `scripts/build-workbench.*`
- `scripts/launch-workbench.*`
- `distribution/generalstaff-workbench.code-workspace`
