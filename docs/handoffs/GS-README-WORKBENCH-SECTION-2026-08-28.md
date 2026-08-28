# Proposed GeneralStaff README Workbench patch

This patch updates the existing desktop entry in the public GeneralStaff README. It keeps Workbench in the optional-layers section because the CLI gate remains the required core and the desktop surface is not needed to run a verified cycle.

Target file: `/Users/rayweiss/Desktop/Dev Work/generalstaff/README.md`

Replace the current line 64 exactly:

```markdown
- **GeneralStaff Desktop.** A native viewer/controller that wraps the dispatcher. See [releases](https://github.com/lerugray/generalstaff-desktop/releases) and [source](https://github.com/lerugray/generalstaff-desktop).
```

with this text:

```markdown
- **GeneralStaff Workbench.** The desktop surface for directing a GeneralStaff fleet in plain English. Choose a project and which AI should do the job, direct the work through conversation, answer decisions, and inspect the result. The GeneralStaff CLI remains the verification gate; Workbench does not accept work just because an agent says it is finished. It ships from the GeneralStaff Desktop repository as a thin Visual Studio Code extension and isolated profile, with code, diffs, previews, and a terminal available when needed. See [releases](https://github.com/lerugray/generalstaff-desktop/releases) and [source](https://github.com/lerugray/generalstaff-desktop).
```

No other line in the public README is part of this proposed patch.
