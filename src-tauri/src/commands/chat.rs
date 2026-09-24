use serde_json::{json, Value};
use tauri::{Emitter, State};

use crate::{
    config,
    error::AppError,
    network::{
        session::AppState,
        socket::Lieu,
        socket_io,
    },
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

/// `true` when the live single-socket connection is a village presence.
/// Tavern-only sends (`change_place`, `ws_send`) must refuse in that case:
/// the live village socket (jsVillePixi) never sends `taverne*` — only
/// `changeSalon` (with vetements+portrait), then ping / villeInit /
/// villeInfosPersonnages. `None` (never dialed / torn down) counts as
/// non-village so error precedence stays `NotConnected`-first.
async fn is_village_socket(state: &State<'_, AppState>) -> bool {
    matches!(
        *state.current_lieu.lock().await,
        Some(Lieu::Village(..))
    )
}

/// Tavern-only refusal error for village-socket sends.
fn tavern_only_err(event: &str) -> String {
    format!("{event} is tavern-only — blocked on village socket (changeSalon-only presence)")
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
    dial_with_discipline(&app, &state, Lieu::Taverne(id_lieu)).await
}

/// B1 dial discipline (shared tavern + village entry point; mirrors the
/// official JS `_initialisationEnCours` but latest-wins instead of
/// swallow-all): never two sockets at once, never a swallowed cross-`Lieu`
/// dial.
///
/// - Requested == in-flight `Lieu` → duplicate, swallow (`Ok(())`).
/// - In-flight busy with a DIFFERENT `Lieu` → replace `pending` (single
///   latest wins), bump the generation (stales the in-flight attempt's
///   commit), return `Ok(())` immediately; this drain loop dials it next.
/// - Idle → claim `inflight` and drain: dial, then chain into `pending` if
///   one was queued (replacing it), until no pending remains.
///
/// The caller that claims `inflight` runs the whole chain; queued callers
/// return `Ok(())` at once and learn the outcome via the lieu-tagged
/// `ws-connected` event (`"Connected to the tavern"` / `"Connected to the
/// village"`). `current_lieu` stays the presence authority; `ws_send` /
/// `change_place` guards are untouched.
pub(crate) async fn dial_with_discipline(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    lieu: Lieu,
) -> Result<(), String> {
    {
        let mut dial = state.dial.lock().await;
        if dial.inflight.as_ref() == Some(&lieu) {
            // Duplicate of the in-flight dial (or of the target this drain
            // loop is about to chain into): swallow.
            return Ok(());
        }
        if dial.inflight.is_some() {
            // Busy with a different Lieu (e.g. Montpellier preview in its
            // portrait-fetch + 250ms window while Bordeaux is requested):
            // queue latest-wins. The gen bump stales the in-flight
            // attempt so its late commit/emit is suppressed.
            if dial.pending.as_ref() != Some(&lieu) {
                dial.pending = Some(lieu);
                dial.gen += 1;
            }
            return Ok(());
        }
        dial.inflight = Some(lieu);
        dial.gen += 1;
        *state.ws_connecting.lock().await = true;
    }
    // Drain loop: only the claimer runs this (queued callers returned
    // above), so `ws_connect_inner` calls never overlap.
    loop {
        let (target, gen) = {
            let dial = state.dial.lock().await;
            // `inflight` is `Some` until the loop exits below.
            (dial.inflight.clone().expect("dial inflight held by drain loop"), dial.gen)
        };
        let result = ws_connect_inner(app, state, target.clone(), gen).await;
        let mut dial = state.dial.lock().await;
        match dial.pending.take() {
            Some(next) if next != target => {
                dial.inflight = Some(next);
                dial.gen += 1;
                *state.ws_connecting.lock().await = true;
                // Loop and dial the queued latest target even if `result`
                // was an error: latest intent wins.
            }
            _ => {
                // No pending (or a duplicate of what just settled):
                // release single-flight and report the last outcome to the
                // claiming caller.
                dial.inflight = None;
                *state.ws_connecting.lock().await = false;
                return result;
            }
        }
    }
}

/// `true` when a newer dial target was queued after `gen` was captured
/// (or any `pending` target waits): the in-flight attempt is stale and must
/// neither dial nor commit — the drain loop chains into the queued latest
/// target instead.
async fn is_superseded(state: &State<'_, AppState>, gen: u64) -> bool {
    let dial = state.dial.lock().await;
    dial.gen != gen || dial.pending.is_some()
}

/// Shared connect core for tavern + village presence (single-socket
/// time-multiplexed): teardown of the old WS session, fresh-first portrait
/// fetch with last-good cache fallback, then dial via
/// `socket::ws_connect_lieu`. The `Lieu` enum avoids forking this logic —
/// `village_connect` reuses it directly. Single-flight + latest-wins queue
/// live in `dial_with_discipline` (the only caller); `gen` is the generation
/// captured at claim/chain time — when a newer target was queued mid-flight
/// (`dial.gen != gen` or `pending` present) this attempt is stale: skip the
/// dial and report `Ok(())` so the drain loop chains into the queued target
/// instead of flashing a superseded roster.
pub(crate) async fn ws_connect_inner(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    lieu: Lieu,
    gen: u64,
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
        // Always let the server digest the close before the new dial — even
        // when the old channel was already dead (`had_live=false` after a
        // server-sent 41): skipping the wait lets rapid reconnect bursts
        // hammer the server and the new `changeSalon` races the reaped
        // ghost (intermittent 41 on village→tavern switches).
        logs::log_info(&format!(
            "ws_connect_inner teardown gen={gen} {} id={} prioritaire={} had_live={had_live}: 41 sent, digesting {}ms",
            lieu.kind(),
            lieu.id(),
            lieu.prioritaire(),
            config::WS_TEARDOWN_DIGEST_MS
        ));
        drop(session_guard);
        tokio::time::sleep(std::time::Duration::from_millis(
            config::WS_TEARDOWN_DIGEST_MS,
        ))
        .await;
        (login, token, jar, client)
    };
    // B1: a newer target queued during the digest window stales this
    // attempt — skip the dial so the drain loop chains straight into it
    // (no superseded Montpellier presence flash under a Bordeaux header).
    if is_superseded(state, gen).await {
        logs::log_info(&format!(
            "ws_connect_inner gen={gen}: superseded after teardown, skipping dial"
        ));
        return Ok(());
    }
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
    // B1: the portrait fetch is the wide window (HTTP Zoom round-trip) —
    // a target queued meanwhile stales this attempt; skip the dial.
    if is_superseded(state, gen).await {
        logs::log_info(&format!(
            "ws_connect_inner gen={gen}: superseded after portrait fetch, skipping dial"
        ));
        return Ok(());
    }
    crate::network::socket::ws_connect_lieu(
        &login,
        &token,
        &jar,
        lieu,
        app.clone(),
        portrait_json,
        gen,
    )
    .await
    .map_err(|e| AppError::Network(e).to_string())
}

