//! GeneralStaff Desktop — the command console for the GeneralStaff
//! dev-fleet orchestrator.
//!
//! A viewer/controller over GeneralStaff's file-based state: it reads
//! state to display it and never edits the structured state files
//! (`tasks.json`, `project-meta.yaml`) directly. Its writes are all to
//! the pings inbox (`state/pings/inbox.md`) — a shared append-only log
//! any actor may add to: resolving a ping appends a `## resolved` block,
//! and the dashboard's add-ping affordance appends a new ping block.
//! Both are the same kind of write the inbox is built for.
//!
//! The "fleet" is the project portfolio across two repos: most projects
//! keep their `tasks.json` / `MISSION.md` / `project-meta.yaml` in
//! `generalstaff-private/state/`, but a few public-state projects keep
//! theirs in the public GeneralStaff repo's `state/`. The desktop reads
//! both and merges them by project id.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;

mod sessions;
mod tray;

// ---------------------------------------------------------------------
// Locating GeneralStaff (the private working repo)
// ---------------------------------------------------------------------

pub(crate) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Resolve the generalstaff-private repo root — the private working repo
/// where the project portfolio lives. Honors `~/.generalstaff-desktop/
/// config.json` ({"generalstaff_path": "..."}), else falls back to the
/// conventional `~/Desktop/Dev Work/generalstaff-private`.
fn generalstaff_root() -> PathBuf {
    if let Some(home) = home_dir() {
        let cfg = home.join(".generalstaff-desktop").join("config.json");
        if let Ok(text) = std::fs::read_to_string(&cfg) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(p) = v.get("generalstaff_path").and_then(|x| x.as_str()) {
                    return PathBuf::from(p);
                }
            }
        }
        return home
            .join("Desktop")
            .join("Dev Work")
            .join("generalstaff-private");
    }
    PathBuf::from("generalstaff-private")
}

/// The public GeneralStaff repo — a sibling of generalstaff-private
/// named `generalstaff` (case-insensitive). Public-state projects keep
/// their state there rather than in the private repo. Also where
/// `scripts/gen-repo-context.sh` lives — sessions.rs shells out to it to
/// build the repo-structure orientation prepended to a spawned agent's
/// seed prompt (feat/repo-context-dispatch).
pub(crate) fn public_gs_root() -> Option<PathBuf> {
    let parent = generalstaff_root().parent()?.to_path_buf();
    for entry in std::fs::read_dir(&parent).ok()?.flatten() {
        if entry.path().is_dir()
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case("generalstaff")
        {
            return Some(entry.path());
        }
    }
    None
}

/// Resolve a project's state directory: `generalstaff-private/state/<id>/`
/// for the usual private-state projects, falling back to the public
/// GeneralStaff repo's `state/<id>/` for public-state projects.
fn project_state_dir(id: &str) -> Option<PathBuf> {
    let private = generalstaff_root().join("state").join(id);
    if private.is_dir() {
        return Some(private);
    }
    let public = public_gs_root()?.join("state").join(id);
    public.is_dir().then_some(public)
}

// ---------------------------------------------------------------------
// Fleet state — read GS's file-based state, never written.
// ---------------------------------------------------------------------

#[derive(Serialize, Clone)]
struct ProjectState {
    id: String,
    /// "active" (has pending tasks) | "clear" (none pending)
    status: String,
    total: u64,
    pending: u64,
    /// gsd-043 — paused-by-design tasks (status="deferred"). Don't count
    /// as active backlog; carried separately so the rail badge + the
    /// dashboard Situation strip can show the split.
    deferred: u64,
    interactive_pending: u64,
    /// Viability rubric sum (financial_return + reputation_signal +
    /// lifestyle_value) from project-meta.yaml. None if no meta file.
    viability_sum: Option<i64>,
    required_attention: Option<String>,
    /// `archived: true` in project-meta.yaml — the project is off the
    /// active board (set by the 2026-05-16 portfolio triage).
    archived: bool,
    category: Option<String>,
    /// Absolute path of the project's code repo — a directory alongside
    /// generalstaff-private whose name matches the id. None if no repo
    /// exists (a brand-new project not yet under version control).
    repo_path: Option<String>,
}

#[derive(Serialize, Clone)]
struct FleetSnapshot {
    ok: bool,
    message: Option<String>,
    generalstaff_path: String,
    projects: Vec<ProjectState>,
}

/// Read a JSON file into a Value; None on any failure (missing, or a
/// torn read mid-write — the caller degrades gracefully rather than
/// presenting confidently-wrong data).
fn read_json(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Read a YAML file (project-meta.yaml) into a Value; None on any failure.
fn read_yaml(path: &Path) -> Option<serde_yaml_ng::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_yaml_ng::from_str(&text).ok()
}

/// (total, pending, deferred, interactive-only-pending) task counts for
/// a project's tasks.json.
fn task_counts(tasks_path: &Path) -> (u64, u64, u64, u64) {
    let Some(v) = read_json(tasks_path) else {
        return (0, 0, 0, 0);
    };
    let Some(arr) = v.as_array() else {
        return (0, 0, 0, 0);
    };
    let mut total = 0;
    let mut pending = 0;
    let mut deferred = 0;
    let mut interactive = 0;
    for t in arr {
        total += 1;
        match t.get("status").and_then(|s| s.as_str()) {
            Some("pending") => {
                pending += 1;
                if t.get("interactive_only").and_then(|b| b.as_bool()) == Some(true) {
                    interactive += 1;
                }
            }
            Some("deferred") => deferred += 1,
            _ => {}
        }
    }
    (total, pending, deferred, interactive)
}

