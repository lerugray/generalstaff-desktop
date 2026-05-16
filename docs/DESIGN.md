# generalstaff-desktop — Design

The desktop command console for GeneralStaff (GS). Structured 2026-05-16
from a three-stream research pass (GS's own surfaces, devforge, and
multi-session-tooling prior art) plus a Hammerstein audit. v0.0.1 scope
and the child-session model were locked by Ray the same day.

## Purpose

GeneralStaff is an autonomous dev-fleet orchestrator — a TypeScript/Bun
CLI that runs verification-gated bot cycles across ~36 projects, with
file-based state as the single source of truth. `generalstaff-desktop`
is its desktop face: a Tauri 2 app that lets the operator see the whole
fleet at a glance, drill into any project, and (from v0.1) spawn and
watch child Claude Code sessions — without living in a terminal.

It exists because GS is critical to how Ray works day to day, and the
desktop's one job is to make operating the fleet *easier* — never to add
friction or reduce GS's reliability.

## Hard architectural stance: viewer / controller

The desktop is strictly a **viewer/controller** over GS's file-based
state. It **never writes GS state files directly.** It reads state to
display it; any *action* is performed by invoking the `gs` CLI, which
mutates state through GS's own code paths. GS remains the single writer
and source of truth. (GS Hard Rule 2 explicitly permits "a local desktop
UI as a viewer/controller" — this is that.)

## Shape — Fleet → Project → Session

One persistent window with a tray / menu-bar status icon.

```
┌─────────────┬─────────────────────────────────────┐
│ FLEET       │  MAIN AREA  (swaps with selection)   │
│             │                                      │
│ ● generalst…│  Fleet view   — the briefing         │
│ ● retrogaze │  Project view — the workbench        │
│ ▶ twar-pc   │  Session view — a child CC session   │
│ ! catalogdna│                                      │
│   … 36 rows │                                      │
├─────────────┤                                      │
│ tray: idle  │   ● idle   ▶ running   ! attention   │
└─────────────┴─────────────────────────────────────┘
```

- **Left rail — the fleet.** One row per project, a semantic status dot
  (idle / cycle running / needs attention / failed). Vertical, so it
  scales past 36 projects without tab overflow.
- **Main area — swaps with selection:**
  - **Briefing** (fleet selected): the command-center shell GS's
    UI-VISION docs already specify — Situation / Attention / Fleet grid /
    Actions / Usage, in decision-urgency order; the Attention panel
    renders only when non-empty.
  - **Workbench** (a project selected): a file tree + read-only file
    viewer + that project's cycle history.
  - **Session** (a child session): a real `claude` / `cursor-agent`
    process in an `xterm.js` terminal tab — see SESSION-COCKPIT-PLAN.md.

## Locked decisions

1. **Fresh build, own repo, not a devforge fork.** devforge is an
   ~18k-line single-file ES5 monolith; ~14k of it is game-dev domain
   logic a fleet console does not want. Only ~300 lines — the
   session-spawn mechanism, the git-worktree-tab system, the file tree —
   are worth transplanting. Build fresh; lift those patterns.

2. **The devforge boundary.** devforge is a separate live commercial
   product ($9, itch.io) — and was, in effect, an early attempt at GS
   before Ray's operating principles had formed; it found its own niche
   and earned its users. The GS desktop must never grow devforge's
   mode / skill / GDD-prompt-builder layer — that layer is devforge's
   identity and commercial moat. The line (from the existing df-013
   alignment audit): *they share genes but branch on who is at the
   keyboard* — devforge is the single-project IDE for a human at the
   keyboard; the GS desktop is the fleet console for a human overseeing
   bots.

3. **v0.0.1 = briefing + read-only workbench.** No child sessions in the
   first release. Everything in v0.0.1 is read-only display plus
   CLI-driven actions — no process management, no PTY — which keeps the
   first release low-risk.

4. **Child sessions: a thin terminal wrapper (reversed 2026-05-16).**
   The original decision here — compose-and-fire `claude -p` first,
   interactive PTY later — was reversed. Compose-and-fire is a custom
   chat UI on headless mode; it cannot function identically to Claude
   Code and drifts behind every Claude Code release. Sessions instead
   run the real `claude` / `cursor-agent` CLI under a PTY, rendered in
   `xterm.js` terminal tabs — the desktop wraps Claude Code rather than
   reimplementing it. See `docs/SESSION-COCKPIT-PLAN.md` for the full
   architecture, the Hammerstein-audit constraints, and the phases.

5. **Design register: Prussian Kriegspiel lithograph.** Warm paper / ink
   / a single rust accent; period serif display, monospace for data; a
   "subordinate briefing the commander" voice. Inherits GS's existing
   CSS token set. No SaaS glass-and-neon, no military iconography.
   Locked by GS's `UI-VISION-2026-04-15.md` + the live `gs serve`
   stylesheet.

## Hammerstein-audit constraints (folded in)

The 2026-05-16 audit (`audit-this-plan`, qwen3.6-plus) surfaced four
catches, all adopted as design constraints:

- **Surface, don't reimplement.** GS's orchestration safety —
  diff-review gates, file-collision pre-checks, token ceilings — is
  GS-core's job. The desktop *surfaces* the results; it does not rebuild
  the logic. Where GS does not do something yet, that is a
  GeneralStaff-core task, not a desktop task. This keeps the desktop a
  thin, reliable viewer rather than a second, half-built orchestrator.
- **State-file races are real.** GS writes state continuously. The
  desktop must use a file-watcher and a staleness check (compare mtimes
  / version against last render), and show a "syncing" state rather than
  confidently-wrong data.
- **No template drift.** The desktop does not re-port the `gs serve`
  dashboard's HTML. v0.0.1 embeds the existing `gs serve` view in a
  webview, with a health-check + "server offline" fallback so the window
  never simply goes blank.
- **Don't front-load.** The full vision (workbench + sessions + a
  six-feature safety layer at once) is over-scoped for v0.0.1 — hence
  the briefing + read-only-workbench scope above.