#[tauri::command]
pub async fn ws_send(state: State<'_, AppState>, message: String) -> Result<(), String> {
    // Every `ws_send` branch emits a `taverne*` event (taverneMessage /
    // Emote / Commande / Prive) — never valid on a village socket, where
    // live captures show changeSalon-only presence.
    if is_village_socket(&state).await {
        return Err(tavern_only_err("ws_send(taverneMessage/Emote/Commande)"));
    }
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
    drop(session);
    // Presence target cleared with the session: a stale `Village` must not
    // block the next tavern dial's commands (each `ws_connect_lieu` sets it).
    *state.current_lieu.lock().await = None;
    // B1: stale any in-flight dial attempt (its commit/emit guards check
    // this generation) so a slow handshake finishing after a voluntary
    // close can never resurrect presence or clobber the next dial.
    // `inflight`/`pending` are left to the drain loop — it settles the
    // current attempt (superseded → skipped) and chains or releases.
    state.dial.lock().await.gen += 1;
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
    // `taverneChangePlace` on a village socket is the exact contamination
    // seen in logs (42["taverneChangePlace",1] after a 326 changeSalon):
    // live village sockets never send `taverne*`.
    if is_village_socket(&state).await {
        return Err(tavern_only_err("taverneChangePlace"));
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
