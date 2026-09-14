use std::sync::Arc;
use wreq::{cookie::Jar, header, redirect::Policy, Client};

use crate::config;

/// Browser-mimicking defaults applied once to every HTTP client, so the
/// per-request builders (`network/auth.rs`, `commands/taverne.rs`) only
/// set endpoint-specific headers (Accept / Referer / Origin / Cookie).
fn default_browser_headers() -> header::HeaderMap {
    let mut headers = header::HeaderMap::new();
    headers.insert(
        header::USER_AGENT,
        header::HeaderValue::from_static(config::USER_AGENT),
    );
    headers
}

pub fn create_client() -> Result<(Client, Arc<Jar>), String> {
    let jar = Arc::new(Jar::default());

    let client = Client::builder()
        .cookie_provider(Arc::clone(&jar))
        .default_headers(default_browser_headers())
        .redirect(Policy::limited(10))
        .timeout(std::time::Duration::from_secs(config::HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    Ok((client, jar))
}
