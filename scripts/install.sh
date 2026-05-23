#!/usr/bin/env bash
# macOS ONLY. Requires an Apple Developer certificate or a self-signed
# signing certificate named "GS Dev Signing" (or whatever signingIdentity
# is set to in src-tauri/tauri.local.conf.json on this machine).
# Contributors building from source without a signing cert can run
# `bun tauri dev` or `bun tauri build` directly — those paths skip this
# script and do not require a cert.
#
# Build GeneralStaff Desktop and install it to /Applications.
#
# Handles two things plain `cargo tauri build` does not:
#   - gs-mcp (the dispatcher's MCP server — src/bin/gs-mcp.rs, a second
#     binary in this crate) is copied into the bundle's Contents/MacOS/,
#     next to the app, where gs_mcp_path() looks for it. Without it the
#     dispatcher (a claude session spawning child tabs) silently dies in
#     the installed app.
#   - The sidecar copy invalidates Tauri's release-bundle signature; the
#     bundle is re-signed inside-out with the stable `GS Dev Signing`
#     identity that tauri.conf.json declares. Ad-hoc re-signing (the
#     prior approach) changed the bundle's designated requirement on
#     every install, so macOS TCC forgot every granted permission
#     (Desktop folder, Screen Recording, Accessibility) and re-prompted
#     — which is what blocked peekaboo-via-GSD on FnordOS.
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

echo "==> Re-signing the bundle with GS Dev Signing (inside-out)…"
SIGN_ID="GS Dev Signing"
if ! security find-identity -v -p codesigning 2>/dev/null | grep -Fq "\"$SIGN_ID\""; then
  echo "WARNING: GS Dev Signing cert not found, falling back to ad-hoc — macOS will forget permissions on reinstall" >&2
  SIGN_ID="-"
fi
codesign --force --sign "$SIGN_ID" "$APP_SRC/Contents/MacOS/gs-mcp"
codesign --force --sign "$SIGN_ID" "$APP_SRC/Contents/MacOS/generalstaff-desktop"
codesign --force --sign "$SIGN_ID" "$APP_SRC"

echo "==> Installing to /Applications…"
rm -rf "$APP_DST"
ditto "$APP_SRC" "$APP_DST"

codesign --verify --strict "$APP_DST"
echo "==> Done — GeneralStaff.app is installed and verified in /Applications."
