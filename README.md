# GeneralStaff Desktop

The desktop command console for **GeneralStaff** — the autonomous
dev-fleet orchestrator.

A Tauri 2 app that shows the whole project fleet at a glance, lets you
drill into any project's files and cycle history, and (from v0.1) spawns
and watches child Claude Code sessions — without living in a terminal.

It is strictly a **viewer/controller** over GeneralStaff's file-based
state: it reads state to display it and drives the `gs` CLI for actions.
It never writes GeneralStaff's state directly.

## Status

v0.0.1 — in development. Scope: the fleet briefing plus a read-only
per-project workbench (file tree, file viewer, cycle history). See
[`docs/DESIGN.md`](docs/DESIGN.md) for the full design and task plan.

## Develop

```
bun install
bun run dev
```

Requires Rust and the Tauri 2 prerequisites.

## Stack

Tauri 2 · Rust backend · vanilla-JS frontend, no bundler. Modeled on the
mission-companion house pattern.
