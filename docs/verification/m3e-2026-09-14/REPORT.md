# M3e verification report — 2026-09-14

Branch: `cursor/m3e-meter-and-render-cc0c`. VSIX built, not installed.

## Check-suite tally

| | tests | result |
|---|---|---|
| Before (M3d baseline) | 118/118 | green |
| After (M3e) | 124/124 | green (`npm run check`) |

Six new tests in `workbench-extension/test/m3e-meter-and-render.test.ts` on the scrubbed fixture `test/fixtures/glm-catchup-m3e.jsonl` (built from the diagnosis arithmetic — not Ray's live transcript).

## Deliverables

1. **Meter = occupancy** — `normalizeCliLine` no longer feeds the `result` envelope into `context-usage`; it emits `session-spend` instead. Last assistant occupancy on the fixture is **140,628**. Old arithmetic on the same fixture still yields **91%** (957,944 / 1,048,576); occupancy against that window is **13%**.
2. **One denominator** — `CC_DOOR_STATED_CONTEXT_TOKENS = 1_000_000` (matches `gsd-cc-door.sh`). Live meter with the door ceiling reads **14%** (140,628 / 1M). Direct Ollama seats keep 1,048,576.
3. **Tool cards** — Claude-protocol `tool_use` emits name + one-line label; matching `tool_result` sets ok/error + ≤120-char preview. Webview renders collapsible cards interleaved with prose.
4. **One bubble per turn + thinking** — `extension.ts` opens a new assistant bubble per Claude `message.id`; thinking blocks render as collapsed cards ("Thinking · N chars").
5. **Meter tooltip preamble vs added** — first occupancy **132,479**, added **8,149**, plus session spend **957,944**.

## VSIX

- Filename: `generalstaff-workbench-0.4.17.vsix` (built under `workbench-extension/`; gitignored)
- sha256: `f9d70585e2eb4cae78c91712017c19576d04c7762864a880e36f2aca146c068e`

## PNG proofs (DPR 2)

- `m3e-transcript-first.png`
- `m3e-tool-card-expanded.png`
- `m3e-thinking-collapsed.png`
- `m3e-meter-tooltip.png`

See also `WHAT-CHANGED.md` in this directory.
