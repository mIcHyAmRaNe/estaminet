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

fn build_default_portrait(login: &str) -> String {
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

/// Presence target for the single time-multiplexed WS connection.
/// The village lives only in phase tavern: entering a tavern via the
/// existing `ws_connect` tears the village connection down (and vice
/// versa) — one socket at a time, no parallel connections.
/// NOTE: village IDLieu scheme is NOT the tavern id — callers pass the
/// raw `id_village: u64` through, never guess a mapping.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Lieu {
    Taverne(u64),
    /// Village presence carrying the per-user `vetements` outfit object for
    /// `changeSalon` (`None` maps to `{}` — backward compat for callers
    /// without an outfit source; live sends the full object per user).
    Village(u64, Option<serde_json::Value>),
}

impl Lieu {
    pub(crate) fn id(&self) -> u64 {
        match self {
            Lieu::Taverne(id) | Lieu::Village(id, _) => *id,
        }
    }

    /// Socket `prioritaire` query flag per live-game evidence:
    /// village (`EcranPrincipal.php`) dials `prioritaire=false`,
    /// tavern (`InterieurTaverne.php`) dials `prioritaire=true`.
    pub(crate) fn prioritaire(&self) -> bool {
        match self {
            Lieu::Taverne(_) => true,
            Lieu::Village(..) => false,
        }
    }

    /// Short kind label for diagnostics (`tavern` / `village`).
    pub(crate) fn kind(&self) -> &'static str {
        match self {
            Lieu::Taverne(_) => "tavern",
            Lieu::Village(..) => "village",
        }
    }

    /// One-line diagnostic fragment: `tavern id=… prioritaire=…`.
    /// Never includes credentials — the dial URL carries the token and is
    /// never logged.
    pub(crate) fn diag(&self) -> String {
        format!(
            "{} id={} prioritaire={}",
            self.kind(),
            self.id(),
            self.prioritaire()
        )
    }
}

fn canonical_portrait(login: &str, portrait_json: &str) -> String {
    let trimmed = portrait_json.trim();
    let valid =
        !trimmed.is_empty() && serde_json::from_str::<serde_json::Value>(trimmed).is_ok();
    // Canonical form shared with `commands::taverne` (session-login
    // normalization + worn-only `equipement` filter); invalid/empty input
    // falls back to the default outfit as before.
    if valid {
        crate::commands::taverne::canonicalize_portrait_json(trimmed, login)
    } else {
        crate::commands::taverne::canonicalize_portrait_json(&build_default_portrait(login), login)
    }
}

pub(crate) fn build_change_salon(login: &str, id_lieu: u64, portrait_json: &str) -> String {
    let portrait = canonical_portrait(login, portrait_json);
    let visage = crate::commands::taverne::code_visage_of(&portrait);
    logs::log_info(&format!(
        "changeSalon id_lieu={id_lieu} codeVisage={visage} ({} bytes)",
        portrait.len()
    ));
    json!({
        "typeLieu": "taverne",
        "IDLieu": id_lieu,
        "portrait": portrait
    })
    .to_string()
}

