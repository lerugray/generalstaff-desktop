//! GeneralStaff Desktop — the command console for the GeneralStaff
//! dev-fleet orchestrator.
//!
//! Strictly a viewer/controller over GeneralStaff's file-based state:
//! it reads state to display it and drives the `gs` CLI for actions;
//! it never writes GS state files directly.
//!
//! v0.0.1 / gsd-001 — the native shell only: the window, the fleet
//! rail, the main area, and the tray icon. No data is wired yet;
//! gsd-002 adds the fleet state layer.

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

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
        .setup(|app| {
            // Tray icon — a persistent menu-bar presence. v0.0.1 ships a
            // static icon; gsd-002 will drive it from live fleet status.
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
