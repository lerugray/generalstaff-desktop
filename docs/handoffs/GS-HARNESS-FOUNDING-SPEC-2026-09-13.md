<!-- GATED 2026-09-13 18:0x EDT by the orchestrator (Fable 5.1 seat); grounded at publish-v23 d2eb411.
RAY'S RULINGS (2026-09-13, chat MCQ):
  Shell = EXTEND THE EXTENSION HOST, hide VS Code chrome (Fugu's lean accepted over Ray's standalone instinct, with the EXIT CLAUSE: if after M2 the Lanes panel still feels like VS Code, the standalone shell inherits the adapter layer as a library).
  Register (Lanes + Desk) = (a) Kriegspiel desk, amber when it matters. (b) Gallery Halogen was the off-signature option on the slate; not chosen.
  Lane-failure alert = badge in the harness only (no OS notification).
  Q1 (empty Desk visible) = rec A, taken as an engineering call.
Builder: cursor cloud agents (auto meter; API pool for hard parts), one milestone per lane from this spec; the VS Code extension stays Ray's daily driver throughout. Public posture: NONE. -->

# GeneralStaff Workbench founding spec
**personal-harness · 2026-09-13 · fugu-max**

Grounded at `generalstaff-desktop` `publish-v23` @ `d2eb411` against `generalstaff-private` HEAD `38846534`. Ray’s GO (s114, 10:1x EDT): stand up Workbench so non-Anthropic seats run private-GS orchestration fully — skills, rules, hooks and memory carrying over, 1M context where the model supports it, Ollama app Claude toggle cloud-models-only.

This is a specification. Coders implement against it. No implementation code follows. Where this spec binds to an existing JSON shape or type, that shape is the contract; do not extend it in this founding.

---

## 1. Purpose

Workbench is Ray’s personal operator harness for GeneralStaff: the one window where a non-programmer orchestrator talks to seats, watches detached work, and rules on staged evidence. It is “like Claude Desktop” in job, not in product ambition — a private console for one operator, rooted in `generalstaff-private`, surviving restarts, carrying the practice (skills, rules, hooks, memory, pings, handoff) without requiring Ray to open Finder, SSH, or a repo tree.

It replaces two digging loops only:

- The morning `ssh` / `ls` / `pgrep` / log-glance loop over Mac and home-PC sentinels, which `lane-desk` already compresses to JSON (`03-lane-desk-scoping.md` §2) but which today is a tool *inside a chat turn*, not a standing view.
- Hand-opening `~/Desktop/handoff/` packets, WHAT-TO-JUDGE cards, and `ANNOTATE.html` in Finder/Preview (`04-decisions-arrive-staged.md` lines 15–20, 52–56).

It replaces nothing shared and nothing public. It is not a second GeneralStaff CLI, not a fleet product, not ORDERLY, not Life Console, and not a thing we ship to other operators. Life Console remains the life-state daily driver (`07-life-console-readme-head.md`); Workbench remains the GS operator harness. They stay separate apps with separate identities.

The founding **extends** Workbench 2.5 (~0.4.7) on `publish-v23`. Command already exists. The new work is “visuals into running lanes” plus Desk, on top of the adapterized seats that already run. It must not become a rewrite, a shared product, or a second operating practice.

---

## 2. Anti-goals