/// Scan one `state/` directory, appending each project to `projects`.
/// Ids already in `seen` are skipped — so a second scan (the public
/// repo) only adds projects the first scan did not already cover.
fn collect_projects(
    state_dir: &Path,
    projects: &mut Vec<ProjectState>,
    seen: &mut HashSet<String>,
    repo_map: &HashMap<String, PathBuf>,
) {
    let Ok(entries) = std::fs::read_dir(state_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with('_') || id.starts_with('.') || id == "pings" {
            continue;
        }
        if seen.contains(&id) {
            continue;
        }
        // A real project dir carries a ledger file; this skips stray dirs.
        let is_project = dir.join("tasks.json").exists()
            || dir.join("project-meta.yaml").exists()
            || dir.join("MISSION.md").exists();
        if !is_project {
            continue;
        }
        seen.insert(id.clone());

        let (total, pending, deferred, interactive_pending) =
            task_counts(&dir.join("tasks.json"));
        let status = if pending > 0 { "active" } else { "clear" };

        // Viability rubric from project-meta.yaml (F + R + L), if present.
        let meta = read_yaml(&dir.join("project-meta.yaml"));
        let viability = meta.as_ref().and_then(|m| m.get("viability"));
        let viability_sum = viability.map(|v| {
            let f = v.get("financial_return").and_then(|x| x.as_i64()).unwrap_or(0);
            let r = v.get("reputation_signal").and_then(|x| x.as_i64()).unwrap_or(0);
            let l = v.get("lifestyle_value").and_then(|x| x.as_i64()).unwrap_or(0);
            f + r + l
        });
        let required_attention = viability
            .and_then(|v| v.get("required_attention"))
            .and_then(|x| x.as_str())
            .map(String::from);
        // `archived: true` is a top-level key in project-meta.yaml.
        let archived = meta
            .as_ref()
            .and_then(|m| m.get("archived"))
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let category = meta
            .as_ref()
            .and_then(|m| m.get("classification"))
            .and_then(|c| c.get("primary"))
            .and_then(|p| {
                p.as_str().map(String::from).or_else(|| {
                    p.as_sequence()
                        .and_then(|s| s.first())
                        .and_then(|x| x.as_str())
                        .map(String::from)
                })
            });

        let repo_path = repo_map
            .get(&id.to_lowercase())
            .map(|p| p.display().to_string());

        projects.push(ProjectState {
            id,
            status: status.to_string(),
            total,
            pending,
            deferred,
            interactive_pending,
            viability_sum,
            required_attention,
            archived,
            category,
            repo_path,
        });
    }
}

/// One full portfolio scan — private-state projects first, then the
/// public repo's (merged by id; private wins). Shared by read_fleet,
/// the task-staleness scan, and the tray's attention summary.
pub(crate) fn scan_fleet_projects() -> Vec<ProjectState> {
    let state_dir = generalstaff_root().join("state");
    let repo_map = sibling_repo_map();
    let mut projects: Vec<ProjectState> = vec![];
    let mut seen: HashSet<String> = HashSet::new();
    collect_projects(&state_dir, &mut projects, &mut seen, &repo_map);
    // Public-state projects (generalstaff, bookfinder-general,
    // wargame-design-book, devforge-website) live only in the public repo.
    if let Some(public) = public_gs_root() {
        collect_projects(&public.join("state"), &mut projects, &mut seen, &repo_map);
    }
    projects
}

/// Read the whole project portfolio — private-state projects from
/// generalstaff-private/state/, then public-state projects from the
/// public GeneralStaff repo's state/ (merged by id; private wins).
#[tauri::command]
fn read_fleet() -> FleetSnapshot {
    let root = generalstaff_root();
    let state_dir = root.join("state");

    if !state_dir.is_dir() {
        return FleetSnapshot {
            ok: false,
            message: Some(format!(
                "generalstaff-private state not found at {}",
                state_dir.display()
            )),
            generalstaff_path: root.display().to_string(),
            projects: vec![],
        };
    }

    let mut projects = scan_fleet_projects();

    // Projects with open work first, alphabetical within each group.
    projects.sort_by(|a, b| {
        let ra = if a.status == "active" { 0 } else { 1 };
        let rb = if b.status == "active" { 0 } else { 1 };
        ra.cmp(&rb)
            .then_with(|| a.id.to_lowercase().cmp(&b.id.to_lowercase()))
    });

    FleetSnapshot {
        ok: true,
        message: None,
        generalstaff_path: root.display().to_string(),
        projects,
    }
}

// ---------------------------------------------------------------------
// Project files — the workbench file tree + read-only viewer.
// ---------------------------------------------------------------------

/// Resolve a project's code repo: a directory alongside generalstaff-private
/// whose name matches the project id (case-insensitive — handles WDS1870 /
/// wds1870, ZERO-PAGE / zero-page, etc.).
pub(crate) fn resolve_project_repo(id: &str) -> Option<PathBuf> {
    let parent = generalstaff_root().parent()?.to_path_buf();
    for entry in std::fs::read_dir(&parent).ok()?.flatten() {
        if entry.path().is_dir()
            && entry.file_name().to_string_lossy().eq_ignore_ascii_case(id)
        {
            return Some(entry.path());
        }
    }
    None
}

/// A lowercase-name -> code-repo-path map of every directory alongside
/// generalstaff-private. Built once per `read_fleet` so each project's
/// repo path is one map lookup, not a fresh parent-dir scan per project.
fn sibling_repo_map() -> HashMap<String, PathBuf> {
    let mut map = HashMap::new();
    let Some(parent) = generalstaff_root().parent().map(Path::to_path_buf) else {
        return map;
    };
    if let Ok(entries) = std::fs::read_dir(&parent) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                map.insert(name, entry.path());
            }
        }
    }
    map
}

#[derive(Serialize)]
struct FileList {
    ok: bool,
    message: Option<String>,
    repo_path: Option<String>,
    files: Vec<String>,
}

