# Workbench playtest, cold pass (2026-09-16)

Playbot cold-played the finished desk after deluxe bites 1-7 landed on `master`. This note is for Ray / Claude. It is the eight-check report plus the four hard tickets that followed.

No em dashes. Smallest real fixes only. Workshop "center still looks like desk" is a soft feel note and was left alone. Unsent composer text on reopen is optional QoL and was left alone.

## Eight-check report

| Check | Result | Note |
| --- | --- | --- |
| 1. Cold open | PASS | Desk arrives. Orchestrator session is the first surface. |
| 2. Close / reopen | PASS | Same conversation comes back. |
| 3. Seat health | FAIL | All five seats read `down` while the main copy said the orchestrator was ready. No useful ready / thin nuance. |
| 4. Consent / key-turn | PARTIAL | Copy was plain ("About to change files..." / "Confirm to enter this room"). Confirm did not finish. Toast: "Command Deck ignored an invalid request". No visible grant receipt. |
| 5. Slash skills | PARTIAL | Lone `/` opens filterable skills. `x/y` stays ordinary typing. Ctrl+A while clearing the slash crashed Code (`reason: crashed`, code 5). Reopen restored the desk. |
| 6. Headroom | FAIL | Duplicated (top-right instrument plus sidebar). Cold empty desk already reading `stop soon`. |
| 7. Workshop center | SOFT | Still feels like the desk in the middle. Skip unless a tiny copy / layout fix is free. |
| 8. Unsent composer text | OPTIONAL | Nice if reopen keeps unsent text. Skip unless trivial. |

Cold open and close/reopen stay green. The four FAIL / PARTIAL rows are the hard tickets.

## Tickets

### 1. Seat health contradiction

Seats counted every catalog lane that *could* take the job, including CLIs that were never installed. One live lane plus a row of missing catalog entries made the whole bank look failed. Welcome copy still said the orchestrator seat was ready.

**Fix:** ignore `missing` catalog lanes. Ready means the installed lanes for that job are up. Thin means some installed lanes are down or still checking. Down means no installed lane can take the job. Welcome copy follows that reading and does not claim ready when the seat is down.

### 2. Consent / key-turn confirm

Enter used `update-routing` with the full routing bag. After switching to write, `ensureSelections` could null the lane id (read-only lane, or no writable compatible lane). The host then parsed the message as invalid and toasted "Command Deck ignored an invalid request". The pending plaque stayed. No grant receipt.

**Fix:** `enter-room` / `leave-room` are first-class messages with only the conversation id. Confirm still uses the existing key-turn modal. A valid confirm writes the grant, posts `routing-updated`, and shows the inside-the-room receipt. That toast is not used for a valid enter.

### 3. Ctrl+A while clearing slash

Lone `/` still opens the skill list. `x/y` still stays text. Ctrl/Cmd+A in the composer was leaking into the host select-all path and crashing the window.

**Fix:** Ctrl/Cmd+A in the prompt selects composer text, closes the skill list if it is open, and never leaves the webview. The query helper also tolerates a weird cursor so clearing `/` cannot throw.

### 4. Headroom duplicated + alarmist on empty cold open

The top-right instrument was the real one. The sidebar footer repeated "Headroom · {band}". Pool pressure treated uninstalled catalog lanes as missing capacity, so a quiet desk with one live lane out of eight catalog rows already read `stop soon`. Fleet backlog on an idle session did the same.

**Fix:** one instrument, top-right. Sidebar footer is just "Workbench / one desk". An idle empty desk (no transcript, no pinned files, no skill, no desk run) glances `comfortable`. Hover details can still tell the truth about lanes and fleet.

## Out of scope

- Do not redesign the desk.
- Workshop center feel: skip.
- Unsent composer text on reopen: skip.

## Verification

`npm run check` in `workbench-extension` must stay green. Visual proof is the cold harness plus the four ticket surfaces.
