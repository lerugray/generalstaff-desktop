# Workbench 2.5 corrective note — persistent orchestrator session

Date: 2026-08-28  
Extension: `lerugray.generalstaff-workbench` 0.4.0

## Interaction model found and changed

Workbench 2.4 used the per-project interaction model unchanged: General Command was a pinned `{ kind: "general" }` target, but the operator still filled an order composer, created a command conversation, spawned a non-interactive provider run, and received a result/receipt. It generalized the working directory without creating the daily orchestrator seat.

Workbench 2.5 replaces that General-scoped order box with one host-owned `Orchestrator session`. The extension creates or restores exactly one primary session identity, automatically opens its full transcript, and sends every follow-up into that same conversation. The newest v2.4 General conversation is promoted in place so its transcript and compatible provider session are retained. The rail now labels and presents per-project orders as the secondary flow; their target resolution, creation, routing, permissions, and receipts are otherwise unchanged.

## Session and process semantics

The durable unit is an extension-host session, not an immortal operating-system process. Its visible transcript, routing, decisions, receipt, and host-only provider session identifiers are persisted in VS Code global state. Codex, direct Claude/Fable, Kimi, and Cursor continue through their native provider conversation when logical lane, concrete runner, permission, selected skill, working directory, and latest receipt still match. Cline, boundary changes, and explicit transcript recovery continue through a bounded visible transcript handoff.

The provider CLI process is owned per active turn so the existing streaming, stop, permission, MCP, redaction, and receipt machinery remains intact. Closing an idle panel and reopening it reattaches to the same session. Closing during a turn stops the owned process; completion/interruption is persisted and the same session reopens through the existing recovery desk. No background-process survival is claimed.

The orchestrator session always uses the `orchestrate` seat, while the operator can still choose its model lane, effort, skill, and access boundary. Provider-session IDs remain outside the webview.

## Presentation change

- The default hydration path selects the persisted `orchestratorSessionId`, so the transcript is the full-size opening surface.
- The primary rail control reads `Orchestrator session · Live seat · private root` and sits above the scrolling project controls.
- The session composer says `Message the orchestrator` / `Send`, not `Issue command`.
- The empty transcript invites catch-up, rulings, follow-ups, and dispatches and explicitly says every message continues the same session.
- The project rail is labeled `Project commands`; project composers continue to use the order interaction.

## Verification

- `./scripts/build-workbench.sh` passed TypeScript, webview syntax, all **57/57** Node tests, esbuild compilation, and VSIX packaging. `npm audit --omit=dev` found zero vulnerabilities.
- `test/orchestratorSession.test.ts` exercises extension-host behavior rather than source matching. It records a first message and provider session, reconstructs both the store and session manager as a reopen would, verifies the same session ID/native provider ID/transcript return, then appends a context-dependent second message to the same persisted transcript. A second test proves in-place v2.4 migration and transcript continuity for Cline.
- The UI hierarchy test proves the orchestrator session hydrates as the active conversation, precedes the project-order rail, and uses session language.
- `npm run probe:general-command -- '/Users/rayweiss/Desktop/Dev Work/generalstaff-private' codex` now parses and runs. It reached the production adapter and returned the expected General target/root receipt envelope; the managed sandbox then denied Codex's in-process app-server initialization with `Operation not permitted`. The former `u`-flag regex `SyntaxError` is fixed.
- `scripts/launch-workbench.sh` was run unchanged with the private root. It force-installed `lerugray.generalstaff-workbench@0.4.0` into `.workbench-data/extensions`; a follow-up profile query reported that exact version. The environment exposed no connected browser surface and produced no new extension-host window log, so a clicked visual/multi-turn GUI pass is not claimed.
- The packaged VSIX contains the 0.4.0 manifest, Workbench 2.5 session-first webview, and compiled session manager. SHA-256: `28fa83e8878a177fc0ce9777d7cedde837891cc51422df3071022214c4f52267`.

## Harvest probe for an operator-visible run

Open the Workbench and confirm the full-size `Orchestrator session` is selected. Use one model and unchanged access/skill settings for both turns.

1. Send: `For this session only, remember the exact phrase "amber heron 7281". Reply with exactly GS_MEMORY_SET.`
2. After the answer completes, send: `Without asking me to repeat it, reply with GS_MEMORY=<the exact phrase from my previous message>. Then run pwd exactly once and add a second line GS_CWD=<the exact pwd output>.`

Pass requires the second answer to contain `GS_MEMORY=amber heron 7281` and `GS_CWD=/Users/rayweiss/Desktop/Dev Work/generalstaff-private` (or the operator's exact configured `GENERALSTAFF_ROOT`). Close and reopen between the two turns for the stronger reattachment variant; the same transcript must reopen and the second answer must still pass.

The requested checkpoint commit was attempted with message `Workbench v2.5: persistent orchestrator session`, but this workspace exposes `.git` read-only and Git could not create `.git/index.lock` (`Operation not permitted`). The completed changes remain in the working tree. No push or release was attempted. `scripts/launch-workbench.sh` and its profile/install contract were not changed.
