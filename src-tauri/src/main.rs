// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod services;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::folder::scan_folder,
            commands::folder::find_duplicates,
            commands::folder::get_thumbnail,
            commands::folder::open_image,
            commands::folder::sort_images_by_date,
            commands::folder::delete_images,
            commands::folder::move_images
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
