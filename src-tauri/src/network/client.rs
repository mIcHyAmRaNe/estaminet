use std::sync::Arc;
use wreq::{cookie::Jar, redirect::Policy, Client};

use crate::config;

pub fn create_client() -> Result<(Client, Arc<Jar>), String> {
    let jar = Arc::new(Jar::default());

    let client = Client::builder()
        .cookie_provider(Arc::clone(&jar))
        .redirect(Policy::limited(10))
        .timeout(std::time::Duration::from_secs(config::HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    Ok((client, jar))
}
