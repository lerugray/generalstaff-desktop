All sources, tests, scripts, and packaging files are read; claims in the packet cross-checked against the code. Here is the sealed review.

---

# GeneralStaff Workbench v2 — sealed review

**Reviewer:** Claude Fable (remote seat, per Gate E)
**Date:** 2026-08-27
**Candidate:** `codex/gs-workbench-v2-20260827` (reviewed as a git-less snapshot at `/tmp/gswb-sealed-review`)
**Posture:** read-only; no files were edited or executed

## Verdict: `NEEDS_REVISION`

The architecture is sound and matches the contract's shape: a first-party extension, a validated host/webview bridge with a restrictive CSP, argument-array process invocation, read-by-default permissions with a host-owned write modal, bounded persistence, and a hardened localhost preview. The packet's factual claims almost all check out against the source (19 tests counted, clip limits, stop semantics, evidence bounds, Kimi gating, read-default reset paths, no `shell: true` anywhere). Five material findings block the slice as-is; each has a small, well-scoped fix. None invalidates the design.

**Scope notes.** The review request says to evaluate against the product contract "and the repository instructions," but the snapshot contains no repository instruction file (no `CLAUDE.md`/`AGENTS.md`); I evaluated against the contract and packet only. The snapshot also has no git history and no `distribution/*.vsix`, so packaging/activation/browser-QA evidence is accepted as reported, not independently verified. I did not execute `npm run check` or any lane CLI (read-only posture).

---

## Release-blocking findings (descending impact)

### 1. A write run's cwd can resolve to the GeneralStaff private state repo, violating a stated boundary

**Paths:** `workbench-extension/src/services/fleet.ts:64-82` (`siblingRepoMap`), `fleet.ts:209`, `workbench-extension/src/extension.ts:229`

The packet guarantees: *"A write run requires a discovered sibling project repository and uses that repository as cwd. It never falls back to the GeneralStaff private state repo."* The sibling scan reads the **parent** of the GS root and admits every directory containing `.git` — including the GS private root itself, which is a git repo and is always its own sibling. `normalizeRepoName('generalstaff-private')` strips the `private` suffix and yields `generalstaff`, so any state directory that normalizes to the root repo's normalized name maps its `repoPath` to the private root. Nothing excludes the root from the map, and on a name collision `map.set` keeps whichever directory `readdir` returned last (`generalstaff-private` sorts after `generalstaff`, so the private root wins even when a legitimate sibling of that name exists).

