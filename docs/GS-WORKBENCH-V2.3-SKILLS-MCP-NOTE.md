# GeneralStaff Workbench v2.3 — cross-model skills and private runtime tools

**Date:** 2026-08-28  
**Branch:** `codex/gs-workbench-v2-20260827`

## Outcome

Workbench 2.3 makes the canonical skills in the selected GeneralStaff root
available across all five model lanes without copying those procedures into the
public repository or package. The same private runtime layer makes Headroom and
Lane Desk available by default wherever the provider exposes a safe transport.

## Skill bridge

- Discovers only valid, non-symlinked `skills/<id>/SKILL.md` directories.
- Explicitly excludes the `lean-ctx` tombstone.
- Shows the catalog in the composer and accepts a leading `/skill-name`.
- Bundles `SKILL.md` plus safe text companions, capped at 80 files and 260,000
  characters. Common credential shapes are redacted before dispatch.
- Translates Claude tool vocabulary into equivalent lane-native behavior,
  including Workbench decision cards for `AskUserQuestion`.
- Keeps native provider sessions scoped to skill ID. Changing the skill forces
  transcript continuity or a new provider session rather than carrying hidden
  instructions across procedures.

The live private root currently yields 28 canonical skills. The largest,
`delegate`, compiles completely at roughly 117,000 characters, below the cap.

## Private runtime matrix

| Capability | Direct Claude / Fable | Codex | Kimi, Cline, Cursor, Cursor-hosted Fable |
|---|---|---|---|
| Headroom | Ephemeral native MCP | Ephemeral native MCP | Unavailable; bounded native reads, never proxy/wrap or lean-ctx |
| Lane Desk | Ephemeral native MCP | Ephemeral native MCP | Equivalent read-only CLI fallback |

MCP definitions are built from verified local executables at run time. They are
not written into target repositories, persisted into provider-global settings,
or included in the VSIX. Lane Desk remains observational and cannot launch,
stop, repair, commit, or modify a lane. Neither helper expands Workbench access
or external-action authority.

Claude's ordinary `plan` mode denies every MCP call, including read-only tools.
For a read-only direct-Fable run with private MCPs, Workbench therefore uses
`dontAsk` with the built-in tool surface reduced to `Read,Grep,Glob` and an
explicit six-tool MCP allowlist (three Headroom, three Lane Desk). This permits
the observational MCP calls without exposing Edit, Write, or Bash. Direct
Claude without the private profile keeps the original `plan` mode.

## Verification

- TypeScript and webview syntax checks pass.
- 38 automated tests pass, including skill traversal/symlink rejection,
  redaction, slash dispatch, skill-scoped sessions, MCP argument construction,
  and Lane Desk native/fallback routing.
- Live discovery found all 28 canonical skills plus healthy Headroom and Lane
  Desk installations.
- A live Codex configuration probe accepted both ephemeral MCP definitions.
- A live direct-Fable low-effort smoke exposed both servers and successfully
  called `lanes_status` through the restricted read-only profile, returning
  `FABLE_GSWB_MCP_OK lanes=0` for the one-hour Mac window.
