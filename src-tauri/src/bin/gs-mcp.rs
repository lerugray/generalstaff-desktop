//! gs-mcp — a tiny stdio MCP server for GeneralStaff Desktop.
//!
//! It exposes one tool, `spawn_session`, to a Claude Code session. When
//! the session (acting as a dispatcher) calls the tool, gs-mcp writes a
//! spawn-request file into ~/.generalstaff-desktop/requests/; the running
//! GS Desktop app watches that directory and opens the session as a tab.
//!
//! Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout (the MCP
//! stdio transport). Only stdout carries protocol messages — anything
//! else goes to stderr.

use std::io::{BufRead, Write};

use serde_json::{json, Value};

fn requests_dir() -> std::path::PathBuf {
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    home.join(".generalstaff-desktop").join("requests")
}

/// The single tool's JSON-Schema declaration.
fn tool_schema() -> Value {
    json!({
        "name": "spawn_session",
        "description": "Open a new agent session as a tab in the GeneralStaff Desktop cockpit. Use this to dispatch an interactive or autonomous claude / cursor-agent session in a fleet project's repo, straight from this conversation.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": {
                    "type": "string",
                    "enum": ["claude", "cursor-agent"],
                    "description": "Which agent to run."
                },
                "project": {
                    "type": "string",
                    "description": "Fleet project id (e.g. 'retrogaze'); its code repo is resolved automatically."
                },
                "cwd": {
                    "type": "string",
                    "description": "Absolute working directory — an alternative to `project`."
                },
                "prompt": {
                    "type": "string",
                    "description": "Optional seed prompt — becomes the session's first message."
                },
                "mode": {
                    "type": "string",
                    "enum": ["interactive", "autonomous"],
                    "description": "interactive (default) or autonomous (a headless run)."
                }
            },
            "required": ["agent"]
        }
    })
}

/// Write a spawn-request file; returns a human-readable ack on success.
fn write_request(args: &Value) -> Result<String, String> {
    let agent = args.get("agent").and_then(|v| v.as_str()).unwrap_or("");
    if agent != "claude" && agent != "cursor-agent" {
        return Err(format!("unknown agent: '{agent}' (use claude or cursor-agent)"));
    }
    if args.get("project").and_then(|v| v.as_str()).is_none()
        && args.get("cwd").and_then(|v| v.as_str()).is_none()
    {
        return Err("a `project` id or an explicit `cwd` is required".into());
    }

    let dir = requests_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut req = serde_json::Map::new();
    req.insert("agent".into(), json!(agent));
    for key in ["project", "cwd", "prompt", "mode"] {
        if let Some(v) = args.get(key) {
            if !v.is_null() {
                req.insert(key.into(), v.clone());
            }
        }
    }
    let body = serde_json::to_string(&Value::Object(req)).map_err(|e| e.to_string())?;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    // Write to a temp name, then rename — the watcher only ever sees a
    // complete `.json` file.
    let tmp = dir.join(format!("{nanos}.json.tmp"));
    let fin = dir.join(format!("{nanos}.json"));
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &fin).map_err(|e| e.to_string())?;

    let target = args
        .get("project")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("cwd").and_then(|v| v.as_str()))
        .unwrap_or("(unspecified)");
    Ok(format!(
        "Session requested: {agent} in {target}. A tab is opening in GeneralStaff Desktop."
    ))
}

/// Handle one JSON-RPC message; `None` for notifications (no reply).
fn handle(msg: &Value) -> Option<Value> {
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = msg.get("id").cloned().unwrap_or(Value::Null);

    match method {
        "initialize" => {
            let pv = msg
                .get("params")
                .and_then(|p| p.get("protocolVersion"))
                .and_then(|v| v.as_str())
                .unwrap_or("2025-06-18")
                .to_string();
            Some(json!({
                "jsonrpc": "2.0", "id": id,
                "result": {
                    "protocolVersion": pv,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "gs-desktop", "version": "0.1.0" }
                }
            }))
        }
        "tools/list" => Some(json!({
            "jsonrpc": "2.0", "id": id,
            "result": { "tools": [tool_schema()] }
        })),
        "tools/call" => {
            let args = msg
                .get("params")
                .and_then(|p| p.get("arguments"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            match write_request(&args) {
                Ok(text) => Some(json!({
                    "jsonrpc": "2.0", "id": id,
                    "result": { "content": [{ "type": "text", "text": text }] }
                })),
                Err(e) => Some(json!({
                    "jsonrpc": "2.0", "id": id,
                    "result": {
                        "content": [{ "type": "text", "text": format!("spawn failed: {e}") }],
                        "isError": true
                    }
                })),
            }
        }
        "ping" => Some(json!({ "jsonrpc": "2.0", "id": id, "result": {} })),
        // Notifications (notifications/initialized, etc.) — no reply.
        m if m.starts_with("notifications/") => None,
        "" => None,
        _ => Some(json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": -32601, "message": format!("method not found: {method}") }
        })),
    }
}

fn main() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(reply) = handle(&msg) {
            if let Ok(s) = serde_json::to_string(&reply) {
                let _ = writeln!(stdout, "{s}");
                let _ = stdout.flush();
            }
        }
    }
}
