use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;
use tokio::time::interval;
use tokio_tungstenite::{connect_async, tungstenite::client::IntoClientRequest};
use wreq::cookie::Jar;

use crate::{config, utils::cookies::extract_cookies, utils::logs};

type WsStream = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

fn build_portrait(login: &str) -> String {
    json!({
        "login": login,
        "sexe": "M",
        "alterations": [],
        "alterationsMidas": [],
        "codeVisage": "M710502372103050",
        "equipement": [
            {
                "idItem": "809", "declinaison": "0", "parametre": "0", "nom": "guenillesTunique",
                "slot": "Chemise", "slotGardeRobe": "Chemises", "miniature": "o",
                "declinaisons": [], "slotsMasques": ["Gilet"],
                "dependCouleurPeau": false, "dependPostureMainG": false, "dependPostureMainD": false,
                "postureMainG": null, "postureMainD": null, "zIndexCalques": ["2300"]
            },
            {
                "idItem": "810", "declinaison": "0", "parametre": "0", "nom": "guenillesBas",
                "slot": "Bas", "slotGardeRobe": "Braies", "miniature": "o",
                "declinaisons": [], "slotsMasques": ["Jupe", "Robe"],
                "dependCouleurPeau": false, "dependPostureMainG": false, "dependPostureMainD": false,
                "postureMainG": null, "postureMainD": null, "zIndexCalques": ["2201"]
            },
            {
                "idItem": "1401", "declinaison": "0", "parametre": "0", "nom": "coiffure6",
                "slot": "Coiffures", "slotGardeRobe": "Coiffures", "miniature": "o",
                "declinaisons": ["0", "1", "2", "3", "4", "5", "6", "7"],
                "slotsMasques": [], "dependCouleurPeau": false, "dependPostureMainG": false,
                "dependPostureMainD": false, "postureMainG": null, "postureMainD": null,
                "zIndexCalques": ["1500", "7000", "10000"]
            },
            {
                "idItem": "1402", "declinaison": "0", "parametre": "0", "nom": "barbe0",
                "slot": "Barbes", "slotGardeRobe": "Barbes", "miniature": "o",
                "declinaisons": ["0", "1", "2", "3", "4", "5", "6", "7"],
                "slotsMasques": [], "dependCouleurPeau": false, "dependPostureMainG": false,
                "dependPostureMainD": false, "postureMainG": null, "postureMainD": null,
                "zIndexCalques": ["7201"]
            }
        ]
    })
    .to_string()
}

fn build_change_salon(login: &str, id_lieu: u64) -> String {
    let portrait = build_portrait(login);
    json!({
        "typeLieu": "taverne",
        "IDLieu": id_lieu,
        "portrait": portrait
    })
    .to_string()
}

// --- small helpers to keep `ws_connect` focused (spec: split monolith) ---

/// Invalidate the dead session (tx replaced with a closed channel — proven
/// pattern from `ws_connect_inner`) then emit `ws-closed` to the frontend
/// with the reason. Without invalidation, `is_connected()` would stay `true`
/// (live tx despite the dead socket) and auto-reconnect would be blocked
/// forever. The session (login/token/jar) is kept: the `ws_connect` re-dial
/// reuses it. Called ONLY on abnormal loop termination — voluntary exits
/// (rx → None) are handled by `teardown_session`, which itself emits
/// `ws-closed` with the `WS_CLOSE_VOLUNTARY` payload.
async fn close_dead_session(app: &tauri::AppHandle, reason: &str) {
    let state = app.state::<crate::network::session::AppState>();
    let mut session_guard = state.session.lock().await;
    if let Some(session) = session_guard.as_mut() {
        let (dummy_tx, dummy_rx) = mpsc::channel::<String>(1);
        drop(dummy_rx);
        session.tx = dummy_tx;
    }
    drop(session_guard);
    let _ = app.emit("ws-closed", reason.to_string());
    logs::log_info(&format!("WS session ended (abnormal): {reason}"));
}

/// Normalized reason for `ws-closed` on write errors (ping/message).
fn write_error_reason(what: &str) -> String {
    format!("WebSocket write error ({what})")
}

fn build_url(login: &str, token: &str) -> String {
    // Use the centralized template — avoids any hard-coded wss:// URL outside config.
    config::CHAT_WSS_URL_TMPL
        .replacen("{}", login, 1)
        .replacen("{}", token, 1)
}

fn build_headers(
    url: String,
    jar: &Arc<Jar>,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, String> {
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("Invalid WebSocket URL: {}", e))?;

    let headers = request.headers_mut();
    headers.insert(
        "Origin",
        config::ORIGIN.parse().expect("Invalid ORIGIN"),
    );
    headers.insert(
        "User-Agent",
        config::USER_AGENT.parse().expect("Invalid USER_AGENT"),
    );

    let cookie_header = extract_cookies(jar);
    if cookie_header.is_empty() {
        return Err("No session cookie available".to_string());
    }
    headers.insert(
        "Cookie",
        cookie_header
            .parse()
            .map_err(|_| "Invalid Cookie header".to_string())?,
    );
    Ok(request)
}

async fn connect(
    request: tokio_tungstenite::tungstenite::http::Request<()>,
) -> Result<
    (
        WsStream,
        tokio_tungstenite::tungstenite::http::Response<Option<Vec<u8>>>,
    ),
    String,
