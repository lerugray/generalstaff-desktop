# GSD Workbench 0.4.4 Grok CLI re-back report

Date: 2026-08-30

## What changed

- The Grok 4.6 trial seat now lists the `grok` CLI runner first, using binary `grok` and candidates `~/.grok/bin/grok` then `~/.local/bin/grok`.
- The CLI presence probe is exactly `--version`, accepted by `/grok \d/`. Availability additionally requires `~/.grok/auth.json`; `grok models` is never used as an authentication signal.
- The existing Cursor runner remains second and retains its `cursor-grok-4.6-{effort}` availability/model mapping.
- The seat detail now says it rides the Grok subscription CLI with Cursor named-model fallback, and the benchmark evidence line is unchanged.
- Grok CLI write-consented calls use `--permission-mode bypassPermissions`; read-only calls use `--permission-mode plan`. Both use `--output-format plain` before `-p`. The CLI runner passes no model, effort, reasoning-effort, `--always-approve`, or `dontAsk` argument.
- Every Grok CLI effort selection resolves to provider default in the invocation and receipt label. The Cursor fallback retains the prior low/medium/high/xhigh named-model behavior.
- Package metadata is 0.4.4 and `CHANGELOG.md` contains the release entry. Fable/default-seat selection was not changed.

## Runner and fallback semantics actually used

`runners[]` is an ordered discovery-time fallback chain in this framework. Discovery probes all present runners, then selects the first runner whose probe and availability checks pass. For Grok, that means:

1. Select Grok CLI when its binary passes `--version` and `~/.grok/auth.json` exists.
2. Otherwise select Cursor when Cursor is logged in and its model catalog contains `cursor-grok-4.6-high`.
3. If neither is usable, preserve the framework's existing unavailable/missing state behavior.

There is no post-launch process-error retry in the adapter. If a successfully discovered Grok CLI later exits during a run, Workbench records that exit; it does not silently spend from Cursor. No runtime failover was invented.

## Verification

- New contract coverage verifies Grok CLI primary selection, `--version` plus auth-file gating, Cursor fallback selection, plain-output ordering, provider-default CLI effort, exact write permission mode, and the absence of `--always-approve` and `dontAsk`.
- Full test discovery: 65 tests. Result in this sandbox: 64 passed and 1 failed because the sandbox denied the unrelated preview test permission to bind `127.0.0.1` (`listen EPERM`).
- All tests runnable without a loopback listener: 64/64 passed.
- An offline machine-local TypeScript check, `node --check media/workbench.js`, and the production esbuild bundle completed successfully.
- The documented locked check could not run end-to-end: dependencies were absent, and both `npm ci` attempts failed because registry DNS is blocked (`ENOTFOUND`).

## Live Grok CLI smoke

- Installed binary: `~/.grok/bin/grok`.
- Presence result: `grok 0.2.54 (fee15ff8ea0)`.
- Auth-file presence check passed without reading or printing credential material.
- Attempted real one-shot shape: `grok --permission-mode plan --output-format plain -p <token request>` with the default model and no reasoning parameter.
- The first attempt reached the CLI but the sandbox denied session-state writes under the read-only home directory. A second attempt used a temporary `GROK_HOME` while reading the existing auth file in place; session-state creation then proceeded, but restricted DNS prevented the CLI transport from resolving its backend (`gs-cloud`). The process was stopped after the transport could not recover.
- Required token `GS_GROK_CLI_OK` was therefore **not returned in this sandbox**. No product invocation-contract failure was observed; this remains an unfulfilled live-environment verification item.

## VSIX

- Artifact: `/Users/rayweiss/Desktop/Dev Work/generalstaff-desktop/distribution/generalstaff-workbench.vsix`
- Archive integrity passed, and both `extension.vsixmanifest` and `extension/package.json` report 0.4.4. The rebuilt bundle inside contains the Grok CLI primary and Cursor fallback code.
- The documented `npm run package:distribution` command was attempted but could not fetch `@vscode/vsce` because registry DNS is blocked and VSCE is not installed locally. As an explicit fallback, the existing known-good VSIX container was refreshed with the rebuilt 0.4.4 package, README, changelog, license, bundle, and media, then zip-tested. This is a valid container but is not a successful VSCE-driven rebuild.

## Credential and key-material scan

The scan covered 17 files across `dist`, `media`, and the unpacked VSIX. It compared artifact content against locally available credential values without printing them and also checked common token/private-key patterns:

- Exact credential-value hits: 0
- Generic key-material hits: 0

## Honest gaps

- Full 65/65 suite green is not demonstrated because loopback bind is forbidden here; 64/64 non-listener tests are green.
- The live token smoke is not green because the sandbox blocks the Grok backend DNS/transport.
- The documented VSCE packaging path is not green because npm registry DNS is blocked; the delivered artifact used the validated container-refresh fallback described above.
