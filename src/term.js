// GeneralStaff Desktop — popped-out session window (gsd-035).
//
// A standalone terminal window that re-attaches to a PTY session that is
// already running in the backend. The main window spawned the session
// and named this window "term-<id>" via the popout_session command; this
// script reads that id, opens an xterm bound to the same session, and
// streams it the way a docked session tab does. The PTY lives in the
// Rust backend — closing this window ends the session (lib.rs).
"use strict";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// The same six themes the main window offers. The popout doesn't
// render its own palette swatches — it just inherits whichever palette
// the main window has selected, via the shared THEME_KEY in
// localStorage.
const THEMES = ["paper", "night", "linen", "vellum", "iron", "carbon"];
const THEME_KEY = "gsd-theme";

// Read the active palette from localStorage and apply it to this
// window's body, so the CSS vars (`--paper`, `--ink`, etc.) resolve to
// the same values they have in the main window. The popout's
// `body.popout { background: var(--paper); }` rule + the xterm theme
// builder both depend on this body class being in place.
function applyPopoutTheme() {
  let id = "paper";
  try {
    id = localStorage.getItem(THEME_KEY) || "paper";
  } catch (e) {}
  if (!THEMES.includes(id)) id = "paper";
  document.body.classList.add("theme-" + id);
  for (const t of THEMES) {
    if (t !== id) document.body.classList.remove("theme-" + t);
  }
  return id;
}
applyPopoutTheme();

// xterm.js theme — derived from the active palette's CSS vars, matching
// the docked terminal in app.js. Builder shape is identical so the two
// stay in step.
function termTheme() {
  const cs = getComputedStyle(document.body);
  const v = (k) => cs.getPropertyValue(k).trim();
  const paper = v("--paper");
  const ink = v("--ink");
  const rust = v("--rust");
  const rustDeep = v("--rust-deep");
  const prussian = v("--prussian");
  const prussianDeep = v("--prussian-deep");
  return {
    background: paper,
    foreground: ink,
    cursor: rust,
    cursorAccent: paper,
    selectionBackground: v("--rule-soft"),
    black: ink,
    red: rust,
    green: prussian,
    yellow: rustDeep,
    blue: prussian,
    magenta: rustDeep,
    cyan: prussianDeep,
    white: v("--ink-soft"),
    brightBlack: v("--ink-faint"),
    brightRed: rustDeep,
    brightGreen: prussianDeep,
    brightYellow: rust,
    brightBlue: prussianDeep,
    brightMagenta: rust,
    brightCyan: prussian,
    brightWhite: ink,
  };
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// The session id — popout_session names this window "term-<id>".
function resolveSessionId() {
  const fromLabel = (lbl) =>
    lbl && lbl.indexOf("term-") === 0 ? lbl.slice(5) : null;
  // The public window API.
  try {
    const w = window.__TAURI__ && window.__TAURI__.window;
    if (w && w.getCurrentWindow) {
      const id = fromLabel(w.getCurrentWindow().label);
      if (id) return id;
    }
  } catch (e) {}
  // The Tauri IPC bridge always carries the current window's label.
  try {
    const m =
      window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.metadata;
    const id = fromLabel(m && m.currentWindow && m.currentWindow.label);
    if (id) return id;
  } catch (e) {}
  return null;
}

const sessionId = resolveSessionId();
const host = document.getElementById("term-host");

if (!sessionId || !window.Terminal) {
  host.textContent = !sessionId
    ? "Could not identify the session for this window."
    : "xterm.js failed to load — terminal unavailable.";
} else {
  const term = new window.Terminal({
    fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 13,
    theme: termTheme(),
    cursorBlink: true,
    scrollback: 8000,
    allowProposedApi: true,
  });

  // React to a theme switch in the main window: localStorage is shared
  // across the app's WebView windows, so a `storage` event fires here
  // when applyTheme() in app.js writes the new THEME_KEY. Re-apply the
  // body class + rebuild the xterm theme from the new CSS vars.
  window.addEventListener("storage", (e) => {
    if (e.key !== THEME_KEY) return;
    applyPopoutTheme();
    try {
      term.options.theme = termTheme();
    } catch (err) {}
  });
  const FitAddonCtor =
    (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;
  const fit = new FitAddonCtor();
  term.loadAddon(fit);
  term.open(host);
  term.onData((d) => {
    invoke("write_session", { id: sessionId, data: d }).catch(() => {});
  });

  function fitNow() {
    try {
      fit.fit();
      invoke("resize_session", {
        id: sessionId,
        rows: term.rows,
        cols: term.cols,
      }).catch(() => {});
    } catch (e) {}
  }

  listen("pty-output", (e) => {
    if (!e.payload || e.payload.id !== sessionId) return;
    term.write(base64ToBytes(e.payload.data));
  });
  listen("pty-exit", (e) => {
    if (!e.payload || e.payload.id !== sessionId) return;
    term.write("\r\n\x1b[2m— session ended —\x1b[0m\r\n");
    invoke("notify", {
      title: "GeneralStaff",
      body: "A popped-out session ended.",
    }).catch(() => {});
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitNow, 120);
  });

  // Bind, size, focus. The PTY resize doubles as a redraw nudge — claude
  // and cursor-agent are TUIs that repaint on SIGWINCH, so the window
  // fills in with the session's current screen as soon as it attaches.
  requestAnimationFrame(() => {
    fitNow();
    term.focus();
  });
}
