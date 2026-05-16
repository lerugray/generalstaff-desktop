#!/usr/bin/env bash
# Build GeneralStaff Desktop and install it to /Applications.
#
# Handles two things plain `cargo tauri build` does not:
#   - gs-mcp (the dispatcher's MCP server — src/bin/gs-mcp.rs, a second
#     binary in this crate) is copied into the bundle's Contents/MacOS/,
#     next to the app, where gs_mcp_path() looks for it. Without it the
#     dispatcher (a claude session spawning child tabs) silently dies in
#     the installed app.
#   - Tauri's release bundle ships a broken ad-hoc code signature that
#     macOS can refuse to launch; the bundle is re-signed inside-out.
#
# `default-run` in Cargo.toml handles the third snag (Tauri otherwise
# can't tell which of the two binaries is the app) — no action needed
# here, it just works.
#
# Plain `cargo build` / `cargo tauri build` are unaffected — the dev
# loop stays normal; this script is only for producing the installed app.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
APP_SRC="$ROOT/src-tauri/target/release/bundle/macos/GeneralStaff.app"
APP_DST="/Applications/GeneralStaff.app"

echo "==> Building the release bundle…"
(
  cd src-tauri
  cargo build --release --bin gs-mcp
  cargo tauri build --bundles app
)

echo "==> Adding the gs-mcp sidecar to the bundle…"
cp "$ROOT/src-tauri/target/release/gs-mcp" "$APP_SRC/Contents/MacOS/gs-mcp"

echo "==> Re-signing the bundle (ad-hoc, inside-out)…"
codesign --force --sign - "$APP_SRC/Contents/MacOS/gs-mcp"
codesign --force --sign - "$APP_SRC/Contents/MacOS/generalstaff-desktop"
codesign --force --sign - "$APP_SRC"

echo "==> Installing to /Applications…"
rm -rf "$APP_DST"
ditto "$APP_SRC" "$APP_DST"

codesign --verify --strict "$APP_DST"
echo "==> Done — GeneralStaff.app is installed and verified in /Applications."
