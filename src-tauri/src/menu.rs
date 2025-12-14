// src-tauri/src/menu.rs
use tauri::{
    menu::{Menu, MenuBuilder, SubmenuBuilder},
    AppHandle, Emitter, Runtime,
};

/// Build the app menu and attach it to the app.
pub fn init_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // --- File menu ---
    let file_menu = SubmenuBuilder::new(app, "File")
        .text("file-open", "Open…")
        .text("file-save", "Save As…")
        .text("file-extract", "Extract…")
        .separator()
        .text("file-close-tab", "Close Tab")
        .build()?;

    // --- Edit menu ---
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .text("edit-add-files", "Add Files…")
        .text("edit-remove-files", "Remove Selected")
        .build()?;

    // --- Help menu ---
    let help_menu = SubmenuBuilder::new(app, "Help")
        .text("help-about", "About Capsule")
        .build()?;

    // Top-level menubar
    let menu: Menu<_> = MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &help_menu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

/// Wire menu click → JS events like "menu://file-open"
pub fn wire_menu_events<R: Runtime>(app: &AppHandle<R>) {
    app.on_menu_event(|app_handle, event| {
        let id = event.id().0.as_str();
        let name = match id {
            "file-open" => "menu://file-open",
            "file-save" => "menu://file-save",
            "file-extract" => "menu://file-extract",
            "file-close-tab" => "menu://file-close-tab",
            "edit-add-files" => "menu://edit-add-files",
            "edit-remove-files" => "menu://edit-remove-files",
            "help-about" => "menu://help-about",
            _ => return,
        };

        // Fire a JS event that you can `listen()` to in main.ts
        let _ = app_handle.emit(name, ());
    });
}
