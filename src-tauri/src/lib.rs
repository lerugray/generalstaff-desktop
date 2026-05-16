//! GeneralStaff Desktop — the command console for the GeneralStaff
//! dev-fleet orchestrator.
//!
//! A viewer/controller over GeneralStaff's file-based state: it reads
//! state to display it and never edits the structured state files
//! (`tasks.json`, `project-meta.yaml`) directly. The one write it makes
//! is to the pings inbox (`state/pings/inbox.md`) — a shared append-only
//! log any actor may add to; resolving a ping appends a `## resolved`
//! block, the same kind of write the inbox is built for.
//!
//! The "fleet" is the project portfolio in `generalstaff-private/state/`
//! — each project's `tasks.json` / `MISSION.md` / `project-meta.yaml`.
//! That is where the real work happens; the public GeneralStaff repo is
//! the sanitized mirror and is not what the desktop reads.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

mod sessions;

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
    interactive_pending: u64,
    /// Viability rubric sum (financial_return + reputation_signal +
    /// lifestyle_value) from project-meta.yaml. None if no meta file.
    viability_sum: Option<i64>,
    required_attention: Option<String>,
    /// `archived: true` in project-meta.yaml — the project is off the
    /// active board (set by the 2026-05-16 portfolio triage).
    archived: bool,
    category: Option<String>,
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

/// (total, pending, interactive-only-pending) task counts for a
/// project's tasks.json.
fn task_counts(tasks_path: &Path) -> (u64, u64, u64) {
    let Some(v) = read_json(tasks_path) else {
        return (0, 0, 0);
    };
    let Some(arr) = v.as_array() else {
        return (0, 0, 0);
    };
    let mut total = 0;
    let mut pending = 0;
    let mut interactive = 0;
    for t in arr {
        total += 1;
        if t.get("status").and_then(|s| s.as_str()) == Some("pending") {
            pending += 1;
            if t.get("interactive_only").and_then(|b| b.as_bool()) == Some(true) {
                interactive += 1;
            }
        }
    }
    (total, pending, interactive)
}

/// Read the whole project portfolio from generalstaff-private's state dir.
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

    let entries = match std::fs::read_dir(&state_dir) {
        Ok(e) => e,
        Err(_) => {
            return FleetSnapshot {
                ok: false,
                message: Some(format!("Cannot read {}", state_dir.display())),
                generalstaff_path: root.display().to_string(),
                projects: vec![],
            }
        }
    };

    let mut projects: Vec<ProjectState> = vec![];
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with('_') || id.starts_with('.') || id == "pings" {
            continue;
        }
        // A real project dir carries a ledger file; this skips stray dirs.
        let is_project = dir.join("tasks.json").exists()
            || dir.join("project-meta.yaml").exists()
            || dir.join("MISSION.md").exists();
        if !is_project {
            continue;
        }

        let (total, pending, interactive_pending) = task_counts(&dir.join("tasks.json"));
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

        projects.push(ProjectState {
            id,
            status: status.to_string(),
            total,
            pending,
            interactive_pending,
            viability_sum,
            required_attention,
            archived,
            category,
        });
    }

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
    let path = generalstaff_root()
        .join("state")
        .join(&id)
        .join("tasks.json");
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
        })
        .collect();
    TaskList {
        ok: true,
        message: None,
        tasks,
    }
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

/// Parse state/pings/inbox.md and return the open pings. The inbox is a
/// sequence of `## ` blocks; a block headed `<date> <time> <actor>` is a
/// ping, and one headed `resolved …` resolves the ping just before it.
#[tauri::command]
fn read_pings() -> PingList {
    let path = generalstaff_root()
        .join("state")
        .join("pings")
        .join("inbox.md");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return PingList {
            ok: false,
            pings: vec![],
        };
    };

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
    pings.reverse(); // newest first
    PingList { ok: true, pings }
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
    let path = generalstaff_root()
        .join("state")
        .join("pings")
        .join("inbox.md");
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
    std::fs::write(&path, joined).map_err(|e| format!("cannot write pings inbox: {e}"))
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

    // Keep the watcher (and its background thread) alive for the app's life.
    Box::leak(Box::new(watcher));
}

// ---------------------------------------------------------------------
// App
// ---------------------------------------------------------------------

/// Show, un-minimize, and focus the main window — used by the tray.
fn surface_main(app: &tauri::AppHandle) {
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .manage(sessions::SessionManager::default())
        .invoke_handler(tauri::generate_handler![
            read_fleet,
            project_files,
            read_project_file,
            project_tasks,
            read_pings,
            resolve_ping,
            sessions::spawn_session,
            sessions::write_session,
            sessions::resize_session,
            sessions::kill_session,
            sessions::list_sessions,
            sessions::save_session_layout,
            sessions::load_session_layout
        ])
        .setup(|app| {
            // Tray icon — a persistent menu-bar presence.
            let show = MenuItem::with_id(app, "show", "Show GeneralStaff", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("gs-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("GeneralStaff")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => surface_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Live portfolio — watch generalstaff-private's state dir.
            start_fleet_watcher(app.handle());
            // Dispatcher spawn requests — watch ~/.generalstaff-desktop/requests/.
            sessions::start_request_watcher(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Persistent console: closing the window hides it (the tray
            // icon brings it back). Cmd+Q still quits for real.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running GeneralStaff Desktop");
}