/// The git-tracked files of a project's code repo (`git ls-files`).
#[tauri::command]
fn project_files(id: String) -> FileList {
    let repo = match resolve_project_repo(&id) {
        Some(r) => r,
        None => {
            return FileList {
                ok: false,
                message: Some(format!(
                    "No code repo found alongside generalstaff-private for '{id}'"
                )),
                repo_path: None,
                files: vec![],
            }
        }
    };
    let output = std::process::Command::new("git")
        .args(["ls-files"])
        .current_dir(&repo)
        .output();
    match output {
        Ok(o) if o.status.success() => {
            let mut files: Vec<String> = String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|s| s.to_string())
                .collect();
            files.sort();
            FileList {
                ok: true,
                message: None,
                repo_path: Some(repo.display().to_string()),
                files,
            }
        }
        _ => FileList {
            ok: false,
            message: Some(format!("git ls-files failed in {}", repo.display())),
            repo_path: Some(repo.display().to_string()),
            files: vec![],
        },
    }
}

#[derive(Serialize)]
struct FileContent {
    ok: bool,
    message: Option<String>,
    content: Option<String>,
}

/// Read one repo-relative file for the viewer. Read-only, size-capped,
/// path-escape guarded.
#[tauri::command]
fn read_project_file(id: String, rel: String) -> FileContent {
    let repo = match resolve_project_repo(&id) {
        Some(r) => r,
        None => {
            return FileContent {
                ok: false,
                message: Some("project repo not found".into()),
                content: None,
            }
        }
    };
    if rel.contains("..") {
        return FileContent {
            ok: false,
            message: Some("invalid path".into()),
            content: None,
        };
    }
    let path = repo.join(&rel);
    match std::fs::metadata(&path) {
        Ok(m) if m.len() > 400_000 => FileContent {
            ok: false,
            message: Some("file too large to preview".into()),
            content: None,
        },
        Ok(_) => match std::fs::read_to_string(&path) {
            Ok(text) => FileContent {
                ok: true,
                message: None,
                content: Some(text),
            },
            Err(_) => FileContent {
                ok: false,
                message: Some("binary or unreadable file".into()),
                content: None,
            },
        },
        Err(_) => FileContent {
            ok: false,
            message: Some("file not found".into()),
            content: None,
        },
    }
}

// ---------------------------------------------------------------------
// Project tasks — the workbench task ledger.
// ---------------------------------------------------------------------

#[derive(Serialize)]
struct TaskItem {
    id: String,
    title: String,
    status: String,
    priority: Option<i64>,
    interactive_only: bool,
    /// gsd-043 — free-text "what unblocks this" for status="deferred" tasks.
    gated_on: Option<String>,
}

#[derive(Serialize)]
struct TaskList {
    ok: bool,
    message: Option<String>,
    tasks: Vec<TaskItem>,
}

/// A project's task ledger from generalstaff-private/state/<id>/tasks.json.
#[tauri::command]
fn project_tasks(id: String) -> TaskList {
    if id.contains('/') || id.contains("..") {
        return TaskList {
            ok: false,
            message: Some("invalid project id".into()),
            tasks: vec![],
        };
    }
    let path = match project_state_dir(&id) {
        Some(d) => d.join("tasks.json"),
        None => {
            return TaskList {
                ok: false,
                message: Some(format!("No state directory for '{id}'")),
                tasks: vec![],
            }
        }
    };
    let arr = match read_json(&path).and_then(|v| v.as_array().cloned()) {
        Some(a) => a,
        None => {
            return TaskList {
                ok: false,
                message: Some(format!("No tasks.json for '{id}'")),
                tasks: vec![],
            }
        }
    };
    let tasks = arr
        .iter()
        .map(|t| TaskItem {
            id: t.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            title: t
                .get("title")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            status: t
                .get("status")
                .and_then(|x| x.as_str())
                .unwrap_or("unknown")
                .to_string(),
            priority: t.get("priority").and_then(|x| x.as_i64()),
            interactive_only: t
                .get("interactive_only")
                .and_then(|x| x.as_bool())
                .unwrap_or(false),
            gated_on: t
                .get("gated_on")
                .and_then(|x| x.as_str())
                .map(str::to_string),
        })
        .collect();
    TaskList {
        ok: true,
        message: None,
        tasks,
    }
}

#[derive(Serialize)]
struct DeferResult {
    ok: bool,
    message: Option<String>,
}

/// gsd-043 — flip a pending task to status="deferred" with a gated_on
/// phrase. The workbench's Defer button calls this; the file watcher
/// then re-renders the task ledger automatically.
#[tauri::command]
fn defer_task(project: String, task: String, gated_on: String) -> DeferResult {
    if project.contains('/') || project.contains("..") {
        return DeferResult {
            ok: false,
            message: Some("invalid project id".into()),
        };
    }
    if task.is_empty() || task.len() > 64 || task.contains(|c: char| c.is_whitespace()) {
        return DeferResult {
            ok: false,
            message: Some("invalid task id".into()),
        };
    }
    let gated_on = gated_on.trim().to_string();
    if gated_on.is_empty() {
        return DeferResult {
            ok: false,
            message: Some("gated_on cannot be empty".into()),
        };
    }
    let Some(dir) = project_state_dir(&project) else {
        return DeferResult {
            ok: false,
            message: Some(format!("no state directory for '{project}'")),
        };
    };
    let path = dir.join("tasks.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return DeferResult {
            ok: false,
            message: Some(format!("could not read {}", path.display())),
        };
    };
    let mut value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            return DeferResult {
                ok: false,
                message: Some(format!("tasks.json parse error: {e}")),
            }
        }
    };
    let Some(arr) = value.as_array_mut() else {
        return DeferResult {
            ok: false,
            message: Some("tasks.json is not an array".into()),
        };
    };
    let mut flipped = false;
    for entry in arr.iter_mut() {
        let Some(obj) = entry.as_object_mut() else { continue };
        let id_matches = obj
            .get("id")
            .and_then(|x| x.as_str())
            .map(|s| s == task)
            .unwrap_or(false);
        if !id_matches {
            continue;
        }
        let status = obj.get("status").and_then(|x| x.as_str()).unwrap_or("pending");
        if status == "done" || status == "cancelled" {
            return DeferResult {
                ok: false,
                message: Some(format!("task '{task}' is {status} — refusing to defer")),
            };
        }
        obj.insert("status".into(), serde_json::Value::String("deferred".into()));
        obj.insert("gated_on".into(), serde_json::Value::String(gated_on.clone()));
        flipped = true;
        break;
    }
    if !flipped {
        return DeferResult {
            ok: false,
            message: Some(format!("task '{task}' not found in {project}")),
        };
    }
    let mut serialized = match serde_json::to_string_pretty(&value) {
        Ok(s) => s,
        Err(e) => {
            return DeferResult {
                ok: false,
                message: Some(format!("serialize error: {e}")),
            }
        }
    };
    serialized.push('\n');
    if let Err(e) = std::fs::write(&path, serialized) {
        return DeferResult {
            ok: false,
            message: Some(format!("write error: {e}")),
        };
    }
    DeferResult { ok: true, message: None }
}

