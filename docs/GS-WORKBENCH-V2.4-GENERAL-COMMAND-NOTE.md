# Workbench 2.4 General Command note

Date: 2026-08-28  
Extension: `lerugray.generalstaff-workbench` 0.3.0

Workbench 2.4 makes the private GeneralStaff root a first-class command target. The pinned General Command surface is selected on every Workbench open and does not depend on a discovered project. New commands there use the same lane, seat, effort, skill, permission, continuity, recovery, and decision pipeline as project commands.

The extension host resolves a General target directly to the discovered `GENERALSTAFF_ROOT`. That path is used as the child-process `cwd`, the local-context allowlist root, the supporting-terminal directory, and the provider-session continuity key. Project targets retain their existing sibling-repository/state-path resolution. Legacy stored project conversations migrate to explicit project targets.

## Verification

- `./scripts/build-workbench.sh` passed the 54-test TypeScript/webview/Node suite, compiled the host, and produced the distribution package.
- `scripts/launch-workbench.sh`, with `GENERALSTAFF_ROOT=/Users/rayweiss/Desktop/Dev Work/generalstaff-private`, force-installed `lerugray.generalstaff-workbench` 0.3.0 into `.workbench-data/extensions`.
- The packaged and installed webview contains the default `selectedTargetKind: 'general'`, pinned General Command markup, and Workbench 2.4 label.
- Production Cline and Claude seat processes were launched read-only through the General target. Their provider-origin runtime envelopes both reported `cwd` as `~/Desktop/Dev Work/generalstaff-private`; Cline logged `CLI run started`, and Claude emitted its `system/init` envelope with that cwd.
- The final VSIX SHA-256 is `aeace7e315845445d3c874827c88c74e1c88c861121ed0c581b245a6f161d59f`.

## Environment-limited gaps

The managed execution environment had no connected browser and denied screen capture or launching a separately debuggable VS Code process (`kLSNoLaunchPermissionErr`). The normal launcher did install the final VSIX, but a clicked composer-to-receipt UI pass could not be observed here. The provider seats attempted `pwd`; their tool execution was blocked by the environment's non-interactive approval/filesystem boundary, so the cwd evidence is the provider runtime's own initialization output rather than stdout from `pwd`. Claude also encountered an expired OAuth token after initialization.

Checkpoint commits were requested but could not be created because this workspace exposes `.git` read-only; Git failed creating `.git/index.lock` with `Operation not permitted`. No push or release was attempted.
