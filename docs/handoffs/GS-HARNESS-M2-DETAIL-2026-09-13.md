# GS harness — M2: lane detail + harvest on row select (read-only), from the gated founding spec

Read first: docs/handoffs/GS-HARNESS-FOUNDING-SPEC-2026-09-13.md (§3 Lanes, §5 Data + integrity — READS ONLY, §7 M2 acceptance, §8 register (a) ruled), docs/handoffs/GS-HARNESS-M1-LANES-2026-09-13.md and the M1 implementation as merged at 2323edb (workbench-extension/src/services/laneDeskStatus.ts, src/lanesPanel.ts, src/lanesPanelModel.ts, media/lanes.js, the M1 tests). M1 fetches lane-desk STATUS via the lane_desk.py CLI (`status --json`) — the spec's chosen transport; M2 extends the same CLI use.

## Deliverable (one milestone; nothing from M3 Desk; nothing that writes)
Selecting a lane row in the Lanes panel opens a DETAIL view (same webview, a right-hand or drawer pane in the Kriegspiel register) fed by lane-desk's `lane_detail` and `lane_harvest` results for that lane, read-only:
- Detail: the full status envelope for the lane (host, tree/cwd, branch, WANT/HEAD sha, model/door, launch time, cap, elapsed, sentinel files + their last lines, run.status tail), the last N lines of the lane's log AS RETURNED BY lane-desk (`lane_detail` — never by opening a path yourself), and the harvest preview from `lane_harvest` (files changed / dirty count / commits since WANT / battery line if lane-desk reports one). If lane-desk's `lane_detail`/`lane_harvest` verbs exist in lane_desk.py as CLI subcommands use them; if they are MCP-only, add the thinnest CLI subcommand to lane_desk.py's CLI surface in gs-private is OUT OF SCOPE — instead call the MCP tool through the extension's existing lane-desk MCP launch (the same one Command uses for capable seats) and say which path you took in the return doc.
- No harvest ACTION in M2 (no commit, no merge, no kill) — a disabled "Harvest…" affordance with a tooltip "M3+" is fine; nothing that writes to any repo or lane dir.
- Refresh with the panel's poll; stale-on-timeout like M1; partial envelope tolerated; a lane that disappears from status keeps its last detail with a "gone" marker.
- Register (a): detail pane reads as the counter's card turned over — same palette variables, marginalia typography for shas/paths, amber only for attention states; log tail in the existing Command mono face.
- Tests: fixture-driven (lane_detail + lane_harvest JSON for a running lane and a failed lane; a gone lane) asserting the fields bound, no path reads, and stale/gone handling; `npm run check` green (87/87 baseline + new).
- Version 0.4.10; rebuild the VSIX (vsce) — the launcher re-run is the orchestrator's harvest step, do not run it in the cloud.
Commit on your branch. Do NOT touch credentials, .env, signing, launcher internals, master, src-tauri/, or gs-private.

---

## Transport path taken (2026-09-13)

CLI — same one-shot Lane Desk transport as M1. `privateRuntime.ts` already documents the fallback verbs:

- `python3 lane_desk.py --config … detail LANE_ID --host HOST --lines 40 --json`
- `python3 lane_desk.py --config … harvest LANE_ID --host HOST --json`

No MCP session is held by the Lanes panel. No CLI subcommands were added under gs-private.

---

## Harvest render proof (2026-09-13)

`docs/handoffs/GS-HARNESS-M2-PROOF-2026-09-13.png` — same standalone-shim method as M1
(`media/workbench.css` + unmodified `media/lanes.js` over local HTTP, the ~10-line
`acquireVsCodeApi()` no-op shim, real `window.postMessage`), extended to also post a
`{type:'lanes-detail', detail}` message. The detail payload is the actual
`buildLaneDetailModel` output built from `parseLaneDeskDetail`/`parseLaneDeskHarvest` run
against `test/fixtures/lane-detail-running.json` + `lane-harvest-running.json` for the
`mac:gs-harness-m1` row selected out of the M1 status fixture. Rendered headless Chromium
(`--mute-audio`), 1204x753 @2x, matching the M1 proof's frame size. `docs/handoffs/GS-HARNESS-M1-PROOF-b.png` — the same M1 status fixture (no row selected) re-rendered at the same
size through the current (post-M2) `lanes.js`/`workbench.css`, as a regression check that
the unselected Lanes panel still renders unchanged.