## v0.0.1 scope

**In:** the native shell (fleet rail, main area, tray icon); the fleet
state layer (file-watcher + staleness handling); the embedded briefing
(`gs serve` + health-check); the project workbench (file tree +
read-only viewer + cycle history); the Claude Design visual pass.

**Deferred:** child sessions (v0.1); interactive terminal (post-v0.1);
live-mode metrics; the richer safety surfacing.

## Task plan (v0.0.1)

- **gsd-001** — repo + Tauri 2 scaffold: the native shell.
- **gsd-002** — fleet state layer: file-watcher + staleness handling;
  the fleet rail driven by live GS state.
- **gsd-003** — embedded briefing: `gs serve` in a webview + health-check.
- **gsd-004** — workbench: file tree + read-only file viewer.
- **gsd-005** — workbench: per-project cycle history.
- **gsd-006** — Claude Design visual pass (Kriegspiel lithograph).
- **gsd-007** — v0.0.1 dogfood + friction pass.

## Open longer-term questions

- **Does the desktop supersede `gs serve` as the primary GS UI, or
  coexist with it?** Not a v0.0.1 blocker (v0.0.1 embeds `gs serve`). If
  it supersedes, the briefing eventually goes native and `gs serve`
  becomes the headless / remote fallback. Revisit after v0.0.1.
- Which safety features need GeneralStaff-core work before the desktop
  can surface them — filed as GeneralStaff tasks when they come up.

## Relationship to the rest of the ecosystem

- **GeneralStaff** — the CLI / orchestrator this is a face for. The
  desktop reads its state and drives its CLI.
- **devforge** — see locked decision 2.
- **mission-companion** — the shape reference ("similar to
  mission-companion"): a Tauri 2 app. The GS desktop is fleet-first
  where mission-companion is a single chat surface.
