// GeneralStaff Desktop — the shell. gsd-002: live project portfolio.
// Reads generalstaff-private's project state through the Rust backend and
// re-renders whenever a file-watcher reports a change.
"use strict";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const STATUS_LABEL = {
  active: "open work",
  clear: "clear",
};

const fleetList = document.getElementById("fleet-list");
const content = document.getElementById("content");
const contextTitle = document.getElementById("context-title");
const contextSub = document.getElementById("context-sub");
const railHead = document.getElementById("rail-head");
const footDot = document.getElementById("fleet-status-dot");
const footText = document.getElementById("fleet-status-text");

let snapshot = { ok: false, projects: [] };
let selectedId = null;

function markSelected() {
  for (const row of fleetList.children) {
    row.classList.toggle("selected", row.dataset.id === selectedId);
  }
}

function renderRail() {
  fleetList.innerHTML = "";

  if (!snapshot.ok) {
    footDot.className = "dot dot-failed";
    footText.textContent = "GeneralStaff not found";
    return;
  }

  for (const proj of snapshot.projects) {
    const row = document.createElement("div");
    row.className = "fleet-row";
    row.dataset.id = proj.id;
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.title =
      (STATUS_LABEL[proj.status] || proj.status) +
      (proj.pending ? " — " + proj.pending + " pending" : "");

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

    row.addEventListener("click", () => selectProject(proj.id));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectProject(proj.id);
      }
    });
    fleetList.appendChild(row);
  }
  markSelected();

  const active = snapshot.projects.filter((p) => p.status === "active").length;
  footDot.className = "dot dot-idle";
  footText.textContent =
    snapshot.projects.length +
    " projects" +
    (active ? " · " + active + " with open work" : "");
}

function showBriefing() {
  selectedId = null;
  markSelected();
  contextTitle.textContent = "Fleet briefing";

  if (!snapshot.ok) {
    contextSub.textContent = "";
    content.innerHTML =
      '<div class="panel"><h2>GeneralStaff not found</h2><p>' +
      (snapshot.message || "Could not locate the generalstaff-private state.") +
      " Set <code>generalstaff_path</code> in " +
      "<code>~/.generalstaff-desktop/config.json</code> to point at your " +
      "generalstaff-private repo.</p></div>";
    return;
  }

  const projs = snapshot.projects;
  const active = projs.filter((p) => p.status === "active").length;
  const pending = projs.reduce((n, p) => n + p.pending, 0);
  const waiting = projs.reduce((n, p) => n + p.interactive_pending, 0);
  contextSub.textContent = projs.length + " projects in the portfolio";

  // Situation — the portfolio at a glance.
  const stat = (num, label) =>
    '<div class="stat"><span class="stat-num">' + num + "</span>" +
    '<span class="stat-label">' + label + "</span></div>";
  const situation =
    '<div class="panel"><h2>Situation</h2><div class="stat-row">' +
    stat(projs.length, "projects") +
    stat(active, "with open work") +
    stat(pending, "pending tasks") +
    stat(waiting, "waiting on you") +
    "</div></div>";

  // Attention — where review time goes, against what each project is worth.
  const ranked = projs
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
            '">viability ' + p.viability_sum + "</span>";
      return (
        '<div class="attn-row" data-id="' + p.id +
        '" role="button" tabindex="0">' +
        '<span class="attn-name">' + p.id + "</span>" +
        '<span class="attn-wait">' + p.interactive_pending + " waiting</span>" +
        score + "</div>"
      );
    })
    .join("");
  if (!rows) rows = '<p class="muted">Nothing waiting on you.</p>';
  const attention =
    '<div class="panel"><h2>Attention — where your review time goes</h2>' +
    '<p class="panel-note">Ranked by tasks waiting on you, against each ' +
    "project's viability score (financial + reputation + lifestyle, 0–11). " +
    "A high wait count next to a low score is a triage candidate.</p>" +
    '<div class="attn-list">' + rows + "</div></div>";

  content.innerHTML = situation + attention;

  for (const row of content.querySelectorAll(".attn-row")) {
    const id = row.dataset.id;
    row.addEventListener("click", () => selectProject(id));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectProject(id);
      }
    });
  }
}

async function selectProject(id) {
  selectedId = id;
  markSelected();

  const proj = snapshot.projects.find((p) => p.id === id);
  contextTitle.textContent = id;
  if (proj) {
    const bits = [STATUS_LABEL[proj.status] || proj.status];
    bits.push(proj.pending + " of " + proj.total + " tasks open");
    if (proj.interactive_pending) {
      bits.push(proj.interactive_pending + " waiting on you");
    }
    if (proj.category) bits.push(proj.category);
    if (proj.viability_sum !== null && proj.viability_sum !== undefined) {
      bits.push("viability " + proj.viability_sum);
    }
    contextSub.textContent = bits.join(" · ");
  } else {
    contextSub.textContent = "project workbench";
  }

  content.innerHTML = `
    <div class="panel">
      <h2>Files</h2>
      <div id="file-tree" class="file-tree muted">Loading file tree…</div>
    </div>
    <div class="panel" id="viewer-panel" hidden>
      <h2 id="viewer-name">—</h2>
      <pre id="viewer-body" class="viewer-body"></pre>
    </div>
    <div class="panel">
      <h2>Task ledger</h2>
      <div id="task-ledger" class="task-ledger muted">Loading task ledger…</div>
    </div>`;

  // Load the task ledger (state/<id>/tasks.json) alongside the file tree.
  loadTaskLedger(id);

  // Load the project's code-repo file tree (git ls-files).
  let fl;
  try {
    fl = await invoke("project_files", { id });
  } catch (e) {
    fl = { ok: false, message: String(e), files: [] };
  }
  const treeEl = document.getElementById("file-tree");
  if (!treeEl || selectedId !== id) return; // selection moved on while loading
  treeEl.className = "file-tree";
  if (!fl.ok) {
    treeEl.innerHTML = '<p class="muted">' + (fl.message || "No files.") + "</p>";
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

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  bodyEl.textContent = "Loading…";
  let fc;
  try {
    fc = await invoke("read_project_file", { id, rel });
  } catch (e) {
    fc = { ok: false, message: String(e) };
  }
  bodyEl.textContent = fc.ok
    ? fc.content
    : "— " + (fc.message || "could not read file");
}

// Load the project's task ledger into the workbench panel.
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
    el.innerHTML = '<p class="muted">' + (tl.message || "No tasks.") + "</p>";
    return;
  }
  // Pending first, then done; by priority within each.
  const rank = (t) => (t.status === "pending" ? 0 : 1);
  const sorted = tl.tasks
    .slice()
    .sort((a, b) => rank(a) - rank(b) || (a.priority || 9) - (b.priority || 9));
  if (!sorted.length) {
    el.innerHTML = '<p class="muted">No tasks.</p>';
    return;
  }
  el.innerHTML = sorted
    .map(
      (t) =>
        '<div class="task-row" title="' + escapeHtml(t.title) + '">' +
        '<span class="task-status task-' + escapeHtml(t.status) + '">' +
        escapeHtml(t.status) + "</span>" +
        '<span class="task-id">' + escapeHtml(t.id) + "</span>" +
        '<span class="task-title">' + escapeHtml(t.title) + "</span>" +
        (t.interactive_only
          ? '<span class="task-flag" title="waiting on you">●</span>'
          : "") +
        "</div>"
    )
    .join("");
}

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
railHead.addEventListener("click", showBriefing);
railHead.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    showBriefing();
  }
});

// Re-read whenever the file-watcher reports the portfolio changed.
listen("fleet-updated", reload);
reload();
