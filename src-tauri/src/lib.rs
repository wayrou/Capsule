// src-tauri/src/lib.rs

mod commands;
mod menu;

use std::env;
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Keep only plugins that are actually in your Cargo.toml
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Setup: menu + menu events
        .setup(|app| {
            menu::init_menu(&app.handle())?;
            menu::wire_menu_events(&app.handle());

            // Handle "Open with Capsule" – first non-zero arg is the path
            let args: Vec<String> = env::args().collect();
            if args.len() > 1 {
                let path = args[1].clone();
                let _ = app.emit("open-with://file", path);
            }

            Ok(())
        })
        // Commands from src-tauri/src/commands.rs
        .invoke_handler(tauri::generate_handler![
            commands::open_archive,
            commands::extract_archive,
            commands::create_zip_archive,
            commands::add_files_to_zip,
            commands::remove_files_from_zip,
            commands::copy_file,
            commands::get_file_size,
            commands::preview_archive_entry,
            commands::extract_archive_entry_to_temp,
        ])
        // Run app
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
