# GS harness — M3b: ruling-form completion + night-palette look items (follow-up to M3, 3ab4e01)

Read: docs/handoffs/GS-HARNESS-M3-DESK-2026-09-13.md, the spec §3 Desk item 2, the M3 harvest findings below.
1. Ruling form (pingRuling.ts / deskPanel.ts / media/desk.js): the ping BODY must include the packet folder name first ("<PACKET-NAME>: <verdict>"), and the form gets an opt-in checkbox "Attach ANNOTATE notes" that, when the packet carries ANNOTATE.html notes in its localStorage export file (or a NOTES.txt the page saves — check what scripts/make-annotate.py's page persists), appends them to the body. Tests updated (argv exact).
2. Night palette (Kriegspiel Night): the vision judge flagged (a) an amber/orange right-edge badge appearing on EVERY row incl. running — verify by rendering lanes-night with the fixture and pixel-sampling the right edge of a running row and a done row: if any amber/brass pixels exist there, fix (amber only on failed/inconsistent attention marks, the unreachable-host row, and the icon badge); if none, record the pixel samples in the return doc as the refutation; (b) "boxes, not one plate" in the detail folio at night — render detail-night and ensure the folio uses rule lines, not nested bordered boxes (chits in the Lanes list are by design).
3. `npm run check` green (101/101 + updated); version 0.4.13; VSIX (vsce); regenerate proofs (desk-paper, desk-night, lanes-night, detail-night); commit. Nothing outside workbench-extension/ + this doc + proofs.

---

## Harvest (2026-09-13)

Workbench **0.4.13**. M3b closes the founding-spec ruling body gap left by M3:

- Ping body is now `"<PACKET-NAME>: <verdict>"`. Opt-in **Attach ANNOTATE notes** checkbox appears when notes exist (default on); notes append only when checked.
- Notes reader (`annotateNotes.ts`): prefers `NOTES.txt` / `notes.txt`, then JSON sidecars (`notes.json`, `annotate-notes.json`, `.annotate-notes.json`, `localStorage-notes.json`), then a best-effort scrape of `ANNOTATE.html` (`application/json` script / textarea / `data-notes`). `scripts/make-annotate.py` is not in this workspace (gs-private 404 here); the reader is shaped to those sidecars the brief names.
- Night look audit (pixel samples in `GS-HARNESS-M3B-PIXEL-SAMPLES-2026-09-13.json`):
  - **(a) refuted** — running right-edge amberCount=0 (sample RGBs are ink paper `#ede0c0` / surface, no brass); done amberCount=0 (quiet-grey / surface). Failed right edge correctly shows brass attention-mark samples (e.g. `#d18a5a`-family).
  - **(b) ok** — detail-night: outer plate only (`detailBorderCount: 4`); `innerBoxBorders: 0`; `.lanes-mono-tail` border 0 (rules via `border-top` section dividers, not nested boxes).
- Proofs: `GS-HARNESS-M3-PROOF-desk-paper.png`, `GS-HARNESS-M3-PROOF-desk-night.png`, `GS-HARNESS-REGISTER-PROOF-lanes-night.png`, `GS-HARNESS-M3B-PROOF-detail-night.png` (+ regenerated paper companions).
- Tests: **104/104** (`npm run check`); VSIX rebuilt to `distribution/generalstaff-workbench.vsix`.
