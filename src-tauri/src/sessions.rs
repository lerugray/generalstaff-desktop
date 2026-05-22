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
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{home_dir, resolve_project_repo};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// One live child session. The PTY master (for resize) and the input
/// writer live here; the child handle and the output reader are owned
/// by the per-session reader thread, which reaps the child on exit.
///
/// `killer` is a cloned cross-platform handle for sending a kill signal
/// to the child without needing the raw PID — avoids Unix-only
/// `libc::kill` and works on Windows via portable-pty's ConPTY path.
struct Session {
    id: String,
    agent: String,
    cwd: String,
    mode: String,
    /// Raw process id — kept for diagnostics / future use; kill goes
    /// through `killer` instead (cross-platform).
    #[allow(dead_code)]
    pid: Option<u32>,
    killer: Box<dyn ChildKiller + Send + Sync>,
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
    /// Resume the agent's prior conversation in the repo, not start fresh.
    resume: Option<bool>,
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
    // On Windows, executables have a .exe extension.
    #[cfg(windows)]
    let exe_name = format!("{exe}.exe");
    #[cfg(unix)]
    let exe_name = exe.to_string();

    if let Some(home) = home_dir() {
        let local = home.join(".local").join("bin").join(&exe_name);
        if local.exists() {
            return Ok(local);
        }
    }
    #[cfg(unix)]
    {
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            let p = PathBuf::from(dir).join(&exe_name);
            if p.exists() {
                return Ok(p);
            }
        }
    }
    #[cfg(windows)]
    {
        // cursor-agent's Windows installer lands in %LOCALAPPDATA%\Programs\
        // or %LOCALAPPDATA%\cursor-agent\; Anthropic's Windows CLI may land
        // in %LOCALAPPDATA%\Programs\ or be on PATH via npm.
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let lad = std::path::Path::new(&local_app_data);
            for subdir in ["Programs", "cursor-agent"] {
                let p = lad.join(subdir).join(&exe_name);
                if p.exists() {
                    return Ok(p);
                }
            }
        }
    }
    // Last resort: bare name, resolved against the PATH set below.
    Ok(PathBuf::from(&exe_name))
}

/// A known-good PATH for spawned agents — explicit dirs first, then the
/// inherited PATH. Pre-empts the `command not found` class of failure.
fn agent_path() -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(home) = home_dir() {
        parts.push(home.join(".local").join("bin").display().to_string());
    }
    #[cfg(unix)]
    {
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            parts.push(dir.to_string());
        }
    }
    #[cfg(windows)]
    {
        // Windows-standard install locations for claude / cursor-agent.
        // %LOCALAPPDATA%\Programs\ is where cursor-agent's Windows installer
        // places the binary; %LOCALAPPDATA%\cursor-agent\ is also used.
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let lad = std::path::Path::new(&local_app_data);
            parts.push(lad.join("Programs").display().to_string());
            parts.push(lad.join("cursor-agent").display().to_string());
        }
        // Anthropic's Windows CLI installer typically lands in AppData\Local\Programs
        // or %APPDATA%\npm (if installed via npm/npx). Include both.
        if let Ok(appdata) = std::env::var("APPDATA") {
            let ad = std::path::Path::new(&appdata);
            parts.push(ad.join("npm").display().to_string());
        }
    }
    let sep = if cfg!(windows) { ";" } else { ":" };
    if let Ok(existing) = std::env::var("PATH") {
        parts.push(existing);
    }
    parts.join(sep)
}

/// ~/.generalstaff-desktop/requests/ — the spawn-request drop directory.
fn requests_dir() -> PathBuf {
    home_dir()
        .unwrap_or_default()
        .join(".generalstaff-desktop")
        .join("requests")
}

/// ~/.generalstaff-desktop/theme-kind — a one-line "light" or "dark"
/// classification of the active GSD palette, written by the frontend on
/// every `applyTheme` (gsd-046). Read at spawn time so `claude` is told
/// to render with the matching ANSI-palette theme — see `build_command`.
fn theme_kind_file() -> PathBuf {
    home_dir()
        .unwrap_or_default()
        .join(".generalstaff-desktop")
        .join("theme-kind")
}

fn current_theme_kind() -> String {
    std::fs::read_to_string(theme_kind_file())
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// Persist the active palette's light/dark classification so the next
/// `claude` spawn can pick the matching ANSI-palette theme. JS calls this
/// from `applyTheme` (gsd-046).
#[tauri::command]
pub fn set_theme_kind(kind: String) -> Result<(), String> {
    let path = theme_kind_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, kind).map_err(|e| e.to_string())
}

