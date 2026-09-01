# GeneralStaff Workbench distribution

This folder is the thin distribution layer around the GeneralStaff Workbench extension. It deliberately uses stable VS Code APIs and a dedicated workspace profile instead of carrying a permanent source fork of Code OSS.

The current stable local artifact is Workbench 2.5 (`lerugray.generalstaff-workbench` 0.4.5). It opens into one persistent, full-size orchestrator transcript rooted at the selected GeneralStaff private repository. Follow-ups reattach to the same host-owned session and resume provider context when supported. Per-project orders remain available in the secondary rail with their existing repository/state scoping.

The distribution does three things:

1. connects one durable orchestrator session to the operator-selected GeneralStaff private repository without exposing it as the editor workspace;
2. gives that live conversation the full command-deck surface while demoting project orders to the rail; and
3. preserves the editor, diff viewer, browser, source control, and terminal as supporting instruments.

Run `scripts/build-workbench.sh` (or `.cmd`) once to verify and package the extension. Then run `scripts/launch-workbench.sh` on macOS/Linux or `scripts/launch-workbench.cmd` on Windows. The launcher installs the stable `distribution/generalstaff-workbench.vsix` artifact into `.workbench-data/`, isolated from the operator's normal VS Code profile, without rebuilding on every start.

The future Code OSS package may replace product name, icons, and installer metadata. It should continue consuming this extension rather than duplicating GeneralStaff behavior in a long-lived core fork.
