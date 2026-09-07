use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ChatResponse {
    #[serde(rename = "tokenChat")]
    pub token: Option<String>,
    pub erreur: Option<String>,
}
