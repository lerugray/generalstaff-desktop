# GeneralStaff Desktop v2 — product contract

**Working product name:** GeneralStaff Workbench
**Branch:** `codex/gs-workbench-v2-20260827`
**Contract date:** 2026-08-27
**Status:** build contract; supersedes the v1 terminal-first direction on this branch only

## 1. The promise

GeneralStaff Workbench is a premium desktop command environment for a non-programmer who
already operates a fleet of AI models and projects.

The operator opens one application, chooses a project and a seat (or lets GeneralStaff route
one), explains the outcome in plain English, and watches structured work progress. Code,
terminals, diffs, Markdown, HTML previews, and browser views remain available as supporting
instruments. None is the product's center of gravity.

The defining test is:

> Ray can direct real GeneralStaff work, change model providers when one subscription is
> exhausted, inspect the resulting artifact, and answer decisions without being forced into
> a terminal or source-code view.

## 2. Why v1 failed

GeneralStaff Desktop v1 built useful fleet, project, ping, progress, notification, and session
machinery. Its execution surface was an embedded PTY running the real Claude/Cursor terminal
interface. As session features accumulated, the application became a decorated terminal
multiplexer. For an operator who does not write code, the wrapper added friction without
changing the underlying interaction.

V2 preserves the useful concepts and reverses the hierarchy:

1. conversation and decisions;
2. projects, lanes, progress, and artifacts;
3. previews and documents;
4. code and terminal access only when deliberately opened.

## 3. Product shape

V2 begins as a first-party extension and profile for current Visual Studio Code. If the
vertical slice proves valuable, it graduates to a thin Code OSS distribution that bundles the
extension, branding, profile, defaults, and update overlay. It must not become a long-lived
deep fork of editor core.

This ordering gives the project a falsifiable proof before it inherits distribution upkeep.
The extension is the product logic; the eventual Code OSS package is a replaceable shell.

### 3.1 Primary surfaces

#### Command Deck

The opening surface answers four questions without exposing implementation detail:

- What needs Ray?
- What is working now?
- What completed or failed?
- What should happen next?

It contains a concise attention queue, active sessions, lane availability, project cards,
recent verified/rejected work, and an artifact shelf.

#### Conversation

The main work surface resembles a premium desktop assistant, not a terminal:

- plain-English threaded conversation;
- visible project context;
- seat/model selector with human-readable roles;
- attach or reference local documents and images;
- streaming status expressed as activity, not raw protocol logs;
- stop, continue, retry, and open-result actions;
- structured decision cards when operator judgment is needed;
- a collapsible receipt showing model, lane, working directory, duration, and evidence.

Raw output is retained for diagnosis but stays behind a disclosure.

#### Project and artifact context

Projects are selected from GeneralStaff's real state and repository map. The workbench shows
mission, current work, recent progress, decisions, and artifacts. Markdown, HTML, images,
browser previews, diffs, source files, and terminals open through the mature editor shell only
when requested.

### 3.2 Secondary instruments

- Markdown and text editing in normal editor tabs.
- Rendered Markdown and local HTML/browser previews.
- Source browsing, search, source control, and diffs for exceptional cases.
- A real integrated terminal for diagnosis or direct CLI access.
- Command palette actions for experienced operators.

These capabilities must never crowd the Command Deck or conversation by default.

## 4. Seats, models, and lanes

The operator chooses a **job-shaped seat**, with the provider/model shown but subordinate:

- **Orchestrate** — route, decide, verify, harvest, and report.
- **Build** — implement bounded work in a repository.
- **Review** — inspect artifacts and return findings without writing.
- **Verify** — rerun checks and compare claims with evidence.
- **Fast assist** — short drafting, lookup, and mechanical work.

GeneralStaff owns the routing policy. The UI displays why a lane was selected and permits an
explicit override. Model IDs and current subscription preferences live in adapters/config, not
hardcoded throughout the workbench.

### 4.1 Initial adapter roster

Subscription-backed CLI adapters, preferred because they reuse already-paid access:

- Codex CLI (`gpt-5.6-sol`, with lighter Codex variants when appropriate);
- Claude Code (normal seat and explicitly configured alternate account);
- Kimi Code (edit-enabled prompt lane only: its current CLI cannot combine
  non-interactive prompt mode with plan mode, so the Workbench does not claim a
  read-only Kimi boundary);
- Cursor Agent;
- Cline (including the free GLM-5.3 Flash lane and Cline Pass roster).

Direct provider adapters, using secrets held outside the webview:

- Z.ai coding-plan GLM-5.3;
- Kimi subscription API (`k3`, `k3-256k`);
- Ollama Cloud rotating catalog;
- Alibaba token-plan Qwen;
- other GeneralStaff-approved OpenAI-compatible endpoints.

The 2026-08-24 orchestrator-seat benchmark supports GLM-5.3, Kimi K3/K3-256k, and xhigh
Opus as credible comparative seat candidates, subject to its missing human layer. Fable, the
normal operator, is dogfood-proven but has never been run through that battery because doing so
would consume too much of the scarce subscription allocation. GPT/Codex was a judge rather than
a subject in the battery; it has strong repo-level results, Fable's informed judgment that it can
carry the seat, and the present stopgap session as operational evidence, but is not yet a
benchmark-certified orchestrator.