**Concrete failure scenario:** root is `~/code/generalstaff-private`; the state tree contains `state/generalstaff/tasks.json` (the project's own visual harness, `workbench-extension/test/visual-harness.html`, models exactly such a `generalstaff` meta-project, so this naming is expected in production). The project card then shows a "discovered repository," the operator enables edit access via the modal, and the write-consented lane — Cline with `--auto-approve true`, or Kimi — runs with **cwd = the private state repo**, free to edit `state/`, task ledgers, and decision records. Every host-side guard (`project.repoPath` checks at `extension.ts:120,155,225`) passes, because `repoPath` is set — to the wrong repo.

**Correction:** in `siblingRepoMap`, skip the entry whose resolved path equals `rootPath` (and consider refusing normalized-name collisions instead of last-write-wins).

### 2. On Windows, prompt text still reaches `cmd.exe` command-line parsing through the PowerShell shim — the "operator text is never command source" claim does not hold for the shim path

**Paths:** `workbench-extension/src/services/processInvocation.ts:21-33`, `workbench-extension/src/adapters/cliAdapter.ts:272-283`

The shim base64-encodes `{executable, args}` so no operator text sits in the PowerShell command string — verified, and the unit test at `adapter.test.ts:94-103` confirms the encoding. But the decoded call is `& $spec.executable @argumentList`, where `$spec.executable` is a `.cmd`/`.bat` file. PowerShell invokes a batch shim through `cmd.exe`, which re-parses arguments with its own metacharacter rules (`&`, `|`, `%VAR%`, `^`, `"`). `@argumentList` splatting does not neutralize `cmd.exe`'s parsing of the child's argument string. For lanes that pass the prompt as a CLI **argument** rather than stdin — Cline and Cursor both put `groundedPrompt` in `args` (`cliAdapter.ts:100-128`) — a prompt like ``review this & calc`` can still break out on a `.cmd` target.

The test only asserts the prompt is absent from the *PowerShell* args and round-trips through base64; it never exercises `cmd.exe` re-parsing, so it gives false confidence. Note the codex lane passes the prompt via stdin (`cliAdapter.ts:67`) and is not exposed here; Claude uses `-p <prompt>` as an arg (`cliAdapter.ts:72`) and would be. Kimi 3.x is Windows-relevant too.

Because the packet flags Windows `.cmd` invocation as covered-by-unit-test-but-not-run-on-Windows (known limitation 1), and the injection-safety claim is explicit, this is release-blocking for the Windows target rather than optional. **Correction:** invoke `cmd.exe /d /s /c` with the executable and args as a proper argv array (letting Node quote), or resolve `.cmd` shims to their underlying `node`/`.exe` entry and spawn that directly, and add a test that asserts a `&`-bearing prompt does not spawn a second process.

### 3. `execFile` lane probes are not wrapped by the Windows shim, so probing never succeeds for `.cmd`/`.bat` CLIs

**Paths:** `workbench-extension/src/services/lanes.ts:106-124` (`probeLane`), `lanes.ts:90-104` (`findOnPath`)

`probeLane` calls `processInvocation(executable, args)` (good) but hands the result to `execFile`. When the discovered executable is a `.cmd` (the normal shape for npm-installed CLIs on Windows, and `findOnPath` explicitly appends `.CMD`/`.BAT` from `PATHEXT` at `lanes.ts:92-93`), `processInvocation` rewrites the call to `powershell.exe … -Command <script>` and moves the base64 spec into `processSpec.env`. `execFile`'s options **do** merge that env (`lanes.ts:115`), so PowerShell would run — but `probeArgs` such as `['login','status']` are the *lane's* probe args, which the shim faithfully forwards; the real issue is that this path has zero test coverage and the 5-second `execFile` timeout plus PowerShell cold-start makes false-negative "unavailable" likely on Windows. More concretely: every lane whose probe depends on a `.cmd` shim inherits the untested shim path, and a probe misfire renders the lane `unavailable`/`missing` in the UI (`lanes.ts:145`), silently hiding a paid, working subscription.

**Concrete failure scenario:** on Windows, `codex.cmd` is present and logged in, but the probe times out or the PowerShell wrapper's exit/stdout plumbing differs from a direct spawn; the Command Deck shows "needs login or repair" and the operator cannot select a lane that actually works. This compounds finding 2's lack of real Windows exercise. **Correction:** add Windows probe coverage (or a documented manual probe result) and confirm `execFile` + shim returns probe stdout intact; treat probe timeouts distinctly from auth failure in the surfaced `detail`.

### 4. The webview's lane "evidence" badges are hardcoded and contradict the contract's honesty requirement

**Paths:** `workbench-extension/media/workbench.js:24-30`, rendered at `workbench.js:306` and `workbench.js:426`

Contract §4.1 requires the interface to preserve three distinct evidence classes — **measured**, **operator-proven**, **promising/provisional** — "instead of flattening them into a misleading leaderboard," and §7 requires "real data wherever a surface claims to be live; clearly labeled sample data only in an isolated preview mode." The lane cards render a static map: `kimi: 'Measured · 87.3'`, `cline: 'GLM measured · 87.7'`, `claude: 'Operator-proven · not benchmarked'`, `codex: 'Repo-proven · seat provisional'`. These numbers are constants in presentation code, shown unconditionally on the live Command Deck with no sample-data labeling. They are a scored leaderboard — exactly what §4.1 forbids — and they present benchmark figures as live truth. The contract's own §4 narrative also says Fable "has never been run through that battery," which the "operator-proven · not benchmarked" string honors, but the paired `87.3`/`87.7` numerals for Kimi/Cline read as current measured scores with no provenance or date.

**Concrete failure scenario:** a depleted or reconfigured Cline lane still advertises "GLM measured · 87.7" on a surface the contract insists must be live, misleading the operator's seat choice — the precise "misleading leaderboard" the contract calls out. **Correction:** drive evidence-class from adapter/config data (or the benchmark note's date), label it as historical, and drop the bare numeric scores from the live surface unless sourced from real current data.

