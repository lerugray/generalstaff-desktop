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

  content.innerHTML = `
    <div class="panel">
      <h2>Portfolio</h2>
      <p>${projs.length} projects · ${active} with open work ·
      ${pending} pending tasks, ${waiting} of them waiting on you.
      The rail at left lists every project — pick one to drill in.</p>
    </div>
    <div class="panel">
      <h2>Fleet briefing</h2>
      <p>The command-center briefing — Situation, Attention, Actions,
      Usage — renders here.</p>
      <span class="tag">gsd-003</span>
    </div>`;
}

function selectProject(id) {
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
    contextSub.textContent = bits.join(" · ");
  } else {
    contextSub.textContent = "project workbench";
  }

  content.innerHTML = `
    <div class="panel">
      <h2>Files</h2>
      <p>A git-aware file tree and a read-only file viewer for
      <strong>${id}</strong> land here.</p>
      <span class="tag">gsd-004</span>
    </div>
    <div class="panel">
      <h2>Task ledger</h2>
      <p>The full task list for <strong>${id}</strong> — pending and
      done — from its <code>tasks.json</code>.</p>
      <span class="tag">gsd-005</span>
    </div>`;
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