/// Village `changeSalon` object per live-game `getInfosSalon()` capture
/// (Montpellier 326): `{"typeLieu":"village","IDLieu":326,"portrait":...,
/// "posX":71,"posY":99,"etage":0,"instance":0}`.
/// Portrait stays the canonicalized string form (byte-exact like the tavern
/// builder). `posX`/`posY` must be in-bounds: the server rejects 0,0 as
/// out-of-bounds and falls back to the home village, making IDLieu look
/// ignored. `etage`/`instance` are always 0 per live capture.
/// Per-village valid spawn coords (minimal table):
/// Montpellier 326 -> base (71,99) from the live Harvey capture. Bordeaux 461
/// -> base (98,161) from the live Eren_j capture (IDLieu 461, posX 98, posY
/// 161, etage 0, instance 0). Non-zero on purpose (the server rejects 0,0 as
/// out-of-bounds and falls back to the home village, making IDLieu look
/// ignored). Unmapped
/// villages never dial (frontend `VILLAGE_IDS` gates the call and
/// `village_connect` rejects id 0); the (0,0) fallback below is
/// unreachable in practice and would be rejected server-side.
///
/// Visitor-spawn collision (ghost/observer) fix: spawning exactly on the map
/// anchor cell (e.g. Eren_j previewing 326 at Harvey's exact 71,99) makes the
/// server send only the `connectMe` snapshot + own echo with no
/// cross-broadcast — `ville.personnages` never lists the visitor (T0 absent
/// = never placed) and parler+crier stay invisible both ways. So the spawn
/// is `base + deterministic per-login offset` on X (`+0..2` tiles, same Y):
/// the bases stay the documented map anchors, but distinct logins spread over
/// three adjacent in-bounds tiles instead of all piling on the anchor
/// occupant's cell. E.g. Montpellier: (71..73, 99); Bordeaux: (98..100, 161).
/// `etage`/`instance` stay 0; never OOB (unmapped ids still return the
/// unreachable (0,0) without offset).
fn village_login_offset(login: &str) -> u32 {
    // FNV-1a 64 over the trimmed lowercased login: stable across runs, no
    // extra deps. `% 3` keeps the spawn on the anchor tile or one of the two
    // adjacent free tiles east of it (verified: eren_j -> +2, harvey -> +1,
    // so the reported 326 collision pair separates).
    let mut hash: u64 = 14_695_981_039_344_656_037;
    for b in login.trim().to_lowercase().bytes() {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(1_099_511_628_211);
    }
    (hash % 3) as u32
}

fn village_spawn_coords(id_village: u64, login: &str) -> (u32, u32) {
    let (base_x, base_y) = match id_village {
        326 => (71, 99),
        461 => (98, 161),
        _ => return (0, 0),
    };
    (base_x + village_login_offset(login), base_y)
}

pub(crate) fn build_change_salon_village(
    login: &str,
    id_village: u64,
    portrait_json: &str,
    vetements: Option<serde_json::Value>,
) -> String {
    let portrait = canonical_portrait(login, portrait_json);
    let visage = crate::commands::taverne::code_visage_of(&portrait);
    // Per-login spawn: `login` feeds the deterministic +0..2 X offset so a
    // preview visitor never stacks on the anchor occupant's cell (ghost fix).
    let (pos_x, pos_y) = village_spawn_coords(id_village, login);
    // Live `changeSalon` carries the full per-user `vetements` outfit object
    // alongside the `portrait` string. `None` maps to `{}` (callers without
    // an outfit source) — never hardcode one user's outfit for all users.
    let vetements = vetements.unwrap_or_else(|| serde_json::json!({}));
    logs::log_info(&format!(
        "changeSalon village id_village={id_village} posX={pos_x} posY={pos_y} codeVisage={visage} ({} bytes)",
        portrait.len()
    ));
    json!({
        "typeLieu": "village",
        "IDLieu": id_village,
        "portrait": portrait,
        "vetements": vetements,
        "posX": pos_x,
        "posY": pos_y,
        "etage": 0,
        "instance": 0
    })
    .to_string()
}

/// Dispatch to the tavern / village `changeSalon` object builder.
/// The village `vetements` outfit rides on `Lieu::Village` (`None` maps to
/// `{}` in `build_change_salon_village`).
pub(crate) fn build_change_salon_for_lieu(
    login: &str,
    lieu: Lieu,
    portrait_json: &str,
) -> String {
    match lieu {
        Lieu::Taverne(id) => build_change_salon(login, id, portrait_json),
        Lieu::Village(id, vetements) => {
            build_change_salon_village(login, id, portrait_json, vetements)
        }
    }
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
        session.replace_tx_with_closed();
    }
    drop(session_guard);
    let _ = app.emit("ws-closed", reason.to_string());
    logs::log_info(&format!("WS session ended (abnormal): {reason}"));
}

