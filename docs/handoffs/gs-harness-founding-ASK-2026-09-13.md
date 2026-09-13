# ASK — GeneralStaff Workbench: the personal-harness founding, 2026-09-13

Grounded at generalstaff-desktop branch `publish-v23` @ `d2eb411`, and against
generalstaff-private HEAD `38846534`. Ray gave the GO for this founding at s114,
10:1x EDT, verbatim ruling: "stand up the Workbench (generalstaff-desktop) so
non-Anthropic seats run private-GS orchestration fully — skills, rules, hooks
and memory carrying over, 1M context where the model supports it, and the
Ollama app's Claude toggle configured the same way (cloud models only)."

This is a request for a SPECIFICATION, not code. Fugu specs; coders (cursor/
codex/kimi) implement against the spec. Do not write implementation code in
the response — describe architecture, contracts, and acceptance criteria.

## What already exists (read the fed files before proposing anything new)

`generalstaff-desktop` is NOT a founding from zero. It is a working VS Code
extension (Workbench 2.5, ~0.4.7) already doing most of what a "personal
GeneralStaff harness" needs:

- A persistent Orchestrator session pinned above a project list, rooted in
  generalstaff-private, surviving VS Code restarts (see fed `domain.ts` for
  the type contract: `SeatId`, `LaneId`, `LaneSummary`, `FleetSnapshot`).
