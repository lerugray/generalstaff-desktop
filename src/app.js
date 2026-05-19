// GeneralStaff Desktop — the shell.
//
// Two layers:
//   • The Fleet tab — the read-only viewer over generalstaff-private's
//     project state (rail + briefing + workbench). Re-renders on the
//     file-watcher's fleet-updated event.
//   • Session tabs — real claude / cursor-agent CLI processes running
//     under a PTY, rendered in xterm.js terminals. The desktop wraps
//     Claude Code; it does not reimplement it.
//
// All rendered HTML routes through escapeHtml(), which entity-escapes
// every non-ASCII char so the output is pure ASCII and cannot mojibake.
// Terminal content bypasses this — xterm.js renders bytes directly.
"use strict";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const STATUS_LABEL = { active: "open work", clear: "clear" };

// xterm.js theme — warm ink-on-dark, in the Kriegspiel paper family.
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

const fleetList = document.getElementById("fleet-list");
const tabbar = document.getElementById("tabbar");
const contentEl = document.getElementById("content");
const fleetView = document.getElementById("fleet-view");
const railHead = document.getElementById("rail-head");
const footText = document.getElementById("fleet-status-text");
const railThemes = document.getElementById("rail-themes");

let snapshot = { ok: false, projects: [] };
let selectedId = null; // selected project in the Fleet view
let currentRepoPath = null; // code-repo path of the selected project
// gsd-025 — scroll positions captured before a briefing rebuild so the
// re-render can restore them; resolving a ping or adding one otherwise
// snaps the dashboard back to the top.
let scrollToRestore = null;

// tabs: [{ id, kind: 'fleet'|'session', label, sessionId? }]
let tabs = [{ id: "fleet", kind: "fleet", label: "Fleet" }];
let activeTabId = "fleet";
// sessionId -> { info, term, fit, host, view, status }
const sessions = new Map();

// Escape HTML metacharacters AND every non-ASCII char (to a numeric
// entity), so the rendered HTML is pure ASCII regardless of charset.
function escapeHtml(s) {
  return String(s).replace(/[&<>"]|[^\x00-\x7f]/g, (c) => {
    if (c === "&") return "&amp;";
    if (c === "<") return "&lt;";
    if (c === ">") return "&gt;";
    if (c === '"') return "&quot;";
    return "&#" + c.charCodeAt(0) + ";";
  });
}

// ---------------------------------------------------------------------
// Theme — six Kriegspiel palettes (gsd-006). The choice is a body class
// swap and persists in localStorage; the swatch row lives in the rail.
// ---------------------------------------------------------------------

const THEMES = [
  { id: "paper", name: "Kriegspiel Paper" },
  { id: "night", name: "Kriegspiel Night" },
  { id: "linen", name: "Linen Folio" },
  { id: "vellum", name: "Map Vellum" },
  { id: "iron", name: "Iron Press" },
  { id: "carbon", name: "Carbon Folio" },
];
const THEME_KEY = "gsd-theme";
let activeTheme = "paper";

function applyTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = "paper";
  activeTheme = id;
  document.body.className = "theme-" + id;
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch (e) {}
  if (railThemes) {
    for (const sw of railThemes.querySelectorAll(".rail__theme")) {
      sw.classList.toggle("is-active", sw.dataset.t === id);
    }
  }
}

function renderThemeSwatches() {
  if (!railThemes) return;
  railThemes.innerHTML = "";
  for (const t of THEMES) {
    const sw = document.createElement("button");
    sw.className = "rail__theme" + (t.id === activeTheme ? " is-active" : "");
    sw.dataset.t = t.id;
    sw.title = t.name;
    sw.setAttribute("aria-label", t.name);
    sw.addEventListener("click", () => applyTheme(t.id));
    railThemes.appendChild(sw);
  }
}

function initTheme() {
  let saved = "paper";
  try {
    saved = localStorage.getItem(THEME_KEY) || "paper";
  } catch (e) {}
  applyTheme(saved);
  renderThemeSwatches();
}

// ---------------------------------------------------------------------
// Modal — a centered overlay card. gsd-030 uses it for the full text of
// a ping, whose dashboard row truncates the body to two lines.
// ---------------------------------------------------------------------

let modalOverlay = null;

function initModal() {
  modalOverlay = document.createElement("div");
  modalOverlay.className = "modal-overlay";
  modalOverlay.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true">' +
    '<div class="modal__head"><div class="modal__meta"></div>' +
    '<button class="modal__close" title="Close" aria-label="Close">' +
    "&#215;</button></div>" +
    '<div class="modal__body"></div></div>';
  // Backdrop click closes; a click inside the card does not.
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  modalOverlay
    .querySelector(".modal__close")
    .addEventListener("click", closeModal);
  document.body.appendChild(modalOverlay);
}

function closeModal() {
  if (modalOverlay) modalOverlay.classList.remove("is-open");
}

// Open the modal showing one ping's full inbox text and heading meta.
function openPingModal(ping) {
  if (!modalOverlay) return;
  const kindCls =
    ping.kind === "idea"
      ? " kind-idea"
      : ping.kind === "task"
        ? " kind-task"
        : "";
  modalOverlay.querySelector(".modal__meta").innerHTML =
    '<span class="modal__when">' +
    escapeHtml(ping.when) +
    "</span>" +
    (ping.actor ? "<span>" + escapeHtml(ping.actor) + "</span>" : "") +
    '<span class="modal__kind' +
    kindCls +
    '">' +
    escapeHtml(ping.kind) +
    "</span>";
  modalOverlay.querySelector(".modal__body").innerHTML =
    '<pre class="modal__text">' + escapeHtml(ping.body) + "</pre>";
  modalOverlay.classList.add("is-open");
}

document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    modalOverlay &&
    modalOverlay.classList.contains("is-open")
  ) {
    closeModal();
  }
});

// ---------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------

function renderTabbar() {
  tabbar.innerHTML = "";
  for (const tab of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === activeTabId ? " tab-active" : "");

    let live = false; // a session tab with a running, poppable process
    if (tab.kind === "session") {
      const dot = document.createElement("span");
      if (tab.dormant) {
        // Restored from the last run — no live process until clicked.
        el.classList.add("tab-dormant");
        dot.className = "tab-dot dot-dormant";
        dot.title = "dormant — click to resume";
      } else {
        const s = sessions.get(tab.sessionId);
        const st = (s && s.status) || "running";
        live = st !== "exited";
        const dotClass =
          st === "exited"
            ? "dot-done"
            : st === "idle"
              ? "dot-attention"
              : "dot-running";
        dot.className = "tab-dot " + dotClass;
        dot.title =
          st === "exited"
            ? "ended"
            : st === "idle"
              ? "idle — may want you"
              : "running";
      }
      el.appendChild(dot);
    }

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.label;
    el.appendChild(label);

    // gsd-035 — pop a live session out into its own OS window.
    if (live) {
      const pop = document.createElement("span");
      pop.className = "tab-popout";
      pop.textContent = "↗"; // north-east arrow
      pop.title = "Pop out into its own window";
      pop.addEventListener("click", (e) => {
        e.stopPropagation();
        popOutTab(tab.id);
      });
      el.appendChild(pop);
    }

    if (tab.kind !== "fleet") {
      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×"; // multiplication sign
      close.title = "Close session";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      el.appendChild(close);
    }

    el.addEventListener("click", () => activateTab(tab.id));
    tabbar.appendChild(el);
  }
}

function activateTab(id) {
  if (!tabs.some((t) => t.id === id)) id = "fleet";
  // A dormant tab has no live process — activating it wakes it.
  const target = tabs.find((t) => t.id === id);
  if (target && target.dormant) {
    resumeDormant(id);
    return;
  }
  activeTabId = id;
  for (const v of contentEl.querySelectorAll(".view")) {
    v.classList.toggle("view-hidden", v.dataset.view !== id);
  }
  renderTabbar();
  const tab = tabs.find((t) => t.id === id);
  if (tab && tab.kind === "session") {
    requestAnimationFrame(() => {
      fitSession(tab.sessionId);
      const s = sessions.get(tab.sessionId);
      if (s) s.term.focus();
    });
  }
}

function closeTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || tab.kind === "fleet") return;
  const s = sessions.get(tab.sessionId);
  if (s) {
    invoke("kill_session", { id: tab.sessionId }).catch(() => {});
    try {
      s.term.dispose();
    } catch (e) {}
    s.view.remove();
    sessions.delete(tab.sessionId);
  }
  tabs = tabs.filter((t) => t.id !== id);
  persistLayout();
  if (activeTabId === id) activateTab("fleet");
  else renderTabbar();
}

// gsd-035 — pop a live session tab out into its own OS window. The PTY
// keeps running in the backend; the new window (term.html) re-attaches
// to it by id. On success the tab is dropped from this window — the
// session now lives in the popped-out window, which owns its lifecycle
// (closing that window ends the session).
function popOutTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || tab.kind !== "session" || tab.dormant) return;
  const s = sessions.get(tab.sessionId);
  if (!s) return;
  invoke("popout_session", {
    id: tab.sessionId,
    label: sessionLabel(s.info),
  })
    .then(() => {
      try {
        s.term.dispose();
      } catch (e) {}
      s.view.remove();
      sessions.delete(tab.sessionId);
      tabs = tabs.filter((t) => t.id !== id);
      persistLayout();
      if (activeTabId === id) activateTab("fleet");
      else renderTabbar();
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------
// Sessions — PTY-backed agent terminals
// ---------------------------------------------------------------------

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function basename(p) {
  const parts = String(p).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function sessionLabel(info) {
  const agent = info.agent === "cursor-agent" ? "cursor" : info.agent;
  return agent + " · " + basename(info.cwd);
}

function createTerminal(host, sessionId) {
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
  // Cmd+1-9 are tab hotkeys — don't forward the digit to the agent; the
  // document keydown handler does the tab switch.
  term.attachCustomKeyEventHandler(
    (e) => !(e.metaKey && /^[1-9]$/.test(e.key)),
  );
  term.open(host);
  term.onData((d) => {
    invoke("write_session", { id: sessionId, data: d }).catch(() => {});
  });
  return { term, fit };
}

function fitSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.fit.fit();
    invoke("resize_session", {
      id,
      rows: s.term.rows,
      cols: s.term.cols,
    }).catch(() => {});
  } catch (e) {}
}

function openSessionTab(info) {
  const view = document.createElement("div");
  view.className = "view view-session";
  view.dataset.view = "se:" + info.id;
  const host = document.createElement("div");
  host.className = "term-host";
  view.appendChild(host);
  contentEl.appendChild(view);

  if (!window.Terminal) {
    host.textContent = "xterm.js failed to load — terminal unavailable.";
    return;
  }

  const { term, fit } = createTerminal(host, info.id);
  sessions.set(info.id, {
    info,
    term,
    fit,
    host,
    view,
    status: "running",
    lastOutputAt: Date.now(),
  });

  tabs.push({
    id: "se:" + info.id,
    kind: "session",
    label: sessionLabel(info),
    sessionId: info.id,
  });
  activateTab("se:" + info.id);
  persistLayout();
}

async function startSession(agent, cwd, prompt, msgEl, opts) {
  opts = opts || {};
  if (!cwd) {
    if (msgEl) msgEl.textContent = "No code repo for this project.";
    return;
  }
  if (msgEl) msgEl.textContent = "Starting " + agent + "…";
  try {
    // The tab opens on the session-spawned event the backend emits —
    // the same path the dispatcher's request-file spawn travels.
    await invoke("spawn_session", {
      agent,
      cwd,
      prompt: prompt || null,
      mode: opts.mode || "interactive",
      resume: Boolean(opts.resume),
    });
    if (msgEl) msgEl.textContent = "";
  } catch (e) {
    if (msgEl) msgEl.textContent = "Could not start session: " + e;
  }
}

// gsd-031 — fire a native OS notification through the backend. The
// frontend owns the *when* (it knows the active tab and the per-session
// idle timer); the Rust `notify` command owns the OS call.
function notifyDesktop(title, body) {
  invoke("notify", { title, body }).catch(() => {});
}

// True when the active tab is the one for this session — i.e. the
// operator is already looking at it, so no notification is warranted.
function isActiveSession(sessionId) {
  const tab = tabs.find((t) => t.sessionId === sessionId);
  return Boolean(tab) && tab.id === activeTabId;
}

listen("pty-output", (e) => {
  const s = sessions.get(e.payload.id);
  if (!s) return;
  s.term.write(base64ToBytes(e.payload.data));
  s.lastOutputAt = Date.now();
  s.idleNotified = false; // fresh output — re-arm the idle notification
  if (s.status === "idle") {
    s.status = "running";
    renderTabbar();
  }
});

listen("pty-exit", (e) => {
  const s = sessions.get(e.payload.id);
  if (s) {
    s.status = "exited";
    s.term.write("\r\n\x1b[2m— session ended —\x1b[0m\r\n");
    renderTabbar();
    // gsd-031 — notify only when the operator is not on this tab.
    if (!isActiveSession(e.payload.id)) {
      notifyDesktop("Session ended", sessionLabel(s.info));
    }
  }
  // gsd-032 — a dispatched session may have just shipped a ping's work;
  // re-probe so the "may be done" hint can appear right away instead of
  // waiting for an unrelated state change. A harmless no-op when the
  // briefing is not the rendered fleet view.
  loadPings();
});

// A session spawned anywhere — the workbench button, the dispatcher
// button, or a dispatcher session's spawn tool — opens its tab here.
listen("session-spawned", (e) => {
  openSessionTab(e.payload);
});

// ---------------------------------------------------------------------
// Session restore + quick-switch — reopen the last run's tabs dormant,
// and Cmd+1-9 to jump between tabs.
// ---------------------------------------------------------------------

let dormantSeq = 0;

// Persist the open session tabs (interactive only) so a relaunch can
// reopen them. Live tabs contribute their session info; dormant tabs —
// restored, not yet woken — contribute their stored restore info.
function persistLayout() {
  const layout = [];
  for (const tab of tabs) {
    if (tab.kind !== "session") continue;
    let r = null;
    if (tab.dormant) {
      r = tab.restore;
    } else {
      const s = sessions.get(tab.sessionId);
      if (s) r = s.info;
    }
    if (r && r.mode === "interactive") {
      layout.push({ agent: r.agent, cwd: r.cwd, mode: r.mode });
    }
  }
  invoke("save_session_layout", { sessions: layout }).catch(() => {});
}

// Reopen a session from the last run as a dormant tab — a tab-bar entry
// with no live process. Clicking it (or Cmd+N) resumes the session.
function openDormantTab(restore) {
  const id = "rest:" + dormantSeq++;
  tabs.push({
    id,
    kind: "session",
    label: sessionLabel(restore),
    dormant: true,
    restore,
  });
  renderTabbar();
}

// Wake a dormant tab: drop the placeholder and spawn the real session,
// resuming the agent's prior conversation in that repo. The live tab
// opens on the session-spawned event — the same path as any spawn.
function resumeDormant(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || !tab.dormant) return;
  const { agent, cwd, mode } = tab.restore;
  tabs = tabs.filter((t) => t.id !== id);
  renderTabbar();
  startSession(agent, cwd, "", null, { mode, resume: true });
}

// On launch, reopen the prior run's session tabs — dormant. Nothing
// spawns; the workspace is back, each session waits for a click.
async function restoreLayout() {
  let saved = [];
  try {
    saved = await invoke("load_session_layout");
  } catch (e) {
    saved = [];
  }
  for (const s of saved) openDormantTab(s);
}

// Cmd+1-9 — jump to the tab at that position (Cmd+1 is the Fleet tab).
function switchToTabIndex(i) {
  if (i >= 0 && i < tabs.length) activateTab(tabs[i].id);
}
document.addEventListener("keydown", (e) => {
  if (e.metaKey && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    switchToTabIndex(Number(e.key) - 1);
  }
});

// ---------------------------------------------------------------------
// Fleet rail
// ---------------------------------------------------------------------

function markSelected() {
  for (const row of fleetList.querySelectorAll(".rail__item")) {
    row.classList.toggle("is-active", row.dataset.id === selectedId);
  }
}

// A project is "parked" if the 2026-05-16 portfolio triage archived it
// or set its required_attention to dormant.
function isParked(p) {
  return Boolean(p.archived) || p.required_attention === "dormant";
}