/// B1 generation guard for abnormal session invalidation: only the current
/// generation may invalidate the session + emit `ws-closed`. A stale socket
/// task (superseded Montpellier handshake/socket dying after Bordeaux took
/// over) stays silent — otherwise it would kill the live session, wedge
/// `is_connected()`, and trigger a phantom reconnect fight.
async fn close_dead_session_if_current(app: &tauri::AppHandle, gen: u64, reason: &str) {
    let current = app
        .state::<crate::network::session::AppState>()
        .dial
        .lock()
        .await
        .gen;
    if current != gen {
        logs::log_info(&format!(
            "WS session ended (stale gen {gen} vs {current}, silent): {reason}"
        ));
        return;
    }
    close_dead_session(app, reason).await;
}

/// `true` when `gen` is no longer the latest dial generation (a newer
/// target was queued / chained / torn down since).
async fn is_stale_gen(app: &tauri::AppHandle, gen: u64) -> bool {
    app.state::<crate::network::session::AppState>()
        .dial
        .lock()
        .await
        .gen
        != gen
}

/// Normalized reason for `ws-closed` on write errors (ping/message).
fn write_error_reason(what: &str) -> String {
    format!("WebSocket write error ({what})")
}

fn build_url(login: &str, token: &str, prioritaire: bool) -> String {
    // Use the centralized template — avoids any hard-coded wss:// URL outside config.
    // Login/token substitution is unchanged (no encoding); the third
    // placeholder carries the per-Lieu `prioritaire` flag (tavern=true,
    // village=false per live-game evidence).
    config::CHAT_WSS_URL_TMPL
        .replacen("{}", login, 1)
        .replacen("{}", token, 1)
        .replacen("{}", if prioritaire { "true" } else { "false" }, 1)
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
    gen: u64,
    lieu: &Lieu,
) -> Result<
    (
        WsStream,
        tokio_tungstenite::tungstenite::http::Response<Option<Vec<u8>>>,
    ),
    String,
> {
    // Diagnostics carry gen + lieu id + prioritaire only — never the URL:
    // it embeds the token.
    logs::log_info(&format!("WS dial connecting gen={gen} {}", lieu.diag()));
    connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))
}