// ---------------------------------------------------------------------
// Pings — the GS inbox (state/pings/inbox.md), open items only.
// ---------------------------------------------------------------------

#[derive(Serialize)]
struct Ping {
    /// Heading timestamp, e.g. "2026-05-16 15:38".
    when: String,
    actor: String,
    body: String,
    /// "idea" | "task" | "other" — drives which action the desktop offers.
    kind: String,
}

#[derive(Serialize)]
struct PingList {
    ok: bool,
    /// Open (unresolved) pings, newest first.
    pings: Vec<Ping>,
}

/// Classify a ping by its text. "idea" — a new thing to scope and maybe
/// build. "task" — a unit of work on something that exists (includes
/// "X needs help" issues and feature requests). "other" — notes, tests,
/// nothing actionable. Drives whether the desktop offers Scaffold,
/// Dispatch, or no action.
fn classify_ping(body: &str) -> &'static str {
    let first = body.lines().next().unwrap_or("").trim().to_lowercase();
    let full = body.to_lowercase();
    if first.starts_with("idea")
        || first.starts_with("possible project")
        || first.contains("wild idea")
        || first.contains("project idea")
        || first.contains("new project")
    {
        return "idea";
    }
    if first.starts_with("task")
        || first.starts_with("possible task")
        || first.starts_with("feature request")
        || first.starts_with("feature idea")
        || first.starts_with("consider")
        || first.contains("improvement")
        || first.contains("could use")
        || full.contains("needs help")
        || full.contains("needs some help")
    {
        return "task";
    }
    "other"
}

fn pings_inbox_path() -> PathBuf {
    generalstaff_root()
        .join("state")
        .join("pings")
        .join("inbox.md")
}

/// Parse inbox.md text into its open pings, oldest first. The inbox is a
/// sequence of `## ` blocks; a block headed `<date> <time> <actor>` is a
/// ping, and one headed `resolved …` resolves the ping just before it.
fn parse_open_pings(text: &str) -> Vec<Ping> {
    // Split into (heading, body) blocks on `## ` lines.
    let mut blocks: Vec<(String, String)> = vec![];
    let mut heading: Option<String> = None;
    let mut body = String::new();
    for line in text.lines() {
        if let Some(h) = line.strip_prefix("## ") {
            if let Some(prev) = heading.take() {
                blocks.push((prev, body.trim().to_string()));
            }
            heading = Some(h.trim().to_string());
            body.clear();
        } else if heading.is_some() {
            body.push_str(line);
            body.push('\n');
        }
    }
    if let Some(prev) = heading.take() {
        blocks.push((prev, body.trim().to_string()));
    }

    // A ping heading starts with a YYYY-MM-DD date; it is open unless
    // the very next block is a `resolved` block.
    let is_date = |h: &str| {
        let b = h.as_bytes();
        b.len() >= 10
            && b[0..4].iter().all(u8::is_ascii_digit)
            && b[4] == b'-'
            && b[7] == b'-'
    };
    let mut pings = vec![];
    for i in 0..blocks.len() {
        let (h, body) = &blocks[i];
        if !is_date(h) {
            continue;
        }
        let resolved = blocks
            .get(i + 1)
            .map(|(next, _)| next.starts_with("resolved"))
            .unwrap_or(false);
        if resolved {
            continue;
        }
        let parts: Vec<&str> = h.splitn(3, ' ').collect();
        let when = if parts.len() >= 2 {
            format!("{} {}", parts[0], parts[1])
        } else {
            h.clone()
        };
        let actor = parts.get(2).unwrap_or(&"").to_string();
        pings.push(Ping {
            when,
            actor,
            kind: classify_ping(body).to_string(),
            body: body.clone(),
        });
    }
    pings
}

/// Parse state/pings/inbox.md and return the open pings, newest first.
#[tauri::command]
fn read_pings() -> PingList {
    let Ok(text) = std::fs::read_to_string(pings_inbox_path()) else {
        return PingList {
            ok: false,
            pings: vec![],
        };
    };
    let mut pings = parse_open_pings(&text);
    pings.reverse(); // newest first
    PingList { ok: true, pings }
}

/// Open-ping count for the tray's situation line — the same parse
/// read_pings uses, count only.
pub(crate) fn open_ping_count() -> usize {
    std::fs::read_to_string(pings_inbox_path())
        .map(|t| parse_open_pings(&t).len())
        .unwrap_or(0)
}

