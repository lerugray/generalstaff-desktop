//! Child-session management — runs the real `claude` / `cursor-agent`
//! CLI processes under a PTY, streams their output to the frontend, and
//! routes keystrokes back. The desktop wraps Claude Code; it does not
//! reimplement it. See docs/SESSION-COCKPIT-PLAN.md.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::home_dir;

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

/// Build the agent command — explicit environment, cwd, and the args
/// for the requested mode.
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

/// Spawn a child agent session under a PTY. Returns once the process is
/// running; output arrives asynchronously via `pty-output` events.
#[tauri::command]
pub fn spawn_session(
    app: AppHandle,
    mgr: State<SessionManager>,
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
        let _ = app_for_reader.emit("pty-exit", PtyExit { id: id_for_reader });
    });

    let info = SessionInfo {
        id: id.clone(),
        agent: agent.clone(),
        cwd: cwd.clone(),
        mode: mode.clone(),
        status: "running".into(),
    };

    mgr.sessions.lock().unwrap().insert(
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

    Ok(info)
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