- **Not a shared product.** No marketplace listing, no onboarding, no multi-user, no “team workspace,” no public README pitch. Personal to Ray.
- **No marketing surface.** No landing page, changelog theatre, or screenshot kit as deliverables of this founding.
- **Not a VS Code clone.** The current architecture may legitimately *host* VS Code. Hosting the editor is not cloning it. Cloning it would mean reproducing VS Code’s chrome, file tree, and “an IDE with a chat sidebar” as the product identity. The product identity is Command / Lanes / Desk for one operator. VS Code is the host the way a browser hosts a web app: editor, diff, terminal, and provider CLIs come for free; they are not the point. A dedicated simple layout that *can* reveal the editor is in-scope. An IDE skin is not.
- **No local inference. NEVER.** Ollama is cloud models only. The Ollama app’s Claude toggle is configured the same way. Workbench must refuse to point CC-doors or direct-API seats at a local model. This is a fed rule, not a preference.
- **No new scheduler.** `lane-desk` plus existing sentinels (`run.log` / `run.status` / `run.done`, classified in `03-lane-desk-scoping.md` §2) are the scheduler. Do not invent a second process table, a Workbench-owned launch queue, or `lane_launch` (explicitly deferred v1 in that same spec). Do not run `lane-desk` as a daemon — its non-goals forbid a background daemon on the Mac (`03-lane-desk-scoping.md` §4).
- **No Tauri resurrection** unless a concrete capability is impossible in the extension host. None is. Do not revive `src-tauri/` / `src/` as a shell. Do not embed a terminal as the primary interaction.
- **No skills polyfill** on direct-API / Cursor / Cline / Grok adapters. Full private-GS orchestration (skills, rules, hooks, memory) rides the CC-door. Do not fake it.
- **No silent writes** to ledgers, `tasks.json`, git, sentinels, or BOARD.md. See §5.
- **No merge with Life Console or ORDERLY.** Lane-desk was specified *out* of ORDERLY for boundary reasons (`03-lane-desk-scoping.md` §1). Keep that.
- **No greenfield chat.** Command’s conversation path is being hardened (tool-payload leak, Enter-to-send). Reuse it. Do not open a second message pipeline.

Astra’s CUT is an anti-goal in force: pause expansion of surfaces until one more outcome is demonstrated (`06-astra-personal-passage.md` item 8). This founding is allowed only because Ray GO’d it and because it extends a working harness rather than adding a fourth app. Anything that is not Command-extend / Lanes-panel / Desk-panel is out.

---

## 3. The three surfaces

One extension. Three surfaces. Shared host, shared private root, no shared product.

### Command (exists — name the gap, do not rebuild)

Already present, keep:

- Persistent Orchestrator session pinned above the project list, rooted in `generalstaff-private`, surviving restarts.
- Type contract: `SeatId`, `LaneId`, `LaneSummary`, `FleetSnapshot`, `Conversation`, `RunEvent` (`01-domain.ts` lines 1–17, 35–47, 104–113, 154–178).
- Adapterized seats and CC-doors (§4).
- Private runtime tools Headroom and Lane Desk as *ephemeral MCP defs* for Claude/Codex/CC-door write-capable runs (`02-cliAdapter.ts` lines 54–86, 163–174, 248–275), degrading for lanes that cannot take stdio MCP.
- Hardened chat normalize path (`02-cliAdapter.ts` `claudeProtocolAssistantText` lines 369–379, `nestedText` skipping `tool_use`/`tool_result` lines 348–351, `normalizeCliLine` lines 400–478).

Missing, and this founding’s only Command work:

- Activity-bar (or equivalent) entries that open **Lanes** and **Desk** as first-class panels, independent of any conversation.
- A count badge on the Lanes icon from the same poll Lanes uses (`counts.failed + counts` of `stalled`/`inconsistent`/`orphaned`). Do **not** inject detached-lane rows into `FleetSnapshot.attention` — that mixes two vocabularies (`LaneState` vs lane-desk states) and is a schema change nobody needs.
- No new Command widgets, no second orchestrator transcript, no embedded terminal.

Lane Desk *as an MCP tool inside a chat turn* stays exactly as `privateRuntime` already launches it. That is not the Lanes surface.

### Lanes (NEW) — live visuals of detached runs

**What it is.** A standing, passively watched panel of work-lanes running *outside* the extension process tree (Mac / home-PC sentinels). It is not the Command seat list. Workbench `LaneId` (`codex`, `claude`, … in `01-domain.ts` lines 3–17) and lane-desk `id` (`orderly-authz`, …) are different objects. In this panel, “lane” means a lane-desk lane. Chrome subtitle: “detached runs.” Do not rename Command.

**What it is not.** Not an xterm. Not a replica of a remote conversation. Not a launcher. Not a poll of Ollama Cloud seats — those are Command seats, in-process. “Cloud” in Ray’s fleet sentence does not add a third host in this founding. v0 lane-desk hosts are `mac` | `home-pc` only (`03-lane-desk-scoping.md` §2 input schema). Bind to whatever the JSON returns; do not invent a `cloud` host or scrape logs for one.