/// The `gs-mcp` stdio MCP server binary — built alongside the app, so it
/// sits next to the app executable.
fn gs_mcp_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let p = exe.parent()?.join("gs-mcp");
    p.exists().then_some(p)
}

/// The bundled orchestration-discipline instruction — appended to a
/// spawned `claude` session's system prompt so a dispatcher session
/// (one that opens child tabs via the gs-mcp tool) keeps its context
/// window lean. Resolved from two locations, in order:
///   1. The Tauri resource dir — where `tauri.conf.json`'s
///      `bundle.resources` places it in the installed app.
///        macOS: `Contents/Resources/`, a sibling of `Contents/MacOS/`
///               (which holds the executable).
///        Windows: resources are placed beside the `.exe` by Tauri.
///   2. The dev-tree source path (`src-tauri/resources/…` via
///      `CARGO_MANIFEST_DIR`) — the unbundled `cargo run` / `tauri dev`
///      loop, where there is no bundled resources dir.
/// Returns None if neither exists; the caller then simply omits the
/// flag rather than failing the spawn.
fn orchestration_instruction_path() -> Option<PathBuf> {
    const NAME: &str = "orchestration-discipline.md";
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            #[cfg(target_os = "macos")]
            {
                // …/Contents/MacOS/<exe>  ->  …/Contents/Resources/<NAME>
                if let Some(contents) = exe_dir.parent() {
                    let bundled = contents.join("Resources").join(NAME);
                    if bundled.is_file() {
                        return Some(bundled);
                    }
                }
            }
            #[cfg(windows)]
            {
                // Tauri on Windows places bundled resources beside the .exe.
                let beside = exe_dir.join(NAME);
                if beside.is_file() {
                    return Some(beside);
                }
            }
            // Fallback for non-macOS Unix (Linux) and any layout where
            // resources land beside the executable.
            #[cfg(not(any(target_os = "macos", windows)))]
            {
                let beside = exe_dir.join(NAME);
                if beside.is_file() {
                    return Some(beside);
                }
            }
        }
    }
    // Dev tree: src-tauri/resources/<NAME>.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(NAME);
    dev.is_file().then_some(dev)
}

/// ~/.generalstaff-desktop/settings.json — persisted app settings (a
/// flat JSON object). Parallels `sessions.json` and `theme-kind`;
/// distinct from the user-hand-edited `config.json` (path config), so a
/// settings write can never clobber `generalstaff_path`.
fn settings_file() -> PathBuf {
    home_dir()
        .unwrap_or_default()
        .join(".generalstaff-desktop")
        .join("settings.json")
}

/// Claude Code's real `--effort` levels (from `claude --help`). The
/// frontend control offers exactly these; `claude_effort()` validates
/// against this list so a stale or hand-edited settings.json can never
/// feed `claude` an unknown value.
const CLAUDE_EFFORT_LEVELS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// Default Claude effort — `max`. Spawning a session with no persisted
/// setting (or an invalid one) keeps the pre-gsd-036 behaviour exactly.
const DEFAULT_CLAUDE_EFFORT: &str = "max";

/// The configured `claude --effort` level (gsd-036). Reads
/// `settings.json` -> `claude_effort`; falls back to `max` if the file
/// is absent, unparseable, or holds a value not in CLAUDE_EFFORT_LEVELS.
fn claude_effort() -> String {
    let parsed = std::fs::read_to_string(settings_file())
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| {
            v.get("claude_effort")
                .and_then(|x| x.as_str())
                .map(str::to_string)
        });
    match parsed {
        Some(e) if CLAUDE_EFFORT_LEVELS.contains(&e.as_str()) => e,
        _ => DEFAULT_CLAUDE_EFFORT.to_string(),
    }
}

/// All persisted app settings, for the settings UI. Currently effort
/// level + the autonomous-mode consent flag. An object so future
/// settings extend it without a new command. Always returns a value —
/// defaults fill any missing field.
#[derive(Serialize)]
pub struct AppSettings {
    claude_effort: String,
    /// The real `--effort` levels — lets the UI build the control
    /// without hardcoding (and drifting from) the list.
    effort_levels: Vec<String>,
    /// True once the operator has acknowledged the autonomous-mode
    /// security warning (no sandbox, no per-action approval).
    autonomous_consent_given: bool,
}

