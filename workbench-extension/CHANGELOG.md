# Changelog

## 0.4.7 — 2026-09-13

- Stop Claude-protocol chat (`claude`, `deepseek-ollama-cc`, `glm-ollama-cc`) from leaking raw tool-input/tool-output payloads into the message bubble: assistant text is now extracted explicitly from `message.content[]` text blocks only, never the generic key-name crawl that could pick up a `tool_use` block's file content.
- Insert a paragraph break between assistant-text segments separated by tool activity, instead of gluing every turn's text into one run-on string.
- Enter sends from the composer; Shift+Enter inserts a newline; Cmd/Ctrl+Enter still sends.
- Make `~/Desktop/handoff` reachable without depending on a lane expanding a literal tilde path: pass it via `--add-dir` on Claude-protocol lane invocations, and add it (plus folder selection) to the context attach picker as a standing staging root.

## 0.4.6 — 2026-09-13

- Add the `DeepSeek V4.1 Flash (Ollama)` read-only direct-API seat, wired like the existing GLM seats and gated on the same authenticated catalog probe.
- Add two CC-door seats, `DeepSeek V4.1 Flash · Workbench seat` and `GLM 5.3 · Workbench seat`, which run the real Claude Code binary against Ollama Cloud's Anthropic-compatible endpoint. They are agentic, support the read and write boundaries and native session resume, and carry the operator's skills, user `CLAUDE.md`, project rules chain, memory and hooks — none of which a single-shot direct-API seat can.
- State the true 1,048,576-token context window on every Ollama seat. Claude Code assumes 200k for a model it does not recognise, so an unstated window silently discards four fifths of these models.
- Keep the Ollama credential out of extension state: CC-door seats spawn the private repository's `gsd-cc-door.sh` launcher, which reads `~/.generalstaff/.env` itself. A regression test asserts no lane summary can carry the key.
- Probe the Grok CLI with `grok models` so a signed-out CLI demotes to the Cursor Grok 4.6 runner at discovery instead of being discovered mid-run.
- Add the `generalstaff.grokRunner` setting (`auto` | `cursor`). Entitlement is not discoverable: probed live on 2026-09-13 the Grok CLI reported itself logged in while every request 402'd `personal-team-blocked:spending-limit` and echoed the prompt back to stdout — output indistinguishable from a real answer — and a real-request probe never returns because the CLI's leader process holds stdout open. Setting `cursor` pins the seat to the working Cursor door for the same model.
- Close stdin on every lane authentication probe. Provider CLIs in prompt mode block on an open stdin pipe, which turned fast probes into timeouts and left a dead runner selected.
- Add `scripts/make-launcher-app.sh`, which builds a double-clickable `GeneralStaff Workbench.app` carrying the original GeneralStaff Desktop icon.

## 0.4.5 — 2026-09-01

- Generalize operator identity in the Command Deck via the `generalstaff.operatorDisplayName` setting.
- Default-unset surfaces read "Needs You" and use a neutral avatar glyph; configured names personalize the attention queue and avatar initials.

## 0.4.4 — 2026-08-30

- Route the Grok 4.6 trial seat through the Grok subscription CLI as its primary runner.
- Retain the Cursor `cursor-grok-4.6-{effort}` named-model door as ordered discovery-time fallback.
- Enforce the verified Grok headless invocation contract: plain output before `-p`, provider-default effort, no model override, and `bypassPermissions` only for write-consented runs.
