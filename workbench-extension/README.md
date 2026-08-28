# GeneralStaff Workbench

A conversation-first command environment for directing a GeneralStaff project fleet from VS Code without turning the operator into a programmer.

Workbench 2.4 opens on a pinned **General Staff — orchestrator** target. Its commands run with the selected GeneralStaff private root as their working directory, inheriting that repository's instructions, state, and skills exactly as a terminal opened there would. No project selection is required for fleet catch-up, routing, dispatch, or cross-project questions. Selecting an individual project preserves the existing project-repository flow.

The extension reads canonical project state, presents operator decisions and recent receipts, keeps target-scoped conversations, and dispatches job-shaped work to existing Codex, Claude Fable, Kimi, Cline/GLM, and Cursor subscriptions. General Command and project commands expose the same compatible seats, lanes, effort controls, skills, and read/edit permission choices. Terminals and source files remain available as supporting instruments.

Workbench 2.4 preserves native provider conversations for Codex, Claude Fable, Kimi, and Cursor when the lane, working directory, permission boundary, and selected skill still match. Cline and older conversations receive a bounded transcript handoff. Failed or interrupted work has dedicated native Retry and fresh-session transcript recovery controls, while provider-raised operator choices render as structured decision cards.

The Codex lane explicitly selects GPT-5.6 Sol. Fable prefers an authenticated Claude CLI and safely falls back to an authenticated Cursor subscription with an explicit Fable 5 model. The composer exposes only supported non-interactive effort values for Codex, Fable, and Cline; Kimi and Cursor remain on provider defaults. The rail also restores the six legacy GeneralStaff Desktop palettes and remembers the local selection.

When the selected GeneralStaff root contains canonical `skills/*/SKILL.md` procedures, the composer exposes them across every lane and accepts `/skill-name` as a leading invocation. The extension host compiles a bounded, credential-redacted bundle with text companion files and translates Claude-specific tool vocabulary into lane-neutral behavior. Skill source never enters the VSIX or webview.

Private runtime helpers are similarly discovered from the selected root and machine. Headroom and Lane Desk are passed ephemerally as native MCP configurations to direct Claude and Codex. Kimi, Cline, Cursor, and Cursor-hosted Fable receive Lane Desk's read-only CLI fallback; Headroom is explicitly unavailable there rather than silently emulated. None of these helpers expands repository or external-action permission.

Provider session identifiers remain in extension-host storage and are never sent to the webview or raw receipt disclosure. Native sessions are scoped to the selected skill so a procedure change cannot inherit hidden context from the prior skill. New commands still begin read-only; edit access requires host-owned confirmation and is bounded to either the private GeneralStaff repository or a discovered project repository.

## Development

```sh
npm install
npm run check
npm run package:distribution
```

Use `../scripts/build-workbench.sh` followed by `../scripts/launch-workbench.sh` (or the Windows `.cmd` equivalents) for an isolated, immersive local run.
