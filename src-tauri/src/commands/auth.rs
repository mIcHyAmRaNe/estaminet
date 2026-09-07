use tauri::State;

use crate::{
    config,
    error::AppError,
    network::{
        auth::AuthError,
        credentials::{self, SavedCreds},
        session::AppState,
    },
    utils::logs,
};

/// Warning returned (not thrown) when login succeeded but the session could
/// not be persisted because secure storage is unavailable.
pub const KEYRING_UNAVAILABLE_WARNING: &str =
    "Logged in without remembering: keyring unavailable on this system.";

#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
    remember: bool,
) -> Result<Option<String>, String> {
    inner_login(&state, &username, &password, remember)
        .await
        .map_err(|e| e.to_string())?;

    if remember {
        let creds = SavedCreds {
            username,
            password,
        };
        // Persistence failures never fail login: surface a warning instead.
        match credentials::save(&creds) {
            Ok(()) => Ok(None),
            Err(AppError::KeyringUnavailable(detail)) => {
                logs::log_warn(&format!("keyring unavailable (save): {detail}"));
                Ok(Some(KEYRING_UNAVAILABLE_WARNING.to_string()))
            }
            Err(e) => {
                logs::log_error(&format!("save creds failed: {e}"));
                Ok(Some(KEYRING_UNAVAILABLE_WARNING.to_string()))
            }
        }
    } else {
        match credentials::delete() {
            Ok(()) => Ok(None),
            Err(AppError::KeyringUnavailable(detail)) => {
                logs::log_warn(&format!("keyring unavailable (delete): {detail}"));
                Ok(None)
            }
            Err(e) => {
                logs::log_error(&format!("delete creds failed: {e}"));
                Ok(None)
            }
        }
    }
}

async fn inner_login(
    state: &State<'_, AppState>,
    username: &str,
    password: &str,
    remember: bool,
) -> Result<String, AppError> {
    let (client, jar, token) =
        crate::network::auth::login(username, password)
            .await
            .map_err(|e| match e {
                AuthError::BadCredentials(msg) => AppError::BadCredentials(msg),
                AuthError::Network(msg) => AppError::Network(msg),
            })?;

    let login_owned = username.to_owned();
    let mut session = state.session.lock().await;
    *session = Some(crate::network::session::Session {
        login: login_owned.clone(),
        token,
        jar,
        client,
        tx: tokio::sync::mpsc::channel(config::WS_CHANNEL_CAP).0,
        remember,
    });
    Ok(login_owned)
}

#[tauri::command]
pub async fn try_auto_login(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let saved = match credentials::load() {
        Ok(s) => s,
        // Secure storage missing: silent, no boot error (detail stays in logs).
        Err(AppError::KeyringUnavailable(detail)) => {
            logs::log_warn(&format!("keyring unavailable (auto-login): {detail}"));
            return Ok(None);
        }
        Err(e) => return Err(e.to_string()),
    };
    let creds = match saved {
        None => return Ok(None),
        Some(c) => c,
    };
    let username = creds.username.clone();
    let password = creds.password.clone();
    match inner_login(&state, &username, &password, true).await {
        Ok(login) => Ok(Some(login)),
        Err(e) => match &e {
            AppError::BadCredentials(_) => {
                // Stale creds — drop them, then surface the error.
                if let Err(del_err) = credentials::delete() {
                    logs::log_error(&format!(
                        "delete creds after BadCredentials failed: {del_err}"
                    ));
                }
                Err(e.to_string())
            }
            // Network failure — keep entry for a later retry.
            _ => Err(e.to_string()),
        },
    }
}

#[tauri::command]
pub async fn get_saved_login() -> Result<Option<String>, String> {
    match credentials::load() {
        Ok(saved) => Ok(saved.map(|c| c.username)),
        // Secure storage missing: silent, no boot error (detail stays in logs).
        Err(AppError::KeyringUnavailable(detail)) => {
            logs::log_warn(&format!("keyring unavailable (saved login): {detail}"));
            Ok(None)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    crate::commands::chat::teardown_session(&state, &app).await;
    if let Err(e) = credentials::delete() {
        logs::log_error(&format!("delete creds on logout failed: {e}"));
    }
    Ok(())
}

/// Closes the session (tavern) without touching the keyring: remembered
/// credentials are kept for the "remembered account" state.
#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    crate::commands::chat::teardown_session(&state, &app).await;
    Ok(())
}

#[tauri::command]
pub async fn is_connected(state: State<'_, AppState>) -> Result<bool, String> {
    let session = state.session.lock().await;
    Ok(session.as_ref().is_some_and(|s| !s.tx.is_closed()))
}

#[tauri::command]
pub async fn get_session_login(
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let session = state.session.lock().await;
    Ok(session.as_ref().map(|s| s.login.clone()))
}