**Integration (precise).** The panel does **not** hold an MCP connection. MCP is a chat-turn tool with standing prompt cost, registered only while orchestration is active (`03-lane-desk-scoping.md` §1). The panel invokes the **CLI** that already wraps the same core functions (`status` / `harvest` / `detail`, each `--json`). One-shot process, parse stdout JSON, discard. If the CLI is missing, render the existing capability miss (`PrivateCapabilitySummary` id `'lane-desk'`, `01-domain.ts` lines 55–62) and stop; do not shell-out to `ssh`/`pgrep` as a fallback (that would be a second scheduler).

Poll:

- Interval 15s while the Lanes panel is visible; 60s while hidden if the badge is still wanted; pause in sleep.
- Do not poll faster than lane-desk’s 10s in-memory TTL (`03-lane-desk-scoping.md` §3 Error behavior).
- Default invocation probes both hosts, matching the tool default.
- A failed host must still render the other (`ok: false`, `partial: true`, compact error codes only). Never hang the UI on `home-pc` SSH — the probe is already time-bounded; if a call exceeds ~6s, show last good snapshot with a stale mark and the envelope’s error, do not invent cached host data the CLI did not return.

**Status table — bind 1:1 to `lanes_status`. Do not add fields.**

Envelope (`03-lane-desk-scoping.md` §2 sample):

- `ok`, `generated_at`, `hosts.{mac|home-pc}.{ok, latency_ms, code?, message?}`, `counts`, `lanes[]`, `errors[]`, optional `omitted`.

Row (`lanes[]`): `id`, `host`, `repo`, `state`, `sha`, `dirty`, `age_min`.

State enum, unchanged: `running | stalled | done | failed | orphaned | inconsistent | unknown`. Sort as lane-desk already sorts (attention priority: inconsistent, failed, stalled, orphaned, running, done, unknown). Do not re-sort in the UI.

Map to the ASK’s column list as follows — this is a closed mapping, not a wish list:

| ASK column | Source | Rule |
|---|---|---|
| name | `lanes[].id` | filename stem / lane id |
| host | `lanes[].host` | `mac` \| `home-pc` |
| model | **not in status** | Do not parse logs for a model name (schema creep + log sensitivity, `03-lane-desk-scoping.md` §2 rules and §4). Show `repo` on the row. If `lane_harvest` later carries a harness/model key, show it in the detail pane only. Otherwise omit. |
| elapsed | `lanes[].age_min` | minutes since latest log/sentinel mtime |
| sentinel state | `lanes[].state` | the seven-state enum |
| log tail | `lane_detail` | **on selection only**, never auto, never as part of status |
| harvest button | `lane_harvest` | display-only |

Also show `sha`, `dirty`, host latency, and `counts`. Cap at 50 rows; if `omitted` is set, show “omitted: N” and do not page.

**Selection → detail pane.**

1. Call `lane_detail` with `{lane_id, host, lines: 40}` (default 40, max 100, 16 KiB — do not raise). Render `lines[]` as a monospace tail. Strip is already done by lane-desk. Do not secret-scrub further; do not claim you did. Never accept a filesystem path from the UI.
2. Harvest button calls `lane_harvest` with `{lane_id, host}`. `host` is required in the UI whenever two rows share an id (the tool already returns `ambiguous_lane` otherwise). Render the envelope as a read-only card: paths, process `{running,pid,pgid}`, git summary, `tests.reported` / `tests.verified` (always false in v0), `attention[]`. This is read-only despite the word “harvest.” No commit, kill, rerun, verdict, or sentinel write (`03-lane-desk-scoping.md` §2 `lane_harvest` rules).
3. Ambiguous / missing / unmapped: show the structured error (`code`, candidates). Do not guess a repo.

**Prohibitions on this surface.** No kill, relaunch, WIP commit, BOARD edit, log-path open-in-editor as a default action, raw SSH, or `lane_launch`. Opening a harvested `log_path` in the host editor is allowed only behind an explicit “Open log” gated click, and only for Mac-local paths; do not SCP from home-PC.

