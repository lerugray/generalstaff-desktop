# GeneralStaff Workbench v2 — Fable remediation record

**Date:** 2026-08-27
**Branch:** `codex/gs-workbench-v2-20260827`
**Source review:** `docs/GS-WORKBENCH-V2-FABLE-SEALED-REVIEW.md`
**Initial verdict:** `NEEDS_REVISION` (five release-blocking findings)

This record maps the sealed findings to completed changes. It does not replace
the preserved review.

## Blocking-finding closure

1. **Private-root and sibling mapping boundary — fixed.**
   `siblingRepoMap` now excludes the GeneralStaff root itself. Normalized-name
   collisions fail closed by removing the mapping instead of using
   last-write-wins. A fleet test constructs both the private-root collision and
   two ambiguous siblings and confirms that `repoPath` remains unset.

2. **Windows command-shim argument boundary — fixed.**
   `.cmd`/`.bat` files are no longer invoked through PowerShell or `cmd.exe`.
   The host reads a trusted npm shim, resolves its `node_modules` JavaScript entry
   point, and spawns `node.exe` directly with an argument array. Unsupported
   batch wrappers fail closed.

3. **Windows probe path — fixed and exercised.**
   Lane probes use the same direct-Node resolution. Probe timeouts are surfaced
   distinctly from authentication failure, and the timeout is 12 seconds.
   `scripts/windows-shim-smoke.ts` bundles the production resolver and verifies
   both the adapter `spawn` path and probe `execFile` path. The bundle ran under
   real Windows Node on home-PC and returned `WINDOWS_SHIM_OK`; an ampersand-
   bearing prompt round-tripped as one literal argument and did not execute its
   marker command.

4. **Evidence-class honesty — fixed.**
   Presentation-layer numeric scores were removed. Each lane now supplies a
   non-numeric `evidenceLabel` through the discovered lane data. Measured labels
   name the historical 2026-08-24 benchmark; Fable is labeled as the daily
   operator seat and explicitly not benchmarked; Codex remains repo-proven and
   provisional.

5. **VS Code engine/type alignment — fixed.**
   `engines.vscode` is now `^1.134.0`, matching `@types/vscode ^1.134.0`. The
   candidate is still installed and runtime-checked in VS Code 1.135, which
   satisfies the product's current-host Gate A without claiming a 1.135-only API
   type surface.

## Non-blocking follow-up absorbed now

- Added JWT redaction coverage.
- Added explicit extension deactivation cleanup for active process trees and the
  preview server.
- Clarified the context action as “Reference local files.”
- Added the required Codex seat session note to the final gate checklist (written
  after re-verification so it can contain the final verdict).

## Post-remediation evidence

- `npm run check`: 20 tests, TypeScript, webview syntax, and compile pass.
- Browser harness: dated, non-numeric evidence labels render from lane data;
  Kimi is visibly disabled as “edit access only” under the read default.
- Real Windows Node smoke: `WINDOWS_SHIM_OK` for both spawn and execFile paths.
- A new stable VSIX and final real VS Code activation check are required after
  the re-review gate.
