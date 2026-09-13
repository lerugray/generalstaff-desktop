# Workbench chat parity across ALL seats (Ray, 2026-09-13: "the same thing should maybe apply to all different models as well")

Grounded: 0.4.7 (e09cf2c) = docs/handoffs/workbench-chat-polish-2026-09-13.md landed — clean assistant text for the Claude-protocol lanes (claude / deepseek-ollama-cc / glm-ollama-cc), Enter sends / Shift+Enter newline (global), ~/Desktop/handoff via --add-dir + picker.

## Scope
Bring every OTHER seat's chat rendering to the same standard: codex (`codex exec` JSON events), cursor-agent (stream-json), the direct Ollama API adapter (glm-5.3 / glm-5.3-flash / deepseek-v4.1-flash seats), grok runner (cursor-backed), and any other lane in `workbench-extension/src/adapters/`. For each lane:
1. Capture ONE real fixture of its raw output for a tool-heavy turn (a turn that reads a file and writes a file) into `workbench-extension/test/fixtures/<lane>-tool-turn.jsonl` (no credentials, no repo secrets; scrub paths to `<repo>`); run it through the adapter's normalize path.
2. Assert: the chat bubble contains ONLY the model's assistant prose per turn; tool calls/results render as the compact collapsible activity line (never as prose); paragraph breaks when prose follows tool activity; no raw JSON, no file contents, no progress spam, no duplicated final answer.
3. Fix each adapter that fails, in the same style as `cliAdapter.ts` normalizeCliLine for the Claude protocol (text blocks only; tool_use/tool_result hard-rejected; stream/progress events mapped to status, not prose).
4. Handoff folder: confirm every lane that can take an allowed-dir gets `~/Desktop/handoff` (expanded) — codex `--add-dir`/sandbox config, cursor `--add-dir` or its allowlist, direct-API seats get it in the context picker only (say so in the doc).
5. Tests: one adapter test per lane on its fixture; `npm run check` green; bump to 0.4.8; rebuild the VSIX (vsce) and re-run scripts/make-launcher-app.sh. Commit on your branch. Do not touch master (the working branch is publish-v23).
Report per lane: REAL FIX / ALREADY CLEAN / NOT APPLICABLE with file:line.
