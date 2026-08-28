# GeneralStaff Workbench

A persistent orchestrator session for directing a GeneralStaff project fleet from VS Code without turning the operator into a programmer.

Workbench 2.5 opens directly into one full-size **Orchestrator session** rooted at the selected GeneralStaff private repository. The visible transcript, selected model, permissions, and provider continuity belong to that durable session; a follow-up continues the same seat instead of creating a new General-scoped order. The project list is a secondary rail and preserves the existing per-project order flow.

The extension reads canonical project state, presents operator decisions and recent receipts, and streams work from existing Codex, Claude Fable, Kimi, Cline/GLM, and Cursor subscriptions. The orchestrator seat keeps the model, effort, skill, and read/edit controls available; project orders retain their existing seat choices. Terminals and source files remain supporting instruments.

The session survives webview close/reopen and extension-host restart through host-owned transcript and provider-session storage. Codex, Claude Fable, Kimi, and Cursor resume their native provider conversation when the lane, concrete runner, working directory, permission boundary, and skill still match; Cline and any deliberately changed boundary continue from the bounded visible transcript. Closing the panel stops an in-flight provider process, records the interruption, and reopens the same recoverable session—it does not claim that a background process survived.

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
