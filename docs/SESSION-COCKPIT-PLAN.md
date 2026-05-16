# generalstaff-desktop — Session Cockpit Plan

The build plan for the interactive layer: turning the v0.0.1 read-only
viewer into a daily-driver orchestration cockpit. Locked by Ray
2026-05-16; supersedes `DESIGN.md` locked-decision 4.

## What this supersedes

`DESIGN.md` decision 4 locked a *compose-and-fire* child-session model:
write a prompt, fire `claude -p` (headless), render the streamed output
read-only, `--resume` to continue — interactive PTY deferred to "later"
on cross-platform-reliability grounds.

That model is reversed. Compose-and-fire is itself a custom chat UI
built on headless mode — it reimplements the conversation loop, the
output rendering, the mode toggle. It cannot function identically to
Claude Code, and drifts behind every Claude Code release. The
reliability rationale for deferring a PTY was also overweighted: this is
Ray's personal tool on his own Macs, not a shipped cross-platform
product, and `portable-pty` + `xterm.js` is mature, well-trodden tech —
it is what the VS Code integrated terminal runs.

## The pivot — a thin wrapper

A *session* is the real `claude` (or `cursor-agent`) CLI process,
running under a PTY, rendered in an `xterm.js` terminal. The desktop
does not reimplement Claude Code — it runs it. Auto-mode toggle, output
structure, streaming, resumption: all inherited for free, and they stay
correct through every future Claude Code update. The wrapper's whole job
is four verbs — spawn the process, draw the terminal, route keystrokes,
manage tabs.

## Architecture

1. **Session = a terminal tab.** Rust side: a session manager over the
   `portable-pty` crate. Tauri commands `spawn_session` / `write_session`
   / `resize_session` / `kill_session` / `list_sessions`. PTY output is
   streamed to the frontend over Tauri events (base64 chunks keyed by
   session id). Frontend side: each session tab hosts an `xterm.js`
   terminal bound to a session id.

2. **The v0.0.1 viewer stays.** The fleet rail remains the always-on
   left spine. The briefing, each project workbench, and each session
   are tabs in the main area. The four existing read-only commands and
   the file-watcher are untouched — this layer is purely additive.

3. **Spawn path 1 — the UI.** From a project workbench, "Start session
   here": pick agent, optional seed prompt → a new session tab, the
   agent process running in that project's repo.

4. **Spawn path 2 — the dispatcher, from chat.** A small stdio MCP
   server (`gs-mcp`, built alongside the app) gives every spawned
   `claude` session a `spawn_session` tool. Calling it drops a request
   file into `~/.generalstaff-desktop/requests/`, which the app watches
   — so a dispatcher session (a `claude` session in generalstaff-private)
   spawns child session tabs from plain-English instruction: agent,
   repo, seed prompt, mode. A file-request queue rather than an
   in-process HTTP server: a simpler transport, and it keeps the MCP
   server out of the app's process space (the coupling the audit
   flagged).

5. **Autonomous launches** run `claude -p` / `cursor-agent -p --trust`,
   rendered in a tab so the run is watchable, marked done on process
   exit.

## Audit constraints (Hammerstein, 2026-05-16 — folded in)

- **Phase 0 is a hard go/no-go gate.** Before any tab/spawn code,
  `claude` and `cursor-agent` must render, accept input, resize, and
  exit cleanly inside `xterm.js`-in-Tauri. If the gate fails, the
  fallback is hybrid — an external terminal for interactive work — not
  grinding on terminal emulation.
- **Explicit spawn environment.** Spawned processes get a deliberately
  constructed environment — `PATH` (with `~/.local/bin`,
  `/opt/homebrew/bin`), `TERM=xterm-256color`, `HOME` — not a blind
  inherit. This pre-empts the `claude: command not found` exit-127 class
  of failure.
- **No ANSI parsing.** Session state (for tab badges, notifications) is
  derived only from process lifecycle (running / exited) and an
  output-idle timer. The desktop never scrapes the terminal stream to
  infer what the TUI is doing — that is the chat-UI-reimplementation rot
  the pivot exists to escape. Badges report running / idle / done, not
  "permission prompt waiting."

## Phases

- **Phase 0 — spike (gate).** `portable-pty` session manager + vendored
  `xterm.js` + one terminal. Verify `claude` + `cursor-agent` render.
  Hard gate.
- **Phase 1 — the session core.** Tab system (briefing / workbench /
  session tabs); UI-driven spawn; both agents, interactive.
- **Phase 2 — the dispatcher.** In-process HTTP MCP server +
  `gs_spawn_session`; autonomous mode (`-p`).
- **Phase 3 — daily-driver polish.** Native notifications on session
  state-change; needs-you tab badges (lifecycle + idle-timer only);
  session restore on relaunch; quick-switch hotkeys.

### Locked decision — autonomous mode

Autonomous launches ship in Phase 2 as raw headless agent runs
(`claude -p` / `cursor-agent -p`). A later phase wires GeneralStaff's
own cycle machinery — verification gate, diff-review, auto-rollback —
behind autonomous launch, so an autonomous session can optionally be a
*gated GS cycle*. Roadmapped, not built yet. (Ray, 2026-05-16.)

## Task mapping

- **gsd-010** — Phase 0 spike (gate)
- **gsd-011** — Phase 1 session core: tabs + PTY + UI spawn
- **gsd-012** — Phase 2 dispatcher MCP + autonomous mode
- **gsd-013** — Phase 3 daily-driver polish
- **gsd-014** — (later) GS-cycle-gated autonomous launch
