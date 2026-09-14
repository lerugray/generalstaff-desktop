# M5 — Seat experience REPORT (2026-09-14)

Grounded brief: `docs/handoffs/M5-SEAT-EXPERIENCE-2026-09-14.md`. Branch work on `cursor/m5-seat-experience-*`. Package remains **0.4.17** (no version bump, no VSIX).

## Tests

`npm test` in `workbench-extension`: **147/147 pass** (137 prior + 10 new M5 cases in `test/m5-seat-experience.test.ts`).

## MUST evidence

| MUST | Result | Evidence |
|------|--------|----------|
| **M1 Steering channel** | **Fallback shipped** (live door unavailable) | Probe verbatim: `PROBE-STEERING.md` + `probe-raw.log`. Code: `cliAdapter.ts` (`--input-format stream-json`, `keepStdinOpen`, `enqueueFollowUp` hold-until-turn), `extension.ts` (`enqueueWhileRunning` — never "already has a lane running"), delivery chips in `workbench.js`. Unit: `test/m5-seat-experience.test.ts` M1 cases. |
| **M2 Seat conduct** | **Pass** | `promptForSeat` inserts `SEAT CONDUCT` before `Operator request`. Test: `M2: seat conduct block sits before Operator request`. |
| **M3 Live activity strip** | **Pass** | One-line `.activity-strip` above composer (tool · call elapsed · run total; idle — your turn). Frames: `proof-live-strip-composer-1100x700-2026-09-14T16-41-58.png`, `proof-live-strip-composer-sidebar-760x700-2026-09-14T16-41-58.png`, `proof-idle-strip-*-2026-09-14T16-41-58.png`. |
| **M4 Incremental rendering** | **Pass** | `run-event` / `context-usage` / `notice` / `notes` patch only (`patchActivityStrip`, `patchContextMeter`, `patchNoticeOnly`). Scroll proof: scrollTop unchanged within 1px after 20+20 events — `scroll-stability-2026-09-14T16-41-58.json` (`delta: 0` both viewports). Jump-to-latest pill when not at bottom. |
| **M5 Composer sizing** | **Pass** | One-row auto-grow, `resize: none`, ⚙ settings popover (selects never wrap). Transcript ≥70% pane: `streamRatio` 0.709 both viewports in scroll-stability JSON. Frames above. |
| **M6 M3e carry-overs** | **Pass** | Meter chrome scoped under `.conversation-meta` / `.aux-view`; legacy unscoped block deleted. `overflow-wrap: anywhere` retained. Ceiling test points at real `scripts/gsd-cc-door.sh`; fixture mirror deleted. Rune-safe `capPersisted` retained. `.is-redacted` styling + summary "Thinking · redacted". |

## Frames (timestamped)

- `proof-live-strip-composer-1100x700-2026-09-14T16-41-58.png`
- `proof-live-strip-composer-sidebar-760x700-2026-09-14T16-41-58.png`
- `proof-idle-strip-1100x700-2026-09-14T16-41-58.png`
- `proof-idle-strip-sidebar-760x700-2026-09-14T16-41-58.png`

Generator: `workbench-extension/scripts/render-m5-proofs.ts`.

## Notes for the orchestrator gate

1. Live GLM mid-turn acceptance still needs a re-probe on a host with `generalstaff-private/scripts/gsd-cc-door.sh` + `claude` + seat credentials; this lane documented the failure and shipped the hold-until-turn fallback exactly as the brief requires.
2. Do not bump to 0.4.18 / rebuild VSIX here — orchestrator owns that after opus re-gate + Ray's live seat verdict.
