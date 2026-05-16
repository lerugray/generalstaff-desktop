//! Child-session management — runs the real `claude` / `cursor-agent`
//! CLI processes under a PTY, streams their output to the frontend, and
//! routes keystrokes back. The desktop wraps Claude Code; it does not
//! reimplement it. See docs/SESSION-COCKPIT-PLAN.md.
//!
//! Sessions are spawned two ways, both through `do_spawn`:
//!   • the `spawn_session` command — the workbench "Start session here"
//!     button and the briefing's dispatcher button;
//!   • the request-file watcher — a dispatcher session calls the
//!     `gs-mcp` tool, which drops a request file this watcher picks up.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use base64::Engine;
use notify::{RecursiveMode, Watcher};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::{home_dir, resolve_project_repo};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// One live child session. The PTY master (for resize) and the input
/// writer live here; the child handle and the output reader are owned
/// by the per-session reader thread, which reaps the child on exit.
struct Session {
    id: String,
    agent: String,
    cwd: String,
    mode: String,
    pid: Option<u32>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

/// The live-session table — Tauri-managed state.
#[derive(Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, Session>>,
}

#[derive(Serialize, Clone)]
pub struct SessionInfo {
    id: String,
    agent: String,
    cwd: String,
    mode: String,
    status: String,
}

#[derive(Serialize, Clone)]
struct PtyOutput {
    id: String,
    /// base64-encoded PTY bytes — base64 keeps multibyte / ANSI bytes
    /// intact across the IPC boundary; xterm.js decodes and renders.
    data: String,
}

#[derive(Serialize, Clone)]
struct PtyExit {
    id: String,
}

/// A spawn request dropped into ~/.generalstaff-desktop/requests/ by the
/// `gs-mcp` stdio server when a dispatcher session calls its spawn tool.
#[derive(Deserialize)]
struct SpawnRequest {
    agent: String,
    /// A fleet project id — its code repo is resolved automatically.
    project: Option<String>,
    /// An explicit working directory — alternative to `project`.
    cwd: Option<String>,
    prompt: Option<String>,
    mode: Option<String>,
}

/// Resolve an agent's real binary. `claude` is shell-aliased on Ray's
/// machines, so a directly-spawned process cannot rely on the alias —
/// resolve the actual file.
fn resolve_agent_binary(agent: &str) -> Result<PathBuf, String> {
    let exe = match agent {
        "claude" => "claude",
        "cursor-agent" => "cursor-agent",
        other => return Err(format!("unknown agent: {other}")),
    };
    if let Some(home) = home_dir() {
        let local = home.join(".local").join("bin").join(exe);
        if local.exists() {
            return Ok(local);
        }
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        let p = PathBuf::from(dir).join(exe);
        if p.exists() {
            return Ok(p);
        }
    }
    // Last resort: bare name, resolved against the PATH set below.
    Ok(PathBuf::from(exe))
}

/// A known-good PATH for spawned agents — explicit dirs first, then the
/// inherited PATH. Pre-empts the `command not found` class of failure.
fn agent_path() -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(home) = home_dir() {
        parts.push(home.join(".local").join("bin").display().to_string());
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        parts.push(dir.to_string());
    }
    if let Ok(existing) = std::env::var("PATH") {
        parts.push(existing);
    }
    parts.join(":")
}

/// ~/.generalstaff-desktop/requests/ — the spawn-request drop directory.
fn requests_dir() -> PathBuf {
    home_dir()
        .unwrap_or_default()
        .join(".generalstaff-desktop")
        .join("requests")
}

/// The `gs-mcp` stdio MCP server binary — built alongside the app, so it
/// sits next to the app executable.
fn gs_mcp_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let p = exe.parent()?.join("gs-mcp");
    p.exists().then_some(p)
}