### Desk (NEW) — handoff packets, rulings back through pings

**What it is.** A standing view of `~/Desktop/handoff/` (`04-decisions-arrive-staged.md` lines 15–16), the one maintained staging surface. Each subdirectory is one packet (`<GAME>-<GATE>-<date>/`). One decision per folder.

**Packet view, read-only scan:**

- Folder name, mtime.
- Ray-facing cards: `*.html` (WHAT-TO-JUDGE and reading docs). **Never present raw `.md` as the operator card** (addendum 2026-08-26, lines 42–46). If only `.md` exists, show “card not staged as HTML” and do not render markdown as a substitute UI.
- `ANNOTATE.html` if present (screenshot packets, lines 52–56) — open in the panel webview (`file://`, offline). Do not reimplement pin UI; the file is the UI.
- Playables / frames / WAVs listed as open-with-OS actions (double-click equivalent). Workbench does not embed a game runtime or an audio DAW.
- Stamp presence, display-only: `.ready-gate-passed`, `.replay-gate-passed`. Desk does **not** run `scripts/stage-gate.sh` or mint READY records. Staging law stays with the orchestrator (`04-decisions-arrive-staged.md` addendum 2026-09-04).
- Empty desk: one quiet sentence, “No packets on the desk.” Not a dashboard, not a hidden icon.

**What is not a packet.** Text-only policy calls stay in Command as decision cards (`ConversationDecision` in `01-domain.ts` lines 128–148; s73 addendum lines 64–68). Desk must not grow an MCQ builder for no-artifact questions.

**Ruling write-back — load-bearing.**

A ruling is one operator-confirmed action that does exactly two things, in order:

1. **Write the ping via `scripts/ping.sh` only.** Never a raw append to the pings inbox, never a direct file write, never a ledger row, never a `tasks.json` edit, never a git commit. Compose stdin/args the way other GS surfaces already invoke that script (coder: read `scripts/ping.sh` in `generalstaff-private` and match its current CLI; do not invent flags). Body MUST include: packet folder name, the ruling text Ray typed, and any ANNOTATE notes he pasted or that the panel collected from the card’s “COPY ALL NOTES” output if he opts in. Do not silently include annotate notes without a visible checkbox defaulting to on when notes exist.
2. **Stale the packet** by moving the folder to `~/Documents/session-artifacts/` (`04-decisions-arrive-staged.md` lines 16, 58–62). The ruling *is* the operator gate; the sweep is immediate and unconditional once `ping.sh` exits 0. If `ping.sh` fails, do not move the folder; show the error; leave the packet.

Do not sweep on panel close, on Workbench quit, or on a timer. Do not delete in place. Do not mutate repo state as part of a ruling.

Preview of HTML cards uses the extension webview. That is display, not a write.

---

## 4. Seats + doors

Reuse `src/adapters/` and `02-cliAdapter.ts`. Do not add a seat in this founding. Do not redesign availability probes.

### Which seat runs where

From `LaneId` (`01-domain.ts` lines 3–17) and `invocationFor` (`02-cliAdapter.ts` lines 163–284):

| Seat (`LaneId`) | Where it runs | Protocol | Skills/rules/hooks/memory | MCP Headroom / Lane Desk |
|---|---|---|---|---|
| `claude` | Anthropic Claude Code binary, model `fable` | Claude-protocol | Native CC config | Yes, **write-capable runs only** (plan mode strips MCP, lines 163–174) |
| `claude` runner `cursor` | Cursor Fable fallback | Cursor stream-json | Cursor, not CC | No |
| `codex` | Codex CLI, `gpt-5.6-sol` | Codex json | Codex instructions, not CC skills | Yes (`codexMcpArgs`, lines 54–61) |
| `kimi` | Kimi CLI | stream-json | Native Kimi | No; write-only (read-only throws, lines 175–186) |
| `cline` | Cline CLI | Cline json | Native Cline | No |
| `cursor` | Cursor CLI, model `auto` | Cursor stream-json | Native Cursor | No |
| `grok` | Grok CLI, or Cursor Grok fallback | plain or Cursor json | Native | No |
| `glm-ollama`, `glm-ollama-flash`, `deepseek-ollama` | Ollama Cloud **direct-API** adapter | Direct API | **Cannot.** `invocationFor` throws to the API adapter (lines 280–284). Comment at `01-domain.ts` lines 12–17 is the law. | No |
| `deepseek-ollama-cc`, `glm-ollama-cc` | **CC-door**: real `claude` binary against Ollama Cloud’s Anthropic-compatible endpoint, own config dir, via `scripts/gsd-cc-door.sh` + `scripts/seat-config-sync.sh` | Claude-protocol (`speaksClaudeProtocol`, `02-cliAdapter.ts` lines 396–398) | **Yes — this is what “non-Anthropic seats run private-GS orchestration fully” already means.** Plan mode, effort, resume, extra dirs, MCP permission args: same as Fable (lines 248–275) | Yes, write-capable only, same strip as Claude |

