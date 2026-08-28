# GeneralStaff Workbench

GeneralStaff Workbench is the current GeneralStaff Desktop product. It is a conversation-first command surface for directing a GeneralStaff project fleet. An operator chooses a project and a job-shaped seat, describes the outcome in plain English, follows the work, answers decisions, and inspects the result.

This realizes the original GeneralStaff Desktop goal more directly. The conversation is the main instrument. Fleet state, progress, artifacts, source files, diffs, previews, and terminals support the conversation instead of competing with it. The opening Command Deck is organized around what needs attention, what is running, what recently finished, and what the operator can do next.

Workbench 2.3 is a first-party Visual Studio Code extension launched in a dedicated profile. It is the product code in this repository. The earlier Tauri and xterm application is retained as historical product work, not as a second current desktop surface.

## Direct the fleet from one conversation surface

Workbench reads the selected GeneralStaff root and builds its project view from canonical state under `state/`. It shows project missions, task counts, work that needs review or a decision, blocked work, recent completions, and a small shelf of local artifacts. A matching sibling repository enables edit-capable work and project artifacts; a project without one remains available as state-only context.

Conversations are project-scoped and persist across Workbench restarts. Each conversation keeps its selected seat, lane, effort, permission, referenced project files, messages, decisions, and latest receipt. Markdown, local HTML, images, PDFs, source files, diffs, and the integrated terminal open through Visual Studio Code when the operator asks for them.

The rail includes the six palettes carried forward from the legacy desktop: Kriegspiel Paper, Kriegspiel Night, Linen Folio, Map Vellum, Iron Press, and Carbon Folio. Carbon Folio is the default, and the selected palette is kept in local webview state.

The five seats describe the job rather than the vendor:

- **Orchestrate** routes, decides, verifies, and reports.
- **Build** carries out bounded repository work.
- **Review** inspects work without writing.
- **Verify** reruns checks and compares claims with evidence.
- **Fast assist** handles short drafting and mechanical work.

The extension discovers installed, authenticated command-line lanes and exposes only the seat, permission, and effort combinations that each lane supports.

| Lane | Seats | Permission | Continuity |
| --- | --- | --- | --- |
| Codex, pinned to GPT-5.6 Sol | All five | Read or edit | Native provider session |
| Claude Fable, with an authenticated Cursor Fable fallback | All five | Read or edit | Native provider session, scoped to the concrete runner |
| Kimi K3 | Orchestrate and Build | Edit only | Native provider session |
| Cline / GLM | All five | Read or edit | Bounded transcript handoff |
| Cursor Agent | Build, Review, and Verify | Read or edit | Native provider session |

Codex, Fable, and Cline expose the effort values supported by their non-interactive CLI paths. Kimi and Cursor use the provider default. A native session is reused only when the conversation, logical lane, concrete runner, permission, selected skill, and working directory still match. Otherwise Workbench starts a new session or supplies a bounded recent transcript. Failed and interrupted runs can be retried with a matching native session or reconstructed from the transcript. Provider-raised choices can appear as validated decision cards with one recorded answer.

## Skills and private runtime tools

Workbench 2.3 can apply canonical procedures from `skills/<id>/SKILL.md` in the selected GeneralStaff root across every lane. The composer lists discovered skills and accepts a leading `/skill-name`. The extension host bundles the selected `SKILL.md` with safe text companions, rejects symlinked skill directories, excludes the `lean-ctx` tombstone, enforces file and character limits, and redacts common credential shapes before dispatch.

Private runtime helpers are discovered from the operator's machine rather than packaged with the extension. Headroom and Lane Desk are passed to direct Claude and Codex runs as ephemeral MCP definitions. Kimi, Cline, Cursor, and Cursor-hosted Fable can use Lane Desk through its read-only CLI route; Headroom is reported unavailable on those lanes because there is no equivalent safe transport. Lane Desk remains observational. Neither helper changes the selected repository permission or grants authority for external actions.

Private skill source, MCP launch paths, and provider session identifiers do not enter the VSIX or webview. The receipt discloses the selected skill and available capability names, not their private definitions.

## Install and run

The repository launcher expects Visual Studio Code 1.135 or newer, Node and npm for the source build, and at least one supported provider CLI that is already authenticated. Build the extension and stable package once:

```bash
./scripts/build-workbench.sh
```

Then open the isolated Workbench profile:

```bash
./scripts/launch-workbench.sh
```

On Windows, use `scripts\build-workbench.cmd` and `scripts\launch-workbench.cmd`. Set `CODE_BIN` if Visual Studio Code is installed somewhere the launcher does not discover.

The build script runs the Workbench checks and writes `distribution/generalstaff-workbench.vsix`. The launcher installs that package into the repo-local, gitignored `.workbench-data/` profile and opens the dedicated Workbench workspace. It does not install into or modify the operator's normal Visual Studio Code profile. On first run, choose the GeneralStaff root that contains `state/`; the choice is stored as a machine-scoped setting in the isolated profile.