### 5. `@types/vscode` (1.134) is older than the declared engine (`^1.135.0`), so the "activates on VS Code 1.135" spine claim is typechecked against the wrong surface

**Paths:** `workbench-extension/package.json:14,107`

`engines.vscode` is `^1.135.0` and Gate A requires activation on 1.135, but `devDependencies["@types/vscode"]` is `^1.134.0`. The packet discloses this (known limitation 7). It is minor in isolation, but it means `npm run typecheck` — the first line of the evidence chain (`package.json:99,101`) — validates the host code against the 1.134 API, not the 1.135 target the extension declares and the review is asked to certify. Any 1.135-only API or signature change would pass CI and fail at runtime. Combined with the snapshot carrying no `.vsix` and no independently reproducible activation log, the "activates without errors on 1.135" claim rests on types for a different version.

**Correction:** pin `@types/vscode` to `^1.135.0` once published (or lower `engines.vscode` to `^1.134.0` to match the type surface actually validated), then re-run `npm run check`. Until then, treat the 1.135 activation claim as asserted, not typecheck-backed.

---

## Optional follow-up (non-blocking)

- **Redaction misses generic `sk-ant-`/provider keys and long hex/JWT bearer tokens.** `workbench-extension/src/security/redaction.ts:3` matches `sk-` with optional `ws-`/`sp-` infixes but a raw `sk-ant-…` matches the general `sk-` rule only if it has ≥12 trailing chars (it does) — acceptable — yet three-part JWTs and bare 64-char hex secrets are not covered. Evidence is bounded and best-effort by design; consider adding a JWT pattern. Not blocking.
- **`normalizeRepoName` collision is silent.** Two siblings normalizing to the same key (e.g. `snesos` and `snes-os`) collide in the map with last-write-wins (`fleet.ts:60,76`). Beyond finding 1, this can mis-map a project to the wrong repo. Consider warning on collision.
- **Prompt/transcript handoff sends the full selected-context file *paths* to the lane** (`extension.ts:236-241`) but never the file contents; the operator-facing copy ("attach or reference local documents and images," contract §3.1) may over-promise. The lane receives a path list, not attachments. Worth a UI clarification. Not a safety issue.
- **`deactivate()` performs no cleanup** (`extension.ts:532-534`); it relies on panel `dispose()` via subscriptions. This is correct for normal shutdown and matches known limitation 6, but the comment claims process trees are disposed "through registered subscriptions" — the child processes are owned by `CommandDeckPanel`, whose `dispose()` runs on panel close, not on `deactivate`. Behavior is fine; the comment slightly overstates.
- **Codex is the only lane defaulting selected in the webview** (`workbench.js:14`) and its evidence line says "seat provisional," consistent with the contract's stopgap posture. No action needed; noted for traceability.
- **Contract Gate E expects a dated `docs/sessions/*codex-seat*.md` pickup note**; it is absent from the snapshot. Likely out of review scope, but it is a named acceptance artifact still outstanding.

---

## What was verified and holds

Bridge validation rejects unknown lanes/seats, oversized prompts, and inherited shapes (`messages.ts`, `messages.test.ts`); path containment rejects prefix-lookalikes and `..` escapes (`paths.ts`, `security.test.ts`); the webview CSP is `default-src 'none'` with a per-load nonce and `connect-src 'none'` (`extension.ts:464-471`); the preview server binds `127.0.0.1:0`, gates on a 36-hex random token, re-checks path containment per request, and sets no-store/nosniff/no-referrer/restrictive-CSP (`previewServer.ts`); output clips at 200,000 chars and evidence at 80 lines × 800 chars, redacted (`extension.ts:255-264`, `cliAdapter.ts:264-268`); new conversations reset to `read` on every entry path (`workbench.js:540,557,562,724`); Kimi throws in read mode (`cliAdapter.ts:87-90`); stop sends process-group TERM then KILL after 4s, `taskkill /t /f` on Windows (`cliAdapter.ts:228-252`); no `shell: true` and no string-concatenated commands anywhere; the CSS references no external URLs. Test count is 19 across the six files, matching the packet.

The two most serious items (findings 1 and 2) are boundary claims the packet states as guarantees, which is why they block rather than defer. All five are correctable without redesign.