/// Build the agent command — explicit environment, cwd, the dispatcher
/// MCP tool (claude only), and the args for the requested mode.
fn build_command(
    agent: &str,
    cwd: &str,
    prompt: Option<&str>,
    mode: &str,
) -> Result<CommandBuilder, String> {
    let bin = resolve_agent_binary(agent)?;
    let mut cmd = CommandBuilder::new(bin);
    cmd.cwd(cwd);

    // Explicit environment: inherit the parent env, then override PATH
    // and TERM to known-good values (audit constraint — no blind env).
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    cmd.env("PATH", agent_path());
    cmd.env("TERM", "xterm-256color");

    // A claude session runs at max effort (Ray's standing preference —
    // he trusts the reasoning) and gets the gs-mcp tool, so it can act
    // as a dispatcher — opening child session tabs straight from chat.
    if agent == "claude" {
        cmd.arg("--effort");
        cmd.arg("max");
        if let Some(mcp) = gs_mcp_path() {
            let cfg = serde_json::json!({
                "mcpServers": { "gs": { "command": mcp.display().to_string() } }
            })
            .to_string();
            cmd.arg("--mcp-config");
            cmd.arg(cfg);
        }
    }

    match (agent, mode) {
        ("claude", "autonomous") => {
            cmd.arg("-p");
            cmd.arg("--permission-mode");
            cmd.arg("bypassPermissions");
            if let Some(p) = prompt {
                cmd.arg(p);
            }
        }
        ("cursor-agent", "autonomous") => {
            cmd.arg("-p");
            cmd.arg("--trust");
            if let Some(p) = prompt {
                cmd.arg(p);
            }
        }
        // interactive (default) — a seed prompt becomes the first message.
        (_, _) => {
            if let Some(p) = prompt {
                cmd.arg(p);
            }
        }
    }
    Ok(cmd)
}

/// A short human label for a session — e.g. "claude · hammerstein".
fn session_label(agent: &str, cwd: &str) -> String {
    let base = Path::new(cwd)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(cwd);
    let agent = if agent == "cursor-agent" { "cursor" } else { agent };
    format!("{agent} · {base}")
}