For extension development, run the checks from the extension directory:

```bash
cd workbench-extension
npm ci
npm run check
```

`npm run check` performs the TypeScript check, validates the webview script syntax, runs the Node test suite, and compiles the extension. The automated suite covers the message, persistence, adapter, permission, path, redaction, decision, continuity, theme, skill, and private-runtime boundaries; `npm run check` reports the current count.

## Architecture boundary

Workbench uses the stable Visual Studio Code extension API and a dedicated workspace profile. The extension host owns filesystem access, provider discovery, process launch, persistence, redaction, and permission checks. The webview is presentation code behind a validated message allowlist and a restrictive content policy. Visual Studio Code supplies the editor, diff viewer, Markdown renderer, browser preview, source control, and terminal.

This is a thin distribution by design, not a fork of Visual Studio Code or Code OSS. A future branded Code OSS package may replace the outer shell, but the Workbench extension remains the product logic. The repository layout reflects that boundary:

| Path | Status |
| --- | --- |
| `workbench-extension/` | Current Workbench product code |
| `scripts/` and `distribution/` | Check, package, and isolated-profile launch layer |
| `docs/GS-WORKBENCH-*` | Product contract, implementation notes, and review evidence |
| `src/` and `src-tauri/` | Superseded Tauri/xterm prototype retained for history |

The legacy prototype proved fleet state, tray attention, pings, progress, notifications, and session machinery. Its primary interaction remained an embedded terminal, so it became a decorated terminal multiplexer rather than the intended command surface. New operator-facing behavior belongs in `workbench-extension/`.

## Permissions, privacy, and redaction

New conversations begin read-only. Edit access is visibly distinct, requires a repository matched to the selected project, and requires confirmation in a host-owned Visual Studio Code dialog. Kimi is shown only for its supported edit-capable path because its non-interactive prompt mode cannot provide the claimed read-only boundary. Child processes are spawned with an executable and argument array in the resolved project directory, not with concatenated shell commands.

The webview has no unrestricted filesystem or network access. Incoming messages are type-checked and size-bounded. File references and open-file requests must resolve inside the selected GeneralStaff state or registered project roots. Provider credentials remain in an authenticated CLI or its existing credential store. They are not written to workspace settings, receipts, transcripts, or the VSIX.

Provider session identifiers are stored separately in extension-host state and are never sent to the webview. Provider output, surfaced errors, and receipts pass through redaction for common private-key, API-key, token, password, home-directory, and session-identifier patterns. Compiled skill text is separately redacted for the common credential and identity patterns before dispatch. Redaction is a containment layer, not a claim that arbitrary sensitive text can always be recognized.

Workbench is a local control surface, but the selected provider still receives the task text and any bounded transcript or skill bundle needed for that run. Referenced local files are supplied as paths for the selected lane to read within its permission boundary. Operators should choose lanes and context with that data flow in mind.

Stopping a run or closing the Workbench asks the owned process tree to terminate. A full operating-system or extension-host crash can still outlive JavaScript cleanup until the provider exits or is terminated separately.

## Relationship to the GeneralStaff CLI and gate

Workbench is the desktop command surface. The GeneralStaff CLI remains the task dispatcher and verification gate. Workbench reads the same project state and gives the operator a place to direct provider lanes, inspect results, and open a supporting terminal for direct CLI work.

A completed conversation and its receipt show what a provider ran and reported. They do not run or satisfy the GeneralStaff cycle gate, and they do not make an agent's success claim authoritative. GeneralStaff's existing independent verification and reviewer gates remain the boundary for gated work.

## Further reading

- [`docs/GS-WORKBENCH-V2-PRODUCT-CONTRACT.md`](docs/GS-WORKBENCH-V2-PRODUCT-CONTRACT.md) defines the product promise and safety boundary.
- [`docs/GS-WORKBENCH-V2.1-IMPLEMENTATION-NOTE.md`](docs/GS-WORKBENCH-V2.1-IMPLEMENTATION-NOTE.md) records continuity, recovery, and decision cards.
- [`docs/GS-WORKBENCH-V2.2-THEMES-EFFORT-PROFILE-NOTE.md`](docs/GS-WORKBENCH-V2.2-THEMES-EFFORT-PROFILE-NOTE.md) records themes, effort controls, and provider runners.
- [`docs/GS-WORKBENCH-V2.3-SKILLS-MCP-NOTE.md`](docs/GS-WORKBENCH-V2.3-SKILLS-MCP-NOTE.md) records the skill bridge and private runtime tools.

## License

[AGPL-3.0-or-later](LICENSE). Copyright (C) 2024-2026 Ray Weiss.
