# GeneralStaff Workbench

A persistent orchestrator session for directing a GeneralStaff project fleet from VS Code without turning the operator into a programmer.

Workbench 2.5 opens directly into one full-size **Orchestrator session** rooted at the selected GeneralStaff private repository. The visible transcript, selected model, permissions, and provider continuity belong to that durable session; a follow-up continues the same seat instead of creating a new General-scoped order. The project list is a secondary rail and preserves the existing per-project order flow.

The extension reads canonical project state, presents operator decisions and recent receipts, and streams work from existing Codex, Claude Fable, Kimi, Cline/GLM, Cursor, Grok 4.6 trial, and direct Ollama Cloud GLM 5.3 lanes. The orchestrator seat keeps the model, effort, skill, and supported permission controls available; project orders retain their existing seat choices. Terminals and source files remain supporting instruments.

The session survives webview close/reopen and extension-host restart through host-owned transcript and provider-session storage. Codex, Claude Fable, Kimi, Cursor, and the Grok trial lane resume their native provider conversation when the lane, concrete runner, working directory, permission boundary, and skill still match; Cline, both Ollama Cloud lanes, and any deliberately changed boundary continue from the bounded visible transcript. Closing the panel stops an in-flight provider request or process, records the interruption, and reopens the same recoverable session; it does not claim that background work survived.

The Codex lane explicitly selects GPT-5.6 Sol. Fable prefers an authenticated Claude CLI and safely falls back to an authenticated Cursor subscription with an explicit Fable 5 model. Grok 4.6 rides the Grok subscription CLI first and falls back at discovery time to Cursor Agent's named Grok model when the CLI binary or auth file is unavailable. The Grok CLI always uses provider-default effort; its Cursor fallback preserves the existing named low/medium/high/extra-high mapping. GLM 5.3 (Ollama) and GLM 5.3 Flash (Ollama) are additional read-only direct-API options backed by one authenticated Ollama Cloud catalog and adapter; the existing Cline / GLM lane is unchanged, and Fable remains the default orchestrator seat. The rail also restores the six legacy GeneralStaff Desktop palettes and remembers the local selection.

When the selected GeneralStaff root contains canonical `skills/*/SKILL.md` procedures, the composer exposes them across every lane and accepts `/skill-name` as a leading invocation. The extension host compiles a bounded, credential-redacted bundle with text companion files and translates Claude-specific tool vocabulary into lane-neutral behavior. Skill source never enters the VSIX or webview.

Private runtime helpers are similarly discovered from the selected root and machine. Headroom and Lane Desk are passed ephemerally as native MCP configurations to direct Claude and Codex. Kimi, Cline, Cursor, Cursor-hosted Fable, and the Grok trial lane receive Lane Desk's read-only CLI fallback; Headroom is explicitly unavailable there rather than silently emulated. Direct Ollama Cloud lanes receive neither helper. None of these helpers expands repository or external-action permission.

Ollama Cloud availability requires `export OLLAMA_CLOUD_API_KEY=...` in `~/.generalstaff/.env`. Workbench probes `https://ollama.com/api/tags` with Bearer authentication and enables each picker entry only when its exact tag is present. Runs use the OpenAI-compatible chat-completions door and surface only answer content, never Ollama's separate reasoning field.

Provider session identifiers remain in extension-host storage and are never sent to the webview or raw receipt disclosure. Native sessions are scoped to the selected skill so a procedure change cannot inherit hidden context from the prior skill. New commands still begin read-only; edit access requires host-owned confirmation and is bounded to either the private GeneralStaff repository or a discovered project repository.

## Development

```sh
npm install
npm run check
npm run package:distribution
```

Use `../scripts/build-workbench.sh` followed by `../scripts/launch-workbench.sh` (or the Windows `.cmd` equivalents) for an isolated, immersive local run.
