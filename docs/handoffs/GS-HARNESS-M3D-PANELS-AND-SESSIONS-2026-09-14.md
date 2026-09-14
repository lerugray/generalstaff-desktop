# GS harness — M3d: Lanes/Desk become toggleable windows; session management like Claude Code's sidebar (follow-up to M3c, a78357e)

Read first: `docs/handoffs/GS-HARNESS-M3C-CONTEXT-CEILING-2026-09-13.md` (shape and gates of the prior
milestone), `workbench-extension/src/extension.ts` (activation, `openOnLaunch`, how the Command Deck /
Lanes / Desk panels are created and revealed), `workbench-extension/src/lanesPanel.ts`,
`workbench-extension/src/deskPanel.ts`, `workbench-extension/src/services/conversations.ts`
(`ConversationStore`, `generalstaff.conversations.v1`), `workbench-extension/src/services/orchestratorSession.ts`,
`workbench-extension/media/workbench.js` (the deck render, incl. `renderLanes()`), `workbench-extension/package.json`
(`contributes.viewsContainers` / `views` / `commands`), `distribution/generalstaff-workbench.code-workspace`
(immersive settings: tabs hidden, activity bar, status bar hidden), `README.md` §Versions, and
`workbench-extension/scripts/render-m3c-proofs.ts` (how proofs are rendered).

## Why (operator report, 2026-09-14, verbatim spirit)

"Now it's barely usable. I asked for possible windows into lanes and the desk but they shouldn't be clogging
up the main view making everything impossible to read; they should be windows you can toggle rather than make
the rest of the program impossible to see/use. Also I can't figure out how to clear out a session and start
fresh — there is still the deepseek test from earlier and there seems to be no way to start / look through /
archive / rename sessions as there is on the left in the Claude Code harness."

Diagnosis from the source (verify it yourself before changing anything): `extension.ts` around lines 865-875
opens `LanesPanel.show(context, ViewColumn.Beside)` AND `DeskPanel.show(context, ViewColumn.Beside)` at
activation when `generalstaff.openOnLaunch` is true, and the activity-bar view visibility handlers (~825-828)
open them Beside again. With the workspace's immersive settings (`workbench.editor.showTabs: none`,
`editorActionsLocation: hidden`, status bar hidden) the operator gets three webviews splitting one editor
group, no tabs to close, and a deck too narrow to read. `renderLanes()` additionally embeds the whole
"Your model bench" grid inside the deck itself. There is exactly one host-owned orchestrator conversation
plus per-project conversations in `ConversationStore`; nothing lists, names, archives, or clears them.

## Deliverable (Workbench 0.4.16) — two parts, one branch

### Part A — the deck is the only thing that opens; Lanes and Desk are toggles

1. On launch, ONLY the Command Deck opens, full width, `ViewColumn.One`. Never open Lanes or Desk at
   activation, never on view-visibility events, never as a side effect of refresh.
2. Lanes and Desk each become an on-demand window with an explicit toggle. Implement them as
   `WebviewViewProvider`s hosted in the **secondary side bar** (auxiliary bar) — one view container
   "GeneralStaff" with two collapsible views "Lanes · detached runs" and "Desk · handoff packets" — so a
   single keystroke/button shows or hides both without touching the editor group. Keep the existing
   `generalstaff.openLanes` / `openDesk` commands but make them focus/toggle that side bar view instead of
   creating editor panels. Delete the `createWebviewPanel` path for Lanes and Desk (supersession means
   deletion; do not leave a second way to open them).
3. The deck's topbar gets two small toggle buttons, "Lanes" and "Desk" (with the live badge counts the
   panels already compute), and one keyboard chord for each (document them in the README). Toggling shows
   the auxiliary bar with that view focused; toggling again hides the auxiliary bar. The immersive
   workspace settings must not hide the auxiliary bar (`workbench.auxiliaryBar`-related settings stay
   default); keep the activity bar setting exactly as the committed workspace file has it — do not fight
   the operator's local copy.
