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
const footDot = document.getElementById("fleet-status-dot");
const footText = document.getElementById("fleet-status-text");

let snapshot = { ok: false, projects: [] };
let selectedId = null; // selected project in the Fleet view
let currentRepoPath = null; // code-repo path of the selected project

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
// Tab bar
// ---------------------------------------------------------------------

function renderTabbar() {
  tabbar.innerHTML = "";
  for (const tab of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === activeTabId ? " tab-active" : "");

    if (tab.kind === "session") {
      const s = sessions.get(tab.sessionId);
      const dot = document.createElement("span");
      dot.className =
        "tab-dot " + (s && s.status === "running" ? "dot-running" : "dot-idle");
      el.appendChild(dot);
    }

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.label;
    el.appendChild(label);

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
  if (activeTabId === id) activateTab("fleet");
  else renderTabbar();
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
  });

  tabs.push({
    id: "se:" + info.id,
    kind: "session",
    label: sessionLabel(info),
    sessionId: info.id,
  });
  activateTab("se:" + info.id);
}

async function startSession(agent, cwd, prompt, msgEl) {
  if (!cwd) {
    if (msgEl) msgEl.textContent = "No code repo for this project.";
    return;
  }
  if (msgEl) msgEl.textContent = "Starting " + agent + "…";
  let info;
  try {
    info = await invoke("spawn_session", {
      agent,
      cwd,
      prompt: prompt || null,
      mode: "interactive",
    });
  } catch (e) {
    if (msgEl) msgEl.textContent = "Could not start session: " + e;
    return;
  }
  if (msgEl) msgEl.textContent = "";
  openSessionTab(info);
}

listen("pty-output", (e) => {
  const s = sessions.get(e.payload.id);
  if (s) s.term.write(base64ToBytes(e.payload.data));
});

listen("pty-exit", (e) => {
  const s = sessions.get(e.payload.id);
  if (s) {
    s.status = "exited";
    s.term.write("\r\n\x1b[2m— session ended —\x1b[0m\r\n");
    renderTabbar();
  }
});

// ---------------------------------------------------------------------
// Fleet rail
// ---------------------------------------------------------------------

