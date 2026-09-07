use serde_json::{json, Value};
use tauri::{Emitter, State};

use crate::{
    config,
    error::AppError,
    network::session::AppState,
    utils::logs,
};

fn socket_io(event: &str, args: &[Value]) -> String {
    let mut payload = vec![json!(event)];
    payload.extend_from_slice(args);
    format!("42{}", json!(payload).to_string())
}

#[tauri::command]
pub async fn ws_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id_lieu: u64,
) -> Result<(), String> {
    // Single-flight (mirrors the official JS `_initialisationEnCours`):
    // ignore concurrent calls so we never open two sockets at once
    // (duplicate Eren_j/eren_j presence, seats flipping, kick 41).
    {
        let mut connecting = state.ws_connecting.lock().await;
        if *connecting {
            return Ok(());
        }
        *connecting = true;
    }
    let result = ws_connect_inner(&app, &state, id_lieu).await;
    {
        let mut connecting = state.ws_connecting.lock().await;
        *connecting = false;
    }
    result
}

async fn ws_connect_inner(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    id_lieu: u64,
) -> Result<(), String> {
    // Destroy the existing WS session BEFORE opening a new one:
    // send "41" through the old channel then close it, so the old
    // WebSocket task terminates (forward 41 → exit) before dialing.
    // Without this, two sockets briefly coexist on the server side.
    let (login, token, jar) = {
        let mut session_guard = state.session.lock().await;
        let s = session_guard
            .as_mut()
            .ok_or_else(|| AppError::NotConnected.to_string())?;
        let login = s.login.clone();
        let token = s.token.clone();
        let jar = s.jar.clone();
        // Replace tx with a closed placeholder: the old rx will see the
        // buffered "41" then `None` and the task will terminate. The closed
        // placeholder also flips `is_connected` back to false during the window.
        let (dummy_tx, dummy_rx) = tokio::sync::mpsc::channel::<String>(1);
        drop(dummy_rx);
        let old_tx = std::mem::replace(&mut s.tx, dummy_tx);
        let had_live = !old_tx.is_closed();
        if had_live {
            let _ = old_tx.send("41".to_owned()).await;
        }
        // `old_tx` dropped here: closes the old channel.
        drop(old_tx);
        if had_live {
            // Let the server digest the close before the new dial.
            drop(session_guard);
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        (login, token, jar)
    };
    crate::network::socket::ws_connect(&login, &token, &jar, id_lieu, app.clone())
        .await
        .map_err(|e| AppError::Network(e).to_string())
}

#[tauri::command]
pub async fn ws_send(state: State<'_, AppState>, message: String) -> Result<(), String> {
    if message.len() > config::MSG_MAX_LEN {
        return Err(AppError::MessageTooLong(config::MSG_MAX_LEN).to_string());
    }

    let payload = if message.starts_with("/me ")
        || message.starts_with("/faire ")
        || message.starts_with("/emote ")
    {
        let txt = message.splitn(2, ' ').nth(1).unwrap_or("");
        socket_io("taverneEmote", &[json!(txt)])
    } else if message.starts_with("/w ") {
        let parts: Vec<&str> = message[3..].splitn(2, ' ').collect();
        if parts.len() != 2 {
            return Err(
                AppError::InvalidFormat("Invalid /w format. Use: /w login message".into())
                    .to_string(),
            );
        }
        socket_io("taverneMessagePrive", &[json!(parts[0]), json!(parts[1])])
    } else if message.starts_with("/boire") {
        r#"42["taverneCommandeVerre"]"#.into()
    } else if message.starts_with("/manger ") {
        let id = message
            .splitn(2, ' ')
            .nth(1)
            .unwrap_or("0")
            .trim()
            .parse::<u64>()
            .map_err(|_| {
                AppError::InvalidFormat("Invalid menu number".into()).to_string()
            })?;
        socket_io("taverneCommandeRepas", &[json!(id)])
    } else {
        socket_io("taverneMessage", &[json!(message)])
    };

    let session = state.session.lock().await;
    let s = session
        .as_ref()
        .ok_or_else(|| AppError::NotConnected.to_string())?;
    s.tx.send(payload)
        .await
        .map_err(|_| AppError::ConnectionLost.to_string())?;
    Ok(())
}

/// Shared teardown: send socket.io close ("41") then drop the session
/// (token/jar/client). Does NOT touch the keyring — see `auth::logout`.
/// Emits `ws-closed` with the voluntary payload: the frontend can thus tell
/// a user-requested close (no auto-reconnect) apart from a real drop
/// (auto-reconnect armed). Emitted HERE, not in the socket task: the
/// `ws_connect_inner` re-dial also closes the old channel, so a generic
/// emission there would produce a bogus "voluntary" on every tavern change.
/// `teardown_session` is only called by logout/disconnect.
pub async fn teardown_session(state: &State<'_, AppState>, app: &tauri::AppHandle) {
    let mut session = state.session.lock().await;
    if let Some(s) = session.take() {
        let _ = s.tx.send("41".to_owned()).await;
        // `s` dropped here: token/jar/client released.
    }
    // Guaranteed order: "41" is buffered in the old channel (the socket
    // task will write it then terminate) BEFORE the frontend event. On
    // ws-closed the `wasConnected` guard already sees the intended state,
    // no phantom reconnect.
    let _ = app.emit("ws-closed", config::WS_CLOSE_VOLUNTARY);
    logs::log_info("teardown_session: session closed voluntarily (41 + ws-closed)");
}

#[tauri::command]
pub async fn change_place(state: State<'_, AppState>, id_place: u64) -> Result<(), String> {
    let session = state.session.lock().await;
    let s = session
        .as_ref()
        .ok_or_else(|| AppError::NotConnected.to_string())?;
    if id_place > config::PLACE_MAX {
        return Err(AppError::InvalidPlace.to_string());
    }
    logs::log_info(&format!("change_place id={id_place}"));
    let payload = socket_io("taverneChangePlace", &[json!(id_place)]);
    logs::log_info(&format!("sending {payload}"));
    s.tx.send(payload)
        .await
        .map_err(|_| AppError::ConnectionLost.to_string())?;
    Ok(())
}