CC-door covers the Claude-protocol non-Anthropic fleet. It does **not** cover direct-API Ollama, Cursor, Cline, Kimi, Grok, or Codex. That is not a miss to patch in this founding; it is the adapter boundary. If a future provider grows an Anthropic-compatible cloud endpoint, add a CC-door seat the same way — do not shim skills onto the direct adapter.

1M context: already set for CC-door via `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, verified live 2026-09-13 against `/api/show`. Do not regress. No new Command control.

Ollama app Claude toggle: cloud models only, same as the door. M0/M4 acceptance includes a probe that the door’s endpoint is cloud, not local. Never start a local model from Workbench.

### Availability probes — describe, do not redesign

`LaneSummary.state: 'available' | 'missing' | 'checking' | 'unavailable'` (`01-domain.ts` lines 19, 35–47). Command already probes executables and fills `executable?`. Lanes-the-panel uses lane-desk host health, a different enum; do not merge. Gap: none worth a redesign. If `lane-desk` CLI is missing, that is `PrivateCapabilitySummary.state = 'missing'`, already modeled.

`supportsNativeResume` (`02-cliAdapter.ts` lines 88–90) stays as-is: false for `cline`, `glm-ollama`, `glm-ollama-flash`, `deepseek-ollama`.

Effort tables (`02-cliAdapter.ts` lines 92–117) stay as-is. CC-door default effort is `high`.

### Carry-over

- **CC-door seats:** `seat-config-sync.sh` remains the only mechanism that symlinks skills, rules, memory, hooks into the door’s config directory. Workbench must not reimplement that sync; it may *invoke* the existing script if Command already does on seat check, otherwise leave it as the operator/setup path that s114 already used.
- **Claude Fable:** native CC config, already.
- **Codex:** MCP tools only, not CC skills.
- **Everyone else:** native provider surface. Document in seat detail, do not fake a skills list.

---

## 5. Data + integrity

### Reads (observers only)

| What | Canonical path / source | Who already reads it |
|---|---|---|
| Private root, projects, roster, skills, Command lanes | `FleetSnapshot.rootPath` → `generalstaff-private`; `projects[].statePath`; `lanes`, `skills`, `capabilities` (`01-domain.ts` lines 104–113) | Command, today |
| SESSION-RESUME | The existing resume document Command already loads from that private root. Coder: use the same resolver Command uses; do not add a second glob. | Command, today |
| Pings inbox | Whatever `scripts/ping.sh` appends to. Resolve from that script. Do not hardcode a parallel inbox. | ping path, other GS surfaces |
| Detached lane artifacts | lane-desk TOML allowlist. home-PC default log dir `/home/ray/launch-logs/` (`03-lane-desk-scoping.md` §3). Mac log dir is configured explicitly — **do not guess it.** Goals sample path in harvest JSON is informational. Git only against mapped, allowlisted repos. | lane-desk CLI |
| Desk packets | `~/Desktop/handoff/<GAME>-<GATE>-<date>/` | Finder/Preview today; Desk after this founding |
| Swept packets | `~/Documents/session-artifacts/` | wrapup sweep today |

Lanes and Desk **read through** lane-desk CLI and directory listing. They do not grow their own roster, board, or lane database (lane-desk non-goal: “Maintain an authoritative lane database”).

### Writes (closed set)

Allowed without a further design call:

1. `scripts/ping.sh` as the sole ruling write (§3 Desk).
2. Move of a *ruled* packet from `~/Desktop/handoff/` to `~/Documents/session-artifacts/` after `ping.sh` exits 0, as part of that same confirmed action.
3. Extension-local UI state (last selected lane, panel visibility, badge counts) in the existing Workbench state store. Not in the repo.

**Forbidden without an explicit, additional operator gate that already exists in Command (write-consent on a conversation):**

- ledgers, `tasks.json`, BOARD.md, READY records, sentinels (`.done` / `.failed`), git, `lane-run.sh`, Claude/Ollama config, `seat-config-sync` as a silent side effect of opening a panel, anything under repo trees.

The harness must never silently mutate those. A Lanes refresh is a read. A harvest is a read. Opening ANNOTATE.html is a read. This is load-bearing.

Handoff HTML preview must not write into the packet except ANNOTATE.html’s own existing local autosave (that file already autosaves; do not replace it).

---

## 6. Shell choice with tradeoffs

**Recommend: keep the existing VS Code extension host. Extend Workbench 2.5. Do not revive Tauri. Do not start a greenfield Electron app.**

### Why the Tauri prototype failed

Its 5-commit history proved real things: fleet state, tray attention, pings, progress, notifications, session machinery. It then became “a decorated terminal multiplexer” because the *primary interaction stayed an embedded terminal instead of the conversation*. That is a UX trap, not a shell-technology failure. Life Console proves Tauri can host a non-terminal personal console (`07-life-console-readme-head.md`: Tauri 2.10, vanilla HTML/JS/CSS, hotkey summon, amber identity). Reviving `src-tauri/` would still invite the trap the moment someone “just adds a terminal” for detached lanes. Lanes is a JSON situation board; Desk is a packet folio. Neither needs a PTY.

### Would that failure repeat under Electron?

Only if we choose it. Electron can host webviews the same as a VS Code webview. It does not protect us from an xterm. It also does not give us the editor, diff viewer, integrated terminal, or the provider CLIs already solved in the extension. A standalone Electron “Claude Desktop clone” would re-solve: adapter spawn (`runCliAdapter`, 770 lines of hard-won normalize/redact/session/MCP), availability probes, conversation persistence, write-consent, the same-day chat-hardening, and the private-root watcher — then drift from `publish-v23` forever. That is a second product. Astra CUT forbids counting a new surface as progress.

### Cost of walking away from the extension host

Concrete, already-paid assets on `publish-v23`:

- Domain contract and FleetSnapshot.
- Eight plus two CC-door seats, effort tables, plan-mode boundaries, MCP strip on read-only Claude/CC.
- `normalizeCliLine` / `claudeProtocolAssistantText` — the tool-payload-leak fix.
- Headroom + lane-desk MCP launch for capable seats.
- Editor, diff, terminal, file open, when Ray *does* need to see a patch.
- Restart-surviving orchestrator session.

Walking away means re-paying all of that during a founding whose GO was “stand up the Workbench (generalstaff-desktop)” — the extension that already exists — “so non-Anthropic seats run private-GS orchestration fully.” The CC-doors already do the GO’s mechanical work. The founding’s new work is two webview panels and a ping-gated Desk write. That is extension work.

“Like Claude Desktop, not a VS Code clone” is a **layout and register** problem: custom webviews, simple layout that hides the editor until a file is opened, activity-bar icons for Command / Lanes / Desk, Workbench palettes — not a shell swap.

---

## 7. Milestones M0–M4

Each is one verifiable sentence. No extra scope.

- **M0** = Workbench on `publish-v23` activates, Command still shows the pinned Orchestrator session plus the existing seat list with live `LaneSummary.state` probes, and a documented probe confirms the Ollama Claude toggle / CC-door endpoint is cloud-models-only (no local model).
- **M1** = A Lanes panel, independent of any conversation, renders a live `lanes_status --json` table for Mac and home-PC with `id`, `host`, `repo`, `state`, `sha`, `dirty`, `age_min`, host latency, and counts, including a partial envelope when `home-pc` is down.
- **M2** = Selecting a row loads `lane_detail` (default 40 lines) in a tail pane and a Harvest button loads `lane_harvest` as a read-only card, with no writes and no path-based log open.
- **M3** = A Desk panel lists `~/Desktop/handoff/` packets with HTML WHAT-TO-JUDGE cards and `ANNOTATE.html`, and one confirmed ruling invokes `scripts/ping.sh` then moves that folder to `~/Documents/session-artifacts/` only on ping success.
- **M4** = From Command, a CC-door seat (`deepseek-ollama-cc` or `glm-ollama-cc`) completes one private-GS orchestration turn with skills/rules/hooks/memory carried, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` still at 1M where supported, chat still going through `normalizeCliLine` (no tool payloads in bubbles), and Lanes/Desk unused by that turn except as available panels.