/// Resolve a ping — insert a `## resolved` block immediately after the
/// matching ping in state/pings/inbox.md, the convention `read_pings`
/// recognises as closing it. The ping is matched by heading (when +
/// actor) *and* body, so a same-minute timestamp collision cannot
/// resolve the wrong one. This is the desktop's one write to GS state —
/// an append to a shared log built for exactly this kind of write.
#[tauri::command]
fn resolve_ping(
    when: String,
    actor: String,
    body: String,
    date: String,
) -> Result<(), String> {
    let path = pings_inbox_path();
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("cannot read pings inbox: {e}"))?;
    let lines: Vec<&str> = text.lines().collect();

    // Heading-line indices of every `## ` block — the same block split
    // read_pings does.
    let heads: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| l.starts_with("## "))
        .map(|(i, _)| i)
        .collect();

    // The target ping: a block whose heading parses to (when, actor) and
    // whose body matches. `end` is the block boundary the resolved block
    // is spliced in at.
    let mut end: Option<usize> = None;
    for (bi, &h) in heads.iter().enumerate() {
        let heading = lines[h].strip_prefix("## ").unwrap_or("").trim();
        let parts: Vec<&str> = heading.splitn(3, ' ').collect();
        if parts.len() < 3 {
            continue;
        }
        if format!("{} {}", parts[0], parts[1]) != when || parts[2] != actor {
            continue;
        }
        let stop = heads.get(bi + 1).copied().unwrap_or(lines.len());
        if lines[h + 1..stop].join("\n").trim() == body.trim() {
            end = Some(stop);
            break;
        }
    }
    let Some(end) = end else {
        return Err("ping not found — it may already be resolved".into());
    };

    // Splice the resolved block in, with one blank line on each side.
    let mut out: Vec<String> = lines[..end].iter().map(|s| s.to_string()).collect();
    while out.last().map(String::is_empty).unwrap_or(false) {
        out.pop();
    }
    out.push(String::new());
    out.push(format!("## resolved {date}"));
    out.push("Resolved from GeneralStaff Desktop.".to_string());
    out.push(String::new());
    out.extend(lines[end..].iter().map(|s| s.to_string()));

    let mut joined = out.join("\n");
    if text.ends_with('\n') {
        joined.push('\n');
    }
    std::fs::write(&path, joined).map_err(|e| format!("cannot write pings inbox: {e}"))?;
    commit_inbox_write(format!("resolve {when}"));
    Ok(())
}

/// Append a ping to the GS inbox (gsd-026) — the dashboard's add-ping
/// affordance. A second use of the inbox-write carve-out `resolve_ping`
/// established; the inbox is a shared append-only log built for exactly
/// this. `when` is "YYYY-MM-DD HH:MM" — the frontend stamps local time.
#[tauri::command]
fn append_ping(when: String, actor: String, body: String) -> Result<(), String> {
    let when = when.trim();
    let actor = actor.trim();
    let body = body.trim();
    if body.is_empty() {
        return Err("ping body is empty".into());
    }
    // Guard the heading shape so a malformed `when` cannot write a block
    // read_pings would not recognise as a dated ping.
    let wb = when.as_bytes();
    let dated = wb.len() >= 16
        && wb[0..4].iter().all(u8::is_ascii_digit)
        && wb[4] == b'-'
        && wb[7] == b'-'
        && wb[10] == b' ';
    if !dated || actor.is_empty() {
        return Err("ping heading must be 'YYYY-MM-DD HH:MM <actor>'".into());
    }
    let path = pings_inbox_path();
    let mut text = std::fs::read_to_string(&path)
        .map_err(|e| format!("cannot read pings inbox: {e}"))?;
    // One blank line between the prior block and the new one.
    if !text.ends_with('\n') {
        text.push('\n');
    }
    if !text.ends_with("\n\n") {
        text.push('\n');
    }
    text.push_str(&format!("## {when} {actor}\n{body}\n"));
    std::fs::write(&path, text).map_err(|e| format!("cannot write pings inbox: {e}"))?;
    commit_inbox_write(format!("add {when} {actor}"));
    Ok(())
}

/// Serialises GSD's background inbox commits so two rapid writes cannot
/// race on git's index lock.
static INBOX_GIT_LOCK: Mutex<()> = Mutex::new(());

/// Commit — and best-effort push — GSD's write to the pings inbox
/// (gsd-029). resolve_ping and append_ping otherwise leave inbox.md
/// uncommitted; an uncommitted local inbox conflicts on the next pull
/// when mission-companion's GS mode pushes from another machine. Runs
/// on a background thread so the Tauri command returns at once — the
/// file-watcher has already refreshed the panel from the file write.
/// Mirrors mission-companion's git_commit_state_write: commit (a
/// pathspec commit, so it never sweeps up other staged changes); on a
/// push reject, pull --rebase and retry once; on a rebase failure,
/// abort and leave the commit local for a later sync.
fn commit_inbox_write(summary: String) {
    std::thread::spawn(move || {
        let _guard = INBOX_GIT_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = generalstaff_root();
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(&root)
                .args(args)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        };
        // A pathspec commit — inbox.md only, never anything else in the
        // index. No change to inbox.md -> git exits non-zero -> we stop.
        if !git(&[
            "commit",
            "-m",
            &format!("pings: {summary}"),
            "--",
            "state/pings/inbox.md",
        ]) {
            return;
        }
        if !git(&["push"]) {
            if git(&["pull", "--rebase"]) {
                let _ = git(&["push"]);
            } else {
                let _ = git(&["rebase", "--abort"]);
            }
        }
    });
}

/// Whether a project repo carries the explicit `GS-Ping: <when>` commit
/// trailer a dispatched session leaves when it ships a ping's work
/// (gsd-027). An exact, greppable signal — deliberately NOT a fuzzy
/// "any recent commit" guess, which would flag every ping for an
/// actively-developed project. No trailer, no hint: no false positives.
fn repo_shipped_ping(repo: &str, when: &str) -> bool {
    let trailer = format!("GS-Ping: {when}");
    std::process::Command::new("git")
        .args(["-C", repo, "log", "-1", "--format=%H", "--fixed-strings"])
        .arg(format!("--grep={trailer}"))
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false)
}

