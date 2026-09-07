// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    estaminet_lib::run()
}