- 8 lanes/seats already adapterized (Codex, Claude Fable + Cursor-Fable
  fallback, Kimi K3, Cline/GLM, Cursor Agent, Grok 4.6 via Cursor, GLM 5.3 and
  GLM 5.3 Flash via Ollama Cloud direct-API) plus two more CC-door seats
  (`deepseek-ollama-cc`, `glm-ollama-cc`) that run the REAL `claude` binary
  against Ollama Cloud's Anthropic-compatible endpoint via
  `scripts/gsd-cc-door.sh` + `scripts/seat-config-sync.sh` (fed) — these two
  are what "non-Anthropic seats run private-GS orchestration fully" already
  means mechanically: skills/rules/memory/hooks symlinked in, 1M context set
  via `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (verified live 2026-09-13 against
  `/api/show`).
- Private runtime tools (Headroom, Lane Desk) wired as ephemeral MCP defs for
  Claude/Codex lanes, degrading gracefully (read-only CLI route or
  "unavailable") for lanes that can't take stdio MCP.
- A superseded Tauri/xterm prototype (`src-tauri/`, `src/`) that proved fleet
  state, tray attention, pings, progress, notifications, session machinery —
  and then became "a decorated terminal multiplexer" because its primary
  interaction stayed an embedded terminal instead of the conversation. Its
  5-commit history (gsd-001..gsd-004) is fed for reference; do not resurrect
  its shell unless the spec has a concrete reason Electron-of-VS-Code
  genuinely can't do something the harness needs.
- Two live handoff briefs landed THIS SAME DAY fixing chat rendering (tool
  payloads leaking into chat bubbles, Enter-to-send) across all lanes — the
  chat surface is being actively hardened, not greenfield.

Ray's own framing for what this founding IS: "like Claude Desktop, not merely
a VS Code clone; visuals into running lanes; personal to me, not something we
share." Astra's cold-read of the whole GS practice (fed,
`ASTRA-COLD-READ-GS-HAMMERSTEIN-2026-09-04.md`) independently landed on the
same framing under a CUT-effort-S recommendation: "Keep GS as useful personal
infrastructure while testing whether others need the whole operating
practice... Pause expansion of surfaces until one more outcome is
demonstrated." Read that as a constraint, not a green light for a rewrite:
the founding should EXTEND the existing Workbench toward "visuals into
running lanes," not replace it.

## What "visuals into running lanes" does NOT yet have

The Workbench's conversation and lane-availability model is mature. What is
NOT yet wired: a live view of DETACHED lanes running outside the extension's
own process tree — the home-PC/cloud lane fleet that `orchestrator-lane-
mechanics.md` (fed) and the `lane-desk` MCP tool (`lanes_status` /
`lane_harvest` / `lane_detail`, JSON shape fed) already track via sentinel
files (`run.log` / `run.status` / `run.done`). `privateRuntime.ts` already
knows how to launch Lane Desk as an MCP server for Claude/Codex — but that's
Lane Desk AS A TOOL INSIDE a chat turn, not a standing Lanes panel the
operator watches passively, independent of any conversation.

Also not yet wired: the Desk (handoff packets under `~/Desktop/handoff`, per
`decisions-arrive-staged.md`, fed) as a Workbench surface — packets, their
WHAT-TO-JUDGE cards, and ANNOTATE.html currently live entirely outside the
extension, opened by hand in Finder/Preview.

## Required output sections (write the spec with these exact headings)

1. **Purpose** — personal operator harness for Ray, a non-programmer
   orchestrator; what it replaces (nothing shared, nothing public) and what
   it must not become (a shared product, a second GeneralStaff CLI).
2. **Anti-goals** — not a shared product, no marketing surface, not a VS Code
   clone (it may legitimately host VS Code, per the current architecture —
   say why that's not the same thing as "cloning" it), no local inference
   (NEVER — see fed rule), no new scheduler (lane-desk + existing sentinels
   are the scheduler; don't invent a second one).
3. **The three surfaces** — Command (the persistent orchestrator conversation
   + seats — already exists, name what's missing), Lanes (live visuals of
   running lanes across Mac/home-PC/cloud: name, host, model, elapsed,
   sentinel state, log tail, harvest button — NEW, spec the lane-desk
   integration precisely against its JSON shape), Desk (handoff packets with
   WHAT-TO-JUDGE cards + rulings captured back into pings — NEW, spec how a
   ruling writes back via `scripts/ping.sh`, never a raw file write).
4. **Seats + doors** — reuse the adapter layer (`src/adapters/`); which seat
   runs where; availability probes (already exists — describe, don't
   redesign, unless there's a real gap); skill/rule/memory carry-over (the
   CC-door pattern is already the answer for Claude-protocol non-Anthropic
   seats — confirm it covers the fleet, or name what it misses for
   non-Claude-protocol lanes like the direct Ollama/cursor/codex adapters).
5. **Data + integrity** — what it reads (lane dirs, pings inbox,
   SESSION-RESUME, roster — all already read by other GS surfaces, name the
   canonical paths); what it writes (rulings into pings via `ping.sh`,
   nothing else without an explicit operator gate — this is load-bearing,
   the harness must never silently mutate ledgers, tasks.json, or repo state
   outside an operator-confirmed action).
6. **Shell choice with tradeoffs** — Tauri revival vs Electron vs the
   existing VS Code extension host. RECOMMEND ONE. Ground the recommendation
   in why the Tauri prototype specifically failed (embedded-terminal trap,
   not a shell-technology failure) and whether that failure mode would repeat
   under Electron. The extension host already has the editor, diff viewer,
   terminal, and provider CLIs solved for free — name the concrete cost of
   walking away from that.
7. **Milestones M0-M4**, each with one demonstrable acceptance condition
   stated as a single verifiable sentence (example shape only —
   "M0 = shell boots and shows lanes_status live", write your own five).
8. **Register** — TWO UI directions for the Lanes/Desk surfaces, ~120 words
   each: (a) grounded in the EXISTING Workbench/Life Console register (the
   six inherited palettes — Kriegspiel Paper/Night, Linen Folio, Map Vellum,
   Iron Press, Carbon Folio; Life Console's amber "signal light" identity is
   fed for a sibling personal-daily-driver reference), (b) deliberately
   OFF-SIGNATURE — labelled as such, proposed by you, not an interpolation
   of Ray's existing choices (per the fed `protect-taste-from-the-machinery`
   rule: every slate reaching Ray needs one option that isn't a mirror of
   his prior picks).
9. **Open design-axis questions for Ray** — purpose/feel/aesthetic only, max
   4, MCQ-shaped, each with a recommended lean. Do NOT ask an engineering or
   scope question here — those are yours to decide per the fed
   `CLAUDE.local.md` "Structural code decisions are Claude's call" convention.
10. **Risks + what would make this founding a mistake** — name the Astra CUT
    recommendation explicitly as a live risk (scope creep past "personal
    infrastructure" into another surface nobody asked for) and at least one
    concrete technical risk grounded in the fed source (e.g. the same
    tool-payload-leak class of bug that just needed a same-day fix across
    every adapter, recurring in a new Lanes/Desk surface if it doesn't reuse
    the hardened normalize path).

Keep the spec to what a coder lane can implement without further design
judgment calls. Cite fed file paths and line ranges where you rely on them.
