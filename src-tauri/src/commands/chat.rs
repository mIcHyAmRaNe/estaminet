use serde_json::{json, Value};
use tauri::{Emitter, State};

use crate::{
    config,
    error::AppError,
    network::{session::AppState, socket_io},
    utils::logs,
};

/// Send a pre-built socket.io payload through the live session channel.
async fn send_payload(state: &State<'_, AppState>, payload: String) -> Result<(), String> {
    let session = state.session.lock().await;
    let s = session
        .as_ref()
        .ok_or_else(|| AppError::NotConnected.to_string())?;
    s.tx.send(payload)
        .await
        .map_err(|_| AppError::ConnectionLost.to_string())?;
    Ok(())
}

/// Build a `42["event", ...]` payload via [`socket_io`] and send it
/// through the live session channel. Collapses the repeated
/// lock-session → NotConnected → tx.send → ConnectionLost blocks.
async fn send_event(
    state: &State<'_, AppState>,
    event: &str,
    args: &[Value],
) -> Result<(), String> {
    send_payload(state, socket_io(event, args)).await
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
    let (login, token, jar, client) = {
        let mut session_guard = state.session.lock().await;
        let s = session_guard
            .as_mut()
            .ok_or_else(|| AppError::NotConnected.to_string())?;
        let login = s.login.clone();
        let token = s.token.clone();
        let jar = s.jar.clone();
        let client = s.client.clone();
        // Replace tx with a closed placeholder via `Session::close_tx`
        // (buffered "41" first): the old rx sees "41" then `None` and the
        // task terminates. The closed placeholder also flips `is_connected`
        // back to false during the window.
        let had_live = s.close_tx().await;
        if had_live {
            // Let the server digest the close before the new dial.
            drop(session_guard);
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        (login, token, jar, client)
    };
    let portrait_json =
        match crate::commands::taverne::fetch_own_portrait_json(&client, &jar, &login).await {
            // Fresh-first on every ws_connect: RP outfit changes apply on
            // quit + re-enter. The last-good JSON is cached per login.
            Ok(p) => {
                logs::log_info(&format!(
                    "own portrait fresh ok (codeVisage={})",
                    crate::commands::taverne::code_visage_of(&p)
                ));
                let mut cache = state.portrait_cache.lock().await;
                cache.insert(login.trim().to_lowercase(), p.clone());
                p
            }
            Err(e) => {
                // Zoom fetch failed: last-good cache, else the default
                // outfit (only when never fetched). The frontend is told
                // via `portrait-warning` (toast + chat line); silence here
                // caused the self/others avatar divergence.
                let cached = state
                    .portrait_cache
                    .lock()
                    .await
                    .get(&login.trim().to_lowercase())
                    .cloned();
                match cached {
                    Some(p) => {
                        logs::log_info(&format!(
                            "own portrait fetch failed ({e}), using last-good cache (codeVisage={})",
                            crate::commands::taverne::code_visage_of(&p)
                        ));
                        let _ = app.emit("portrait-warning", "cached");
                        p
                    }
                    None => {
                        logs::log_info(&format!(
                            "own portrait fetch failed ({e}), no cache: default outfit"
                        ));
                        let _ = app.emit("portrait-warning", "default");
                        String::new()
                    }
                }
            }
        };
    crate::network::socket::ws_connect(&login, &token, &jar, id_lieu, app.clone(), portrait_json)
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

    send_payload(&state, payload).await
}

#[tauri::command]
pub async fn ws_typing_start(state: State<'_, AppState>) -> Result<(), String> {
    send_event(&state, "taverneDebuteMessage", &[]).await
}

#[tauri::command]
pub async fn ws_typing_stop(state: State<'_, AppState>) -> Result<(), String> {
    send_event(&state, "taverneAnnuleMessage", &[]).await
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
    // Preserve original error precedence: NotConnected before InvalidPlace.
    {
        let session = state.session.lock().await;
        session
            .as_ref()
            .ok_or_else(|| AppError::NotConnected.to_string())?;
    }
    if id_place > config::PLACE_MAX {
        return Err(AppError::InvalidPlace.to_string());
    }
    logs::log_info(&format!("change_place id={id_place}"));
    let payload = socket_io("taverneChangePlace", &[json!(id_place)]);
    logs::log_info(&format!("sending {payload}"));
    send_payload(&state, payload).await
}

#[tauri::command]
pub async fn taverne_offre_verre(state: State<'_, AppState>, login: String) -> Result<(), String> {
    send_event(&state, "taverneOffreVerre", &[json!(login)]).await
}

#[tauri::command]
pub async fn taverne_tournee_generale(state: State<'_, AppState>) -> Result<(), String> {
    send_event(&state, "taverneTourneeGenerale", &[]).await
}

#[tauri::command]
pub async fn taverne_accepte_alcool(
    state: State<'_, AppState>,
    accepter: bool,
) -> Result<(), String> {
    send_event(&state, "taverneAccepteAlcool", &[json!(accepter)]).await
}

#[tauri::command]
pub async fn taverne_kick(state: State<'_, AppState>, login: String) -> Result<(), String> {
    send_event(&state, "taverneKick", &[json!(login)]).await
}

#[tauri::command]
pub async fn taverne_ban(state: State<'_, AppState>, login: String) -> Result<(), String> {
    send_event(&state, "taverneBan", &[json!(login)]).await
}

#[tauri::command]
pub async fn taverne_unban(state: State<'_, AppState>, login: String) -> Result<(), String> {
    send_event(&state, "taverneUnban", &[json!(login)]).await
}