/// Read the persisted app settings (gsd-036).
#[tauri::command]
pub fn get_settings() -> AppSettings {
    let obj = std::fs::read_to_string(settings_file())
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    let autonomous_consent_given = obj
        .as_ref()
        .and_then(|v| v.get("autonomous_consent_given"))
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    AppSettings {
        claude_effort: claude_effort(),
        effort_levels: CLAUDE_EFFORT_LEVELS.iter().map(|s| s.to_string()).collect(),
        autonomous_consent_given,
    }
}

/// Record that the operator has explicitly acknowledged the autonomous-mode
/// security warning. Persists `autonomous_consent_given: true` to
/// settings.json — the consent modal is then suppressed for all future
/// sessions on this machine.
#[tauri::command]
pub fn set_autonomous_consent() -> Result<(), String> {
    let path = settings_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Preserve any other keys already in the file.
    let mut obj = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&t).ok())
        .unwrap_or_default();
    obj.insert(
        "autonomous_consent_given".into(),
        serde_json::Value::Bool(true),
    );
    let json =
        serde_json::to_string_pretty(&serde_json::Value::Object(obj)).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Persist the Claude effort level (gsd-036). Rejects a value outside
/// CLAUDE_EFFORT_LEVELS so the UI cannot write a level `claude` would
/// reject. Read-modify-writes settings.json to preserve other keys.
#[tauri::command]
pub fn set_claude_effort(effort: String) -> Result<(), String> {
    if !CLAUDE_EFFORT_LEVELS.contains(&effort.as_str()) {
        return Err(format!("unknown effort level: {effort}"));
    }
    let path = settings_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Preserve any other keys already in the file.
    let mut obj = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&t).ok())
        .unwrap_or_default();
    obj.insert(
        "claude_effort".into(),
        serde_json::Value::String(effort),
    );
    let json =
        serde_json::to_string_pretty(&serde_json::Value::Object(obj)).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Build the agent command — explicit environment, cwd, the dispatcher
