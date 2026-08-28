# GeneralStaff Workbench distribution

This folder is the thin distribution layer around the GeneralStaff Workbench extension. It deliberately uses stable VS Code APIs and a dedicated workspace profile instead of carrying a permanent source fork of Code OSS.

The current stable local artifact is Workbench 2.4 (`lerugray.generalstaff-workbench` 0.3.0). It opens on a pinned General Command orchestrator target whose model processes run from the selected GeneralStaff private root. Per-project commands remain available with their existing repository/state scoping. Both target types share the same compatible model lanes, seats, effort controls, skills, permission boundaries, continuation, recovery, and decision-card behavior.

The distribution does three things:

1. connects General Command to the operator-selected GeneralStaff private repository without exposing it as the editor workspace;
2. gives the conversation-first General Command and project Command Deck surfaces the full window; and
3. preserves the editor, diff viewer, browser, source control, and terminal as supporting instruments.

Run `scripts/build-workbench.sh` (or `.cmd`) once to verify and package the extension. Then run `scripts/launch-workbench.sh` on macOS/Linux or `scripts/launch-workbench.cmd` on Windows. The launcher installs the stable `distribution/generalstaff-workbench.vsix` artifact into `.workbench-data/`, isolated from the operator's normal VS Code profile, without rebuilding on every start.

The future Code OSS package may replace product name, icons, and installer metadata. It should continue consuming this extension rather than duplicating GeneralStaff behavior in a long-lived core fork.
