# GSD revival plan — 2026-06-10 (Fable 5 five-angle survey)

Survey: purpose/repo, UX-vs-terminal, backend health, usage signal,
GS-ecosystem drift. Baseline: backend is healthy (13/13 tests, no
production panics, clean viewer/controller architecture), 48/49 tasks
done — GSD is feature-complete to its May scope and then went unused
(last meaningful launch 2026-05-26; one 7-second open since).

## The diagnosis: right features, wrong interaction model

Ray's stated reason for drifting back to the terminal is "it's just
quicker" — and for everything GSD's workbench offers (file tree,
session spawn, file viewer), the terminal IS quicker. Those surfaces
are terminal-parity chrome and will never win him back.

But GSD's genuinely-unique surfaces are the ones that need NO
interaction: fleet-at-a-glance across 42 projects, task staleness
cross-referenced against commit trailers, the pings inbox, session
idle notifications. The app's value is ambient awareness — and the
current model requires Ray to OPEN an app to get it, which is exactly
backwards. A destination app loses to the terminal; a peripheral
doesn't compete with it.

**The inversion: stop being a console Ray opens; become a presence
that taps Ray on the shoulder, with the console one click behind it.**

## Tier 1 — the inversion

1. **Ship the menu-bar tray** (in DESIGN.md from the start, never
   built). Icon badge = attention count. Dropdown = situation strip,
   top-3 attention items, open-pings count, "bot cycle verified on X"
   recents. Click-through opens the full window on the relevant pane.
   Launch-at-login. This is the whole thesis in one feature.
2. **Default landing pane = attention + pings**, not the dashboard.
   "What's waiting on me" is the question Ray actually has.
3. **PROGRESS.jsonl cycle-verdict feed** — the biggest GS blind spot
   found: GSD never reads the file that records what the bot actually
   did (223 verified / 27 rejected cycles, advisor verdicts,
   hands_off hits). Per-project last-10-cycles in the workbench +
   fleet-level "what the bot did today" on the briefing + tray
   notifications on verdicts. Pairs with Tier 1.1.

## Tier 2 — orchestrator-era awareness

4. **Homelab bot tile**: liveness/model/last-heartbeat for
   100.118.39.34:8765 (GSD predates the bot entirely;
   mission-companion's dashboard already has the liveness pattern to
   copy).
5. **Hygiene**: delete the dead usage-panel code path
   (loadAgentUsage/agent_usage wired but never called), bump-version
   script (it has said v0.0.1 through 54 commits), reconcile the
   stale private-repo DESIGN.md copy with the repo's.

## Tier 3 — Ray's calls

6. **gsd-014** (the one deferred task): wire dispatch buttons to real
   GS cycle invocation. Worth doing only after Tier 1 proves Ray
   comes back at all.
7. **The strategic fork** (surface honestly, Ray decides): the
   ambient-awareness layer could live in mission-companion's
   dashboard instead — MC is the app Ray actually opens daily.
   Claude's lean: do the inversion in GSD (the tray costs little,
   the fleet machinery already lives here, and GSD owns the PTY/
   dispatch value MC lacks), and only fold into MC if the tray
   doesn't change usage within a few weeks. Folding first would
   duplicate fleet plumbing into MC for an unproven need.

## Explicit rejects

- More workbench features (file tree polish, viewer upgrades) — they
  compete with the terminal on the terminal's turf.
- The dead CC-usage panel revival — /context and ccusage in terminal
  already cover it.
- v0.6.0 config-surface parity (quorum settings etc.) — GSD is a
  viewer, not a config editor; surfacing PROGRESS verdicts matters,
  editing reviewer config does not.
