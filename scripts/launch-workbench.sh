#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
runtime_root="${GS_WORKBENCH_DATA_DIR:-$repo_root/.workbench-data}"
extension_package="$repo_root/distribution/generalstaff-workbench.vsix"

if [[ -n "${CODE_BIN:-}" ]]; then
  code_bin="$CODE_BIN"
elif [[ "$(uname -s)" == "Darwin" ]]; then
  code_bin="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
else
  code_bin="$(command -v code || true)"
fi

if [[ ! -x "$code_bin" ]]; then
  echo "GeneralStaff Workbench needs Visual Studio Code 1.135 or newer."
  echo "Set CODE_BIN to the VS Code command-line executable and try again."
  exit 1
fi

mkdir -p "$runtime_root/user" "$runtime_root/extensions"

workspace_file="$runtime_root/generalstaff-workbench.code-workspace"
cp "$repo_root/distribution/generalstaff-workbench.code-workspace" "$workspace_file"

# Local launcher tile uses the existing GS folio mark. The running Code
# host still owns the macOS Dock glyph and the Windows taskbar of code.exe.
workbench_icon="$repo_root/src-tauri/icons/icon.png"
if [[ -f "$workbench_icon" ]]; then
  cp "$workbench_icon" "$runtime_root/workbench-icon.png"
  cat > "$runtime_root/generalstaff-workbench.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=GeneralStaff Workbench
Comment=Direct a GeneralStaff fleet from one desk
Exec=$(printf '%q' "$script_dir/launch-workbench.sh")
Icon=$runtime_root/workbench-icon.png
Terminal=false
Categories=Utility;
EOF
  chmod +x "$runtime_root/generalstaff-workbench.desktop"
fi

if [[ ! -f "$extension_package" ]]; then
  echo "The packaged Workbench extension is missing."
  echo "Run $repo_root/scripts/build-workbench.sh once, then launch again."
  exit 1
fi

"$code_bin" \
  --user-data-dir "$runtime_root/user" \
  --extensions-dir "$runtime_root/extensions" \
  --install-extension "$extension_package" \
  --force

exec "$code_bin" \
  --user-data-dir "$runtime_root/user" \
  --extensions-dir "$runtime_root/extensions" \
  --new-window \
  --disable-telemetry \
  --disable-updates \
  --disable-workspace-trust \
  --skip-welcome \
  --skip-release-notes \
  "$workspace_file"