/// MCP tool (claude only), and the args for the requested mode.
///
/// gsd-022 — argument-construction discipline. `claude`'s arg parser
/// makes ordering load-bearing, so the args are emitted in three strict
/// phases and the positional prompt is emitted in exactly ONE place:
///   Phase 1 — fixed-arity flags + their values (each consumes exactly
///             one following token, so they are order-independent among
///             themselves and safe to place before the prompt).
///   Phase 2 — the positional seed prompt (at most one bare argument).
///   Phase 3 — variadic `--mcp-config` (consumes EVERY following bare
///             argument), therefore strictly last.
/// A flag added in the wrong phase is the failure class this structure
/// exists to prevent — keep new flags in Phase 1.
fn build_command(
    agent: &str,
    cwd: &str,
    prompt: Option<&str>,
    mode: &str,
    resume: bool,
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
    // gsd-047 — cursor-agent has no `--settings theme` flag, so the
    // equivalent of claude's `*-ansi` mode is `FORCE_COLOR=1`, the chalk
    // env that caps the renderer at the 16-color ANSI palette our xterm
    // theme controls. Without this the input prompt block on light
    // palettes had a subtle cool-tinted bg that didn't match the warm
    // paper (a milder version of the same issue gsd-046 fixed for
    // claude). Setting it on claude too is harmless — claude's `*-ansi`
    // mode already limits itself to ANSI 16 — but scoping to cursor-agent
    // keeps the intent narrow.
    if agent == "cursor-agent" {
        cmd.env("FORCE_COLOR", "1");
    }

    // ---- Phase 1: fixed-arity flags + values ------------------------
    // Every flag below consumes exactly one following token, so they
    // are safe to emit in any order here and never swallow the prompt.

    if agent == "claude" {
        // Effort level (gsd-036) — was hardcoded `max`; now read from
        // settings.json, still defaulting to `max`. `--effort` takes
        // exactly one value (an enum: low|medium|high|xhigh|max).
        cmd.arg("--effort");
        cmd.arg(claude_effort());

        // gsd-046 follow-on to gsd-045 — force claude's `*-ansi` theme so
        // its UI sticks to the 16-color ANSI palette (which our xterm
        // theme controls) instead of imposing a hardcoded light/dark
        // truecolor bg on transcript user-message blocks. Before this,
        // the echoed user message rendered with claude's own light-gray
        // bg on every GSD palette — a cool block sitting on warm paper.
        // With `light-ansi` / `dark-ansi` selected, that block inherits
        // the terminal bg (var(--paper)) and the rest of claude's chrome
        // resolves through our ANSI mapping.
        let theme = if current_theme_kind() == "dark" {
            "dark-ansi"
        } else {
            "light-ansi"
        };
        cmd.arg("--settings");
        cmd.arg(format!("{{\"theme\":\"{}\"}}", theme));

        // gsd-052 — carry the orchestration-discipline instruction into
        // every spawned claude session via `--append-system-prompt` (a
        // fixed-arity flag — one value). A dispatcher session that opens
        // child tabs is exactly the long-lived orchestrator the
        // instruction targets. Omitted (not fatal) if the resource file
        // is missing. cursor-agent has no equivalent flag — left as-is.
        if let Some(p) = orchestration_instruction_path() {
            if let Ok(text) = std::fs::read_to_string(&p) {
                let text = text.trim();
                if !text.is_empty() {
                    cmd.arg("--append-system-prompt");
                    cmd.arg(text);
                }
            }
        }
    }

    // Restore path: resume the agent's prior conversation in this repo
    // rather than starting fresh. `claude --continue` reopens the latest
    // session in the cwd — no session id needed, so no terminal-stream
    // parsing (the audit's prohibition holds). `--continue` is a bare
    // flag (no value), safe in Phase 1. cursor-agent has no id-free
    // resume flag, so a restored cursor session starts fresh.
    if resume && agent == "claude" {
        cmd.arg("--continue");
    }

    // Autonomous mode flags. `-p` / `--trust` are bare; `--permission-
    // mode` takes exactly one value — all fixed-arity, all Phase 1, so
    // the seed prompt (Phase 2, below) is never swallowed by them.
    match (agent, mode) {
        ("claude", "autonomous") => {
            cmd.arg("-p");
            cmd.arg("--permission-mode");
            cmd.arg("bypassPermissions");
        }
        ("cursor-agent", "autonomous") => {
            cmd.arg("-p");
            cmd.arg("--trust");
        }
        // interactive (default) — no extra flags; the seed prompt below
        // becomes the first message.
        (_, _) => {}
    }

    // ---- Phase 2: the positional seed prompt ------------------------
    // Emitted in exactly one place for all (agent, mode) combinations.
    if let Some(p) = prompt {
        cmd.arg(p);
    }

    // ---- Phase 3: variadic `--mcp-config` (claude only) -------------
    // The gs-mcp dispatcher tool. `--mcp-config` is variadic
    // (`--mcp-config <configs...>`): any bare argument after it is
    // swallowed as another config, so a seed prompt placed after it
    // makes claude try to open the prompt as a file and die with
    // ENAMETOOLONG. It MUST be last. This is what lets a claude session
    // open child session tabs straight from chat.
    if agent == "claude" {
        if let Some(mcp) = gs_mcp_path() {
            let cfg = serde_json::json!({
                "mcpServers": { "gs": { "command": mcp.display().to_string() } }
            })
            .to_string();
            cmd.arg("--mcp-config");
            cmd.arg(cfg);
        }
    }

    Ok(cmd)
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
    resume: bool,
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

    let cmd = build_command(&agent, &cwd, prompt.as_deref(), &mode, resume)?;
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn {agent}: {e}"))?;
    // The child now holds the slave; drop our handle so the master sees
    // EOF when the child exits.
    drop(pair.slave);

    let pid = child.process_id();
    // Clone a cross-platform kill handle *before* the child moves into the
    // reader thread. Used by kill_session_id on both Unix and Windows.
    let killer = child.clone_killer();
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
        // The frontend owns the session-ended notification — it knows
        // which tab is active, so it notifies only for a session the
        // operator is not currently watching (gsd-031).
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
            killer,
            master: pair.master,
            writer,
        },
    );

    let _ = app.emit("session-spawned", info.clone());
    Ok(info)
}