Do not slip `lane_launch`, tray apps, or a palette rewrite into M0–M4. Register is chosen by Ray in §9; apply the chosen direction as a skin on Lanes/Desk without blocking M1–M3.

---

## 8. Register

Two directions for **Lanes and Desk only**. Command keeps its current Workbench skin until Ray says otherwise. Coders ship whichever Ray picks; default if he does not answer: (a).

### (a) Grounded — Kriegspiel desk, amber when it matters

~120 words. Inherit the six Workbench palettes — Kriegspiel Paper, Kriegspiel Night, Linen Folio, Map Vellum, Iron Press, Carbon Folio — and treat Life Console’s amber “signal light” as a sibling personal-driver cue, not a copy (`07-life-console-readme-head.md`). Lanes reads as a situation map: paper or night field, lanes as counters (id as the unit name, host as the map board, `state` as the counter colour: inconsistent/failed in iron-red, stalled in dust, running in ink, done in quiet grey). Elapsed and sha are marginalia, not dashboard chrome. Desk reads as a folio: one packet one leaf, WHAT-TO-JUDGE card set as a printed plate, ANNOTATE as an overlay sheet. Amber is reserved for *attention that needs Ray* — Lanes badge, failed/inconsistent counters, a packet waiting on the desk — the same job Life Console’s signal light does for daily life, here for GS only. No seagull. No new mascot. Typography and density stay with the current Workbench, so Command and the new panels feel like one instrument.

