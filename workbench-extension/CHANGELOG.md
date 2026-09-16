# Changelog

## 0.4.6 — 2026-09-16

- Show each seat on the desk by its full name, with ready / thin / down taken from the lanes that can take that job.
- Keep those names readable in a narrow window. They wrap instead of collapsing into two-letter chips.

## 0.4.5 — 2026-09-16

- Arrive at the desk: hide the editor sidebars, activity bar, and panel on open so the session is the first surface.
- Add Open workshop / Return to desk so editor tools stay one deliberate step away.
- Show the session target and lane meter on the main surface.

## 0.4.4 — 2026-08-30

- Route the Grok 4.6 trial seat through the Grok subscription CLI as its primary runner.
- Retain the Cursor `cursor-grok-4.6-{effort}` named-model door as ordered discovery-time fallback.
- Enforce the verified Grok headless invocation contract: plain output before `-p`, provider-default effort, no model override, and `bypassPermissions` only for write-consented runs.
