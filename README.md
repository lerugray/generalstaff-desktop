# GeneralStaff Desktop

<!-- TODO: GSD cockpit screenshot -->
![GSD cockpit screenshot](docs/images/screenshot.png)

A Tauri 2 macOS desktop console for [GeneralStaff](https://github.com/lerugray/generalstaff) — the local-first autonomous dev-fleet orchestrator.

GSD gives the full fleet a permanent home outside the terminal: a dashboard of every registered project with its open task queue and recent cycle history, a per-project workbench (file tree, file viewer, pings inbox), and embedded terminal sessions that run real `claude` / `cursor-agent` CLI processes under a PTY — rendered in xterm.js and themed to match the rest of the UI.

It is strictly a **viewer/controller**: it reads GeneralStaff's file-based state and writes only to the pings inbox (`state/pings/inbox.md`). It never touches `tasks.json`, `project-meta.yaml`, or any other structured state file directly.

## Prerequisites

- macOS (only platform currently supported)
- [Rust](https://rustup.rs/) (stable, 1.77.2+)
- [Bun](https://bun.sh/) 1.2+
- [Tauri CLI v2](https://tauri.app/start/prerequisites/) (`cargo install tauri-cli --version "^2"` or via Bun — `bun add -D @tauri-apps/cli`)
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

The `scripts/install.sh` path is the operator's install flow — it builds a release bundle, copies the `gs-mcp` sidecar binary into `GeneralStaff.app/Contents/MacOS/`, re-signs inside-out with a stable identity, and drops the result in `/Applications`. Contributors building locally do not need it.

### The gs-mcp sidecar

`src/bin/gs-mcp.rs` is a second binary in the Cargo workspace — a stdio MCP server the dispatcher uses to communicate with the desktop. `scripts/install.sh` handles copying it into the bundle. During `bun tauri dev` the sidecar is not required; it only matters for the installed-app dispatcher flow.

## Signing (operators only)

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

## Stack

Tauri 2 · Rust backend · vanilla-JS frontend (no bundler) · xterm.js for embedded terminal sessions.

## License

[AGPL-3.0-or-later](LICENSE). Copyright (C) 2024–2026 Ray Weiss.
