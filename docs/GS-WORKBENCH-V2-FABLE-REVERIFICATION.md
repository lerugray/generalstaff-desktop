ExitPlanMode isn't available in this session's toolset, so the reverification below is the deliverable (also saved to `/home/ray/.claude/plans/read-docs-gs-workbench-v2-fable-sealed-r-abundant-bumblebee.md`). No files were edited or executed in the snapshot.

---

# GeneralStaff Workbench v2 — sealed re-verification

**Reviewer:** Claude Fable (remote seat, per Gate E) · **Date:** 2026-08-27 · **Candidate:** `codex/gs-workbench-v2-20260827` snapshot at `/tmp/gswb-sealed-reverify` · **Posture:** read-only

## Verdict: `READY`

All five blockers are closed in the current source, each in the shape the sealed review's correction asked for, and I found no regression introduced by the fixes.

## Blocker closure

1. **Private-root / sibling mapping — closed.** `siblingRepoMap` skips any entry whose resolved path equals the root (`src/services/fleet.ts:72`) and fails closed on normalized-name collisions, order-independently (`fleet.ts:76-81`). `test/fleet.test.ts:47-63` constructs both failure cases from the finding (private-root collision via `state/generalstaff`; then `generalstaff` + `general-staff` ambiguous siblings) and asserts `repoPath` stays unset; the first fleet test proves a legitimate sibling still maps. Host write gates unchanged (`extension.ts:124,159,229,233`).

2. **Windows shim argument boundary — closed.** PowerShell and `cmd.exe` are gone entirely (repo-wide sweep: no remnants). Win32 `.cmd`/`.bat` targets are parsed for their `node_modules` entry (npm cmd-shim `%dp0%` format) and Node is spawned directly with an argv array; unparseable wrappers throw (`processInvocation.ts:27-45`). The adapter spawn routes through the resolver with no shell (`cliAdapter.ts:271-283`). `adapter.test.ts:97-112` asserts an `&`-bearing prompt survives as exactly one argv element and unsupported wrappers fail closed; the throw is caught at both call sites (`extension.ts:322-326`, `lanes.ts:119-123`), so fail-closed can't crash the host.

3. **Windows probe path — closed.** Probes share the resolver inside a try/catch surfacing shim errors as lane detail; timeout is 12 s and is reported distinctly from auth failure (`lanes.ts:117-145,166-170`). `scripts/windows-shim-smoke.ts` imports the production resolver and exercises both the `spawnSync` and `execFileSync` legs with a marker-file non-execution check and exact argv round-trip — the "execFile returns probe stdout intact" confirmation the correction asked for. The `WINDOWS_SHIM_OK` run on real Windows is reported evidence; the script is present and does what the remediation claims.

4. **Evidence-class honesty — closed.** The hardcoded numeric map is deleted (no `87.3`/`87.7` anywhere). `evidenceLabel` is required on `LaneSummary` (`domain.ts:13`) and populated per lane with non-numeric, dated labels — measured lanes name the 2026-08-24 benchmark; Fable is "Daily operator seat · not benchmarked"; Codex stays "Repo-proven · seat provisional" (`lanes.ts:29-83`). The webview renders only from lane data with an honest fallback (`workbench.js:298,418`); the isolated harness mirrors the shape (`visual-harness.html:54-58`).

5. **Engine/type alignment — closed.** `engines.vscode` and `@types/vscode` are both `^1.134.0` (`package.json:14,107`) — the review's explicitly offered alternative correction; the caret range admits the 1.135 host the remediation says was runtime-checked.

## Regression sweep

Nothing previously verified was broken: POSIX invocation is a pass-through and `.exe` CLIs are untouched; Kimi's read-mode refusal, stop semantics, 200k output clip, 80×800 redacted evidence, webview CSP, preview-server hardening, bridge validation, bounded persistence (30 conversations / 10k notes), and read-by-default resets on every new-conversation entry path (`workbench.js:14,532,549,554,716,726`) are all intact. Only three production `child_process` call sites exist, none with a shell. The absorbed follow-ups landed cleanly: JWT redaction with test coverage (`redaction.ts:7`, `security.test.ts:30,34`), idempotent `deactivate()` cleanup of runs and preview server (`extension.ts:497-503,536-538`), and the "Reference local files" copy. Static test count is 20 across six files, matching the packet.

**Reported, not independently verified** (same acceptance class as the original review's scope notes): the real-Windows `WINDOWS_SHIM_OK` run, the `npm run check` pass, and VS Code activation — the remediation itself defers the fresh VSIX and final activation check to after this gate.

## Optional follow-up (non-blocking)

- The Gate E Codex-seat session note (`docs/sessions/*codex-seat*.md`) remains outstanding by declared sequencing — write it now that the verdict exists, then produce the stable VSIX and real activation log.
- pnpm/yarn-generated `.cmd` shims won't match `npmEntryPoint`'s npm-shaped patterns and will fail closed with a surfaced detail — designed behavior, just worth remembering on Windows.
- Bare 64-char hex secrets remain unredacted (carried over from the original optional list; JWTs now covered).