function openFleetBriefing() {
  activateTab("fleet");
  showBriefing();
}

function openFleetProject(id) {
  activateTab("fleet");
  selectProject(id);
}

function buildFleetRow(proj) {
  const row = document.createElement("div");
  row.className = "rail__item";
  if (proj.status === "active") row.classList.add("has-work");
  if (isParked(proj)) row.classList.add("parked");
  row.dataset.id = proj.id;
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.title =
    (STATUS_LABEL[proj.status] || proj.status) +
    (proj.pending ? " - " + proj.pending + " pending" : "");

  const dot = document.createElement("span");
  dot.className = "rail__dot";
  const name = document.createElement("span");
  name.className = "rail__name";
  name.textContent = proj.id;

  row.append(dot, name);
  if (proj.pending) {
    const count = document.createElement("span");
    count.className = "rail__count";
    count.textContent = proj.pending;
    row.appendChild(count);
  }

  row.addEventListener("click", () => openFleetProject(proj.id));
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFleetProject(proj.id);
    }
  });
  return row;
}

function renderRail() {
  fleetList.innerHTML = "";

  if (!snapshot.ok) {
    footText.textContent = "GeneralStaff not found";
    return;
  }

  const activeProjs = snapshot.projects.filter((p) => !isParked(p));
  const parkedProjs = snapshot.projects.filter((p) => isParked(p));

  for (const proj of activeProjs) {
    fleetList.appendChild(buildFleetRow(proj));
  }

  if (parkedProjs.length) {
    const group = document.createElement("details");
    group.className = "parked-group";
    const summary = document.createElement("summary");
    summary.textContent = "Parked (" + parkedProjs.length + ")";
    group.appendChild(summary);
    for (const proj of parkedProjs) {
      group.appendChild(buildFleetRow(proj));
    }
    fleetList.appendChild(group);
  }
  markSelected();

  const withWork = activeProjs.filter((p) => p.status === "active").length;
  footText.textContent =
    activeProjs.length +
    " active" +
    (withWork ? " · " + withWork + " with work" : "") +
    (parkedProjs.length ? " · " + parkedProjs.length + " parked" : "");
}

// ---------------------------------------------------------------------
// Fleet view — briefing
// ---------------------------------------------------------------------

function headHtml(title, sub) {
  return (
    '<div class="dash__head"><h1 class="dash__title">' +
    escapeHtml(title) +
    "</h1>" +
    (sub ? '<div class="dash__breadcrumb">' + escapeHtml(sub) + "</div>" : "") +
    "</div>"
  );
}

function showBriefing() {
  selectedId = null;
  currentRepoPath = null;
  markSelected();

  if (!snapshot.ok) {
    fleetView.innerHTML =
      '<div class="workbench">' +
      headHtml("Fleet briefing", "") +
      '<div class="panel"><div class="panel__head">' +
      '<h2 class="panel__title">GeneralStaff not found</h2></div>' +
      '<div class="panel__body"><p class="muted">' +
      escapeHtml(
        snapshot.message || "Could not locate the generalstaff-private state."
      ) +
      " Set <code>generalstaff_path</code> in " +
      "<code>~/.generalstaff-desktop/config.json</code>.</p></div></div></div>";
    return;
  }

  const activeProjs = snapshot.projects.filter((p) => !isParked(p));
  const parkedCount = snapshot.projects.length - activeProjs.length;
  const active = activeProjs.filter((p) => p.status === "active").length;
  const pending = activeProjs.reduce((n, p) => n + p.pending, 0);
  const waiting = activeProjs.reduce((n, p) => n + p.interactive_pending, 0);

  // Situation strip — four figures across the top.
  const sitCell = (num, label, cls) =>
    '<div class="sit__cell' +
    (cls ? " " + cls : "") +
    '"><div class="sit__num">' +
    num +
    '</div><div class="sit__label">' +
    label +
    "</div></div>";
  const situation =
    '<div class="sit dash__situation">' +
    sitCell(activeProjs.length, "Active projects") +
    sitCell(active, "With open work") +
    sitCell(pending, "Pending tasks") +
    sitCell(waiting, "Waiting on you", "is-rust") +
    "</div>";

  // Attention — projects with work waiting, ranked, against viability.
  const ranked = activeProjs
    .filter((p) => p.interactive_pending > 0)
    .sort((a, b) => b.interactive_pending - a.interactive_pending)
    .slice(0, 12);
  let attnRows = ranked
    .map((p) => {
      const v = p.viability_sum;
      const scored = v !== null && v !== undefined;
      const pct = scored
        ? Math.round((Math.max(0, Math.min(11, v)) / 11) * 100)
        : 0;
      const warn = scored && v <= 3;
      return (
        '<div class="attn__row' +
        (warn ? " warn" : "") +
        '" data-id="' +
        escapeHtml(p.id) +
        '" role="button" tabindex="0">' +
        '<div class="attn__name">' +
        escapeHtml(p.id) +
        "<small>" +
        p.interactive_pending +
        " waiting</small></div>" +
        '<div class="attn__bar"><i style="width:' +
        pct +
        '%"></i></div>' +
        '<div class="attn__score">' +
        (scored ? v : "&mdash;") +
        "</div></div>"
      );
    })
    .join("");
  if (!attnRows) attnRows = '<p class="muted">Nothing waiting on you.</p>';

  const pingsPanel =
    '<div class="panel dash__pings"><div class="panel__head">' +
    '<h2 class="panel__title">Open pings</h2>' +
    '<span class="panel__meta" id="pings-count"></span></div>' +
    '<div class="panel__body">' +
    '<div class="pings__compose">' +
    '<input id="ping-compose-text" type="text" autocomplete="off" ' +
    'spellcheck="false" placeholder="Add a ping to the inbox" />' +
    '<select id="ping-compose-kind" title="Ping kind — sets which action it gets">' +
    '<option value="task">Task</option>' +
    '<option value="idea">Idea</option>' +
    '<option value="other">Note</option></select>' +
    '<button id="ping-compose-add">Add</button></div>' +
    '<div class="pings__toolbar">' +
    '<div class="pings__filter" id="pings-filter">' +
    '<button data-f="all" class="on">All</button>' +
    '<button data-f="idea">Idea</button>' +
    '<button data-f="task">Task</button>' +
    '<button data-f="other">Other</button></div>' +
    '<label class="pings__search"><input id="pings-search" type="text" ' +
    'placeholder="Search pings" autocomplete="off" spellcheck="false" /></label>' +
    "</div>" +
    '<div id="pings-list" class="muted">Loading pings&hellip;</div>' +
    '<div id="pings-msg" class="spawn-msg"></div>' +
    "</div></div>";

  const dispatcher =
    '<div class="dispatch"><div>' +
    '<div class="dispatch__label">Dispatcher</div>' +
    '<div class="dispatch__head">Open an orchestration session</div>' +
    '<div class="dispatch__sub">A Claude Code session in ' +
    "generalstaff-private that opens child sessions for any project " +
    "from chat.</div></div>" +
    '<button class="dispatch__btn" id="dispatch-go">Open</button>' +
    '<div class="dispatch__msg" id="dispatch-msg"></div></div>';

  const attention =
    '<div class="panel"><div class="panel__head">' +
    '<h2 class="panel__title">Attention</h2>' +
    '<span class="panel__meta">ranked by viability</span></div>' +
    '<div class="panel__body">' +
    attnRows +
    "</div></div>";

  const recent =
    '<div class="panel"><div class="panel__head">' +
    '<h2 class="panel__title">Recent activity</h2>' +
    '<span class="panel__meta">sessions &middot; commits</span></div>' +
    '<div class="panel__body">' +
    '<div id="recent-notes" class="muted">Loading&hellip;</div>' +
    '<div id="recent-commits"></div>' +
    '<div class="recent__foot">' +
    '<button class="btn-ghost" id="gen-note">Generate session note</button>' +
    '<button class="btn-ghost" id="reconcile-go">Reconcile state</button>' +
    '<span class="spawn-msg" id="gen-note-msg"></span>' +
    "</div></div></div>";

  const bc =
    activeProjs.length +
    " active" +
    (parkedCount ? " &middot; " + parkedCount + " parked" : "");

  fleetView.innerHTML =
    '<div class="dash">' +
    '<div class="dash__head"><h1 class="dash__title">Fleet briefing</h1>' +
    '<div class="dash__breadcrumb">' +
    bc +
    "</div></div>" +
    '<div class="dash__grid">' +
    situation +
    '<div class="dash__main">' +
    pingsPanel +
    attention +
    "</div>" +
    '<div class="dash__side">' +
    dispatcher +
    recent +
    "</div></div></div>";

  // gsd-025 — restore the dashboard scroll after the rebuild.
  if (scrollToRestore) fleetView.scrollTop = scrollToRestore.view || 0;

  loadPings();
  loadRecentActivity();

  const dgo = document.getElementById("dispatch-go");
  if (dgo) {
    dgo.addEventListener("click", () => {
      startSession(
        "claude",
        snapshot.generalstaff_path,
        "",
        document.getElementById("dispatch-msg")
      );
    });
  }

  const genNote = document.getElementById("gen-note");
  if (genNote) genNote.addEventListener("click", generateSessionNote);

  const recon = document.getElementById("reconcile-go");
  if (recon) recon.addEventListener("click", reconcileState);

  const composeAdd = document.getElementById("ping-compose-add");
  if (composeAdd) composeAdd.addEventListener("click", addPing);
  const composeText = document.getElementById("ping-compose-text");
  if (composeText) {
    composeText.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addPing();
      }
    });
  }

  const filterEl = document.getElementById("pings-filter");
  if (filterEl) {
    for (const btn of filterEl.querySelectorAll("button")) {
      btn.classList.toggle("on", btn.dataset.f === pingFilter);
      btn.addEventListener("click", () => {
        pingFilter = btn.dataset.f;
        for (const b of filterEl.querySelectorAll("button")) {
          b.classList.toggle("on", b === btn);
        }
        renderPingRows();
      });
    }
  }
  const searchEl = document.getElementById("pings-search");
  if (searchEl) {
    searchEl.value = pingSearch;
    searchEl.addEventListener("input", () => {
      pingSearch = searchEl.value;
      renderPingRows();
    });
  }

  for (const row of fleetView.querySelectorAll(".attn__row")) {
    const id = row.dataset.id;
    row.addEventListener("click", () => openFleetProject(id));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFleetProject(id);
      }
    });
  }
}

