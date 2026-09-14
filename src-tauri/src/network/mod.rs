pub mod auth;
pub mod client;
pub mod credentials;
pub mod models;
pub mod session;
pub mod socket;

use serde_json::{json, Value};

/// socket.io `42["event", ...]` payload builder — single source of truth.
/// Used by `commands::chat` (all `taverne*` sends) and `network::socket`
/// (initial `taverneMaj*` sends + the `changeSalon` envelope).
pub(crate) fn socket_io(event: &str, args: &[Value]) -> String {
    let mut payload = vec![json!(event)];
    payload.extend_from_slice(args);
    format!("42{}", json!(payload).to_string())
}
