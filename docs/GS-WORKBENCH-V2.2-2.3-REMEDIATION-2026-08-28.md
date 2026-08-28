# GeneralStaff Workbench v2.2 + v2.3 — Fable delta remediation

**Date:** 2026-08-28  
**Branch:** `hardening-20260828`  
**Starting HEAD:** `3851024` (`WIP harvest: lane output committed as found (s51 orchestrator)`)  
**Source review:** `GS-WORKBENCH-V2.2-2.3-FABLE-DELTA-REVIEW.md` (`NEEDS_REVISION`, 3 blocking / 7 advisory)

## Outcome

- Blocking findings fixed: **3/3**.
- Advisory findings fixed: **5/7**.
- Tests added: **6**; the inventory increased from the grounded 45 to 51.
- The required `npm run check` reached **50/51 passing**. Its only failure was the pre-disclosed sandbox-only preview listener error, `listen EPERM: operation not permitted 127.0.0.1`. TypeScript and webview syntax passed before that test run; the compile step, which the chained check could not reach, passed when run directly.
- The write/delete probe passed before review or implementation work began.

## Blocking finding 1 — repository-carried runtime execution

### Root cause

`discoverPrivateRuntime()` derived Lane Desk executable files directly from the selected GeneralStaff root, treated readability as verification, and wired them into native provider invocations. Headroom was machine-scoped but likewise had no health probe.

### Remediation

- Added the machine-scoped `generalstaff.laneDeskRuntimePath` setting.
- Lane Desk is now absent unless that setting names an absolute, real directory outside the selected GeneralStaff root. The configured directory itself and its three required files must be non-symlink directories/regular files.
- Workbench runs a bounded, no-shell `status --json` health probe through the configured Python command before exposing either the Lane Desk MCP transport or CLI fallback.
- Headroom must now pass a bounded, no-shell `--help` health probe in addition to the executable check before it is wired.
- Fleet discovery and run-time rediscovery use the same machine-scoped option. A path back into the selected root fails closed even when explicitly configured.

### Regression evidence

`test/privateRuntime.test.ts` plants code in `<selected-root>/tools/lane-desk` that would create a marker if executed, checks both automatic discovery and an explicit setting pointed back into the root, and verifies the capability remains missing, no MCP server is wired, and the marker is absent. A separate test proves an external runtime that fails its health probe also remains unwired.

## Blocking finding 2 — unproven `dontAsk` deny semantics

### Root cause

Read-only direct Claude with MCP changed from provider-enforced `plan` mode to `dontAsk` and depended on the combined semantics of `--tools` and `--allowedTools`. The code demonstrated only that write-capable names were omitted, not that the installed provider denied them.

### Remediation

- Eliminated that semantic dependency. Every read-only direct-Claude invocation now stays in provider-enforced `plan` mode.
- Caller-supplied MCP definitions are stripped from read-only Claude invocations. No read path can emit `--tools`, `--allowedTools`, `--mcp-config`, `dontAsk`, or `acceptEdits`.
- Native MCP remains available to direct Claude only after explicit Workbench write consent. Codex retains its sandboxed native MCP path.
- Added `probe:claude-readonly-boundary`. It constructs the production read invocation, supplies a disposable MCP server with a deliberately unallowlisted `boundary_write` tool, requests Write, Bash, and that MCP tool, and fails unless all are reported unavailable/refused and neither the write marker nor MCP-call marker exists.

This sandbox's direct Claude CLI reports `loggedIn: false`, so the live probe stopped before a model call with `An authenticated direct Claude CLI is not available.` No denial result is claimed. The blocker is nevertheless closed mechanically because the risky `dontAsk` profile no longer exists; the retained live probe can independently exercise the stronger `plan` boundary on an authenticated host.

### Regression evidence

- `test/adapter.test.ts` passes MCP servers into a read-only Claude invocation and asserts exact `plan` mode plus absence of every MCP/tool-permission flag.
- `test/claudeBoundaryProbe.test.ts` asserts the probe uses that exact production shape and that its evaluator fails closed for a created marker, a called unallowlisted MCP tool, or any missing denial.

## Blocking finding 3 — receipt capability honesty

### Root cause

