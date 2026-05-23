#!/usr/bin/env bash
# macOS ONLY. Requires the Apple Developer ID Application certificate
# "Developer ID Application: Raymond Weiss (9WX8DXKZQ2)" installed in
# the login keychain (or whatever signingIdentity is set to in
# src-tauri/tauri.local.conf.json on this machine). Falls back to
# ad-hoc signing if the cert is absent (with permission-loss warning).
# Contributors building from source without a signing cert can run
# `bun tauri dev` or `bun tauri build` directly — those paths skip this
# script and do not require a cert.
#
# Build GeneralStaff Desktop, sign with Developer ID, notarize with
# Apple, staple the ticket, and install to /Applications.
#
# Handles three things plain `cargo tauri build` does not:
#   - gs-mcp (the dispatcher's MCP server — src/bin/gs-mcp.rs, a second
#     binary in this crate) is copied into the bundle's Contents/MacOS/,
#     next to the app, where gs_mcp_path() looks for it. Without it the
#     dispatcher (a claude session spawning child tabs) silently dies in
#     the installed app.
#   - The sidecar copy invalidates Tauri's release-bundle signature; the
#     bundle is re-signed inside-out with the stable Developer ID
#     identity that tauri.local.conf.json declares. Ad-hoc re-signing
#     (the prior approach) changed the bundle's designated requirement
#     on every install, so macOS TCC forgot every granted permission
#     (Desktop folder, Screen Recording, Accessibility) and re-prompted
#     — which is what blocked peekaboo-via-GSD on FnordOS.
#   - Notarization: Apple's cloud scans + stamps the .app so Gatekeeper
#     trusts it without the right-click-Open ceremony. Requires the
#     keychain profile "GSD-notarize" — set up once via
#     `xcrun notarytool store-credentials "GSD-notarize" --apple-id ...
#     --team-id ... --password <app-specific>`.
#
# `default-run` in Cargo.toml handles the fourth snag (Tauri otherwise
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

echo "==> Re-signing the bundle with Developer ID (inside-out)…"
SIGN_ID="Developer ID Application: Raymond Weiss (9WX8DXKZQ2)"
if ! security find-identity -v -p codesigning 2>/dev/null | grep -Fq "\"$SIGN_ID\""; then
  echo "WARNING: Developer ID Application cert not found, falling back to ad-hoc." >&2
  echo "         macOS will forget permissions on reinstall + skip notarization" >&2
  echo "         (Apple won't accept ad-hoc signatures for the notarize service)." >&2
  SIGN_ID="-"
fi
codesign --force --options runtime --timestamp --sign "$SIGN_ID" "$APP_SRC/Contents/MacOS/gs-mcp"
codesign --force --options runtime --timestamp --sign "$SIGN_ID" "$APP_SRC/Contents/MacOS/generalstaff-desktop"
codesign --force --options runtime --timestamp --sign "$SIGN_ID" "$APP_SRC"

if [ "$SIGN_ID" != "-" ]; then
  echo "==> Notarizing with Apple (typically 1-5 minutes)…"
  NOTARIZE_ZIP="/tmp/gsd-notarize-$$.zip"
  ditto -c -k --keepParent "$APP_SRC" "$NOTARIZE_ZIP"
  xcrun notarytool submit "$NOTARIZE_ZIP" --keychain-profile "GSD-notarize" --wait
  rm -f "$NOTARIZE_ZIP"
  echo "==> Stapling the notarization ticket onto the .app…"
  xcrun stapler staple "$APP_SRC"
else
  echo "==> Skipping notarization (ad-hoc signing — Apple won't accept self-signed)." >&2
fi

echo "==> Installing to /Applications…"
rm -rf "$APP_DST"
ditto "$APP_SRC" "$APP_DST"

codesign --verify --strict "$APP_DST"
if [ "$SIGN_ID" != "-" ]; then
  xcrun stapler validate "$APP_DST" || echo "WARNING: stapler validation failed on installed app (may be transient)" >&2
fi
echo "==> Done — GeneralStaff.app is installed and verified in /Applications."