// ---------------------------------------------------------------------
// Fleet view — project workbench
// ---------------------------------------------------------------------

async function selectProject(id) {
  selectedId = id;
  currentRepoPath = null;
  markSelected();

  const proj = snapshot.projects.find((p) => p.id === id);
  let sub = "project workbench";
  if (proj) {
    const bits = [STATUS_LABEL[proj.status] || proj.status];
    if (isParked(proj)) bits.push(proj.archived ? "archived" : "dormant");
    bits.push(proj.pending + " of " + proj.total + " tasks open");
    if (proj.interactive_pending) {
      bits.push(proj.interactive_pending + " waiting on you");
    }
    if (proj.category) bits.push(proj.category);
    if (proj.viability_sum !== null && proj.viability_sum !== undefined) {
      bits.push("viability " + proj.viability_sum);
    }
    sub = bits.join("  /  ");
  }

  fleetView.innerHTML =
    '<div class="workbench">' +
    headHtml(id, sub) +
    '<div class="panel"><div class="panel__head">' +
    '<h2 class="panel__title">Session</h2></div><div class="panel__body">' +
    '<p class="panel-note">Start an interactive agent session in this ' +
    "project's repo. It opens in its own tab.</p>" +
    '<div class="spawn-row">' +
    '<select id="spawn-agent">' +
    '<option value="claude">Claude Code</option>' +
    '<option value="cursor-agent">Cursor</option></select>' +
    '<input id="spawn-prompt" type="text" placeholder="optional seed prompt" />' +
    '<button id="spawn-go" disabled>Start session here</button></div>' +
    '<div id="spawn-msg" class="spawn-msg">Locating code repo&hellip;</div>' +
    "</div></div>" +
    '<div class="panel"><div class="panel__head">' +
    '<h2 class="panel__title">Files</h2></div><div class="panel__body">' +
    '<div id="file-tree" class="file-tree muted">Loading file tree...</div>' +
    "</div></div>" +
    '<div class="panel" id="viewer-panel" hidden><div class="panel__head">' +
    '<h2 class="panel__title" id="viewer-name">&mdash;</h2></div>' +
    '<div class="panel__body"><pre id="viewer-body" class="viewer-body"></pre>' +
    "</div></div>" +
    '<div class="panel"><div class="panel__head">' +
    '<h2 class="panel__title">Task ledger</h2></div><div class="panel__body">' +
    '<div id="task-ledger" class="task-ledger muted">Loading task ledger...</div>' +
    '<div id="task-msg" class="spawn-msg"></div>' +
    "</div></div></div>";

  loadTaskLedger(id);

  // Load the project's code-repo file tree (git ls-files).
  let fl;
  try {
    fl = await invoke("project_files", { id });
  } catch (e) {
    fl = { ok: false, message: String(e), files: [] };
  }
  if (selectedId !== id) return; // selection moved on while loading

  // Wire the session-spawn control once the repo path is known.
  const goBtn = document.getElementById("spawn-go");
  const msgEl = document.getElementById("spawn-msg");
  if (fl.repo_path) {
    currentRepoPath = fl.repo_path;
    if (goBtn) goBtn.disabled = false;
    if (msgEl) msgEl.textContent = fl.repo_path;
    if (goBtn) {
      goBtn.addEventListener("click", () => {
        const agent = document.getElementById("spawn-agent").value;
        const prompt = document.getElementById("spawn-prompt").value.trim();
        startSession(agent, currentRepoPath, prompt, msgEl);
      });
    }
  } else if (msgEl) {
    msgEl.textContent = "No code repo found alongside generalstaff-private.";
  }

  const treeEl = document.getElementById("file-tree");
  if (!treeEl) return;
  treeEl.className = "file-tree";
  if (!fl.ok) {
    treeEl.innerHTML =
      '<p class="muted">' + escapeHtml(fl.message || "No files.") + "</p>";
    return;
  }
  treeEl.innerHTML = treeToHtml(buildFileTree(fl.files), "");
  for (const node of treeEl.querySelectorAll(".tree-file")) {
    const rel = node.dataset.rel;
    node.addEventListener("click", () => openFile(id, rel));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFile(id, rel);
      }
    });
  }
}

// Build a nested folder tree from a flat list of repo-relative paths.
function buildFileTree(paths) {
  const root = {};
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        node[part] = null; // file
      } else {
        if (node[part] == null) node[part] = {};
        node = node[part];
      }
    }
  }
  return root;
}

// Render a tree node: folders as collapsed <details>, files as click rows.
function treeToHtml(node, prefix) {
  const names = Object.keys(node).sort();
  const folders = names.filter((n) => node[n] !== null);
  const files = names.filter((n) => node[n] === null);
  let html = "";
  for (const f of folders) {
    html +=
      '<details class="tree-folder"><summary>' +
      escapeHtml(f) +
      "</summary>" +
      treeToHtml(node[f], prefix + f + "/") +
      "</details>";
  }
  for (const f of files) {
    const rel = prefix + f;
    html +=
      '<div class="tree-file" data-rel="' +
      escapeHtml(rel) +
      '" role="button" tabindex="0">' +
      escapeHtml(f) +
      "</div>";
  }
  return html;
}

// Load one file into the viewer panel.
async function openFile(id, rel) {
  const panel = document.getElementById("viewer-panel");
  const nameEl = document.getElementById("viewer-name");
  const bodyEl = document.getElementById("viewer-body");
  if (!panel || !nameEl || !bodyEl) return;
  panel.hidden = false;
  nameEl.textContent = rel;
  bodyEl.textContent = "Loading...";
  let fc;
  try {
    fc = await invoke("read_project_file", { id, rel });
  } catch (e) {
    fc = { ok: false, message: String(e) };
  }
  bodyEl.textContent = fc.ok ? fc.content : fc.message || "could not read file";
}

