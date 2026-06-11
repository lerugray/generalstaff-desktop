//! The ambient fleet-awareness tray (gsd-053) — the inversion's first
//! surface. The tray is the persistent presence: it carries the
//! attention badge, the fleet situation menu, and the only Quit; the
//! main window is a detail view the tray summons. Closing the window
//! hides it (see on_window_event in lib.rs) — the tray is the app.

use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter,
};

const TRAY_ID: &str = "gs-tray";

/// Everything the tray shows, from one fleet scan + one inbox parse.
struct TraySummary {
    total_projects: usize,
    /// (project id, interactive-pending count) — most waiting first.
    attention: Vec<(String, u64)>,
    open_pings: usize,
    /// gsd-054 — pre-formatted "project: verdict 2h ago" lines, newest
    /// first, from the last 24h of fleet PROGRESS.jsonl cycle_end events.
    recent_verdicts: Vec<String>,
}

/// "5m ago" / "2h ago" / "3d ago" for the tray's verdict lines.
fn rel_time(secs: i64) -> String {
    let s = secs.max(0);
    if s < 60 {
        "just now".to_string()
    } else if s < 3_600 {
        format!("{}m ago", s / 60)
    } else if s < 86_400 {
        format!("{}h ago", s / 3_600)
    } else {
        format!("{}d ago", s / 86_400)
    }
}

fn summarize() -> TraySummary {
    let projects = crate::scan_fleet_projects();
    let total_projects = projects.len();
    // Parked projects (archived or required_attention=dormant) are filtered
    // the same way the dashboard's isParked does: a badge that counts them
    // reads high forever and goes numb, defeating the ambient thesis.
    let mut attention: Vec<(String, u64)> = projects
        .into_iter()
        .filter(|p| {
            p.interactive_pending > 0
                && !p.archived
                && p.required_attention.as_deref() != Some("dormant")
        })
        .map(|p| (p.id, p.interactive_pending))
        .collect();
    // Most waiting first; alphabetical tiebreak keeps the menu stable.
    attention.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let now = crate::epoch_now();
    let recent_verdicts = crate::fleet_cycle_ends(24)
        .cycles
        .into_iter()
        .take(3)
        .map(|c| {
            let when = crate::iso_to_epoch(&c.timestamp)
                .map(|t| rel_time(now - t))
                .unwrap_or_default();
            format!(
                "{}: {} {}",
                c.project_id,
                c.outcome.replace('_', " "),
                when
            )
        })
        .collect();
    TraySummary {
        total_projects,
        attention,
        open_pings: crate::open_ping_count(),
        recent_verdicts,
    }
}

/// Create the tray at startup, then fill badge + menu from the first
/// fleet scan.
pub(crate) fn init(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("GeneralStaff")
        .on_menu_event(on_menu_event)
        .build(app)?;
    refresh(app);
    Ok(())
}

/// Frontend hook — app.js calls this on its fleet reload cadence so the
/// tray tracks the same state the dashboard shows.
#[tauri::command]
pub fn refresh_tray(app: AppHandle) {
    refresh(&app);
}

/// Re-read the fleet + pings and rebuild badge + menu. The scan runs on
/// the caller's thread; the menu rebuild hops to the main thread, which
/// the platform menu APIs require.
pub(crate) fn refresh(app: &AppHandle) {
    let summary = summarize();
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || apply(&handle, &summary));
}

fn apply(app: &AppHandle, s: &TraySummary) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    // macOS shows the attention count as title text beside the icon.
    // Windows trays have no title; the count stays in the menu there.
    #[cfg(target_os = "macos")]
    {
        if s.attention.is_empty() {
            let _ = tray.set_title(None::<&str>);
        } else {
            let _ = tray.set_title(Some(s.attention.len().to_string()));
        }
    }
    if let Ok(menu) = build_menu(app, s) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu(app: &AppHandle, s: &TraySummary) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let situation = format!(
        "{} projects | {} need attention | {} open pings",
        s.total_projects,
        s.attention.len(),
        s.open_pings
    );
    menu.append(&MenuItem::with_id(
        app,
        "situation",
        situation,
        false,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    for (id, waiting) in s.attention.iter().take(3) {
        menu.append(&MenuItem::with_id(
            app,
            format!("tray-proj:{id}"),
            format!("{id} - {waiting} waiting"),
            true,
            None::<&str>,
        )?)?;
    }
    if !s.attention.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    menu.append(&MenuItem::with_id(
        app,
        "tray-pings",
        format!("Open pings ({})", s.open_pings),
        true,
        None::<&str>,
    )?)?;
    // gsd-054 — the bot's latest verdicts, ambient (disabled lines).
    if !s.recent_verdicts.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        for (i, line) in s.recent_verdicts.iter().enumerate() {
            menu.append(&MenuItem::with_id(
                app,
                format!("tray-verdict-{i}"),
                line,
                false,
                None::<&str>,
            )?)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "show",
        "Show GeneralStaff",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)?;
    Ok(menu)
}

/// Tray menu actions. Project + ping items surface the main window and
/// emit an event app.js routes to the matching dashboard view.
fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        "show" => crate::surface_main(app),
        "quit" => app.exit(0),
        "tray-pings" => {
            crate::surface_main(app);
            let _ = app.emit("tray-open-briefing", ());
        }
        other => {
            if let Some(project) = other.strip_prefix("tray-proj:") {
                crate::surface_main(app);
                let _ = app.emit("tray-open-project", project.to_string());
            }
        }
    }
}
