#!/usr/bin/env bash
# gsd-cc-door.sh — Claude Code door launcher (in-repo contract for the Workbench meter).
#
# FIXLIST-R3 CODE 6: ceiling is 1048576 (Ollama Cloud's real /api/show window),
# not 1000000. The extension's CC_DOOR_STATED_CONTEXT_TOKENS must match this export.
set -euo pipefail

export CLAUDE_CODE_MAX_CONTEXT_TOKENS="1048576"

# Remaining door wiring lives in generalstaff-private; this repo keeps the ceiling
# export as the one-source-of-truth contract the Workbench tests parse.
exec claude "$@"