// Load the project's task ledger — sectioned Pending / Done.
async function loadTaskLedger(id) {
  let tl;
  try {
    tl = await invoke("project_tasks", { id });
  } catch (e) {
    tl = { ok: false, message: String(e), tasks: [] };
  }
  const el = document.getElementById("task-ledger");
  if (!el || selectedId !== id) return; // selection moved on while loading
  el.className = "task-ledger";
  if (!tl.ok) {
    el.innerHTML =
      '<p class="muted">' + escapeHtml(tl.message || "No tasks.") + "</p>";
    return;
  }
  const byPrio = (a, b) => (a.priority || 9) - (b.priority || 9);
  const pending = tl.tasks.filter((t) => t.status === "pending").sort(byPrio);
  const done = tl.tasks.filter((t) => t.status !== "pending").sort(byPrio);
  if (!pending.length && !done.length) {
    el.innerHTML = '<p class="muted">No tasks.</p>';
    return;
  }
  const rowHtml = (t) =>
    '<div class="task-row" title="' +
    escapeHtml(t.title) +
    '"><span class="task-id">' +
    escapeHtml(t.id) +
    '</span><span class="task-title">' +
    escapeHtml(t.title) +
    "</span>" +
    (t.interactive_only
      ? '<span class="task-flag" title="waiting on you">&#9679;</span>'
      : "") +
    (t.status === "pending"
      ? '<button class="task-assess" data-id="' +
        escapeHtml(t.id) +
        '">Assess</button>' +
        '<button class="task-dispatch" data-id="' +
        escapeHtml(t.id) +
        '">Dispatch</button>'
      : "") +
    "</div>";
  const section = (label, list) =>
    !list.length
      ? ""
      : '<div class="task-section">' +
        label +
        " (" +
        list.length +
        ")</div>" +
        list.map(rowHtml).join("");
  el.innerHTML = section("Pending", pending) + section("Done", done);

  // gsd-033 — a pending task row's Dispatch button opens a claude
  // session in the project's repo, seeded with the task.
  for (const btn of el.querySelectorAll(".task-dispatch")) {
    const task = pending.find((t) => t.id === btn.dataset.id);
    if (!task) continue;
    btn.addEventListener("click", () => dispatchTask(id, task));
  }

  // gsd-040 — the Assess button on the same row: a pre-flight pass that
  // scopes the task and reports whether it is still worth doing, instead
  // of jumping straight to the work.
  for (const btn of el.querySelectorAll(".task-assess")) {
    const task = pending.find((t) => t.id === btn.dataset.id);
    if (!task) continue;
    btn.addEventListener("click", () => assessTask(id, task));
  }
}

// The autonomy preamble every click-launched dispatch (task or ping)
// shares. Ray operates GSD as a non-programmer — he can't read diffs
// and doesn't want to. Routine commits + pushes are pre-authorized so
// the bot ships work end-to-end instead of pausing to ask. Escalation
// is still expected for genuinely-risky operations (hands-off paths,
// destructive git, ambiguous design calls), but the default for an
// ordinary code change is: do it, commit, push, report in plain
// English. No diff dumps.
const NON_PROGRAMMER_PREAMBLE =
  "Operator note — Ray runs GSD as a non-programmer. He cannot review " +
  "diffs and does not want to. For this dispatch you are pre-authorized " +
  "to commit and push routine work without asking. Do not surface a " +
  "diff for approval, do not ask 'should I commit this?', do not ask " +
  "'should I push?'. When you finish: commit with a descriptive " +
  "message, push, then report in one short paragraph of plain English " +
  "what you actually changed and what Ray will see different. Only " +
  "stop and ask if the work would touch hands_off paths, force-push, " +
  "delete history, or hinges on a design call (voice / feel / scope) " +
  "that Ray needs to make. Mechanical / structural calls — file " +
  "organization, library choice, test approach — are yours to make.";

// gsd-033 — dispatch a project task: open a claude session in the
// project's own repo, seeded with the task — the project-task analogue
// of a ping's Dispatch button. The GS-Task trailer (gsd-039) gives the
// Reconcile-state pass an explicit signal to close the task against.
function dispatchTask(projectId, task) {
  const msg = document.getElementById("task-msg");
  const proj = (snapshot.projects || []).find((p) => p.id === projectId);
  if (!proj || !proj.repo_path) {
    if (msg) msg.textContent = "No code repo found for " + projectId + ".";
    return;
  }
  const prompt =
    NON_PROGRAMMER_PREAMBLE +
    "\n\nA task from the " +
    projectId +
    " project task ledger (generalstaff-private/state/" +
    projectId +
    "/tasks.json):\n\n" +
    task.id +
    " — " +
    task.title +
    "\n\nThis session is open in the " +
    projectId +
    " repo. Handle the task: make the change, commit it, and push. If " +
    "the task turns out to be already done, or should not be done, say " +
    "so rather than forcing it — and skip the trailer if you did not " +
    "do the work." +
    "\n\nWhen you commit, put this exact line in the commit message " +
    "body so the Reconcile pass can close the task ledger entry:" +
    "\n\n    GS-Task: " +
    task.id;
  startSession("claude", proj.repo_path, prompt, msg);
}

// gsd-040 — assess a project task: open a claude session in the
// project's repo seeded with an assessment-only prompt. The pre-flight
// counterpart of dispatchTask — it scopes the task and reports whether
// the work is still needed, and changes nothing.
function assessTask(projectId, task) {
  const msg = document.getElementById("task-msg");
  const proj = (snapshot.projects || []).find((p) => p.id === projectId);
  if (!proj || !proj.repo_path) {
    if (msg) msg.textContent = "No code repo found for " + projectId + ".";
    return;
  }
  const prompt =
    "This is an assessment pass — make no changes and do not commit.\n\n" +
    "A task from the " +
    projectId +
    " project task ledger (generalstaff-private/state/" +
    projectId +
    "/tasks.json):\n\n" +
    task.id +
    " — " +
    task.title +
    "\n\nThis session is open in the " +
    projectId +
    " repo. Read the git log and the current project state, then tell " +
    "me plainly: is this task still real and needed, already done, " +
    "obsolete, or in need of rescoping? If it is real, what would it " +
    "actually take to do? Give a one-paragraph verdict with a short " +
    "rationale — and change nothing. A pending ledger entry is not " +
    "proof the work is needed.";
  startSession("claude", proj.repo_path, prompt, msg);
}

// ---------------------------------------------------------------------
// Fleet view — open pings (the GS inbox)
// ---------------------------------------------------------------------

// First non-empty line of a ping body, truncated for the row display.
function pingSnippet(body) {
  const line =
    String(body)
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s) || "";
  return line.length > 140 ? line.slice(0, 139) + "…" : line;
}

// gsd-023 — the dispatch target meaning "open in generalstaff-private"
// (the orchestration repo) rather than a project's own repo.
const GS_PRIVATE_TARGET = "__gs-private__";

// Best-effort: which fleet project is this ping about? Scans the body for
// a project id as a whole token (case-insensitive) and returns the
// earliest-mentioned one, or null. Only a default — the Dispatch target
// select shows the result and is fully overridable.
function detectPingProject(body) {
  const text = String(body).toLowerCase();
  let bestId = null;
  let bestAt = Infinity;
  for (const p of snapshot.projects || []) {
    const id = String(p.id).toLowerCase();
    if (!id) continue;
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = text.match(new RegExp("(^|[^a-z0-9-])" + esc + "([^a-z0-9-]|$)"));
    if (m && m.index < bestAt) {
      bestAt = m.index;
      bestId = p.id;
    }
  }
  return bestId;
}

// The Dispatch target <select> for a task ping — generalstaff-private plus
// every fleet project, with the detected project pre-selected (or
// generalstaff-private when nothing was detected).
function targetSelectHtml(detected) {
  let opts =
    '<option value="' +
    GS_PRIVATE_TARGET +
    '"' +
    (detected ? "" : " selected") +
    ">generalstaff-private</option>";
  for (const p of snapshot.projects || []) {
    opts +=
      '<option value="' +
      escapeHtml(p.id) +
      '"' +
      (p.id === detected ? " selected" : "") +
      ">" +
      escapeHtml(p.id) +
      "</option>";
  }
  return (
    '<select class="ping-target" title="Dispatch target — which repo the session opens in">' +
    opts +
    "</select>"
  );
}