### (b) Off-signature — Gallery Halogen (labelled as such)

~120 words. **Not an interpolation of Ray’s prior picks** (`protect-taste-from-the-machinery`: one option on every slate must not mirror the paper / night / linen / vellum / iron / carbon / amber set). Gallery Halogen: museum white, black steel frames, a single warm halogen spot on the thing being judged, cool leftover field. Lanes is a captioned hanging: each detached run is a labelled frame (id, host, state) on a white wall; colour is almost absent except a tally-light red on `failed`/`inconsistent` and a small green pin on `running`. No map grain, no folio deckle, no carbon stock, no amber wash. Desk is a viewing bench: the packet’s artifact sits in the spot-lit well; the WHAT-TO-JUDGE card is a wall label in a grotesque, not a serif; ANNOTATE is a loan-desk clipboard. Empty desk is a blank wall, not a cozy empty folio. The judged object is lit; chrome disappears. If Ray hates it, that is the point of putting it on the slate — taste stays his, not the machinery’s.

---

## 9. Open design-axis questions for Ray

Purpose / feel / aesthetic only. Engineering and scope are decided above. Max 4. Each has a recommended lean.

**Q1. Empty Desk**
When there are no packets, should Desk be (A) always visible with a one-line empty state, or (B) absent until a packet lands (icon dims / hides)?
**(Recommended) A** — a hidden surface is a surface Ray cannot trust is working; empty-and-quiet is the folio at rest.

**Q2. Lanes attention**
When a detached lane is `failed` / `inconsistent` / `stalled`, should Workbench (A) badge the Lanes icon only, in-window, or (B) also raise an OS notification / tray flash?
**(Recommended) A** — Life Console already owns daily-driver summon; this founding should not grow a second notification personality. Command already survived without one.

