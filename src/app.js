// GeneralStaff Desktop — v0.0.1 shell (gsd-001).
// Placeholder fleet data + view-swapping. gsd-002 wires real GS state.
"use strict";

// Placeholder fleet — real project names, varied statuses, so the shell
// is legible at review. gsd-002 replaces this with live GeneralStaff state.
const FLEET = [
  { id: "generalstaff",         status: "idle" },
  { id: "twar-pc",              status: "running" },
  { id: "catalogdna",           status: "attention" },
  { id: "retrogaze",            status: "idle" },
  { id: "kreuzfeuer",           status: "idle" },
  { id: "veridian-contraption", status: "failed" },
  { id: "hammerstein-ai",       status: "idle" },
  { id: "mission-companion",    status: "running" },
];

const STATUS_LABEL = {
  idle: "idle",
  running: "cycle running",
  attention: "needs attention",
  failed: "last cycle failed",
};

const fleetList = document.getElementById("fleet-list");
const content = document.getElementById("content");
const contextTitle = document.getElementById("context-title");
const contextSub = document.getElementById("context-sub");
const railHead = document.getElementById("rail-head");

let selectedId = null;

function renderFleet() {
  fleetList.innerHTML = "";
  for (const proj of FLEET) {
    const row = document.createElement("div");
    row.className = "fleet-row";
    row.dataset.id = proj.id;
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.title = STATUS_LABEL[proj.status] || proj.status;

    const dot = document.createElement("span");
    dot.className = "dot dot-" + proj.status;

    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = proj.id;

    row.append(dot, name);
    row.addEventListener("click", () => selectProject(proj.id));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectProject(proj.id);
      }
    });
    fleetList.appendChild(row);
  }
}

function markSelected() {
  for (const row of fleetList.children) {
    row.classList.toggle("selected", row.dataset.id === selectedId);
  }
}

function showBriefing() {
  selectedId = null;
  markSelected();
  contextTitle.textContent = "Fleet briefing";
  contextSub.textContent = FLEET.length + " projects · scaffold v0.0.1";
  content.innerHTML = `
    <div class="panel">
      <h2>Fleet briefing</h2>
      <p>The command-center briefing renders here — Situation,
      Attention, the fleet grid, Actions, Usage. v0.0.1 embeds the
      existing <code>gs serve</code> dashboard in this panel, with a
      health-check fallback so the view never goes blank.</p>
      <span class="tag">gsd-003</span>
    </div>
    <div class="panel">
      <h2>Fleet state</h2>
      <p>The rail at left lists every project with a live status dot,
      read from GeneralStaff's file-based state through a file-watcher.
      Until then the rows are placeholders.</p>
      <span class="tag">gsd-002</span>
    </div>`;
}

function selectProject(id) {
  selectedId = id;
  markSelected();
  contextTitle.textContent = id;
  contextSub.textContent = "project workbench";
  content.innerHTML = `
    <div class="panel">
      <h2>Files</h2>
      <p>A git-aware file tree and a read-only, syntax-highlighted file
      viewer for <strong>${id}</strong> land here — for seeing what
      the project and its cycles look like at a glance.</p>
      <span class="tag">gsd-004</span>
    </div>
    <div class="panel">
      <h2>Cycle history</h2>
      <p>Every bot cycle for <strong>${id}</strong> — outcome, task,
      duration — read from its <code>PROGRESS.jsonl</code>.</p>
      <span class="tag">gsd-005</span>
    </div>`;
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

renderFleet();
showBriefing();
