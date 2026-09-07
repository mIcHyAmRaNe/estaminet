mod commands;
pub mod config;
mod error;
mod network;
mod utils;

use commands::{auth, chat, logs, taverne};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(network::session::AppState::default())
        .invoke_handler(tauri::generate_handler![
            taverne::get_taverns,
            taverne::get_taverne_places,
            taverne::get_portrait_json,
            auth::login,
            auth::try_auto_login,
            auth::try_auto_login_for,
            auth::get_saved_login,
            auth::list_accounts,
            auth::save_account,
            auth::remove_account,
            auth::ws_disconnect,
            auth::logout,
            auth::disconnect,
            auth::is_connected,
            auth::get_session_login,
            chat::ws_connect,
            chat::ws_send,
            chat::change_place,
            logs::save_chat_log,
            logs::get_log_dir,
            logs::get_full_log
        ])
        .run(tauri::generate_context!())
        .expect("Error while running the Tauri application");
}