// The seed prompt a "Scaffold" click hands the dispatcher session.
// Scaffold is a scoping pass — it researches and proposes, it does not
// ship code — so the non-programmer preamble doesn't apply here (no
// commit/push decision to pre-authorize).
function scaffoldPrompt(ping) {
  return (
    "A new idea came in via the GeneralStaff pings inbox (" +
    ping.when +
    ", " +
    ping.actor +
    "):\n\n" +
    ping.body +
    "\n\nScaffold this idea: research what it would take, Hammerstein-" +
    "scope it with /audit, and either propose how it becomes a registered " +
    "GS project — or tell me honestly if it should not be one."
  );
}

// The seed prompt a "Dispatch" click hands the spawned session. When the
// session opens in a project's own repo it is told so; when it opens in
// generalstaff-private it keeps the orchestration framing.
function dispatchPrompt(ping, projectId) {
  const intro =
    NON_PROGRAMMER_PREAMBLE +
    "\n\nA task came in via the GeneralStaff pings inbox (" +
    ping.when +
    ", " +
    ping.actor +
    "):\n\n" +
    ping.body +
    "\n\n";
  // gsd-027 — every dispatched session tags its commit with a GS-Ping
  // trailer (the ping's exact timestamp) and pushes, so the Reconcile
  // pass has an explicit, greppable signal to close the ping against.
  const trailer =
    "\n\nWhen you commit, put this exact line in the commit message body — " +
    "it lets the work be reconciled back to the GeneralStaff ping inbox:" +
    "\n\n    GS-Ping: " +
    ping.when +
    "\n\nThen push the commit.";
  if (projectId) {
    return (
      intro +
      "This session is open in the " +
      projectId +
      " repo — the project this task is for. Handle it here: make the " +
      "change, commit it, push, and report what shipped. If the task " +
      "turns out not to belong to this project after all, say so rather " +
      "than forcing it — and skip the trailer if you did not do the work." +
      trailer
    );
  }
  return (
    intro +
    "Handle it. If it belongs to a specific fleet project, work in that " +
    "project's repo — open a child session there if that is cleaner. " +
    "Otherwise handle it directly. Commit, push, and report what shipped." +
    trailer
  );
}

// gsd-040 — the seed prompt an "Assess" click hands the spawned session:
// an assessment-only framing, and no GS-Ping trailer — Assess commits
// nothing, so there is nothing to reconcile back to the inbox.
function assessPrompt(ping, projectId) {
  const intro =
    "This is an assessment pass — make no changes and do not commit.\n\n" +
    "A task came in via the GeneralStaff pings inbox (" +
    ping.when +
    ", " +
    ping.actor +
    "):\n\n" +
    ping.body +
    "\n\n";
  const ask =
    "Read the git log and the current state of the relevant project. " +
    "Tell me plainly: is this task still real and needed, already done, " +
    "obsolete, or in need of rescoping? If it is real, what would it " +
    "actually take to do? Give a one-paragraph verdict with a short " +
    "rationale — and change nothing.";
  if (projectId) {
    return (
      intro +
      "This session is open in the " +
      projectId +
      " repo — the project this task looks to be for. " +
      ask
    );
  }
  return (
    intro +
    "If this belongs to a specific fleet project, assess it against " +
    "that project's repo and state. " +
    ask
  );
}

// Today's date as YYYY-MM-DD (local) — stamped into a resolved block.
function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

// Now as "YYYY-MM-DD HH:MM" (local) — the heading stamp for a new ping.
function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    p(d.getMonth() + 1) +
    "-" +
    p(d.getDate()) +
    " " +
    p(d.getHours()) +
    ":" +
    p(d.getMinutes())
  );
}

// Resolve a ping from the desktop — closes it in the GS inbox itself, so
// it drops off the daily brief too, not just this panel.
async function resolvePing(ping) {
  const msg = document.getElementById("pings-msg");
  if (msg) msg.textContent = "Resolving…";
  try {
    await invoke("resolve_ping", {
      when: ping.when,
      actor: ping.actor,
      body: ping.body,
      date: todayIso(),
    });
    if (msg) msg.textContent = "";
    // The state/ file-watcher fires fleet-updated -> reload(), which
    // re-renders the panel with scroll preserved (gsd-025). No explicit
    // loadPings() here — that was the redundant double-render.
  } catch (e) {
    if (msg) msg.textContent = "Could not resolve: " + e;
  }
}

// Dispatch a task ping: spawn a claude session in the target chosen in the
// ping row's select — a project's own repo, or generalstaff-private (the
// fallback for cross-project / GS-state pings, and when a chosen project
// has no resolved repo).
function dispatchPing(btn, ping) {
  const row = btn.closest(".ping");
  const sel = row ? row.querySelector(".ping-target") : null;
  const target = sel ? sel.value : GS_PRIVATE_TARGET;
  let cwd = snapshot.generalstaff_path;
  let projectId = null;
  if (target && target !== GS_PRIVATE_TARGET) {
    const proj = (snapshot.projects || []).find((p) => p.id === target);
    if (proj && proj.repo_path) {
      cwd = proj.repo_path;
      projectId = proj.id;
    }
  }
  startSession(
    "claude",
    cwd,
    dispatchPrompt(ping, projectId),
    document.getElementById("pings-msg")
  );
}

// gsd-040 — assess a task ping: the same target resolution as
// dispatchPing, but the spawned session gets an assessment-only prompt
// and changes nothing.
function assessPing(btn, ping) {
  const row = btn.closest(".ping");
  const sel = row ? row.querySelector(".ping-target") : null;
  const target = sel ? sel.value : GS_PRIVATE_TARGET;
  let cwd = snapshot.generalstaff_path;
  let projectId = null;
  if (target && target !== GS_PRIVATE_TARGET) {
    const proj = (snapshot.projects || []).find((p) => p.id === target);
    if (proj && proj.repo_path) {
      cwd = proj.repo_path;
      projectId = proj.id;
    }
  }
  startSession(
    "claude",
    cwd,
    assessPrompt(ping, projectId),
    document.getElementById("pings-msg")
  );
}

// Pings — the open GS inbox. loadPings fetches; renderPingRows filters
// by the toolbar's kind chip + search box and draws the rows. Fetch and
// render are split so a file-watcher refresh keeps the current search.
let pingsCache = [];
let pingFilter = "all";
let pingSearch = "";

async function loadPings() {
  let pl;
  try {
    pl = await invoke("read_pings");
  } catch (e) {
    pl = { ok: false, pings: [] };
  }
  pingsCache = pl.ok && pl.pings ? pl.pings : [];
  renderPingRows();
}