**Q3. How “Claude Desktop” vs how “hosts VS Code”**
Should the default Workbench layout be (A) a simple three-surface console that hides the editor until a file is actually opened, or (B) the current VS Code workbench chrome with Lanes/Desk as extra panels?
**(Recommended) A** — matches “like Claude Desktop, not a VS Code clone” without leaving the host; the editor remains one click away, which is the cost-free asset §6 refuses to throw away.

**Q4. New-panel register**
For Lanes and Desk, pick (A) grounded Kriegspiel/folio + amber-for-attention, or (B) off-signature Gallery Halogen?
**(Recommended) A** for continuity with Command; **B is on the slate so the pick is a ruling, not a mirror.** If Ray wants the new surfaces to *feel* like a different instrument from Command, B is legitimate.

---

## 10. Risks + what would make this founding a mistake

**Astra CUT is a live risk.** Item 8, `[CUT · S]`: “Pause expansion of surfaces until one more outcome is demonstrated. Keep GS as useful personal infrastructure while testing whether others need the whole operating practice… Do not let another model lane, mode, dashboard, or audit document count as progress by itself” (`06-astra-personal-passage.md`). This founding is a new dashboard. It is justified only as *personal infrastructure Ray GO’d* (s114 10:1x) that extends a working extension, not as proof of GS-as-product. It becomes a mistake if M0–M4 grow a launcher, a public skin, a merge with Life Console, a second CLI, or “while we’re here” cloud-host scraping. The success test is Ray watching detached lanes and ruling packets without digging — not a seventh palette or an eighth seat.

**Tool-payload-leak class, recurring.** Same-day (2026-09-13) Command had tool payloads leaking into chat bubbles across adapters. The fix is specific: Claude-protocol walks `message.content[]` and only emits `type: "text"`; `tool_use` / `tool_result` never become prose (`02-cliAdapter.ts` lines 348–351, 369–379, 413–431). A Lanes/Desk surface that renders `lane_detail.lines[]` or harvest `paths[]` through the *chat* message pipeline, or that invents a second nested-text crawl for JSON envelopes, will re-bleed. **Contract:** Lanes and Desk render lane-desk JSON in their own view models. They do not call `normalizeCliLine`. They do not dump harvest JSON into a conversation bubble unless the operator explicitly pastes it. Command continues to use the hardened normalize path and only that path.

**Other concrete risks**

- **Vocabulary collision.** Workbench `LaneId` vs lane-desk `id`. If the Lanes panel is labelled like the seat picker, Ray will think Fable is “stalled.” Copy must say “detached runs.”
- **Daemon creep.** Polling the CLI every 15s is in-spec; leaving a Python MCP server running for the panel is a lane-desk non-goal and a standing cost. Don’t.
- **Write-path drift.** A “quick” `fs.writeFile` into pings or a packet `RULING.txt` would violate §5 and `04-decisions-arrive-staged.md`. Ping-or-nothing.
- **Stale packet trap.** If M3 pings but fails to sweep, Ray re-judges superseded evidence (s68 incident, lines 58–62). Sweep is part of the ruling, not a later wrapup.
- **SSH hang.** UI must not block Command on `home-pc`. Partial envelopes exist; use them.
- **Log sensitivity.** `lane_detail` can put secrets in a webview. Keep the 40/100/16 KiB cap; never auto-tail all rows; never send tails to a model from this panel.
- **Scope that duplicates Command.** Ollama Cloud seats already live in Command. Putting them on Lanes “for completeness” invents a third host and a second availability probe.

**What would make this founding a mistake, in one line:** building a new app (Tauri/Electron) or a new scheduler so that “visuals into running lanes” can look like progress, while the CC-doors that actually satisfy Ray’s GO already work on `publish-v23` and the only missing thing was a read-only panel plus a ping-gated desk.

---

*Coders: implement M0–M4 on `generalstaff-desktop` against this spec. Do not wait on §9 to start M1–M3; skin with (a) until Ray rules Q4. Do not add fields to lane-desk. Do not write implementation-adjacent “helpers” that launch, kill, or commit. Structural decisions above are closed.*