/// Validate that `cwd` is an existing, absolute directory — required
/// before passing it to `do_spawn`. Returns an error string if not.
fn validate_cwd(cwd: &str) -> Result<(), String> {
    let path = std::path::Path::new(cwd);
    if !path.is_absolute() {
        return Err(format!("cwd must be an absolute path: {cwd}"));
    }
    if !path.is_dir() {
        return Err(format!("cwd does not exist or is not a directory: {cwd}"));
    }
    Ok(())
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
    resume: bool,
) -> Result<SessionInfo, String> {
    validate_cwd(&cwd)?;
    do_spawn(&app, agent, cwd, prompt, mode, resume)
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

/// Terminate a session by id: signal the child via the portable-pty
/// `ChildKiller` handle (cross-platform — SIGHUP on Unix, TerminateProcess
/// on Windows via ConPTY), then drop our PTY handles. The reader thread
/// reaps the child and emits exit. Shared by the kill_session command and
/// the popped-out window's close handler.
pub fn kill_session_id(mgr: &SessionManager, id: &str) {
    let mut sessions = mgr.sessions.lock().unwrap();
    if let Some(mut s) = sessions.remove(id) {
        // portable-pty's ChildKiller::kill() is cross-platform:
        //   Unix  — sends SIGHUP to the process group
        //   Windows — calls TerminateProcess via the ConPTY path
        // Errors are ignored: if the child already exited the kill is a no-op.
        let _ = s.killer.kill();
        // s (master + writer) drops here.
    }
}

/// Terminate a session — the tab-close command.
#[tauri::command]
pub fn kill_session(mgr: State<SessionManager>, id: String) -> Result<(), String> {
    kill_session_id(mgr.inner(), &id);
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
// Session layout — persist the open session tabs so a relaunch can
// reopen them. They reopen *dormant*: nothing re-spawns on launch; a
// click resumes the session. No surprise processes, no cost on open.
// ---------------------------------------------------------------------

/// One persisted session tab — enough to reopen it dormant and, on a
/// click, resume it (`claude --continue`).
#[derive(Serialize, Deserialize, Clone)]
pub struct PersistedSession {
    agent: String,
    cwd: String,
    mode: String,
}

/// ~/.generalstaff-desktop/sessions.json — the persisted tab layout.
fn sessions_file() -> PathBuf {
    home_dir()
        .unwrap_or_default()
        .join(".generalstaff-desktop")
        .join("sessions.json")
}

/// Persist the open session tabs — called by the frontend whenever a
/// session tab opens or closes.
#[tauri::command]
pub fn save_session_layout(sessions: Vec<PersistedSession>) -> Result<(), String> {
    let path = sessions_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&sessions).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// The persisted session tabs from the last run — reopened dormant on
/// launch. An empty list (not an error) when there is no saved layout.
#[tauri::command]
pub fn load_session_layout() -> Vec<PersistedSession> {
    std::fs::read_to_string(sessions_file())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
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
    // Validate that cwd is an existing, absolute directory before spawning.
    if validate_cwd(&cwd).is_err() {
        return;
    }
    let _ = do_spawn(
        app,
        req.agent,
        cwd,
        req.prompt,
        req.mode.unwrap_or_else(|| "interactive".into()),
        req.resume.unwrap_or(false),
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

// ---------------------------------------------------------------------
// gsd-022 — integration tests for `build_command`.
//
// `build_command`'s argument construction was never integration-tested
// and was treated as fragile. These tests exercise every spawn case
// (new claude session, --continue, autonomous, with --mcp-config, each
// effort value, cursor-agent) and assert the produced command — program
// path, arg order, and the three load-bearing invariants:
//   • `--mcp-config` is strictly last (it is variadic — a bare arg
//     after it is swallowed as another config file);
//   • the positional prompt is emitted exactly once, and never after
//     `--mcp-config`;
//   • each fixed-arity flag is immediately followed by its one value.
// One test also actually executes the resolved agent binary to confirm
// the program the spawn path selected is real and launchable.
// ---------------------------------------------------------------------
#[cfg(test)]
mod build_command_tests {
    use super::*;
    use std::ffi::OsString;
    use std::sync::Mutex;

    // The effort tests read and write the real
    // ~/.generalstaff-desktop/settings.json (claude_effort() has no
    // injection seam). Serialize them and restore the file so the
    // suite never leaves a machine's settings mutated.
    static SETTINGS_GUARD: Mutex<()> = Mutex::new(());

    /// The CLI args (everything after argv[0], the program path).
    fn args_of(cmd: &CommandBuilder) -> Vec<String> {
        cmd.get_argv()
            .iter()
            .skip(1)
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    /// Index of the first occurrence of `flag` in `args`, if present.
    fn pos(args: &[String], flag: &str) -> Option<usize> {
        args.iter().position(|a| a == flag)
    }

    /// Run `f` with settings.json set to `effort` (or removed if None),
    /// then restore whatever was there before. Holds SETTINGS_GUARD.
    fn with_effort_setting<F: FnOnce()>(effort: Option<&str>, f: F) {
        let _g = SETTINGS_GUARD.lock().unwrap_or_else(|e| e.into_inner());
        let path = settings_file();
        let original = std::fs::read_to_string(&path).ok();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match effort {
            Some(e) => {
                let body = serde_json::json!({ "claude_effort": e }).to_string();
                std::fs::write(&path, body).expect("write test settings.json");
            }
            None => {
                let _ = std::fs::remove_file(&path);
            }
        }
        f();
        // Restore.
        match original {
            Some(text) => std::fs::write(&path, text).expect("restore settings.json"),
            None => {
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    /// The three gsd-022 invariants, asserted on any built command.
    fn assert_arg_invariants(args: &[String]) {
        // Invariant 1: at most one `--mcp-config`, and if present it is
        // the second-to-last token (flag) with its single value last.
        let mcp_count = args.iter().filter(|a| *a == "--mcp-config").count();
        assert!(mcp_count <= 1, "--mcp-config must appear at most once");
        if let Some(i) = pos(args, "--mcp-config") {
            assert_eq!(
                i,
                args.len() - 2,
                "--mcp-config must be the last flag (got args: {args:?})"
            );
        }
        // Invariant 2: every fixed-arity flag is followed by a value
        // that is not itself another flag. (`--mcp-config` and `-p`
        // handled separately: `-p` is bare; `--mcp-config` value is a
        // JSON blob, checked above.)
        for flag in ["--effort", "--settings", "--append-system-prompt", "--permission-mode"] {
            if let Some(i) = pos(args, flag) {
                let val = args
                    .get(i + 1)
                    .unwrap_or_else(|| panic!("{flag} has no value (args: {args:?})"));
                assert!(
                    !val.starts_with("--"),
                    "{flag}'s value looks like a flag: {val:?}"
                );
            }
        }
    }

    /// Walk `args` the way Claude Code's parser does — consume each
    /// known flag with its values — and return every leftover token
    /// (the positionals). This models the real parser, so it catches a
    /// flag-value being mistaken for the prompt, or the prompt being
    /// swallowed by the variadic `--mcp-config`. Returns (positionals,
    /// index-of-each-positional).
    fn positionals(args: &[String]) -> Vec<(usize, String)> {
        // Fixed-arity flags that consume exactly one following token.
        const ONE_VALUE: [&str; 4] =
            ["--effort", "--settings", "--append-system-prompt", "--permission-mode"];
        // Bare flags that consume nothing (claude + cursor-agent).
        const BARE: [&str; 3] = ["-p", "--continue", "--trust"];
        let mut out = Vec::new();
        let mut i = 0;
        while i < args.len() {
            let a = &args[i];
            if a == "--mcp-config" {
                // Variadic — swallows itself + every remaining token.
                break;
            } else if ONE_VALUE.contains(&a.as_str()) {
                i += 2; // skip flag + its value
            } else if BARE.contains(&a.as_str()) {
                i += 1; // skip the bare flag
            } else {
                out.push((i, a.clone()));
                i += 1;
            }
        }
        out
    }

    /// The seed prompt is emitted in exactly ONE place (Phase 2): it is
    /// the sole positional, and it always precedes `--mcp-config`. When
    /// no prompt is passed there must be zero positionals — proving no
    /// flag-value leaked out as a stray bare argument.
    fn assert_prompt_position(args: &[String], prompt: Option<&str>) {
        let pos_tokens = positionals(args);
        match prompt {
            None => assert!(
                pos_tokens.is_empty(),
                "no prompt was passed yet a positional appeared: {pos_tokens:?} (args: {args:?})"
            ),
            Some(p) => {
                assert_eq!(
                    pos_tokens.len(),
                    1,
                    "exactly one positional (the prompt) expected: {pos_tokens:?}"
                );
                assert_eq!(pos_tokens[0].1, p, "the positional is the seed prompt");
                // The prompt must come before --mcp-config (Phase 2 < 3).
                if let Some(mi) = pos(args, "--mcp-config") {
                    assert!(
                        pos_tokens[0].0 < mi,
                        "prompt must precede --mcp-config: {args:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn new_claude_interactive_session() {
        with_effort_setting(None, || {
            let cmd = build_command("claude", "/tmp", None, "interactive", false)
                .expect("build_command claude interactive");
            let args = args_of(&cmd);
            // Default effort is `max` when nothing is persisted.
            let ei = pos(&args, "--effort").expect("--effort present");
            assert_eq!(args[ei + 1], "max", "default effort is max");
            // The carryover instruction is appended.
            assert!(
                pos(&args, "--append-system-prompt").is_some(),
                "claude session gets --append-system-prompt"
            );
            assert_arg_invariants(&args);
            assert_prompt_position(&args, None);
        });
    }

    #[test]
    fn claude_session_with_seed_prompt() {
        with_effort_setting(None, || {
            let prompt = "do the thing";
            let cmd = build_command("claude", "/tmp", Some(prompt), "interactive", false)
                .expect("build_command claude with prompt");
            let args = args_of(&cmd);
            assert!(args.iter().any(|a| a == prompt), "prompt is in argv");
            assert_arg_invariants(&args);
            assert_prompt_position(&args, Some(prompt));
        });
    }

    #[test]
    fn claude_continue_session() {
        with_effort_setting(None, || {
            let cmd = build_command("claude", "/tmp", None, "interactive", true)
                .expect("build_command claude --continue");
            let args = args_of(&cmd);
            assert!(
                args.iter().any(|a| a == "--continue"),
                "resume=true adds --continue"
            );
            assert_arg_invariants(&args);
        });
    }

    #[test]
    fn claude_autonomous_session() {
        with_effort_setting(None, || {
            let prompt = "ship it";
            let cmd = build_command("claude", "/tmp", Some(prompt), "autonomous", false)
                .expect("build_command claude autonomous");
            let args = args_of(&cmd);
            assert!(args.iter().any(|a| a == "-p"), "autonomous adds -p");
            let pmi = pos(&args, "--permission-mode").expect("--permission-mode present");
            assert_eq!(
                args[pmi + 1], "bypassPermissions",
                "autonomous uses bypassPermissions"
            );
            // `-p` is bare — the very next token must NOT be the prompt.
            let pi = pos(&args, "-p").unwrap();
            assert_ne!(
                args.get(pi + 1).map(String::as_str),
                Some(prompt),
                "-p must not swallow the prompt"
            );
            assert_arg_invariants(&args);
            assert_prompt_position(&args, Some(prompt));
        });
    }

    #[test]
    fn claude_continue_autonomous_with_prompt() {
        // The densest case: resume + autonomous + prompt + mcp-config
        // all at once — the combination most likely to mis-order.
        with_effort_setting(None, || {
            let prompt = "resume and continue working";
            let cmd = build_command("claude", "/tmp", Some(prompt), "autonomous", true)
                .expect("build_command claude continue+autonomous");
            let args = args_of(&cmd);
            assert!(args.iter().any(|a| a == "--continue"));
            assert!(args.iter().any(|a| a == "-p"));
            assert!(args.iter().any(|a| a == prompt));
            assert_arg_invariants(&args);
            assert_prompt_position(&args, Some(prompt));
        });
    }

    #[test]
    fn every_effort_level_flows_through() {
        // gsd-036 — each real --effort value, when persisted, reaches
        // the built command; default (no setting) stays `max`.
        for level in ["low", "medium", "high", "xhigh", "max"] {
            with_effort_setting(Some(level), || {
                let cmd = build_command("claude", "/tmp", None, "interactive", false)
                    .expect("build_command per-effort");
                let args = args_of(&cmd);
                let ei = pos(&args, "--effort").expect("--effort present");
                assert_eq!(args[ei + 1], level, "effort {level} flows through");
                assert_arg_invariants(&args);
            });
        }
    }

    #[test]
    fn invalid_persisted_effort_falls_back_to_max() {
        // A stale or hand-corrupted settings.json must not feed claude
        // an unknown --effort value.
        with_effort_setting(Some("ludicrous"), || {
            assert_eq!(claude_effort(), "max", "bad effort falls back to max");
            let cmd = build_command("claude", "/tmp", None, "interactive", false)
                .expect("build_command bad-effort");
            let args = args_of(&cmd);
            let ei = pos(&args, "--effort").unwrap();
            assert_eq!(args[ei + 1], "max");
        });
    }

    #[test]
    fn set_claude_effort_rejects_unknown_value() {
        let _g = SETTINGS_GUARD.lock().unwrap_or_else(|e| e.into_inner());
        let path = settings_file();
        let original = std::fs::read_to_string(&path).ok();
        assert!(
            set_claude_effort("turbo".into()).is_err(),
            "set_claude_effort must reject an unknown level"
        );
        // A valid level round-trips through get_settings().
        set_claude_effort("high".into()).expect("set valid effort");
        assert_eq!(get_settings().claude_effort, "high");
        // effort_levels exposes exactly Claude Code's real values.
        assert_eq!(
            get_settings().effort_levels,
            vec!["low", "medium", "high", "xhigh", "max"]
        );
        match original {
            Some(text) => std::fs::write(&path, text).expect("restore"),
            None => {
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    #[test]
    fn cursor_agent_is_untouched_by_claude_only_flags() {
        // cursor-agent must get NONE of the claude-only flags: no
        // --effort, no --settings, no --append-system-prompt, no
        // --mcp-config, no --continue.
        let cmd = build_command("cursor-agent", "/tmp", Some("hi"), "interactive", true)
            .expect("build_command cursor-agent");
        let args = args_of(&cmd);
        for forbidden in [
            "--effort",
            "--settings",
            "--append-system-prompt",
            "--mcp-config",
            "--continue",
        ] {
            assert!(
                !args.iter().any(|a| a == forbidden),
                "cursor-agent must not get {forbidden} (args: {args:?})"
            );
        }
        // cursor-agent autonomous still gets -p and --trust.
        let auto = build_command("cursor-agent", "/tmp", Some("go"), "autonomous", false)
            .expect("build_command cursor-agent autonomous");
        let aargs = args_of(&auto);
        assert!(aargs.iter().any(|a| a == "-p"));
        assert!(aargs.iter().any(|a| a == "--trust"));
        // cursor-agent gets FORCE_COLOR=1 (gsd-047).
        assert_eq!(
            cmd.get_env("FORCE_COLOR"),
            Some(OsString::from("1").as_os_str()),
            "cursor-agent gets FORCE_COLOR=1"
        );
    }

    #[test]
    fn unknown_agent_is_rejected() {
        assert!(build_command("gpt", "/tmp", None, "interactive", false).is_err());
    }

    #[test]
    fn environment_and_cwd_are_set() {
        let cmd = build_command("claude", "/some/repo", None, "interactive", false)
            .expect("build_command env check");
        assert_eq!(cmd.get_cwd().map(|c| c.to_string_lossy().into_owned()), Some("/some/repo".into()));
        assert!(cmd.get_env("PATH").is_some(), "PATH is set explicitly");
        assert_eq!(
            cmd.get_env("TERM"),
            Some(OsString::from("xterm-256color").as_os_str()),
            "TERM is forced to xterm-256color"
        );
    }

    #[test]
    fn orchestration_instruction_resource_resolves() {
        // The bundled carryover instruction must be findable in the dev
        // tree (deliverable 1 + 2a). If this fails the resource file or
        // its path is wrong and --append-system-prompt would be omitted.
        let p = orchestration_instruction_path()
            .expect("orchestration-discipline.md must resolve");
        let text = std::fs::read_to_string(&p).expect("read instruction");
        assert!(
            text.contains("Orchestration context discipline"),
            "instruction file has unexpected content"
        );
    }

    #[test]
    fn produced_command_program_is_real_and_launchable() {
        // Actually execute the program the spawn path resolved for
        // `claude`, to confirm a real, runnable binary was selected.
        // We invoke it as `<program> --version` directly rather than
        // running the full built argv — the built command starts an
        // interactive/agent session (no clean non-interactive exit
        // without burning an API turn). A successful --version proves
        // resolve_agent_binary picked a launchable executable, which is
        // the spawn path's first failure point.
        let cmd = build_command("claude", "/tmp", None, "interactive", false)
            .expect("build_command for exec smoke");
        let program = cmd.get_argv()[0].clone();
        let out = std::process::Command::new(&program)
            .arg("--version")
            .output();
        match out {
            Ok(o) => assert!(
                o.status.success(),
                "`{} --version` exited non-zero",
                program.to_string_lossy()
            ),
            Err(e) => panic!(
                "could not execute resolved claude binary {}: {e}",
                program.to_string_lossy()
            ),
        }
    }
}