async fn handshake(
    read: &mut futures_util::stream::SplitStream<WsStream>,
    app: &tauri::AppHandle,
    gen: u64,
    lieu: &Lieu,
) -> Result<(), ()> {
    // Handshake failures surface as `ws-closed` (via `close_dead_session`),
    // NOT `ws-error`: the frontend listens to `ws-closed` / `ws-connected` /
    // `ws-message` only, so a `ws-error` emit here would be unheard AND leave
    // the session tx live, wedging `is_connected()` at `true` forever.
    // Diagnostics (gen + lieu id + prioritaire) on every path below; the
    // token never appears in logs.
    logs::log_info(&format!("WS handshake start gen={gen} {}", lieu.diag()));
    // Ghost-overlap guard BEFORE blocking: already superseded → silent, no
    // `ws-closed` (a stale task must never kill the live session).
    if is_stale_gen(app, gen).await {
        logs::log_info(&format!(
            "WS handshake gen={gen} {} stale before open, exiting silently (no presence)",
            lieu.diag()
        ));
        return Err(());
    }
    // First engine.io open packet (e.g. "0{...}") — log and ignore.
    if let Some(Ok(msg)) = read.next().await {
        logs::log_info(&format!("Handshake received: {msg}"));
        // A newer target may have queued during the open wait.
        if is_stale_gen(app, gen).await {
            logs::log_info(&format!(
                "WS handshake gen={gen} {} stale after open, exiting silently (no presence)",
                lieu.diag()
            ));
            return Err(());
        }
    }

    loop {
        // Ghost-overlap guard INSIDE the loop (not only post-handshake): a
        // superseded attempt aborts early and stays silent even if its
        // `connecteAuServeur` / `41` arrives late.
        if is_stale_gen(app, gen).await {
            logs::log_info(&format!(
                "WS handshake gen={gen} {} went stale, exiting silently (no presence)",
                lieu.diag()
            ));
            return Err(());
        }
        match read.next().await {
            Some(Ok(msg)) => {
                let text = msg.to_string();
                logs::log_info(&format!("Message received: {text}"));
                // Queued-newer-target check per frame: the frame was already
                // in flight while the newer dial was requested — still
                // silent, never presence.
                if is_stale_gen(app, gen).await {
                    logs::log_info(&format!(
                        "WS handshake gen={gen} {} stale on frame, exiting silently (no presence)",
                        lieu.diag()
                    ));
                    return Err(());
                }
                if text.starts_with("42[\"connecteAuServeur\"") {
                    logs::log_info(&format!(
                        "Connected to the chat server! gen={gen} {}",
                        lieu.diag()
                    ));
                    return Ok(());
                }
                if text == "41" {
                    // In-handshake 41 (auth-level, before any `changeSalon`):
                    // no room-init could have been seen — keep the auth
                    // payload, distinct from the mid-loop room-reject path.
                    logs::log_info(&format!(
                        "WS handshake 41 (auth) gen={gen} {}: Authentication error",
                        lieu.diag()
                    ));
                    close_dead_session_if_current(app, gen, "Authentication error (41)").await;
                    return Err(());
                }
            }
            Some(Err(e)) => {
                logs::log_error(&format!("WebSocket error: {e}"));
                close_dead_session_if_current(app, gen, &format!("WebSocket error: {e}")).await;
                return Err(());
            }
            None => {
                logs::log_error("Connection closed by the server");
                close_dead_session_if_current(app, gen, "Connection closed by the server").await;
                return Err(());
            }
        }
    }
}

