#!/usr/bin/env bash
# make-launcher-app.sh — build a double-clickable macOS launcher for the Workbench.
#
# The Workbench is a VS Code extension in an isolated profile, which means it normally starts
# from a terminal command. This wraps the documented launch (scripts/launch-workbench.sh) in a
# minimal .app bundle carrying the original GeneralStaff Desktop icon, so it opens from Finder,
# the Dock or Spotlight like any other application.
#
#   Usage: scripts/make-launcher-app.sh [DEST_DIR]      (default: ~/Applications)
#   Env:   GENERALSTAFF_ROOT   the private state repository the Workbench opens
#          GS_LAUNCHER_NAME    bundle name (default: GeneralStaff Workbench)
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
dest_dir="${1:-$HOME/Applications}"
app_name="${GS_LAUNCHER_NAME:-GeneralStaff Workbench}"
app="$dest_dir/$app_name.app"
gs_root="${GENERALSTAFF_ROOT:-$HOME/Desktop/Dev Work/generalstaff-private}"

# The icon is the original Tauri-era GeneralStaff Desktop mark, kept in this repository as
# historical product work. It is the icon Ray already associates with GSD.
icon_src="$repo_root/src-tauri/icons/icon.icns"
[ -f "$icon_src" ] || { echo "make-launcher-app: no icon at $icon_src" >&2; exit 1; }
[ -x "$repo_root/scripts/launch-workbench.sh" ] || { echo "make-launcher-app: launch-workbench.sh missing" >&2; exit 1; }

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$icon_src" "$app/Contents/Resources/generalstaff.icns"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$app_name</string>
  <key>CFBundleDisplayName</key><string>$app_name</string>
  <key>CFBundleIdentifier</key><string>com.lerugray.generalstaff.workbench.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>generalstaff</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Install the packaged extension into the isolated profile now, from this terminal run, where
# the repository under ~/Desktop is readable. The .app itself must never touch ~/Desktop: an
# unsigned bundle has no TCC grant for it, and exec'ing a script there fails with "Operation not
# permitted" (observed 2026-09-13). Everything the bundle does at click time is therefore an
# argv string handed to LaunchServices.
runtime_root="${GS_WORKBENCH_DATA_DIR:-$repo_root/.workbench-data}"
vsix="$repo_root/distribution/generalstaff-workbench.vsix"
workspace="$repo_root/distribution/generalstaff-workbench.code-workspace"
code_bin="${CODE_BIN:-/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code}"
code_app="${GS_CODE_APP:-/Applications/Visual Studio Code.app}"
[ -f "$vsix" ] || { echo "make-launcher-app: build the VSIX first (scripts/build-workbench.sh)" >&2; exit 1; }
[ -d "$code_app" ] || { echo "make-launcher-app: Visual Studio Code is not installed at $code_app" >&2; exit 1; }
mkdir -p "$runtime_root/user" "$runtime_root/extensions"
if [ -x "$code_bin" ]; then
  "$code_bin" --user-data-dir "$runtime_root/user" --extensions-dir "$runtime_root/extensions" \
    --install-extension "$vsix" --force >/dev/null
  echo "  installed: $(basename "$vsix") into the isolated Workbench profile"
fi

# LSUIElement keeps the launcher itself out of the Dock: VS Code is the application the operator
# sees, and a second permanent Dock tile for a script that exits would be noise.
#
# `open -na` hands the launch to LaunchServices, so VS Code starts as its OWN responsible
# process with its own TCC grants rather than as a child of this unsigned bundle. That is what
# makes a Desktop-resident workspace openable from a double-click.
cat > "$app/Contents/MacOS/launch" <<LAUNCH
#!/bin/bash
# Launcher stub for $app_name. Opens the isolated Workbench profile and workspace, and keeps a
# log so a failed double-click is diagnosable instead of silent.
log="\$HOME/Library/Logs/generalstaff-workbench-launcher.log"
mkdir -p "\$(dirname "\$log")"
{
  echo "--- \$(date '+%Y-%m-%d %H:%M:%S') opening Workbench"
  exec /usr/bin/open -na "$code_app" --args \\
    --user-data-dir "$runtime_root/user" \\
    --extensions-dir "$runtime_root/extensions" \\
    --new-window \\
    --disable-telemetry \\
    --disable-updates \\
    --disable-workspace-trust \\
    --skip-welcome \\
    --skip-release-notes \\
    "$workspace"
} >>"\$log" 2>&1
LAUNCH
chmod +x "$app/Contents/MacOS/launch"

# Register the bundle so Finder and Spotlight pick up the icon without a relaunch.
touch "$app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$app" >/dev/null 2>&1 || true

echo "Built $app"
echo "  icon:   $(basename "$icon_src") -> Contents/Resources/generalstaff.icns"
echo "  opens:  $workspace"
echo "  root:   $gs_root"
echo "  log:    ~/Library/Logs/generalstaff-workbench-launcher.log"
