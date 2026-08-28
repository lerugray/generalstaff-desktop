# GeneralStaff Workbench distribution

This folder is the thin distribution layer around the GeneralStaff Workbench extension. It deliberately uses stable VS Code APIs and a dedicated workspace profile instead of carrying a permanent source fork of Code OSS.

The current stable artifact is Workbench 2.1. It includes permission-bound native continuation for Codex, Claude, Kimi, and Cursor; transcript handoff for Cline and fresh recovery; dedicated retry controls; and structured operator decision cards. Provider session identifiers remain in extension-host storage and are excluded from webview state and receipt evidence.

The distribution does three things:

1. connects to the operator-selected GeneralStaff state repository without exposing it as the editor workspace;
2. gives the conversation-first Command Deck the full window; and
3. preserves the editor, diff viewer, browser, source control, and terminal as supporting instruments.

Run `scripts/build-workbench.sh` (or `.cmd`) once to verify and package the extension. Then run `scripts/launch-workbench.sh` on macOS/Linux or `scripts/launch-workbench.cmd` on Windows. The launcher installs the stable `distribution/generalstaff-workbench.vsix` artifact into `.workbench-data/`, isolated from the operator's normal VS Code profile, without rebuilding on every start.

The future Code OSS package may replace product name, icons, and installer metadata. It should continue consuming this extension rather than duplicating GeneralStaff behavior in a long-lived core fork.