function renderPingRows() {
  const el = document.getElementById("pings-list");
  if (!el) return;
  const q = pingSearch.trim().toLowerCase();
  const shown = pingsCache.filter((p) => {
    if (pingFilter !== "all" && p.kind !== pingFilter) return false;
    if (q && !String(p.body || "").toLowerCase().includes(q)) return false;
    return true;
  });

  const countEl = document.getElementById("pings-count");
  if (countEl) {
    countEl.textContent =
      shown.length === pingsCache.length
        ? pingsCache.length + " items"
        : shown.length + " of " + pingsCache.length;
  }

  if (!shown.length) {
    el.className = "muted";
    el.innerHTML = pingsCache.length
      ? "<p>No pings match.</p>"
      : "<p>No open pings.</p>";
    consumePingScroll();
    return;
  }
  el.className = "";

  el.innerHTML = shown
    .map((p, i) => {
      const snip = escapeHtml(pingSnippet(p.body));
      const kindCls =
        p.kind === "idea"
          ? " kind-idea"
          : p.kind === "task"
            ? " kind-task"
            : "";
      let actions = "";
      if (p.kind === "idea") {
        actions =
          '<button class="ping__act act-scaffold" data-act="scaffold" data-i="' +
          i +
          '">Scaffold</button>';
      } else if (p.kind === "task") {
        actions =
          targetSelectHtml(detectPingProject(p.body)) +
          '<button class="ping__act act-assess" data-act="assess" data-i="' +
          i +
          '">Assess</button>' +
          '<button class="ping__act act-dispatch" data-act="dispatch" data-i="' +
          i +
          '">Dispatch</button>';
      }
      actions +=
        '<button class="ping__act" data-act="resolve" data-i="' +
        i +
        '">Resolve</button>';
      return (
        '<div class="ping">' +
        '<div class="ping__meta">' +
        '<span class="ping__when">' +
        escapeHtml(p.when) +
        "</span>" +
        '<span class="ping__kind' +
        kindCls +
        '">' +
        escapeHtml(p.kind) +
        "</span></div>" +
        '<div class="ping__body"><div class="ping__text" title="' +
        snip +
        '">' +
        snip +
        "</div></div>" +
        '<div class="ping__actions">' +
        actions +
        "</div></div>"
      );
    })
    .join("");

  for (const btn of el.querySelectorAll(".ping__act")) {
    const ping = shown[Number(btn.dataset.i)];
    if (!ping) continue;
    const act = btn.dataset.act;
    if (act === "scaffold") {
      btn.addEventListener("click", () =>
        startSession(
          "claude",
          snapshot.generalstaff_path,
          scaffoldPrompt(ping),
          document.getElementById("pings-msg")
        )
      );
    } else if (act === "dispatch") {
      btn.addEventListener("click", () => dispatchPing(btn, ping));
    } else if (act === "assess") {
      btn.addEventListener("click", () => assessPing(btn, ping));
    } else {
      btn.addEventListener("click", () => resolvePing(ping));
    }
  }

  // gsd-030 — clicking a ping row (anywhere but its action buttons)
  // opens the full inbox text in a modal; the row truncates it.
  el.querySelectorAll(".ping").forEach((row, i) => {
    const ping = shown[i];
    if (!ping) return;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".ping__actions")) return;
      openPingModal(ping);
    });
  });

  // gsd-025 — restore the pings panel scroll after this async re-render.
  consumePingScroll();
  // gsd-027 — flag open pings whose project has shipped activity.
  decoratePingHints(shown);
}

// gsd-025 — restore the pings panel body's scroll after a re-render and
// clear the one-shot capture. The body fills in async (loadPings), so
// this runs at the tail of renderPingRows, not right after showBriefing.
function consumePingScroll() {
  if (!scrollToRestore) return;
  const pb = fleetView.querySelector(".dash__pings .panel__body");
  if (pb) pb.scrollTop = scrollToRestore.pings || 0;
  scrollToRestore = null;
}

// gsd-026 — the inbox classifies a ping from its first word, so the kind
// dropdown is honoured by prefixing the body when it doesn't already
// read as that kind. "other" gets no prefix.
function composePingBody(kind, text) {
  const t = text.trim();
  const low = t.toLowerCase();
  if (kind === "task" && !/^(task|feature|consider|possible task)/.test(low)) {
    return "Task: " + t;
  }
  if (
    kind === "idea" &&
    !/^(idea|possible project|wild idea|project idea|new project)/.test(low)
  ) {
    return "Idea: " + t;
  }
  return t;
}

// gsd-026 — add a ping to the GS inbox from the dashboard. Appends a
// block to state/pings/inbox.md; the file-watcher then refreshes the
// panel. Sits alongside mission-companion's GS mode, not replacing it.
async function addPing() {
  const input = document.getElementById("ping-compose-text");
  const kindSel = document.getElementById("ping-compose-kind");
  const msg = document.getElementById("pings-msg");
  if (!input) return;
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  const body = composePingBody(kindSel ? kindSel.value : "task", text);
  if (msg) msg.textContent = "Adding ping…";
  try {
    await invoke("append_ping", { when: nowStamp(), actor: "ray", body });
    input.value = "";
    if (msg) msg.textContent = "";
    // The file-watcher fires fleet-updated -> reload(); the new ping
    // shows up on its own.
  } catch (e) {
    if (msg) msg.textContent = "Could not add ping: " + e;
  }
}

// gsd-027 — the non-destructive "possibly resolved" hint. For each open
// task ping, ask the backend whether the project it names carries the
// explicit GS-Ping commit trailer for that ping. A flagged ping gets a
// marker — a cue to run Reconcile, never an action.
async function decoratePingHints(shown) {
  const probes = [];
  for (const p of shown) {
    if (p.kind !== "task") continue;
    const det = detectPingProject(p.body);
    if (!det) continue;
    const proj = (snapshot.projects || []).find((x) => x.id === det);
    if (proj && proj.repo_path) {
      probes.push({ when: p.when, repo: proj.repo_path });
    }
  }
  if (!probes.length) return;
  let flagged = [];
  try {
    flagged = await invoke("ping_hints", { probes });
  } catch (e) {
    return;
  }
  const set = new Set(flagged);
  const el = document.getElementById("pings-list");
  if (!el) return;
  const rows = el.querySelectorAll(".ping");
  shown.forEach((p, i) => {
    if (!set.has(p.when)) return;
    const meta = rows[i] && rows[i].querySelector(".ping__meta");
    if (!meta || meta.querySelector(".ping__hint")) return;
    const hint = document.createElement("span");
    hint.className = "ping__hint";
    hint.textContent = "may be done";
    hint.title =
      "A commit in this ping's project carries a GS-Ping marker for it — " +
      "the dispatched work shipped. Use Reconcile state to close the ping.";
    meta.appendChild(hint);
  });
}

// ---------------------------------------------------------------------
// Recent activity — session notes + git history
// ---------------------------------------------------------------------

// Load the Recent-activity panel: collapsible recent session notes and
// the recent generalstaff-private commit log.
async function loadRecentActivity() {
  let notes = [];
  try {
    notes = await invoke("recent_session_notes");
  } catch (e) {
    notes = [];
  }
  const nEl = document.getElementById("recent-notes");
  if (nEl) {
    nEl.className = "";
    nEl.innerHTML = notes.length
      ? notes
          .map((n) => {
            const d = /^\d{4}-\d{2}-\d{2}/.test(n.file)
              ? n.file.slice(5, 10)
              : "";
            return (
              '<details class="recent__row"><summary>' +
              '<span class="recent__date">' +
              escapeHtml(d) +
              '</span><div class="recent__title">' +
              escapeHtml(n.title) +
              "</div></summary>" +
              '<pre class="recent__body">' +
              escapeHtml(n.body) +
              "</pre></details>"
            );
          })
          .join("")
      : '<p class="muted">No session notes.</p>';
  }

  let commits = [];
  try {
    commits = await invoke("recent_commits");
  } catch (e) {
    commits = [];
  }
  const cEl = document.getElementById("recent-commits");
  if (cEl) {
    cEl.innerHTML = commits.length
      ? '<div class="recent__sub">generalstaff-private &mdash; commits</div>' +
        commits
          .map(
            (c) =>
              '<div class="recent__commit">' +
              '<span class="recent__date">' +
              escapeHtml(c.date && c.date.length >= 10 ? c.date.slice(5) : c.date) +
              '</span><span class="recent__csub">' +
              escapeHtml(c.subject) +
              "</span></div>"
          )
          .join("")
      : "";
  }
}

// gsd-024 — open a session that drafts the next session note from the git
// history since the last one. The session does the synthesis; it commits
// a draft but does NOT push — Ray reviews the note and pushes it himself.
async function generateSessionNote() {
  const msg = document.getElementById("gen-note-msg");
  if (msg) msg.textContent = "Opening a session to draft the note…";
  let notes = [];
  try {
    notes = await invoke("recent_session_notes");
  } catch (e) {
    notes = [];
  }
  const last = notes && notes.length ? notes[0] : null;
  const lastFile = last && last.file ? last.file : null;
  const lastDate =
    lastFile && /^\d{4}-\d{2}-\d{2}/.test(lastFile)
      ? lastFile.slice(0, 10)
      : null;
  const today = todayIso();
  const since = lastDate
    ? "since the last session note (" + lastFile + ", dated " + lastDate + ")"
    : "covering the last few days of work";
  const prompt =
    "Write the next GeneralStaff session note. Cover the work " +
    since +
    ". Today is " +
    today +
    ".\n\n" +
    "1. Gather the git history: run `git log` in generalstaff-private" +
    (lastDate ? " since " + lastDate : " for the last few days") +
    ", and check the sibling project repos under the parent directory for " +
    "commits in the same window (mission-companion, generalstaff-desktop, " +
    "and any others that changed).\n" +
    "2. Read the two or three most recent notes in docs/sessions/ to match " +
    "their format, section structure, and register.\n" +
    "3. Write a new note at docs/sessions/" +
    today +
    "-<short-slug>.md — factual, grounded in the actual commits and project " +
    "state, not invented.\n" +
    "4. Commit it to generalstaff-private. Do NOT push — leave the commit " +
    "local so Ray can review the note and push it himself.";
  startSession("claude", snapshot.generalstaff_path, prompt, msg);
}

