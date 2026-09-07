use super::{client::create_client, models::ChatResponse};
use crate::config;
use wreq::cookie::Jar;

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("{0}")]
    BadCredentials(String),
    #[error("{0}")]
    Network(String),
}

pub async fn login(
    login: &str,
    password: &str,
) -> Result<(wreq::Client, std::sync::Arc<Jar>, String), AuthError> {
    let (client, jar) = create_client().map_err(AuthError::Network)?;

    // Session initialization
    client
        .get(config::BASE_URL)
        .header("User-Agent", config::USER_AGENT)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        )
        .header("Accept-Language", "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Accept-Encoding", "gzip, deflate, br")
        .header("Connection", "keep-alive")
        .header("Referer", config::REFERER)
        .header("Upgrade-Insecure-Requests", "1")
        .send()
        .await
        .map_err(|e| AuthError::Network(format!("Initial request failed: {e}")))?;

    // Login request
    let response = client
        .post(config::URL_LOGIN)
        .header("User-Agent", config::USER_AGENT)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        )
        .header("Accept-Language", "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Referer", config::REFERER)
        .header("Origin", config::ORIGIN)
        .header("Connection", "keep-alive")
        .form(&[("login", login), ("password", password)])
        .send()
        .await
        .map_err(|e| AuthError::Network(format!("Login request failed: {e}")))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| AuthError::Network(format!("Response error: {e}")))?;

    let body_lower = body.to_lowercase();
    let authenticated = status.is_success()
        && (body_lower.contains("deconnexion") || body_lower.contains("ecranprincipal"));

    if !authenticated {
        return Err(AuthError::BadCredentials(format!(
            "Failed to connect to Renaissance Kingdoms (HTTP {})",
            status
        )));
    }

    // Fetch the chat token
    let response = client
        .get(config::URL_CHAT_TOKEN)
        .header("User-Agent", config::USER_AGENT)
        .header("Accept", "application/json")
        .header("Referer", config::REFERER)
        .header("Connection", "keep-alive")
        .send()
        .await
        .map_err(|e| AuthError::Network(format!("Token request failed: {e}")))?;

    let chat_body = response
        .text()
        .await
        .map_err(|e| AuthError::Network(format!("Chat response error: {e}")))?;

    let data: ChatResponse = serde_json::from_str(&chat_body)
        .map_err(|e| AuthError::Network(format!("Invalid JSON: {e}")))?;

    if let Some(error) = data.erreur {
        return Err(AuthError::Network(format!("Renaissance Kingdoms : {error}")));
    }

    let token = data
        .token
        .ok_or_else(|| AuthError::Network("Missing chat token".to_string()))?;

    Ok((client, jar, token))
}