function markSelected() {
  for (const row of fleetList.querySelectorAll(".fleet-row")) {
    row.classList.toggle("selected", row.dataset.id === selectedId);
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
  row.className = "fleet-row";
  if (isParked(proj)) row.classList.add("parked");
  row.dataset.id = proj.id;
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.title =
    (STATUS_LABEL[proj.status] || proj.status) +
    (proj.pending ? " - " + proj.pending + " pending" : "");

  const dot = document.createElement("span");
  dot.className = "dot dot-" + proj.status;
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = proj.id;

  row.append(dot, name);
  if (proj.pending) {
    const count = document.createElement("span");
    count.className = "row-count";
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
    footDot.className = "dot dot-failed";
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
  footDot.className = "dot dot-idle";
  footText.textContent =
    activeProjs.length +
    " active" +
    (withWork ? " / " + withWork + " with open work" : "") +
    (parkedProjs.length ? " / " + parkedProjs.length + " parked" : "");
}

// ---------------------------------------------------------------------
// Fleet view — briefing
// ---------------------------------------------------------------------

function headHtml(title, sub) {
  return (
    '<div class="fleet-head"><h1>' +
    escapeHtml(title) +
    "</h1>" +
    (sub ? '<div class="sub">' + escapeHtml(sub) + "</div>" : "") +
    "</div>"
  );
}

function showBriefing() {
  selectedId = null;
  currentRepoPath = null;
  markSelected();

  if (!snapshot.ok) {
    fleetView.innerHTML =
      headHtml("Fleet briefing", "") +
      '<div class="panel"><h2>GeneralStaff not found</h2><p>' +
      escapeHtml(
        snapshot.message || "Could not locate the generalstaff-private state."
      ) +
      " Set <code>generalstaff_path</code> in " +
      "<code>~/.generalstaff-desktop/config.json</code> to point at your " +
      "generalstaff-private repo.</p></div>";
    return;
  }

  const activeProjs = snapshot.projects.filter((p) => !isParked(p));
  const parkedCount = snapshot.projects.length - activeProjs.length;
  const active = activeProjs.filter((p) => p.status === "active").length;
  const pending = activeProjs.reduce((n, p) => n + p.pending, 0);
  const waiting = activeProjs.reduce((n, p) => n + p.interactive_pending, 0);
  const sub =
    activeProjs.length +
    " active projects" +
    (parkedCount ? " / " + parkedCount + " parked" : "");

  const stat = (num, label) =>
    '<div class="stat"><span class="stat-num">' +
    num +
    '</span><span class="stat-label">' +
    label +
    "</span></div>";
  const situation =
    '<div class="panel"><h2>Situation</h2><div class="stat-row">' +
    stat(activeProjs.length, "projects") +
    stat(active, "with open work") +
    stat(pending, "pending tasks") +
    stat(waiting, "waiting on you") +
    "</div></div>";

  const ranked = activeProjs
    .filter((p) => p.interactive_pending > 0)
    .sort((a, b) => b.interactive_pending - a.interactive_pending)
    .slice(0, 10);
  let rows = ranked
    .map((p) => {
      const score =
        p.viability_sum === null || p.viability_sum === undefined
          ? '<span class="attn-score none">unscored</span>'
          : '<span class="attn-score' +
            (p.viability_sum <= 3 ? " low" : "") +
            '">viability ' +
            p.viability_sum +
            "</span>";
      return (
        '<div class="attn-row" data-id="' +
        escapeHtml(p.id) +
        '" role="button" tabindex="0">' +
        '<span class="attn-name">' +
        escapeHtml(p.id) +
        "</span>" +
        '<span class="attn-wait">' +
        p.interactive_pending +
        " waiting</span>" +
        score +
        "</div>"
      );
    })
    .join("");
  if (!rows) rows = '<p class="muted">Nothing waiting on you.</p>';
  const attention =
    '<div class="panel"><h2>Attention &mdash; where your review time goes</h2>' +
    '<p class="panel-note">Ranked by tasks waiting on you, against each ' +
    "project's viability score (financial + reputation + lifestyle, " +
    "0&ndash;11). A high wait count next to a low score is a triage " +
    "candidate.</p>" +
    '<div class="attn-list">' +
    rows +
    "</div></div>";

  fleetView.innerHTML = headHtml("Fleet briefing", sub) + situation + attention;

  for (const row of fleetView.querySelectorAll(".attn-row")) {
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
    headHtml(id, sub) +
    `
    <div class="panel">
      <h2>Session</h2>
      <p class="panel-note">Start an interactive agent session in this
        project's repo. It opens in its own tab.</p>
      <div class="spawn-row">
        <select id="spawn-agent">
          <option value="claude">Claude Code</option>
          <option value="cursor-agent">Cursor</option>
        </select>
        <input id="spawn-prompt" type="text" placeholder="optional seed prompt" />
        <button id="spawn-go" disabled>Start session here</button>
      </div>
      <div id="spawn-msg" class="spawn-msg">Locating code repo&hellip;</div>
    </div>
    <div class="panel">
      <h2>Files</h2>
      <div id="file-tree" class="file-tree muted">Loading file tree...</div>
    </div>
    <div class="panel" id="viewer-panel" hidden>
      <h2 id="viewer-name">&mdash;</h2>
      <pre id="viewer-body" class="viewer-body"></pre>
    </div>
    <div class="panel">
      <h2>Task ledger</h2>
      <div id="task-ledger" class="task-ledger muted">Loading task ledger...</div>
    </div>`;

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
}

// ---------------------------------------------------------------------
// Reload + init
// ---------------------------------------------------------------------

async function reload() {
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

listen("fleet-updated", reload);
renderTabbar();
reload();
