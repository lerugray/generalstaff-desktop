# GeneralStaff Desktop

<!-- TODO: GSD cockpit screenshot -->
![GSD cockpit screenshot](docs/images/screenshot.png)

A Tauri 2 desktop console for [GeneralStaff](https://github.com/lerugray/generalstaff) — the local-first autonomous dev-fleet orchestrator. Targets macOS and Windows.

GSD gives the full fleet a permanent home outside the terminal: a dashboard of every registered project with its open task queue and recent cycle history, a per-project workbench (file tree, file viewer, pings inbox), and embedded terminal sessions that run real `claude` / `cursor-agent` CLI processes under a PTY — rendered in xterm.js and themed to match the rest of the UI.

It is strictly a **viewer/controller**: it reads GeneralStaff's file-based state and writes only to the pings inbox (`state/pings/inbox.md`). It never touches `tasks.json`, `project-meta.yaml`, or any other structured state file directly.

## Prerequisites

- macOS or Windows (Linux is untested but the Rust code is otherwise portable)
- [Rust](https://rustup.rs/) (stable, 1.77.2+)
- [Bun](https://bun.sh/) 1.2+
- [Tauri CLI v2](https://tauri.app/start/prerequisites/) (`cargo install tauri-cli --version "^2"` or via Bun — `bun add -D @tauri-apps/cli`)
  - Windows: also requires the [WebView2 runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (ships with Windows 11; downloadable for Windows 10)
- A GeneralStaff checkout (public or private)

## Two-repo layout

GSD reads GeneralStaff's file-based state, which spans two repos:

- **`generalstaff-private/`** — the private working repo where most project portfolios live (`state/<id>/tasks.json`, `state/<id>/MISSION.md`, etc.)
- **`generalstaff/`** — the public repo, which carries state for a handful of public-facing projects

At startup GSD resolves the private repo path from `~/.generalstaff-desktop/config.json`:

```json
{ "generalstaff_path": "/absolute/path/to/your/generalstaff-private" }
```

If the file or key is absent it falls back to `~/Desktop/Dev Work/generalstaff-private`. Create the config file to point GSD at your own GeneralStaff checkout. GSD then expects the public GeneralStaff repo as a sibling directory named `generalstaff` alongside the private one.

## Build from source

```bash
bun install
bun tauri dev       # development — hot-reload frontend, debug Rust
bun tauri build     # release build (unsigned; see Signing below)
```

The `scripts/install.sh` path is the macOS operator install flow — it builds a release bundle, copies the `gs-mcp` sidecar binary into `GeneralStaff.app/Contents/MacOS/`, re-signs inside-out with a stable identity, and drops the result in `/Applications`. Contributors building locally do not need it.

On Windows the sidecar (`gs-mcp.exe`) is placed beside the main executable by Tauri's bundler — no separate copy step is needed.

### The gs-mcp sidecar

`src/bin/gs-mcp.rs` is a second binary in the Cargo workspace — a stdio MCP server the dispatcher uses to communicate with the desktop. `scripts/install.sh` handles copying it into the bundle. During `bun tauri dev` the sidecar is not required; it only matters for the installed-app dispatcher flow.

## Signing (operators only)

### macOS

To keep macOS TCC permissions (Desktop folder, Screen Recording, Accessibility) stable across rebuilds, the installed app is signed with a consistent identity. The signing identity lives in a gitignored local override that Tauri 2 merges at build time:

**`src-tauri/tauri.local.conf.json`** (create this file locally; it is gitignored):

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "GS Dev Signing"
    }
  }
}
```

Set `signingIdentity` to the name of your certificate in Keychain. Contributors without a cert build and run fine without this file — `bun tauri dev` and `bun tauri build` both work unsigned.

## Security

### Autonomous mode — no sandbox

GSD supports an **autonomous session mode** where the AI agent is launched with all permission prompts bypassed (`claude --permission-mode bypassPermissions` / `cursor-agent --trust`). In autonomous mode the agent can **read and write any file on your machine and run any shell command without asking for permission**.

This is intentional for trusted operator use on known projects. It is dangerous if used on a hostile or untrusted project.

**Rules of thumb:**
- Only use autonomous mode on projects and prompts you fully trust.
- Do not open a GeneralStaff session (dispatcher or otherwise) in a project repository that could have been tampered with.
- GSD shows an explicit consent modal the first time you trigger an autonomous session. Once you confirm, the flag persists to `~/.generalstaff-desktop/settings.json` and the modal is not shown again.

The MCP-originated spawn path (a dispatcher session calling the `spawn_session` tool with `"mode": "autonomous"`) does **not** require the same consent gate — it is trusted operator-to-operator communication. Do not point the MCP tool at untrusted dispatcher sessions.

## Stack

Tauri 2 · Rust backend · vanilla-JS frontend (no bundler) · xterm.js for embedded terminal sessions.

## License

[AGPL-3.0-or-later](LICENSE). Copyright (C) 2024–2026 Ray Weiss.