The interface must preserve those different evidence classes instead of flattening them into a
misleading leaderboard: **measured**, **operator-proven**, and **promising/provisional**.

## 5. Adapter contract

Every adapter implements the same boundary:

1. `probe()` — binary/endpoint present, authentication usable, model catalog if available;
2. `start()` — begin a request without shell-string interpolation;
3. `events()` — normalize provider output into status, assistant text, tool activity,
   decision, artifact, error, and completion events;
4. `stop()` — cancel the owned process/request and its process group;
5. `continue()` — resume through a provider-supported session identifier or an explicit
   context handoff;
6. `receipt()` — provider, model, effort, elapsed time, exit state, and redacted evidence.

An adapter's success claim is not verification. Work completion remains subject to
GeneralStaff's existing independent verification and reviewer gates.

## 6. Data handling and permission boundary

The webview is untrusted presentation code. It never receives provider credentials, raw
environment files, authentication tokens, or unrestricted filesystem access.

Required controls:

- Secrets live in the host's secure secret store or remain inside an already-authenticated
  CLI. They are never written to workspace settings, logs, transcripts, receipts, or HTML.
- Host/webview messages use a small validated schema and a command allowlist.
- Child processes are launched with executable plus argument arrays, never concatenated shell
  commands.
- Working directories must resolve to a registered project or an explicitly approved path.
- Autonomous/write-capable operation is visibly distinct, requires a host-owned modal
  confirmation, and records consent; read/review modes remain the default. A lane is hidden
  when its CLI cannot honor the selected permission boundary.
- Local preview content receives a restrictive content policy and cannot call arbitrary
  network locations through extension privileges.
- Logs and surfaced errors are redacted before presentation or persistence.
- The UI invokes GeneralStaff commands/adapters for structured mutations; it does not casually
  rewrite `tasks.json`, project metadata, or decision ledgers.
- Stop/close owns process cleanup; no orphaned lane may silently continue editing.

## 7. Premium experience bar

The first useful build must feel intentional rather than scaffolded:

- strong hierarchy, restrained motion, and coherent empty/loading/error states;
- plain language throughout;
- project, seat, and permission state always visible;
- no generic SaaS dashboard grid, no developer-only jargon wall, and no raw ANSI terminal as
  the default result;
- keyboard accessible, legible at laptop scale, and usable in both a warm-light and deep-dark
  register;
- real data wherever a surface claims to be live; clearly labeled sample data only in an
  isolated preview mode.

The reaction target is Ray's stated bar: the completed product should feel expensive,
surprising, and materially more capable than the time spent appears to allow.

## 8. Acceptance ladder

### Gate A — architecture spine

- Extension activates on VS Code 1.135 without errors.
- Command Deck opens as the intentional home surface.
- Host/webview boundary has typed validation and restrictive content policy.
- Adapter registry can probe at least two genuinely different local lanes.

### Gate B — real conversation

- Ray can choose a registered GS project and at least two selectable model lanes.
- A plain-English prompt runs through each adapter and streams normalized activity into the
  same conversation UI.
- Stop, failure, completion, and raw-receipt disclosures work.
- No terminal tab is required for the normal interaction.

### Gate C — GeneralStaff context

- Real fleet/project state appears on the Command Deck.
- Attention, recent progress, and project mission/current-work context are grounded in current
  files rather than mock data.
- A completed response can surface a real local artifact and open it in the appropriate
  Markdown, editor, browser, image, or terminal instrument.

### Gate D — routing and continuity

- Orchestrate/Build/Review/Verify/Fast roles map through a configurable routing layer.
- A depleted or unavailable lane can be replaced without changing the conversation surface.
- Conversation receipts make the actual provider/model/effort visible.
- At least one conversation continues after application or window restart.

### Gate E — trust and quality

- Automated unit/integration tests cover message validation, path boundaries, redaction,
  adapter argument construction, process cleanup, state parsing, and persistence.
- Visual QA covers the main screen, active conversation, decision state, error state, and
  narrow laptop viewport.
- A neutral sealed-review packet describes data handling, permissions, process ownership,
  secrets, and test evidence without sensational or adversarial wording.
- Claude/Fable performs the sealed review after its account reset; every material finding is
  fixed or explicitly returned to Ray for judgment.
- A dated `docs/sessions/*codex-seat*.md` note records the final branch, evidence, review
  verdict, and exact pickup state.

## 9. Non-goals

- Competing with VS Code, Cursor, or Windsurf as a general-purpose programmer IDE.
- Rebuilding editor, terminal, browser, source-control, or Markdown engines.
- Hiding which provider performed work.
- Treating an agent's green prose as proof.
- Shipping a pay-as-you-go provider as the only usable default.
- Publishing, deploying, or merging to a live branch during the Codex stopgap seat.

## 10. Build order

1. Extension spine, premium Command Deck, validated host bridge.
2. Real GS state and project context.
3. Unified conversation state and persistence.
4. Codex plus one non-OpenAI adapter end to end.
5. Additional subscription and direct-provider adapters.
6. Artifact, preview, document, and terminal instruments.
7. Routing roles, availability, and receipts.
8. Test battery and visual QA.
9. Thin Code OSS packaging proof only after the extension proves the workflow.
10. Neutral sealed Claude/Fable review and remediation.