fn register_handlers(
    ws_stream: WsStream,
    mut rx: mpsc::Receiver<String>,
    app: tauri::AppHandle,
    lieu: Lieu,
    change_salon: String,
    gen: u64,
) {
    let app_clone = app.clone();
    tokio::spawn(async move {
        let (mut write, mut read) = ws_stream.split();

        // Handshake phase (gen + lieu carried for diagnostics + stale abort).
        if handshake(&mut read, &app_clone, gen, &lieu).await.is_err() {
            return;
        }

        // B1: a superseded attempt never takes presence — no changeSalon /
        // refresh sends, no `ws-connected` emit — so a slow Montpellier
        // handshake finishing after Bordeaux was queued stays silent and
        // the lieu-tagged `ws-connected` below always matches `current_lieu`.
        if is_stale_gen(&app_clone, gen).await {
            logs::log_info(&format!(
                "stale dial task gen={gen} {} after handshake: exiting silently (no presence)",
                lieu.diag()
            ));
            return;
        }

        // Send the initial messages. Tavern subscribes to the room state
        // (changeSalon + refresh); village presence is changeSalon only —
        // the `villeInfosPersonnages` roster arrives as `ws-message` frames
        // on the existing bus (no new Tauri event).
        // Order is protocol-significant — keep tavern
        // (changeSalon+taverneMajPerso+taverneMajMenus) vs village
        // (changeSalon only) exactly as-is.
        let initial: Vec<String> = match lieu {
            Lieu::Taverne(_) => vec![
                change_salon.clone(),
                crate::network::socket_io("taverneMajPerso", &[]),
                crate::network::socket_io("taverneMajMenus", &[]),
            ],
            Lieu::Village(..) => vec![change_salon.clone()],
        };
        for payload in initial {
            logs::log_info(&format!("Initial send gen={gen} {}: {payload}", lieu.diag()));
            // Raw-send log to file for byte-exact diff verification
            if payload.starts_with("42[\"changeSalon\"") {
                crate::utils::logs::append_line_for_lieu(lieu.clone(), "SEND", &payload);
            }
            if write.send(payload.into()).await.is_err() {
                logs::log_error("Initial send error");
                return;
            }
        }

        let connected_msg = match lieu {
            Lieu::Taverne(_) => "Connected to the tavern",
            Lieu::Village(..) => "Connected to the village",
        };
        logs::log_info(&format!(
            "WS connected gen={gen} {}: {connected_msg}",
            lieu.diag()
        ));
        let _ = app_clone.emit("ws-connected", connected_msg);

        let mut ping_timer = interval(Duration::from_secs(config::WS_PING_SECS));
        // First tick completes immediately — skip it.
        ping_timer.tick().await;
        // Room-init seen flag for this dial: tavern `taverneInit`, village
        // `villeInfosPersonnages`. A `41` before init is a room-reject
        // (friendly error, no blind retry); after init it is a real drop
        // (retry path).
        let mut saw_room_init = false;

        loop {
            tokio::select! {
                _ = ping_timer.tick() => {
                    if write.send("2".to_string().into()).await.is_err() {
                        logs::log_error("Ping send error");
                        close_dead_session_if_current(&app_clone, gen, &write_error_reason("ping")).await;
                        break;
                    }
                }
                msg_to_send = rx.recv() => {
                    if let Some(payload) = msg_to_send {
                        logs::log_info(&format!("Sending message: {payload}"));
                        if write.send(payload.into()).await.is_err() {
                            logs::log_error("User message send error");
                            close_dead_session_if_current(&app_clone, gen, &write_error_reason("message")).await;
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
                                // B1: stale tasks stay silent (gen-guarded).
                                // Room-reject vs drop: no room-init seen for
                                // this gen/IDLieu → the room refused presence
                                // (distinct payload for a friendly error);
                                // init seen → real drop (retry payload).
                                if saw_room_init {
                                    logs::log_info(&format!(
                                        "WS 41 mid-loop (drop after init) gen={gen} {}: Disconnected by the server",
                                        lieu.diag()
                                    ));
                                    close_dead_session_if_current(&app_clone, gen, "Disconnected by the server").await;
                                } else {
                                    logs::log_info(&format!(
                                        "WS 41 mid-loop (room-rejected, no init yet) gen={gen} {}: {}",
                                        lieu.diag(),
                                        config::WS_CLOSE_ROOM_REJECTED
                                    ));
                                    close_dead_session_if_current(&app_clone, gen, config::WS_CLOSE_ROOM_REJECTED).await;
                                }
                                break;
                            } else {
                                // Per-lieu room-init marker (before the emit
                                // so a racing 41 is classified correctly).
                                let is_init = match &lieu {
                                    Lieu::Taverne(_) => text.contains("\"taverneInit\""),
                                    Lieu::Village(..) => {
                                        text.contains("\"villeInfosPersonnages\"")
                                    }
                                };
                                if is_init && !saw_room_init {
                                    saw_room_init = true;
                                    logs::log_info(&format!(
                                        "WS room-init seen gen={gen} {}",
                                        lieu.diag()
                                    ));
                                }
                                let _ = app_clone.emit("ws-message", text.clone());
                                // Best-effort file log — delegated to utils::logs
                                let line = text.clone();
                                let lieu_c = lieu.clone();
                                tokio::spawn(async move {
                                    logs::append_ws_line_for_lieu(lieu_c, &line);
                                });
                            }
                        }
                        Some(Err(e)) => {
                            logs::log_error(&format!("WebSocket error: {e}"));
                            close_dead_session_if_current(&app_clone, gen, &format!("WebSocket error: {e}")).await;
                            break;
                        }
                        None => {
                            logs::log_error("WebSocket closed by the server");
                            close_dead_session_if_current(&app_clone, gen, "Connection closed by the server").await;
                            break;
                        }
                    }
                }
            }
        }
        logs::log_info("WebSocket task finished");
    });
}

