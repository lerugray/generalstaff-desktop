#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
extension_root="$repo_root/workbench-extension"

cd "$extension_root"
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run check
npm run package:distribution

echo "Built $repo_root/distribution/generalstaff-workbench.vsix"
