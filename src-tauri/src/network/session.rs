use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use wreq::{cookie::Jar, Client};

use crate::network::socket::Lieu;

pub struct Session {
    pub login: String,
    pub token: String,
    pub jar: Arc<Jar>,
    pub client: Client,
    pub tx: mpsc::Sender<String>, // Channel for sending messages to the WebSocket task
}

impl Session {
    /// Swap `tx` for a closed dummy channel and return the previous sender.
    /// The old receiver sees any buffered messages then `None`, so the
    /// socket task terminates. Single source of the dummy-tx pattern
    /// (previously triplicated in `ws_connect_inner`, `ws_disconnect` and
    /// `close_dead_session`).
    pub fn replace_tx_with_closed(&mut self) -> mpsc::Sender<String> {
        let (dummy_tx, dummy_rx) = mpsc::channel::<String>(1);
        drop(dummy_rx);
        std::mem::replace(&mut self.tx, dummy_tx)
    }

    /// Swap in a closed dummy and best-effort send socket.io close ("41")
    /// through the previous channel. Returns `true` when the previous
    /// channel was live (callers can then let the server digest the close).
    pub async fn close_tx(&mut self) -> bool {
        let old_tx = self.replace_tx_with_closed();
        let had_live = !old_tx.is_closed();
        if had_live {
            let _ = old_tx.send("41".to_owned()).await;
        }
        had_live
    }
}

/// B1 dial discipline: single-flight with latest-wins queue + generation.
///
/// `inflight` is the `Lieu` currently being dialed (`ws_connect_inner`:
/// teardown + portrait fetch + `ws_connect_lieu`). A second request for the
/// SAME `Lieu` is a duplicate and swallowed; a request for a DIFFERENT
/// `Lieu` replaces `pending` (single latest wins) and returns `Ok(())`
/// immediately — the drain loop in `chat::dial_with_discipline` dials it
/// right after the in-flight attempt settles.
///
/// `gen` is bumped on every accepted target change (claim, queue, chain,
/// voluntary teardown). `ws_connect_lieu` + its socket task capture the gen
/// at spawn and refuse to commit (`session.tx`, `current_lieu`,
/// `ws-connected`, `ws-closed`) once stale, so a slow Montpellier handshake
/// can never clobber a newer Bordeaux dial.
#[derive(Default)]
pub struct DialState {
    pub inflight: Option<Lieu>,
    pub pending: Option<Lieu>,
    pub gen: u64,
}

#[derive(Default)]
pub struct AppState {
    pub session: Mutex<Option<Session>>,
    /// Presence target of the live single-socket WS connection.
    /// Set on every successful `socket::ws_connect_lieu` dial, cleared on
    /// voluntary teardown (`chat::teardown_session`, `auth::ws_disconnect`).
    /// Tavern-only commands (`change_place`, `ws_send`) refuse to send when
    /// this is `Village` — the live village socket only ever sends
    /// `changeSalon` (+ engine.io ping), never `taverne*`.
    pub current_lieu: Mutex<Option<crate::network::socket::Lieu>>,
    /// Single-flight guard against double-connect (mirrors the official
    /// JS `_initialisationEnCours`: ONE socket at a time).
    /// `true` for the whole `ws_connect` (old teardown + dial).
    pub ws_connecting: Mutex<bool>,
    /// B1 dial discipline state (inflight / queued-latest / generation).
    /// `ws_connecting` above is kept as a legacy mirror (true while
    /// `dial.inflight.is_some()`); the `DialState` is the authority.
    pub dial: Mutex<DialState>,
    /// Serializes credential store read-modify-write cycles
    /// (`upsert`/`remove`) so concurrent account operations never
    /// lose an entry.
    pub cred_lock: Mutex<()>,
    /// Last-good own portrait JSON per login (lowercased key), as sent in
    /// the last successful `changeSalon`. Fresh-first fetch on every
    /// `ws_connect` keeps RP outfit changes safe; this cache is ONLY a
    /// fallback when the Zoom fetch fails (never served blindly).
    pub portrait_cache: Mutex<HashMap<String, String>>,
}
