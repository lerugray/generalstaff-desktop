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

// xterm.js theme — identical to the docked terminal in app.js.
const TERM_THEME = {
  background: "#1f1a11",
  foreground: "#e8dcc0",
  cursor: "#d98b4a",
  cursorAccent: "#1f1a11",
  selectionBackground: "#4a4131",
  black: "#2a2418",
  red: "#b5532e",
  green: "#7a8a4a",
  yellow: "#c98a3e",
  blue: "#5a7a8a",
  magenta: "#9a6a7a",
  cyan: "#6a9a9a",
  white: "#e8dcc0",
  brightBlack: "#8a7f66",
  brightRed: "#d98b4a",
  brightGreen: "#9aaa6a",
  brightYellow: "#e0a850",
  brightBlue: "#7a9aaa",
  brightMagenta: "#ba8a9a",
  brightCyan: "#8abab0",
  brightWhite: "#f1e7d3",
};

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
    theme: TERM_THEME,
    cursorBlink: true,
    scrollback: 8000,
    allowProposedApi: true,
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