#[derive(Deserialize)]
struct PingProbe {
    when: String,
    repo: String,
}

/// For a batch of (open task ping -> its project repo) probes, return the
/// `when` of each ping whose repo shows shipped activity (gsd-027). One
/// round trip; the desktop decorates the flagged rows with a hint.
#[tauri::command]
fn ping_hints(probes: Vec<PingProbe>) -> Vec<String> {
    probes
        .into_iter()
        .filter(|p| repo_shipped_ping(&p.repo, &p.when))
        .map(|p| p.when)
        .collect()
}

// ---------------------------------------------------------------------
// Task staleness hints (gsd-039) — read-side nudge for dispatched work.
// ---------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct TaskHint {
    task_id: String,
    project: String,
    commit_sha: String,
    commit_date: String,
    /// Default branch searched (`main` or `master`) — shown in the UI tooltip.
    default_branch: String,
    suggested: bool,
}

/// Default branch for branch-reachability-bounded git log: prefer
/// `origin/HEAD`, else `main`, else `master` (Ray's convention).
fn repo_default_branch(repo: &str) -> String {
    let sym = std::process::Command::new("git")
        .args(["-C", repo, "symbolic-ref", "refs/remotes/origin/HEAD"])
        .output();
    if let Ok(o) = sym {
        if o.status.success() {
            let refname = String::from_utf8_lossy(&o.stdout);
            if let Some(short) = refname.trim().rsplit('/').next() {
                if git_ref_exists(repo, short) {
                    return short.to_string();
                }
            }
        }
    }
    for candidate in ["main", "master"] {
        if git_ref_exists(repo, candidate) {
            return candidate.to_string();
        }
    }
    "master".to_string()
}

fn git_ref_exists(repo: &str, branch: &str) -> bool {
    std::process::Command::new("git")
        .args(["-C", repo, "rev-parse", "--verify", branch])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// First commit on `default_branch` in the last 30 days whose message
/// carries the explicit `GS-Task: <id>` trailer (gsd-042 dispatch only).
/// Dead feature branches and detached refs are excluded by scoping to the
/// default branch — not `git log --all`.
fn task_trailer_on_default_branch(
    repo: &str,
    task_id: &str,
) -> Option<(String, String, String)> {
    let branch = repo_default_branch(repo);
    let trailer = format!("GS-Task: {task_id}");
    let out = std::process::Command::new("git")
        .args([
            "-C",
            repo,
            "log",
            &format!("--grep={trailer}"),
            "--since=30 days",
            &branch,
            "-1",
            "--format=%H%x09%ci",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if line.is_empty() {
        return None;
    }
    let mut parts = line.split('\t');
    let sha = parts.next()?.to_string();
    let date_raw = parts.next()?;
    // %ci is ISO-like; keep the date portion for the UI.
    let date = date_raw
        .split_whitespace()
        .next()
        .unwrap_or(date_raw)
        .to_string();
    Some((sha, date, branch))
}

/// gsd-039 — task-staleness read-side. For each pending or in_progress
/// ledger entry fleet-wide, look for a `GS-Task: <id>` trailer on the
/// project's default branch (last 30 days). Returns suggested-done hints
/// with commit evidence.
///
/// Caveat: only catches work shipped through GSD's dispatch flow, which
/// appends the GS-Task trailer (gsd-042). Manually-shipped tasks are not
/// detected here — the manual Reconcile button remains the catch-all.
///
/// Branch-reachability gate: `git log` is scoped to the default branch
/// (`main` / `master` via `origin/HEAD`), so commits on dead feature
/// branches, reverted PRs, or detached refs do not count.
///
/// On-demand scan; no cache. Per audit (2026-05-22): false staleness on
/// rapid task-close was higher-risk than 1.7s cold scan; revisit if UI
/// jank becomes an actual problem.
#[tauri::command]
fn task_hints() -> Vec<TaskHint> {
    scan_task_hints()
}

fn scan_task_hints() -> Vec<TaskHint> {
    let projects = scan_fleet_projects();

    let mut hints = Vec::new();
    for proj in projects {
        let Some(repo_path) = proj.repo_path else { continue };
        let tasks_path = match project_state_dir(&proj.id) {
            Some(d) => d.join("tasks.json"),
            None => continue,
        };
        let Some(arr) = read_json(&tasks_path).and_then(|v| v.as_array().cloned()) else {
            continue;
        };
        for t in arr {
            let status = t.get("status").and_then(|s| s.as_str()).unwrap_or("");
            if status != "pending" && status != "in_progress" {
                continue;
            }
            let task_id = t.get("id").and_then(|x| x.as_str()).unwrap_or("");
            if task_id.is_empty() {
                continue;
            }
            if let Some((commit_sha, commit_date, default_branch)) =
                task_trailer_on_default_branch(&repo_path, task_id)
            {
                hints.push(TaskHint {
                    task_id: task_id.to_string(),
                    project: proj.id.clone(),
                    commit_sha,
                    commit_date,
                    default_branch,
                    suggested: true,
                });
            }
        }
    }
    hints
}

// ---------------------------------------------------------------------
// Timestamp helpers — ISO-8601 to epoch seconds, no chrono dependency.
// Used by the bot-cycle verdict windowing below.
// ---------------------------------------------------------------------

/// Days since the Unix epoch for a civil (proleptic Gregorian) date —
/// Howard Hinnant's days_from_civil.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parse a `YYYY-MM-DDTHH:MM:SS...` UTC timestamp — the shape Claude
/// Code writes — to epoch seconds. Sub-second precision and the zone
/// suffix are ignored; the transcripts are UTC.
fn iso_to_epoch(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z).and_then(|p| p.parse::<i64>().ok());
    Some(
        days_from_civil(num(0, 4)?, num(5, 7)?, num(8, 10)?) * 86_400
            + num(11, 13)? * 3_600
            + num(14, 16)? * 60
            + num(17, 19)?,
    )
}

// ---------------------------------------------------------------------
// Recent activity — session notes + git history. The "where did I
// leave off" half of the briefing; pairs with the Situation stats.
// ---------------------------------------------------------------------

#[derive(Serialize)]
struct SessionNote {
    file: String,
    title: String,
    excerpt: String,
    body: String,
}

/// The most recent session notes from generalstaff-private/docs/sessions/,
/// newest first — filenames are YYYY-MM-DD-… so a reverse sort is
/// chronological.
#[tauri::command]
fn recent_session_notes() -> Vec<SessionNote> {
    let dir = generalstaff_root().join("docs").join("sessions");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return vec![];
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("md"))
        .collect();
    files.sort();
    files.reverse();
    files.truncate(8);

    let mut notes = vec![];
    for path in files {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let file = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        // Title = first `# ` heading; excerpt = first couple of prose lines.
        let title = text
            .lines()
            .find(|l| l.starts_with("# "))
            .map(|l| l.trim_start_matches("# ").trim().to_string())
            .unwrap_or_else(|| file.clone());
        let excerpt = text
            .lines()
            .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
            .take(2)
            .collect::<Vec<_>>()
            .join(" ");
        let excerpt = if excerpt.chars().count() > 200 {
            excerpt.chars().take(199).collect::<String>() + "…"
        } else {
            excerpt
        };
        notes.push(SessionNote {
            file,
            title,
            excerpt,
            body: text,
        });
    }
    notes
}

#[derive(Serialize)]
struct Commit {
    hash: String,
    date: String,
    subject: String,
}

/// Recent commits from the generalstaff-private repo — the orchestration
/// log (session notes, state, pings).
#[tauri::command]
fn recent_commits() -> Vec<Commit> {
    let output = std::process::Command::new("git")
        .args([
            "log",
            "-n",
            "15",
            "--pretty=format:%h\x1f%ad\x1f%s",
            "--date=short",
        ])
        .current_dir(generalstaff_root())
        .output();
    let Ok(out) = output else {
        return vec![];
    };
    if !out.status.success() {
        return vec![];
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            Some(Commit {
                hash: parts.next()?.to_string(),
                date: parts.next()?.to_string(),
                subject: parts.next()?.to_string(),
            })
        })
        .collect()
}