4. Remove `renderLanes()` (the "Your model bench" grid) from the deck. The seat picker already carries
   model + ceiling; the bench belongs in the Lanes window. Replace it with nothing — not a collapsed strip.
5. The deck must be readable at 1280 px wide and at 1024 px: the composer, the hero stats, attention and
   activity blocks each get the full column. Add a Playwright proof at both widths.

### Part B — sessions: new / browse / rename / archive / clear, like the Claude Code sidebar

6. Extend `ConversationStore` (bump the storage key to `generalstaff.conversations.v2` with a one-way
   migration from v1 that preserves every existing conversation): each conversation gains `title`
   (operator-editable; default = first 48 chars of its first user message, or "Orchestrator session" /
   the project name), `createdAt`, `updatedAt`, `archivedAt?: number`. The orchestrator scope may hold
   MANY conversations; exactly one is active per scope. "New session" creates a fresh conversation in the
   current scope with no transcript, no provider session id, and makes it active; the previous one stays
   listed. Provider session ids stay host-only as today.
7. A **Sessions** view in the primary side bar under the existing Command container (a `TreeView`,
   id `generalstaff.sessionsNav`): sections "Orchestrator" and "Projects", each listing conversations
   newest-first with title, relative time, lane/model of the last turn, and an "archived" section at the
   bottom (collapsed by default). Inline actions on each row: Open (switch the deck to it), Rename (input
   box), Archive / Unarchive, Delete (confirm; removes transcript and its provider-session mapping). A
   title-bar action "New session" and a filter box. The deck's topbar shows the active session's title
   and a "New session" button; clicking the title opens the Sessions view.
8. Clearing = Delete or New session. There must be an obvious way, from the deck alone, to start fresh
   without hunting: the "New session" button in the topbar and the same command in the palette
   (`GeneralStaff: New Session`). Add commands: `generalstaff.newSession`, `generalstaff.renameSession`,
   `generalstaff.archiveSession`, `generalstaff.unarchiveSession`, `generalstaff.deleteSession`,
   `generalstaff.showSessions`, `generalstaff.toggleLanes`, `generalstaff.toggleDesk`.
9. Switching sessions never kills a running turn silently: if a turn is in flight, the switch asks
   (Stop and switch / Cancel). Deleting the active session while a turn runs is refused with a message.
10. The existing "deepseek test" conversation the operator mentioned must survive migration as a listed,
    renameable, archivable session — prove the migration on a fixture built from the v1 shape.

## Gates (every one, on your branch, before you reply)

- `npm run check` green (extend the tests: v1->v2 migration incl. a v1 fixture with one orchestrator and
  one project conversation; new/rename/archive/delete state transitions; "only the deck opens on launch"
  asserted at the activation seam; toggle commands idempotent).
- Bump `workbench-extension/package.json` to 0.4.16, README §Versions entry, README section describing the
  two toggles, the chords, and the Sessions view — plain prose, no marketing.
- Proofs, rendered with a `scripts/render-m3d-proofs.ts` in the pattern of the M3c script: the deck alone
  at 1280 and 1024 (paper + night), the deck with the auxiliary bar shown (Lanes focused), and the Sessions
  view populated with three sessions incl. one archived. Write them to `docs/handoffs/GS-HARNESS-M3D-PROOF-*.png`.
  Each proof is a real render of the real webview HTML with fixture data, never a mockup.
- Build the VSIX (`workbench-extension` build script) and confirm it packages; do not install anything.
- Commit on your branch with clear messages, do not open a PR, do not merge, and reply with: the branch
  name, the list of files changed, the check counts, and the proof filenames. Say plainly anything you
  could not do.

## Do not

- Do not re-add any auto-open of Lanes/Desk anywhere. Do not keep the editor-panel code path "as a fallback".
- Do not change the seat picker, the context-ceiling code, the lanes/desk data services, or the privacy /
  redaction layers except where the view-host change strictly requires it.
- Do not touch anything under `src-tauri/` or the legacy `src/`.
