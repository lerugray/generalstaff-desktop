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
  "$repo_root/distribution/generalstaff-workbench.code-workspace"
