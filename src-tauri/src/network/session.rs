use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use wreq::{cookie::Jar, Client};

pub struct Session {
    pub login: String,
    pub token: String,
    pub jar: Arc<Jar>,
    #[allow(dead_code)]
    pub client: Client,
    pub tx: mpsc::Sender<String>, // Channel for sending messages to the WebSocket task
    #[allow(dead_code)]
    pub remember: bool,
}

#[derive(Default)]
pub struct AppState {
    pub session: Mutex<Option<Session>>,
    /// Single-flight guard against double-connect (mirrors the official
    /// JS `_initialisationEnCours`: ONE socket at a time).
    /// `true` for the whole `ws_connect` (old teardown + dial).
    pub ws_connecting: Mutex<bool>,
}