// gsd-027 — the decoupled state-reconciliation pass. Spawns a claude
// session in generalstaff-private seeded to check the open pings AND
// every project's task ledger against what has shipped in the project
// repos, and propose closures in a reviewable draft commit — no push,
// Ray reviews. Kept separate from the session-note generator per the
// Hammerstein audit: coupling reconciliation to note-writing enlarges
// the review draft and skips reconciliation whenever a note is skipped.
//
// gsd-042 — the original 2026-05-19 prompt only walked pings, with
// tasks.json as corroborating evidence for ping closures. Work that
// shipped through a regular CC session (no ping, no GS-Ping trailer)
// went uncaught — e.g. asciigpt asci-003 stayed pending after commit
// 1738cc1 explicitly named it. The pass now walks both directions:
// pings → shipped AND tasks → shipped.
function reconcileState() {
  const msg = document.getElementById("gen-note-msg");
  if (msg) msg.textContent = "Opening a session to reconcile state…";
  const prompt =
    "Reconcile the GeneralStaff ping inbox AND every project's task " +
    "ledger against what has actually shipped. Work in generalstaff-" +
    "private. Two passes, both required.\n\n" +
    "=== Pass 1 — pings inbox ===\n" +
    "1. Read state/pings/inbox.md — the open pings are the dated blocks " +
    "with no `## resolved` block immediately after them.\n" +
    "2. For each open ping, identify the project it concerns and look in " +
    "that project's repo (a sibling directory of generalstaff-private) " +
    "for evidence the work shipped: a commit whose message carries a " +
    "`GS-Ping: <timestamp>` trailer matching the ping is an explicit " +
    "signal; a matching task-ledger entry marked done, or a version " +
    "bump, is corroborating evidence.\n" +
    "3. Where the evidence is explicit and unambiguous, resolve the ping " +
    "— append a `## resolved " +
    todayIso() +
    "` block saying what shipped (commit refs, version).\n\n" +
    "=== Pass 2 — project task ledgers ===\n" +
    "4. For every project listed in projects.yaml (and any state/<id>/ " +
    "directory that carries a tasks.json), read the ledger and pick out " +
    "every entry whose status is `pending` or `in_progress`.\n" +
    "5. For each such entry, run `git log --oneline --all` in the " +
    "project's repo (a sibling directory of generalstaff-private) and " +
    "look for shipped evidence:\n" +
    "   - A commit whose message carries a `GS-Task: <task-id>` trailer " +
    "(explicit signal, post-gsd-039).\n" +
    "   - A commit subject or body that mentions the task id as a whole " +
    "token, e.g. `(asci-003)`, `closes asci-003`, `asci-003 —`, etc.\n" +
    "   - A commit that visibly implements the task title, plus a " +
    "version bump or done-note elsewhere that corroborates it.\n" +
    "6. Where the evidence is explicit and unambiguous, flip the entry " +
    "to `status: \"done\"` (or update an `in_progress` entry's status as " +
    "appropriate), set `done_at` to the commit's date (or today if " +
    "ambiguous), and add a short `done_note` quoting the commit SHA and " +
    "subject.\n\n" +
    "=== Both passes ===\n" +
    "7. Be conservative — only close a ping or task on clear evidence. " +
    "If status is ambiguous, leave it open and note it for Ray.\n" +
    "8. Commit the changes to generalstaff-private with a clear message. " +
    "Do NOT push — leave the commit local so Ray can review the " +
    "reconciliation and push it himself.\n" +
    "9. End with a short summary in two sections: pings " +
    "(resolved / left open) and tasks (closed / left open), each with " +
    "one-line why.";
  startSession("claude", snapshot.generalstaff_path, prompt, msg);
}

// ---------------------------------------------------------------------
// Agent usage — Claude Code token volume (gsd-028)
// ---------------------------------------------------------------------

// Aggregating the local ~/.claude transcripts is a ~1s parse, so the
// result is cached and recomputed only when stale — a fleet-updated
// re-render draws from the cache instead of re-parsing.
let agentUsageCache = null;
let agentUsageAt = 0;
const AGENT_USAGE_TTL = 5 * 60 * 1000;

async function loadAgentUsage() {
  const fresh =
    agentUsageCache && Date.now() - agentUsageAt < AGENT_USAGE_TTL;
  if (!fresh) {
    try {
      agentUsageCache = await invoke("agent_usage");
      agentUsageAt = Date.now();
    } catch (e) {
      agentUsageCache = null;
    }
  }
  renderAgentUsage();
}

// Compact count — 1234567 -> "1.2M", 8400 -> "8.4k".
function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
  return String(n);
}

function renderAgentUsage() {
  const el = document.getElementById("usage-body");
  if (!el) return;
  const u = agentUsageCache;
  if (!u || !u.cc_ok) {
    el.className = "muted";
    el.innerHTML = "<p>Claude Code transcripts not found.</p>";
    return;
  }
  el.className = "usage";
  const cell = (num, label) =>
    '<div class="usage__cell"><div class="usage__num">' +
    escapeHtml(String(num)) +
    '</div><div class="usage__label">' +
    label +
    "</div></div>";
  el.innerHTML =
    cell(fmtCount(u.cc_tokens_24h), "tokens 24h") +
    cell(fmtCount(u.cc_tokens_7d), "tokens 7d") +
    cell(u.cc_sessions_7d, "sessions 7d");
}

// ---------------------------------------------------------------------
// Reload + init
// ---------------------------------------------------------------------

async function reload() {
  // gsd-025 — capture fleet scroll before the rebuild so a ping resolve
  // (or any fleet-updated event) doesn't snap the dashboard to the top.
  if (activeTabId === "fleet" && !selectedId) {
    const pb = fleetView.querySelector(".dash__pings .panel__body");
    scrollToRestore = {
      view: fleetView.scrollTop,
      pings: pb ? pb.scrollTop : 0,
    };
  }
  try {
    snapshot = await invoke("read_fleet");
  } catch (e) {
    snapshot = { ok: false, message: String(e), projects: [] };
  }
  renderRail();
  if (
    selectedId &&
    snapshot.ok &&
    snapshot.projects.some((p) => p.id === selectedId)
  ) {
    selectProject(selectedId);
  } else {
    showBriefing();
  }
}

initTheme();
initModal();

railHead.setAttribute("role", "button");
railHead.setAttribute("tabindex", "0");
railHead.addEventListener("click", openFleetBriefing);
railHead.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openFleetBriefing();
  }
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab && tab.kind === "session") fitSession(tab.sessionId);
  }, 120);
});

// Mark a session "idle" once its output has been quiet a while — a
// rough "may want you" badge. Lifecycle + output timing only; the
// terminal stream is never parsed. The badge flips at IDLE_AFTER_MS; a
// notification waits the longer NOTIFY_IDLE_AFTER_MS, so a session that
// is merely mid-thought is far less likely to be flagged as wanting you.
const IDLE_AFTER_MS = 10000;
const NOTIFY_IDLE_AFTER_MS = 60000;
setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.status === "exited") continue;
    const quiet = now - (s.lastOutputAt || 0);
    const next = quiet > IDLE_AFTER_MS ? "idle" : "running";
    if (s.status !== next) {
      s.status = next;
      changed = true;
    }
    // gsd-031 — a session quiet long enough to be genuinely awaiting
    // input, on a tab you are not watching, earns one notification per
    // idle stretch (re-armed when fresh output arrives).
    if (
      quiet > NOTIFY_IDLE_AFTER_MS &&
      !s.idleNotified &&
      !isActiveSession(id)
    ) {
      s.idleNotified = true;
      notifyDesktop("Session may want you", sessionLabel(s.info));
    }
  }
  if (changed) renderTabbar();
}, 3000);

listen("fleet-updated", reload);
renderTabbar();
reload();
restoreLayout();