/// Tavern-only dial kept for API compatibility; new code prefers
/// `ws_connect_lieu` with an explicit `Lieu`.
#[allow(dead_code)]
pub async fn ws_connect(
    login: &str,
    token: &str,
    jar: &Arc<Jar>,
    id_lieu: u64,
    app: tauri::AppHandle,
    portrait_json: String,
) -> Result<(), String> {
    // Dead-code path: carry the current generation through so the commit
    // guard behaves (a truly stale gen would drop without committing).
    let gen = app
        .state::<crate::network::session::AppState>()
        .dial
        .lock()
        .await
        .gen;
    ws_connect_lieu(
        login,
        token,
        jar,
        Lieu::Taverne(id_lieu),
        app,
        portrait_json,
        gen,
    )
    .await
}

/// Shared dial for tavern + village presence (single-socket
/// time-multiplexed): one `ws_stream`, one `ws-message` bus, one session
/// channel. The per-lieu differences are the `changeSalon` object
/// (`build_change_salon_for_lieu`), the initial-send list in
/// `register_handlers`, and the `prioritaire` URL flag
/// (tavern=`true`, village=`false` per live-game evidence).
/// `gen` is the B1 dial generation captured by `chat::dial_with_discipline`:
/// a stale attempt (newer target queued during the TCP dial) neither spawns
/// presence nor commits — the drain loop dials the queued target instead.
/// The lieu-tagged `ws-connected` emit (`"Connected to the tavern"` vs
/// `"Connected to the village"`) therefore always matches `current_lieu`.
pub async fn ws_connect_lieu(
    login: &str,
    token: &str,
    jar: &Arc<Jar>,
    lieu: Lieu,
    app: tauri::AppHandle,
    portrait_json: String,
    gen: u64,
) -> Result<(), String> {
    // Dial diagnostics: gen + lieu id + prioritaire. Never the URL/token —
    // `build_url` embeds the token.
    logs::log_info(&format!("WS dial start gen={gen} {}", lieu.diag()));
    let url = build_url(login, token, lieu.prioritaire());
    let request = build_headers(url, jar)?;
    let (ws_stream, _response) = connect(request, gen, &lieu).await?;

    logs::log_info(&format!("WebSocket connected! gen={gen} {}", lieu.diag()));

    let state = app.state::<crate::network::session::AppState>();
    // B1: queued-newer-target check after the TCP dial window — drop a
    // stale stream before it can take presence or commit the session.
    if state.dial.lock().await.gen != gen {
        logs::log_info("ws_connect_lieu: superseded during dial, dropping without commit");
        return Ok(());
    }

    let salon_obj: serde_json::Value =
        serde_json::from_str(&build_change_salon_for_lieu(login, lieu.clone(), &portrait_json))
            .unwrap_or(serde_json::json!({}));
    let change_salon = crate::network::socket_io("changeSalon", &[salon_obj]);
    let (tx, rx) = mpsc::channel::<String>(config::WS_CHANNEL_CAP);
    let app_clone = app.clone();

    register_handlers(ws_stream, rx, app_clone, lieu.clone(), change_salon, gen);

    // Update the session channel + presence target. Tavern-only
    // commands (`change_place`, `ws_send`) consult `current_lieu` and
    // refuse on a village socket (live village socket is changeSalon-only).
    // B1 re-check: the awaits on the session locks are a (brief) window in
    // which a newer target may have queued — never commit stale. The
    // spawned task self-suppresses post-handshake via its own gen check,
    // and `tx` drops here uncommitted so it exits on `None`.
    if state.dial.lock().await.gen != gen {
        logs::log_info("ws_connect_lieu: superseded before commit, dropping without commit");
        drop(tx);
        return Ok(());
    }
    let mut session_guard = state.session.lock().await;
    if let Some(session) = session_guard.as_mut() {
        session.tx = tx;
    }
    drop(session_guard);
    *state.current_lieu.lock().await = Some(lieu);

    Ok(())
}