/// Spawn a session under a PTY — the shared path for the spawn command
/// and the request-file watcher. Starts the reader thread and emits
/// `session-spawned` so the frontend opens a tab.
fn do_spawn(
    app: &AppHandle,
    agent: String,
    cwd: String,
    prompt: Option<String>,
    mode: String,
) -> Result<SessionInfo, String> {
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;

    let cmd = build_command(&agent, &cwd, prompt.as_deref(), &mode)?;
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn {agent}: {e}"))?;
    // The child now holds the slave; drop our handle so the master sees
    // EOF when the child exits.
    drop(pair.slave);

    let pid = child.process_id();
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader: {e}"))?;

    let id = format!("s{}", NEXT_ID.fetch_add(1, Ordering::SeqCst));

    // Reader thread — owns the child + the output reader. Streams output;
    // on EOF reaps the child and signals exit.
    let app_for_reader = app.clone();
    let id_for_reader = id.clone();
    let label = session_label(&agent, &cwd);
    std::thread::spawn(move || {
        let mut child = child;
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_for_reader.emit(
                        "pty-output",
                        PtyOutput {
                            id: id_for_reader.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = child.wait();
        // Native notification — for a dispatched session you tabbed away from.
        let _ = app_for_reader
            .notification()
            .builder()
            .title("GeneralStaff")
            .body(format!("Session ended — {label}"))
            .show();
        let _ = app_for_reader.emit("pty-exit", PtyExit { id: id_for_reader });
    });

    let info = SessionInfo {
        id: id.clone(),
        agent: agent.clone(),
        cwd: cwd.clone(),
        mode: mode.clone(),
        status: "running".into(),
    };

    app.state::<SessionManager>().sessions.lock().unwrap().insert(
        id.clone(),
        Session {
            id,
            agent,
            cwd,
            mode,
            pid,
            master: pair.master,
            writer,
        },
    );

    let _ = app.emit("session-spawned", info.clone());
    Ok(info)
}

/// Spawn a child agent session under a PTY. Output arrives via
/// `pty-output` events; the new tab opens on the `session-spawned` event.
#[tauri::command]
pub fn spawn_session(
    app: AppHandle,
    agent: String,
    cwd: String,
    prompt: Option<String>,
    mode: String,
) -> Result<SessionInfo, String> {
    do_spawn(&app, agent, cwd, prompt, mode)
}

/// Write keystrokes (xterm.js `onData`) to a session's PTY.
#[tauri::command]
pub fn write_session(mgr: State<SessionManager>, id: String, data: String) -> Result<(), String> {
    let mut sessions = mgr.sessions.lock().unwrap();
    let s = sessions.get_mut(&id).ok_or("no such session")?;
    s.writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Resize a session's PTY to match the xterm.js viewport.
#[tauri::command]
pub fn resize_session(
    mgr: State<SessionManager>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let sessions = mgr.sessions.lock().unwrap();
    let s = sessions.get(&id).ok_or("no such session")?;
    s.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Terminate a session: SIGHUP the child (a terminal hangup), then drop
/// our PTY handles. The reader thread reaps the child and emits exit.
#[tauri::command]
pub fn kill_session(mgr: State<SessionManager>, id: String) -> Result<(), String> {
    let mut sessions = mgr.sessions.lock().unwrap();
    if let Some(s) = sessions.remove(&id) {
        if let Some(pid) = s.pid {
            unsafe {
                libc::kill(pid as libc::pid_t, libc::SIGHUP);
            }
        }
        // s (master + writer) drops here.
    }
    Ok(())
}

/// All live sessions.
#[tauri::command]
pub fn list_sessions(mgr: State<SessionManager>) -> Vec<SessionInfo> {
    mgr.sessions
        .lock()
        .unwrap()
        .values()
        .map(|s| SessionInfo {
            id: s.id.clone(),
            agent: s.agent.clone(),
            cwd: s.cwd.clone(),
            mode: s.mode.clone(),
            status: "running".into(),
        })
        .collect()
}

// ---------------------------------------------------------------------
// Dispatcher spawn requests — the gs-mcp tool drops a file here.
// ---------------------------------------------------------------------

/// Handle one spawn-request file: read it, consume it (delete), spawn.
fn handle_request(app: &AppHandle, path: &Path) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    // Consume the file once, even if it turns out malformed — no retry loop.
    let _ = std::fs::remove_file(path);
    let Ok(req) = serde_json::from_str::<SpawnRequest>(&text) else {
        return;
    };
    let cwd = match (req.cwd, req.project) {
        (Some(c), _) => c,
        (None, Some(p)) => match resolve_project_repo(&p) {
            Some(r) => r.display().to_string(),
            None => return,
        },
        (None, None) => return,
    };
    let _ = do_spawn(
        app,
        req.agent,
        cwd,
        req.prompt,
        req.mode.unwrap_or_else(|| "interactive".into()),
    );
}

/// Watch ~/.generalstaff-desktop/requests/ for spawn-request files
/// written by the gs-mcp stdio server (a dispatcher session's tool).
pub fn start_request_watcher(app: &AppHandle) {
    let dir = requests_dir();
    let _ = std::fs::create_dir_all(&dir);
    let app_handle = app.clone();

    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else {
            return;
        };
        for path in event.paths {
            if path.extension().and_then(|e| e.to_str()) == Some("json") && path.is_file() {
                handle_request(&app_handle, &path);
            }
        }
    });

    if let Ok(mut watcher) = watcher {
        if dir.is_dir() {
            let _ = watcher.watch(&dir, RecursiveMode::NonRecursive);
        }
        // Keep the watcher (and its background thread) alive for the app's life.
        Box::leak(Box::new(watcher));
    }
}
