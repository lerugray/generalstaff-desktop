# Changelog

## 0.4.12 — 2026-09-17

- Seat health ignores catalog lanes that were never installed, so a working desk is ready or thin instead of a stuck-down bank.
- Entering a room is a first-class confirm. A valid enter completes, shows the grant receipt, and no longer toasts "Command Deck ignored an invalid request".
- Ctrl+A in the composer stays in the composer, including while the slash-skill list is open or being cleared.
- Headroom is one instrument. An idle empty desk reads comfortable, not stop soon.

## 0.4.11 — 2026-09-17

- Keep leftover editor chrome closed: menu bar, breadcrumbs, explorer reveal, and a startup terminal stay off unless you open the workshop.
- File, project, and supporting-terminal shortcuts stay at the desk. They no longer dump you into empty IDE panels.
- Typing `/` in the composer opens the private skills list. Typing `x/y` stays ordinary text.

## 0.4.10 — 2026-09-17

- Reopen the same orchestrator conversation as if you just sat back down: title, seat, transcript place, and composer ready to continue.
- If the last turn stopped when the desk closed, say so in plain words and offer a way to keep going.

## 0.4.9 — 2026-09-17

- Replace the scattered lane meter, rail counts, and hero tallies with one headroom instrument.
- Read it at a glance as comfortable, tight, or stop soon. Session, lane pool, and fleet numbers stay behind hover or expand.

## 0.4.8 — 2026-09-16

- Show tool and run evidence as craft receipts: what happened, where, and status in plain words.
- Give a failed pass the same card as a finished one, instead of leading with an exit code or a stack.

## 0.4.7 — 2026-09-16

- Treat edit consent as entering a room: one key-turn confirm that names the real project or General Staff.
- Keep a visible receipt after you enter, so the desk shows what was granted and for which target.
- Replace the Access dropdown with Enter / Look only.

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
