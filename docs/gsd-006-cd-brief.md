# GeneralStaff Desktop — Claude Design brief (gsd-006)

A brief for a claude.ai/design pass on **GeneralStaff Desktop** (GSD). Paste
it into claude.ai/design; attaching a screenshot of the current app helps it
match the existing look. The bundle it returns is integrated per the
GeneralStaff CD-bundle workflow — for this Tauri app, the CSS is the
implementation (no theme-translation phase).

## What GeneralStaff Desktop is

A macOS desktop **command console** for GeneralStaff, an autonomous dev-fleet
orchestrator that runs verification-gated agent cycles across a portfolio of
software projects. GSD is its desktop face: a left rail listing every
project, a main area showing either a **Fleet briefing** (the dashboard) or a
**project workbench**, and live agent-session terminal tabs.

Tauri 2 desktop app. Vanilla HTML / CSS / JavaScript — **no framework, no
build step.** One persistent window, resizable; a fixed 264px left rail, the
main area takes the rest. A menu-bar tray icon.

Register and voice, already locked: a **Prussian Kriegspiel lithograph** look
and a *"subordinate briefing the commander"* voice — calm, precise, no
marketing tone.

## The ask, in one line

**Refine, don't redesign.** The visual register is established and works.
This pass does four things, in priority order:

1. Restructure the **Fleet dashboard** — today it is one long vertical scroll
   and reads as crowded; it should become an at-a-glance multi-panel layout.
2. **Subtly sharpen** the existing theme — spacing, hierarchy, legibility —
   without changing its identity.
3. Suggest **UI/UX improvements** across the app.
4. Add a small set of shippable **variant themes.**

A wholesale visual overhaul is out of scope. If a change would make the app
stop looking like itself, it has gone too far.

## The established register — preserve this

GSD's look is a **Prussian Kriegspiel lithograph**: a warm paper ground, ink
text, a single rust accent, and Prussian blue reserved for the live/running
state. Period serif for display, monospace for data and labels. No SaaS
glass-and-neon. No military iconography — no medals, no insignia; the
register is *the printed staff document*, not militaria.

The design tokens in use today (`src/styles.css`) — keep this palette and
type system, refine within it:

```
Paper      --paper #f1e7d3   --paper-2 #ede1c9   --paper-edge #e4d5b7
Ink        --ink #2a2418   --ink-soft #4a4131   --ink-faint #8a7f66   --ink-ghost #b7ab8e
Rule       --rule-soft #c9bb9b
Rust       --rust #8a3a1c   --rust-deep #5e2410          (the single accent)
Prussian   --prussian #34505f                           (live / running state only)

Display    Spectral (serif)        — headings, the wordmark, stat numbers
Body       system sans             — paragraphs, rows
Mono       JetBrains Mono          — labels, data, ids, timestamps
```

Keep the rail + main-area shell as the frame — this pass is the briefing's
interior and the theme, not the window structure.

## 1 — The Fleet dashboard restructure (the one structural change)

The Fleet briefing is the app's landing view. Today it stacks five panels in
a single vertical column, so it scrolls and reads like a log:

- **Situation** — four stat figures: active projects · with open work ·
  pending tasks · waiting on you.
- **Recent activity** — recent session notes (collapsible) plus a
  recent-commits list.
- **Attention** — a ranked list of projects with work waiting, each shown
  against a viability score.
- **Dispatcher** — a one-line explanation and a single button.
- **Open pings** — a scrollable list of ~15–20 inbound items, each a row with
  action controls.

Want: a **multi-panel dashboard** that reads at a glance — the operator opens
the app and takes in fleet state without scrolling. The data and the five
panels stay the same; this is a layout job. A likely shape: Situation as a
compact stat strip across the top, the rest arranged as a grid or columns in
decision-urgency order — what the operator needs first, placed first.
Propose the arrangement; the panel inventory above is the full set.

Constraints: one window with internal panels — no separate OS windows, no new
state-management layer. Reuse the existing panel components. A panel may
scroll internally (Open pings already does); the *page* should not need to.

## 2 — Subtle theme refinement

Within the established register: tighten the spacing rhythm, sharpen the type
hierarchy (display vs mono vs body), improve panel separation and density.
The goal is "the same app, better resolved" — not a new look.

## 3 — UI/UX improvements

GSD is a daily-driver console. Flag and propose refinements — legibility,
information density, affordance clarity, focus and hover states, keyboard
navigation, contrast and accessibility. The crowded dashboard is the known
issue; surface others you see.

## 4 — Variant themes

GSD ships with one theme today. Add a small shippable set, each a swap of the
`:root` token values above:

- **Kriegspiel Paper** — the current theme, kept as the default.
- **A dark variant** — the same register inverted: a dark ground, warm ink,
  the rust and Prussian accents holding. Essential — a console wants a dark
  mode.
- **2–4 more**, your call, all within the Kriegspiel-document family (not
  arbitrary color themes). A high-contrast variant for accessibility is
  welcome. Aim for roughly 4–6 themes in total.

Also recommend where a lightweight **theme switcher** belongs — the app has a
left rail (with a header and a footer strip), a tab bar, and a tray menu.

The agent-session terminal tabs keep their own dark terminal palette; the
variant themes are for the Fleet and workbench chrome, not the embedded
terminals.

## Tech constraints for the deliverable

- **Vanilla HTML / CSS / JS, no build step.** The implementation is CSS — a
  token system, component styling, the dashboard-layout CSS, and the
  variant-theme palettes (as `body.theme-*` blocks or equivalent). Any
  component code you produce is reference for structure; the app builds its
  DOM in plain JavaScript.
- **Fonts must be local.** The app is local-first and offline-capable and
  ships a Content-Security-Policy — no CDN `@import`. The type system already
  names Spectral and JetBrains Mono; any new face must be vendorable as a
  local `@font-face` under an open license.
- Target one resizable desktop window with a fixed 264px left rail.

## Out of scope

No new features, no new data, no backend or workflow changes. Not a rebuild
of the rail or the tab system. No military iconography, no glass-and-neon.
The terminal tabs' own theme stays as it is.
