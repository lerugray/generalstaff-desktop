# GS harness — M1: the read-only LANES panel (from the gated founding spec)

Read first, in order: docs/handoffs/GS-HARNESS-FOUNDING-SPEC-2026-09-13.md (§1 Purpose, §2 Anti-goals, §3 "Lanes (NEW)", §4 seats, §5 Data + integrity — reads only, §7 M1 acceptance, §8 register (a) Kriegspiel desk / amber when it matters — RULED by Ray; §9 rulings in the gated header: badge-only alerts, hide VS Code chrome), then docs/handoffs/GS-HARNESS-M0-RECEIPT-2026-09-13.md, then workbench-extension/src/domain.ts (LaneSummary / FleetSnapshot) and src/adapters/ for how seats already launch the lane-desk MCP.

## Deliverable (one milestone, nothing from M2+)
A new **Lanes** webview panel in workbench-extension that renders the lane-desk `lanes_status` result LIVE for both hosts (Mac + home-PC), read-only:
- Data: call the lane-desk MCP tool `lanes_status` the way the extension already launches lane-desk for capable seats (reuse that launch; do not add a second transport). Tolerate a partial envelope (one host down → render the other + a host-level "unreachable" row; never blank the panel). Poll every 30 s while the panel is visible; manual refresh button.
- Rows: one per lane — id, host, model/door, state (running / done / failed / stalled / inconsistent), elapsed since launch, sentinel state (run.log / run.status / run.done present?), last log line (from the status payload only; NO path-based file opening in M1). Sort: attention first (failed/inconsistent/stalled), then running, then done.
- Register (a): Kriegspiel desk — inherit the existing Workbench palettes (Kriegspiel Paper/Night etc. — find them in media/ and reuse the CSS variables); lanes read as counters on a situation map: id as the unit name, host as the board, state as the counter colour (failed/inconsistent = iron-red, stalled = dust, running = ink, done = quiet grey); elapsed and sha as marginalia; AMBER only for attention that needs Ray. Typography/density identical to Command so it feels like one instrument.
- Badge: the Lanes activity-bar icon carries a count of attention lanes (failed + inconsistent + stalled). Badge only — NO OS notifications (ruled).
- Layout toward "not a VS clone": add the Lanes icon to the Workbench's own activity-bar group next to Command; when the Workbench workspace opens with no file, the editor area stays hidden and the Command + Lanes panels fill it (VS Code's own chrome minimised per the extension's existing layout settings; do not fight VS Code — use workbench.startupEditor / layout APIs and the profile settings the launcher already writes).
- Tests: a fixture-driven render test (lanes_status JSON with running/failed/stalled/done rows + one unreachable host) asserting sort order, counter colours by state, badge count, and partial-envelope tolerance; keep `npm run check` green (84/84 baseline + new).
- Version 0.4.9; rebuild the VSIX (vsce); re-run scripts/make-launcher-app.sh is the ORCHESTRATOR's harvest step — do not run the launcher script in the cloud.
Commit on your branch with clear messages. Do NOT touch credentials, .env, signing, launcher internals, master, or anything under src-tauri/. Do not implement lane_detail / lane_harvest / Desk (M2/M3).

---

## Harvest render proof (2026-09-13)

`docs/handoffs/GS-HARNESS-M1-PROOF-2026-09-13.png` — the Lanes webview HTML/JS renders standalone
with no VS Code host: `media/workbench.css` + unmodified `media/lanes.js` served over local HTTP,
a ~10-line `acquireVsCodeApi()` shim (getState/setState/postMessage no-ops, the same contract VS
Code injects), and a real `window.postMessage({type:'lanes-model', model})` carrying the model
built by the actual `parseLaneDeskStatus` + `buildLanesPanelModel` functions run against
`test/fixtures/lanes-status-partial.json` (the M1 test fixture: running/failed/stalled/done/
inconsistent rows + one unreachable host). Rendered headless Chromium (`--mute-audio`), 1204x753
@2x. All 6 rows present; attention-first sort verified (unreachable, inconsistent, failed,
stalled, running, done); counter colours distinguishable (amber for unreachable, iron-red for
failed/inconsistent, dust for stalled, ink for running, quiet grey for done).
