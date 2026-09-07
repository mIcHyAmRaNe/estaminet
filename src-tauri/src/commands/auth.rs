use tauri::{Emitter, State};

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
        // Serialize the read-modify-write against concurrent account ops.
        let _guard = state.cred_lock.lock().await;
        // Persistence failures never fail login: surface a warning instead.
        match credentials::upsert(&creds) {
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
        // Multi-account: a non-remembered login never wipes the store.
        Ok(None)
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

/// Usernames of every saved account (in store order).
#[tauri::command]
pub async fn list_accounts() -> Result<Vec<String>, String> {
    match credentials::load_all() {
        Ok(all) => Ok(all.into_iter().map(|c| c.username).collect()),
        // Secure storage missing: silent, no boot error (detail stays in logs).
        Err(AppError::KeyringUnavailable(detail)) => {
            logs::log_warn(&format!("keyring unavailable (list accounts): {detail}"));
            Ok(vec![])
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Insert or update one saved account.
#[tauri::command]
pub async fn save_account(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<(), String> {
    let _guard = state.cred_lock.lock().await;
    credentials::upsert(&SavedCreds { username, password }).map_err(|e| e.to_string())
}

/// Delete one saved account. Errors with `AccountNotFound` when absent.
#[tauri::command]
pub async fn remove_account(
    state: State<'_, AppState>,
    username: String,
) -> Result<(), String> {
    let _guard = state.cred_lock.lock().await;
    match credentials::remove(&username) {
        Ok(true) => Ok(()),
        Ok(false) => Err(AppError::AccountNotFound(username).to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// Passwordless login for one saved account.
#[tauri::command]
pub async fn try_auto_login_for(
    state: State<'_, AppState>,
    username: String,
) -> Result<Option<String>, String> {
    let saved = match credentials::find(&username) {
        Ok(s) => s,
        // Secure storage missing: silent, no boot error (detail stays in logs).
        Err(AppError::KeyringUnavailable(detail)) => {
            logs::log_warn(&format!("keyring unavailable (auto-login): {detail}"));
            return Ok(None);
        }
        Err(e) => return Err(e.to_string()),
    };
    let creds = match saved {
        None => return Err(AppError::AccountNotFound(username).to_string()),
        Some(c) => c,
    };
    let password = creds.password.clone();
    match inner_login(&state, &username, &password, true).await {
        Ok(login) => Ok(Some(login)),
        Err(e) => match &e {
            AppError::BadCredentials(_) => {
                // Stale creds — drop that account only, then surface the error.
                let _guard = state.cred_lock.lock().await;
                if let Err(del_err) = credentials::remove(&username) {
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

/// Deprecated shim: auto-login via the first saved account.
#[tauri::command]
pub async fn try_auto_login(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let first = match credentials::load_all() {
        Ok(all) => all.into_iter().next(),
        // Secure storage missing: silent, no boot error (detail stays in logs).
        Err(AppError::KeyringUnavailable(detail)) => {
            logs::log_warn(&format!("keyring unavailable (auto-login): {detail}"));
            return Ok(None);
        }
        Err(e) => return Err(e.to_string()),
    };
    let Some(creds) = first else {
        return Ok(None);
    };
    try_auto_login_for(state, creds.username).await
}

/// Deprecated shim: first saved username, if any.
#[tauri::command]
pub async fn get_saved_login() -> Result<Option<String>, String> {
    match credentials::load_all() {
        Ok(all) => Ok(all.into_iter().next().map(|c| c.username)),
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
    // Capture the current login BEFORE teardown drops the session.
    let current = {
        let session = state.session.lock().await;
        session.as_ref().map(|s| s.login.clone())
    };
    crate::commands::chat::teardown_session(&state, &app).await;
    // Remove the current account only — other saved accounts are kept.
    if let Some(login) = current {
        let _guard = state.cred_lock.lock().await;
        if let Err(e) = credentials::remove(&login) {
            logs::log_error(&format!("delete creds on logout failed: {e}"));
        }
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

/// Closes the WebSocket but keeps the session (login/token/jar/client) so
/// the frontend can re-enter via `ws_connect` without logging in again.
/// Mirrors the `ws_connect_inner` teardown: the live tx is replaced with a
/// closed dummy (buffered "41" first), then `ws-closed` voluntary is emitted.
#[tauri::command]
pub async fn ws_disconnect(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let mut session_guard = state.session.lock().await;
        let Some(s) = session_guard.as_mut() else {
            return Ok(());
        };
        // Replace tx with a closed placeholder: the old rx sees the
        // buffered "41" then `None` and the socket task terminates.
        let (dummy_tx, dummy_rx) = tokio::sync::mpsc::channel::<String>(1);
        drop(dummy_rx);
        let old_tx = std::mem::replace(&mut s.tx, dummy_tx);
        if !old_tx.is_closed() {
            let _ = old_tx.send("41".to_owned()).await;
        }
        // `old_tx` dropped here: closes the old channel.
        drop(old_tx);
        // Session kept — token/jar/client retained for a later `ws_connect`.
    }
    let _ = app.emit("ws-closed", config::WS_CLOSE_VOLUNTARY);
    logs::log_info("ws_disconnect: ws closed voluntarily (41 + ws-closed), session kept");
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