Receipt decoration used installation state only. It ignored the effective runner, permission, native transport, and CLI fallback, so unavailable Headroom could be claimed and Lane Desk fallback was indistinguishable from MCP.

### Remediation

- Added one effective-transport decision used by prompt language and receipt labels.
- Native labels are emitted only when the capability is actually attached to that lane/runner/permission.
- Lane Desk fallback is labeled `Lane Desk (CLI fallback)`.
- Direct-Claude read receipts name neither private capability because that profile now retains `plan` and strips MCP.
- Non-native lanes never claim Headroom. Prompt text explicitly says unattached helpers are not attached and must not be claimed.

### Regression evidence

`test/privateRuntime.test.ts` covers Codex read/native, direct-Claude read/unattached, direct-Claude write/native, Cursor-hosted Fable fallback, and Kimi fallback. It also checks the direct-Claude read prompt names both helpers as unattached.

## Advisory dispositions

1. **Fixed — metadata/preamble redaction and total cap.** Skill name, description, and relative headings pass through the shared redactor. Absolute source paths were removed from the provider preamble. The compatibility contract and file sections now share the single 260,000-character total cap, and `characterCount` reports the complete dispatched prompt.
2. **Fixed — pre-read file cap.** Skill files larger than 512,000 bytes are rejected from `lstat` metadata before `readFile`; the existing 80-file and 260,000-character aggregate bounds remain.
3. **Fixed — hard links.** Text files with `nlink > 1` are excluded. The regression hard-links an out-of-tree secret into a skill and verifies it is not bundled.
4. **Skipped — argv limits.** One-line reason: provider-specific stdin behavior for Kimi, Cline, Cursor, and Windows has not been live-validated, so changing prompt transport is not a small safe patch in this sandbox.
5. **Fixed — package provenance.** Rebuilt the 10-file `distribution/generalstaff-workbench.vsix`; SHA-256 is `35f92dbd420a94537fea4b918a4f7df626e9dead1715589de11498ac83f4550d`, and archive inspection confirms the remediated `0.2.3` host bundle. No `code`, `code-insiders`, or `codium` CLI is exposed here, so a new isolated install could not be performed and is not claimed.
6. **Skipped — live effort matrix.** One-line reason: the needed authenticated/paid provider calls are unavailable here (direct Claude is logged out), and argv-only tests cannot honestly substitute for provider acceptance evidence.
7. **Fixed — premature slash-skill persistence.** `setSkill` now runs only after lane, permission, repository, runtime, continuity, and skill-bundle preparation have succeeded, immediately before the run reservation and message append.

## Verification detail

### Targeted checks

- Private-runtime, adapter, Claude-boundary, and skill tests passed after their respective changes.
- `npm run typecheck` passed after each blocking/advisory group.
- `git diff --check` passed.
- `npm run compile` passed: esbuild produced `dist/extension.js` and its source map.
- No `README.md` diff exists. `node_modules` remains the pre-existing untracked symlink; no install command was run.

### Required full check

Command: `cd workbench-extension && npm run check`

- TypeScript: pass.
- Webview JavaScript syntax: pass.
- Node tests: 51 total, 50 pass, 1 fail.
- Sole failure: `test/preview.test.ts`, `listen EPERM: operation not permitted 127.0.0.1`.
- Compile in the chained command: not reached because npm stopped at the known listener failure.
- Direct follow-up `npm run compile`: pass.

### Package

- Command: `npm run package:distribution`.
- Result: 10 files, 47.98 KB.
- SHA-256: `35f92dbd420a94537fea4b918a4f7df626e9dead1715589de11498ac83f4550d`.
- Isolated install: unavailable because no VS Code-family CLI is on `PATH`.

## Repository/commit state

The requested per-finding commit checkpoints were attempted after blocking finding 1. Git could not create the linked-worktree lock at `/Users/rayweiss/Desktop/Dev Work/generalstaff-desktop/.git/worktrees/wt-gsd-hard/index.lock` and returned `Operation not permitted`. That parent `.git` location is read-only in this sandbox, so neither staging nor commits are possible. All remediation changes and the rebuilt VSIX remain in the working tree. Nothing was pushed.
