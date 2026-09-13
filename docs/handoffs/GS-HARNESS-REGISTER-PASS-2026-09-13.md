# GS harness — REGISTER PASS over Lanes + Detail (M1/M2 mechanics are landed; the LOOK failed)

Read first: docs/handoffs/GS-HARNESS-FOUNDING-SPEC-2026-09-13.md §8(a) verbatim (RULED by Ray): "Grounded — Kriegspiel desk, amber when it matters. Inherit the six Workbench palettes — Kriegspiel Paper, Kriegspiel Night, Linen Folio, Map Vellum, Iron Press, Carbon Folio. Lanes reads as a situation map: paper or night field, lanes as counters (id as the unit name, host as the map board, state as the counter colour: inconsistent/failed in iron-red, stalled in dust, running in ink, done in quiet grey). Elapsed and sha are marginalia, not dashboard chrome. Desk reads as a folio. Amber is reserved for attention that needs Ray — Lanes badge, failed/inconsistent counters, a packet waiting on the desk. No seagull. No new mascot. Typography and density stay with the current Workbench, so Command and the new panels feel like one instrument." Then the M1/M2 briefs, the merged code (src/lanesPanel.ts, src/lanesPanelModel.ts, src/services/laneDesk*.ts, media/lanes.js, the Lanes CSS in media/workbench.css), and the render proofs docs/handoffs/GS-HARNESS-M1-PROOF-2026-09-13.png / -b.png / GS-HARNESS-M2-PROOF-2026-09-13.png.

## The independent look's verdict on the M1 frame (deepseek-v4.1-flash + vision): LOOK: FAIL, LEDGER 6 — fix every row
1. AMBER OVERLOAD — amber marked ~7 elements (a host timeout pill + three state badges) against "attention 3". Amber must appear ONLY on: the badge count, failed/inconsistent counters' attention mark, an unreachable-host row. Nowhere else (not on "stale", not on timeout pills, not on loading).
2. FAILED / INCONSISTENT rendered amber, not IRON-RED. Map states to the palette's iron-red var; stalled to dust; running to ink; done to quiet grey — and make the counter COLOUR the state, not a text badge.
3. RUNNING rendered as bright white/default text. Running = ink on the field.
4. GENERIC DASHBOARD LOOK — "raw VS Code webview / generic React-Tailwind dashboard". It must read as a situation map: a paper/night FIELD (the palette's ground), lanes as COUNTERS (bordered chits, unit name set large on the chit, board/host as a small board label), not stacked cards with left accent bars and pill tags. Remove pill tags, remove the alert banner, remove the summary line; the badge on the icon already carries attention.
5. MARGINALIA — elapsed and sha (and launch time, cap) set small, muted, at the chit's edge — not as primary metadata lines.
6. ID/HOST HIERARCHY — the unit id dominates; host is a board label.
Detail pane (M2): the same register — the counter's card turned over: same field, chit border, marginalia typography for shas/paths, log tail in the Command mono face on the paper; amber only for gone/attention; no pills.

## Deliverable
- CSS + markup changes in media/lanes.js / workbench.css (and the panel HTML) to achieve the above across ALL SIX palettes (test at least Kriegspiel Paper and Kriegspiel Night). No behaviour change; no new data.
- Regenerate the standalone render proofs the same way the M1/M2 harvest did (shim + fixtures, headless Chromium --mute-audio, 1204x753@2): docs/handoffs/GS-HARNESS-REGISTER-PROOF-lanes-paper.png, -lanes-night.png, -detail-paper.png. Commit them.
- Tests: extend the render/model tests to assert the state→colour class mapping (iron-red/dust/ink/grey) and that the amber class appears only on the three permitted elements; `npm run check` green (91/91 + new).
- Version 0.4.11; rebuild the VSIX (vsce). Commit on your branch. Nothing outside workbench-extension/ + this doc + the proof PNGs.

---

## Register pass landed (2026-09-13)

Workbench **0.4.11**. Lanes + Detail restyled to the ruled Kriegspiel register (look only — same model, poll, detail CLI transport):

- Counters are bordered chits; `--iron-red` / `--dust` / ink (`--paper`) / `--quiet-grey` carry state; state text is visually hidden (sr-only).
- Amber (`.lanes-amber` / `counter-amber`) only on: badge count, iron-red attention marks, unreachable-host rows (+ detail `gone`). Host chips, stale/loading, banners, harvest notes: muted, not amber.
- Removed partial-envelope alert banner, counts summary line, host pills, left accent bars, state badges, attention chips.
- Proofs via `workbench-extension/scripts/render-lanes-register-proofs.ts` (shim + fixtures, Chromium `--mute-audio`, 1204×753@2): `GS-HARNESS-REGISTER-PROOF-lanes-paper.png`, `-lanes-night.png`, `-detail-paper.png`.
- Tests: 94/94 (`lanesPanel` colour/amber model asserts + `lanesRegister` CSS/markup contract).
