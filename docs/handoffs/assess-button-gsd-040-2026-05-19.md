# Handoff — gsd-040: Assess button (task + ping rows)

**For:** a Claude Code session in this repo (`generalstaff-desktop`).
**Filed:** 2026-05-19, from a GeneralStaff reconcile session — Ray's idea
plus a read of the current Dispatch wiring at HEAD `f27185a`.
**Task entry:** `gsd-040` in
`generalstaff-private/state/generalstaff-desktop/tasks.json`.

## The feature

An **Assess** button beside the existing **Dispatch** button, on (1)
pending task-ledger rows and (2) `task`-kind ping rows. Clicking Assess
opens a claude session — exactly like Dispatch — but seeded with an
**assessment-only** prompt: scope the item, check the project's git log
and state for whether it is still needed / already done / obsolete,
report a verdict, and **change nothing**.

Dispatch = "go do it." Assess = "first tell me if this is real and what
it costs." It is the per-row, pre-flight counterpart of the dashboard's
fleet Reconcile pass (gsd-027), and the audit-before-prompt discipline —
*a `pending` ledger entry is not proof the work is needed* — turned into
a one-click affordance.

Sibling task: **gsd-039**, the dashboard task-staleness nudge, is the
*passive* version of the same concern (GSD telling you a task looks
done). gsd-040 is the *active* per-item check. They ship independently —
don't conflate them.

## Why it's small — no Rust change

Assess is Dispatch with a different seed prompt. The backend already
does everything needed: `build_command` (`src-tauri/src/sessions.rs:143`)
runs an interactive claude session with the seed prompt as the first
message (`:195-200`). The whole feature lives in `src/app.js` plus one
CSS rule. No new Tauri command.

## Current Dispatch wiring (what to clone)

**Task path:**
- `loadTaskLedger` → `rowHtml` (`app.js` ~1113-1129) renders a
  `.task-dispatch` button on each *pending* row.
- Listener loop (`app.js` 1143-1147) wires it to `dispatchTask(id, task)`.
- `dispatchTask` (`app.js` 1155-1177) builds a prompt string and calls
  `startSession("claude", proj.repo_path, prompt, msg)`.

**Ping path:**
- `renderPingRows` (`app.js` 1391-1503): the `task`-kind branch
  (1434-1439) emits `targetSelectHtml(...)` + an `act-dispatch` button.
- The `.ping__act` listener loop (1468-1486) routes `dispatch` →
  `dispatchPing(btn, ping)`.
- `dispatchPing` (`app.js` 1352-1371) resolves the target repo from the
  row's `<select>` and calls
  `startSession("claude", cwd, dispatchPrompt(ping, projectId), …)`.
- `dispatchPrompt` (`app.js` 1263-1300) builds the ping seed prompt — note
  it appends a `GS-Ping:` commit trailer. Assess must **not**: it commits
  nothing.

## Implementation shape

1. **Task rows** — add an `Assess` button next to `.task-dispatch` in
   `rowHtml`; wire it in the listener loop to a new `assessTask(id, task)`.
2. **Task pings** — add an `act-assess` button next to `act-dispatch` in
   `renderPingRows`'s `task` branch; route it in the `.ping__act` loop to
   a new `assessPing(btn, ping)`.
3. **`assessTask` / `assessPing`** — near-copies of `dispatchTask` /
   `dispatchPing` that call `startSession` with an assess prompt instead.
   For pings, reuse the same target `<select>` so Assess opens in the
   right repo.
4. **CSS** — style `.task-assess` / `.ping__act.act-assess` as a
   *secondary* sibling of Dispatch (`styles.css` ~1280 for the task
   button, ~816 for `.ping__actions`). Assess is the lighter action —
   visually quieter than Dispatch.

## Design calls already resolved (from the source review)

- **It opens a session tab, not a background probe.** GSD's whole model
  is "spawn a claude session"; there is no headless-verdict-ingestion
  mechanism, and v1 doesn't need one. You read the verdict in the session
  tab, the same way you watch a Dispatch session. This is also literally
  what Ray asked for — "assess it in a CC window."
- **Interactive mode, like Dispatch** (not autonomous `-p`).
- **Both task rows and `task` pings** get it. `idea` pings keep just
  Scaffold — Scaffold already carries assess-flavoured framing ("scope it
  with /audit … tell me honestly if it should not be one").
- **No new "promote to Dispatch" button.** The assess session has the
  gs-mcp dispatcher tool wired in (`sessions.rs:210-218`) — if its verdict
  is "real," it can open a child Dispatch session itself, or you just
  click Dispatch afterward. No extra UI for v1.

## Draft assess seed prompt — task variant (refine to taste)

> This is an **assessment pass — make no changes and do not commit.**
>
> Task from the {projectId} ledger
> (`generalstaff-private/state/{projectId}/tasks.json`):
>
> {task.id} — {task.title}
>
> This session is open in the {projectId} repo. Read the git log and the
> current project state. Tell me plainly: is this task still real and
> needed, already done, obsolete, or in need of rescoping? If it's real,
> what would it actually take to do? Give a one-paragraph verdict with a
> short rationale — and change nothing. (A `pending` ledger entry is not
> proof the work is needed.)

Ping variant: same shape, fed `ping.body` instead of a task id/title, and
with **no** `GS-Ping:` trailer.

## Before building

Per the gsd-027 / gsd-038 / gsd-039 precedent, `/audit` the concrete
implementation plan before writing code.