> {
    connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))
}

async fn handshake(
    read: &mut futures_util::stream::SplitStream<WsStream>,
    app: &tauri::AppHandle,
) -> Result<(), ()> {
    // First engine.io open packet (e.g. "0{...}") — log and ignore.
    if let Some(Ok(msg)) = read.next().await {
        logs::log_info(&format!("Handshake received: {msg}"));
    }

    loop {
        match read.next().await {
            Some(Ok(msg)) => {
                let text = msg.to_string();
                logs::log_info(&format!("Message received: {text}"));
                if text.starts_with("42[\"connecteAuServeur\"") {
                    logs::log_info("Connected to the chat server!");
                    return Ok(());
                }
                if text == "41" {
                    let _ = app.emit("ws-error", "Authentication error (41)");
                    return Err(());
                }
            }
            Some(Err(e)) => {
                logs::log_error(&format!("WebSocket error: {e}"));
                let _ = app.emit("ws-error", format!("WebSocket error: {e}"));
                return Err(());
            }
            None => {
                logs::log_error("Connection closed by the server");
                let _ = app.emit("ws-error", "Connection closed by the server");
                return Err(());
            }
        }
    }
}

fn register_handlers(
    ws_stream: WsStream,
    mut rx: mpsc::Receiver<String>,
    app: tauri::AppHandle,
    tavern_id: u64,
    change_salon: String,
) {
    let app_clone = app.clone();
    tokio::spawn(async move {
        let (mut write, mut read) = ws_stream.split();

        // Handshake phase
        if handshake(&mut read, &app_clone).await.is_err() {
            return;
        }

        // Send the initial messages (changeSalon + refresh)
        for payload in [
            change_salon,
            r#"42["taverneMajPerso"]"#.to_string(),
            r#"42["taverneMajMenus"]"#.to_string(),
        ] {
            logs::log_info(&format!("Initial send: {payload}"));
            if write.send(payload.into()).await.is_err() {
                logs::log_error("Initial send error");
                return;
            }
        }

        let _ = app_clone.emit("ws-connected", "Connected to the tavern");

        let mut ping_timer = interval(Duration::from_secs(config::WS_PING_SECS));
        // First tick completes immediately — skip it.
        ping_timer.tick().await;

        loop {
            tokio::select! {
                _ = ping_timer.tick() => {
                    if write.send("2".to_string().into()).await.is_err() {
                        logs::log_error("Ping send error");
                        close_dead_session(&app_clone, &write_error_reason("ping")).await;
                        break;
                    }
                }
                msg_to_send = rx.recv() => {
                    if let Some(payload) = msg_to_send {
                        logs::log_info(&format!("Sending message: {payload}"));
                        if write.send(payload.into()).await.is_err() {
                            logs::log_error("User message send error");
                            close_dead_session(&app_clone, &write_error_reason("message")).await;
                            break;
                        }
                    } else {
                        // Voluntary exit (teardown_session) or session
                        // replacement (ws_connect_inner re-dial): strict silence.
                        // Any `ws-closed` event is already handled upstream
                        // (WS_CLOSE_VOLUNTARY payload), never here — otherwise a
                        // bogus "voluntary"/drop would pollute every re-dial.
                        break;
                    }
                }
                msg = read.next() => {
                    match msg {
                        Some(Ok(m)) => {
                            let text = m.to_string();
                            logs::log_info(&format!("Message received: {text}"));
                            if text == "3" {
                                // Pong — ignore
                            } else if text == "41" {
                                // The server also invalidates the session: without
                                // this the tx would stay alive, and the auto-reconnect
                                // isConnected() guard would stay stuck at true.
                                close_dead_session(&app_clone, "Disconnected by the server").await;
                                break;
                            } else {
                                let _ = app_clone.emit("ws-message", text.clone());
                                // Best-effort file log — delegated to utils::logs
                                let line = text.clone();
                                tokio::spawn(async move {
                                    logs::append_ws_line(tavern_id, &line);
                                });
                            }
                        }
                        Some(Err(e)) => {
                            logs::log_error(&format!("WebSocket error: {e}"));
                            close_dead_session(&app_clone, &format!("WebSocket error: {e}")).await;
                            break;
                        }
                        None => {
                            logs::log_error("WebSocket closed by the server");
                            close_dead_session(&app_clone, "Connection closed by the server").await;
                            break;
                        }
                    }
                }
            }
        }
        logs::log_info("WebSocket task finished");
    });
}

pub async fn ws_connect(
    login: &str,
    token: &str,
    jar: &Arc<Jar>,
    id_lieu: u64,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let url = build_url(login, token);
    let request = build_headers(url, jar)?;
    let (ws_stream, _response) = connect(request).await?;

    logs::log_info("WebSocket connected!");

    let change_salon = format!("42[\"changeSalon\",{}]", build_change_salon(login, id_lieu));
    let (tx, rx) = mpsc::channel::<String>(config::WS_CHANNEL_CAP);
    let app_clone = app.clone();

    register_handlers(ws_stream, rx, app_clone, id_lieu, change_salon);

    // Update the session channel
    let state = app.state::<crate::network::session::AppState>();
    let mut session_guard = state.session.lock().await;
    if let Some(session) = session_guard.as_mut() {
        session.tx = tx;
    }

    Ok(())
}