// ---------------------------------------------------------------------
// Bot cycle verdicts — PROGRESS.jsonl, the GS dispatcher's append-only
// event log (gsd-054). Read-only: this is the file that records what
// the bot actually did; GSD surfaces it on the workbench, the briefing,
// and the tray.
// ---------------------------------------------------------------------

/// One cycle_end record from a project's PROGRESS.jsonl.
#[derive(Serialize, Clone)]
struct CycleSummary {
    project_id: String,
    cycle_id: String,
    timestamp: String,
    outcome: String,
    reason: String,
    duration_seconds: u64,
}

/// A project's PROGRESS.jsonl. Private-state projects keep tasks.json in
/// generalstaff-private, but the dispatcher runs against the public repo
/// and appends PROGRESS there — so when the preferred state dir has no
/// file, fall back to the public root's state/<id>/.
fn progress_path(id: &str) -> Option<PathBuf> {
    if let Some(dir) = project_state_dir(id) {
        let p = dir.join("PROGRESS.jsonl");
        if p.is_file() {
            return Some(p);
        }
    }
    let p = public_gs_root()?
        .join("state")
        .join(id)
        .join("PROGRESS.jsonl");
    p.is_file().then_some(p)
}

/// Parse one JSONL line; Some only for a well-formed cycle_end event.
fn parse_cycle_end(line: &str, project_id: &str) -> Option<CycleSummary> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("event")?.as_str()? != "cycle_end" {
        return None;
    }
    let data = v.get("data")?;
    Some(CycleSummary {
        project_id: project_id.to_string(),
        cycle_id: v.get("cycle_id")?.as_str()?.to_string(),
        timestamp: v.get("timestamp")?.as_str()?.to_string(),
        outcome: data
            .get("outcome")
            .and_then(|x| x.as_str())
            .unwrap_or("unknown")
            .to_string(),
        reason: data
            .get("reason")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        duration_seconds: data
            .get("duration_seconds")
            .and_then(|x| x.as_u64())
            .unwrap_or(0),
    })
}

/// Newest-first cycle_end records for one project. Lines append
/// chronologically, so the reverse walk stops at the first record older
/// than `min_epoch` (when given). Malformed lines are skipped; a missing
/// PROGRESS.jsonl is empty, not an error — most projects have no bot
/// cycles.
fn project_cycle_ends(id: &str, limit: usize, min_epoch: Option<i64>) -> Vec<CycleSummary> {
    let Some(path) = progress_path(id) else {
        return vec![];
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return vec![];
    };
    let mut out = vec![];
    for line in text.lines().rev() {
        let Some(c) = parse_cycle_end(line, id) else {
            continue;
        };
        if let Some(min) = min_epoch {
            match iso_to_epoch(&c.timestamp) {
                Some(t) if t < min => break,
                None => continue,
                _ => {}
            }
        }
        out.push(c);
        if out.len() >= limit {
            break;
        }
    }
    out
}

/// The last `limit` bot-cycle verdicts for one project — the workbench
/// "Bot cycles" panel.
#[tauri::command]
fn read_progress_cycles(project_id: String, limit: usize) -> Vec<CycleSummary> {
    project_cycle_ends(&project_id, limit, None)
}

/// Cross-project cycle activity within a recency window.
#[derive(Serialize)]
struct FleetProgress {
    /// outcome -> count of cycle_end events in the window.
    counts: HashMap<String, u64>,
    /// The window's cycle_end records, newest first.
    cycles: Vec<CycleSummary>,
}

