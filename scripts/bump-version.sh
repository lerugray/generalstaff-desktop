#!/bin/bash
# bump-version.sh <new-version> — Workbench extension version bump.
# The legacy Tauri app remains frozen at 0.1.0. The daily-driver product is
# workbench-extension, whose package manifest and lockfile must move together.
set -euo pipefail
V="${1:?usage: bump-version.sh <new-version>}"
cd "$(dirname "$0")/.."

python3 - "$V" << 'PYEOF'
import json, sys
v = sys.argv[1]

p = json.load(open("workbench-extension/package.json"))
p["version"] = v
json.dump(p, open("workbench-extension/package.json", "w"), indent=2, ensure_ascii=False)
open("workbench-extension/package.json", "a").write("\n")

lock = json.load(open("workbench-extension/package-lock.json"))
lock["version"] = v
lock["packages"][""]["version"] = v
json.dump(lock, open("workbench-extension/package-lock.json", "w"), indent=2, ensure_ascii=False)
open("workbench-extension/package-lock.json", "a").write("\n")

print(f"bumped Workbench manifest + lockfile to {v}")
PYEOF
grep -n "\"$V\"" workbench-extension/package.json workbench-extension/package-lock.json | head -4
