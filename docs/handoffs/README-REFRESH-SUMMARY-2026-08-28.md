1. Reframed GeneralStaff Workbench 2.3 as the current conversation-first desktop command surface.
2. Explained why Workbench better realizes the original GeneralStaff Desktop operator goal.
3. Documented projects, seats, provider lanes, continuity, recovery, decisions, artifacts, and themes.
4. Documented the v2.3 private skill bridge and the Headroom and Lane Desk transport boundaries.
5. Added source-build, packaging, isolated-profile launch, first-run, and development instructions.
6. Defined the thin Visual Studio Code extension boundary and rejected a long-lived editor-core fork.
7. Marked `src/` and `src-tauri/` as superseded historical prototype code, not the current product.
8. Added the permission, redaction, provider data-flow, process-cleanup, and verification-gate boundaries.
9. Proposed an exact one-line replacement for the public GeneralStaff README without editing that repo.
10. Verification found 38 tests: 37 passed and the preview test hit sandbox `listen EPERM`; all other checks passed, but the commit was blocked because the shared worktree Git metadata is read-only.
