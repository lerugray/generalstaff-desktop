# Fable direction memo — generalstaff-desktop (2026-06-12, final-night blitz)

State read: v0.1.0 shipped 2026-06-11 with the ambient inversion complete (gsd-053/054/055:
tray badge + attention menu, PROGRESS.jsonl verdict feed, attention-first briefing landing,
launch-at-login, hygiene pass). 52 tasks, 51 done, 1 deferred (gsd-014, GS-cycle-gated
autonomous launch). Working tree clean, 13/13 tests green, headed-verified on Mac. The app
is functionally complete to its June scope. What it does not have is usage signal: the
inversion is ~24 hours old, and the prior pull-open version went largely unused. GSD's role
is fixed — it replaced hammerstein-tui as Ray's daily-driving console (Ray, 2026-05-20) —
so every call below serves that role, not feature breadth.

## The calls

1. **LOCK — Prove the tray on real cycles before building anything new.** The inversion
   thesis (ambient tray beats pull-open window) is exactly the kind of premise the
   falsification rule covers. Gate the next feature on observing a handful of real GS bot
   cycles flowing through the shipped tray (badge increments, verdict notifications land,
   Ray actually glances instead of opening a terminal). Cycle-gated, not calendar-gated —
   GS fires daily, so this resolves fast.

2. **LOCK — gsd-014 is the next build, and the dogfood pass is its spec input.** The tray
   is still mostly passive; cycle-gated autonomous triggers are step 2 of the same thesis
   and the real adoption mechanism. Don't treat the dogfood gate as bureaucracy: what
   actually pulled Ray's attention during real cycles tells you which triggers gsd-014
   should fire. Un-defer it as soon as call 1 has data, in the same session if possible.

3. **LOCK — Homelab liveness tile (100.118.39.34:8765) stays deferred behind gsd-014.**
   Daily-driver value lives in cycle verdicts, not bot uptime. Promote it only if the
   dogfood pass shows Ray checking bot liveness by hand; otherwise it's decoration.

4. **LOCK — No cross-platform claim until one headed Windows smoke.** CI builds passing on
   windows-latest is not behavior; nothing Windows-headed has been documented. One smoke
   run on home-PC or thinker (both always-on), one paragraph of notes, done. Until then
   GSD is a Mac app with a Windows build artifact.

5. **LOCK — Strike the agent_usage cleanup from every successor todo.** The revival plan's
   "delete dead loadAgentUsage/agent_usage path" item already shipped in gsd-055
   (commit 163f613, "deleted both sides"). Repo grep confirms zero code references remain.
   Re-doing a done task is the classic stale-notes failure; commits are source of truth.

6. **Quick win — README screenshot.** Line 3 still carries the `<!-- TODO -->` placeholder
   and a broken image link. Capture the cockpit during the call-1 dogfood pass; one
   `screencapture`, one commit.

7. **[RAY] Tray loudness — my lean: keep it quiet.** The 3-notifications-per-pass cap and
   parked-project filtering are right. GSD earns daily-driver status by being trustworthy
   and quiet, not chatty; a console that nags gets muted, and muted is dead. Feel call,
   so Ray owns it, but I'd hold the line here.

## Risks to respect

- **Adoption is the only real risk.** If the tray doesn't change the "terminal is quicker"
  habit after gsd-014 lands, the thesis is falsified and the honest next move is to park
  GSD as done-for-now, not to keep adding panes. Two failed hooks is signal, not bad luck.
- **Windows is unverified in production.** Don't let the CI badge launder that claim.
- **Stale planning docs.** The revival plan now contains at least one shipped item still
  phrased as pending. Read it against `git log`, never alone.

## Fable-era note

GSD's register is a cockpit: attention-first, plain-language verdicts, empty states that
stay quiet ("quiet line" is in the commit record as a verified behavior — preserve that).
House conventions the successor must keep: ship claims ride on headed verification noted in
the commit message (the "13/13 tests green; headed-verified" pattern), version bumps go
through `scripts/bump-version.sh`, signing uses the Developer ID cert (stable identity, not
ad-hoc — TCC re-prompts otherwise), and task state lives in generalstaff-private
`state/generalstaff-desktop/tasks.json`, not in this repo. GSD exists so a non-programmer
can command a dev fleet by glancing, not by reading logs. Every future feature should be
testable against that sentence.