pub(crate) fn epoch_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Scan every fleet project's PROGRESS.jsonl for cycle_end events in the
/// last `hours`. Shared by the briefing panel, the frontend's new-verdict
/// notification diff, and the tray's recent-verdict lines.
pub(crate) fn fleet_cycle_ends(hours: u64) -> FleetProgress {
    let min_epoch = epoch_now() - hours as i64 * 3600;
    let mut counts: HashMap<String, u64> = HashMap::new();
    let mut cycles: Vec<CycleSummary> = vec![];
    for p in scan_fleet_projects() {
        // 200 is far past any real per-project daily cycle volume; the
        // window cutoff is the operative bound.
        cycles.extend(project_cycle_ends(&p.id, 200, Some(min_epoch)));
    }
    // ISO8601 Z timestamps sort lexicographically; newest first.
    cycles.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    for c in &cycles {
        *counts.entry(c.outcome.clone()).or_insert(0) += 1;
    }
    FleetProgress { counts, cycles }
}

#[tauri::command]
fn fleet_progress_recent(hours: u64) -> FleetProgress {
    fleet_cycle_ends(hours)
}

// ---------------------------------------------------------------------
// Desktop UX — native notifications + session pop-out windows.
// ---------------------------------------------------------------------

/// Show a native OS notification (gsd-031). The frontend decides *when*
/// to call this — it owns the active-tab knowledge and the per-session
/// idle timer — so a notification fires only for a session that ended
/// or went idle in a tab the operator is not currently watching.
#[tauri::command]
fn notify(app: tauri::AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Pop a running session out into its own OS window (gsd-035) so it can
/// move to a second monitor while the dashboard stays put. The PTY
/// session keeps running in the backend; the new window (term.html)
/// re-attaches to it by id, read from the `term-<id>` window label.
/// Idempotent — a second call for a session already popped out just
/// focuses its window.
#[tauri::command]
fn popout_session(app: tauri::AppHandle, id: String, label: String) -> Result<(), String> {
    let win_label = format!("term-{id}");
    if let Some(existing) = app.get_webview_window(&win_label) {
        let _ = existing.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, win_label, WebviewUrl::App("term.html".into()))
        .title(format!("GeneralStaff — {label}"))
        .inner_size(900.0, 600.0)
        .min_inner_size(420.0, 280.0)
        .build()
        .map_err(|e| format!("could not open session window: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------
// File-watcher — emit `fleet-updated` when the portfolio changes.
// ---------------------------------------------------------------------

fn start_fleet_watcher(app: &tauri::AppHandle) {
    let state_dir = generalstaff_root().join("state");
    let app_handle = app.clone();
    let last_emit = Mutex::new(Instant::now() - Duration::from_secs(1));

    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_err() {
            return;
        }
        // State changes arrive in flurries — coalesce to ~one emit / 400ms.
        let mut last = last_emit.lock().unwrap();
        if last.elapsed() < Duration::from_millis(400) {
            return;
        }
        *last = Instant::now();
        drop(last);
        let _ = app_handle.emit("fleet-updated", ());
    });

    let mut watcher = match watcher {
        Ok(w) => w,
        Err(_) => return,
    };

    if state_dir.is_dir() {
        let _ = watcher.watch(&state_dir, RecursiveMode::Recursive);
    }
    // Public-state projects live in the public repo — watch its state/ too.
    if let Some(public) = public_gs_root() {
        let pub_state = public.join("state");
        if pub_state.is_dir() {
            let _ = watcher.watch(&pub_state, RecursiveMode::Recursive);
        }
    }

    // Keep the watcher (and its background thread) alive for the app's life.
    Box::leak(Box::new(watcher));
}

// ---------------------------------------------------------------------
// App
// ---------------------------------------------------------------------

/// Show, un-minimize, and focus the main window — used by the tray.
pub(crate) fn surface_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(sessions::SessionManager::default())
        .invoke_handler(tauri::generate_handler![
            read_fleet,
            project_files,
            read_project_file,
            project_tasks,
            defer_task,
            read_pings,
            resolve_ping,
            append_ping,
            ping_hints,
            task_hints,
            recent_session_notes,
            recent_commits,
            read_progress_cycles,
            fleet_progress_recent,
            notify,
            popout_session,
            tray::refresh_tray,
            sessions::spawn_session,
            sessions::write_session,
            sessions::resize_session,
            sessions::kill_session,
            sessions::list_sessions,
            sessions::save_session_layout,
            sessions::load_session_layout,
            sessions::set_theme_kind,
            sessions::get_settings,
            sessions::set_claude_effort,
            sessions::set_autonomous_consent
        ])
        .setup(|app| {
            // Ambient fleet tray (gsd-053) — attention badge + situation menu.
            tray::init(app.handle())?;

            // The inversion is ambient-always-on: register launch-at-login
            // by default. Release builds only — a dev binary registered as
            // a LaunchAgent would point into target/debug. Best-effort; a
            // failure must never block startup.
            if !cfg!(debug_assertions) {
                use tauri_plugin_autostart::ManagerExt;
                let autostart = app.autolaunch();
                if !autostart.is_enabled().unwrap_or(false) {
                    if let Err(e) = autostart.enable() {
                        log::warn!("autostart enable failed: {e}");
                    }
                }
            }

            // Live portfolio — watch generalstaff-private's state dir.
            start_fleet_watcher(app.handle());
            // Dispatcher spawn requests — watch ~/.generalstaff-desktop/requests/.
            sessions::start_request_watcher(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Persistent console: closing the main window hides
                    // it (the tray icon brings it back). Cmd+Q quits.
                    let _ = window.hide();
                    api.prevent_close();
                } else if let Some(id) = window.label().strip_prefix("term-") {
                    // A popped-out session window — closing it ends the
                    // session it carried, the way closing its tab would.
                    sessions::kill_session_id(
                        window.state::<sessions::SessionManager>().inner(),
                        id,
                    );
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running GeneralStaff Desktop");
}
