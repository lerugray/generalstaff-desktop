#!/bin/bash
# bump-version.sh <new-version> — single-source version bump.
# Touches every file that carries the version so they can never drift:
# package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and
# src-tauri/Cargo.lock (gitignored, but kept in sync so the next cargo
# run does not rewrite it). There is no version string in src/ — the
# frontend has no hardcoded version label; if one is ever added, teach
# this script about it.
set -euo pipefail
V="${1:?usage: bump-version.sh <new-version>}"
cd "$(dirname "$0")/.."

python3 - "$V" << 'PYEOF'
import json, re, sys
v = sys.argv[1]

p = json.load(open("package.json"))
p["version"] = v
json.dump(p, open("package.json", "w"), indent=2)
open("package.json", "a").write("\n")

t = json.load(open("src-tauri/tauri.conf.json"))
t["version"] = v
json.dump(t, open("src-tauri/tauri.conf.json", "w"), indent=2)
open("src-tauri/tauri.conf.json", "a").write("\n")

c = open("src-tauri/Cargo.toml").read()
c = re.sub(r'^version = "[^"]+"', f'version = "{v}"', c, count=1, flags=re.M)
open("src-tauri/Cargo.toml", "w").write(c)

# Cargo.lock: update only this package's block (cheaper than cargo check).
l = open("src-tauri/Cargo.lock").read()
l, n = re.subn(
    r'(\[\[package\]\]\nname = "generalstaff-desktop"\nversion = ")[^"]+(")',
    rf"\g<1>{v}\g<2>", l, count=1)
if n != 1:
    sys.exit("Cargo.lock: generalstaff-desktop package block not found")
open("src-tauri/Cargo.lock", "w").write(l)

print(f"bumped all 4 sites to {v}")
PYEOF
grep -n "\"$V\"" package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml | head -4
