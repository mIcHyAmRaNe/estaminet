use std::io::Write;

use crate::{error::AppError, utils::logs::log_path_for, utils::logs::hidden_log_dir};

#[tauri::command]
pub async fn save_chat_log(tavern_id: u64, content: String) -> Result<String, String> {
    let path = log_path_for(tavern_id).map_err(|e| AppError::Other(e).to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| AppError::Io(e.to_string()).to_string())?;
    writeln!(file, "{content}").map_err(|e| AppError::Io(e.to_string()).to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn get_log_dir() -> Result<String, String> {
    hidden_log_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| AppError::Other(e).to_string())
}

#[tauri::command]
pub async fn get_full_log(tavern_id: u64) -> Result<String, String> {
    let path = log_path_for(tavern_id).map_err(|e| AppError::Other(e).to_string())?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| AppError::Io(e.to_string()).to_string())
}
