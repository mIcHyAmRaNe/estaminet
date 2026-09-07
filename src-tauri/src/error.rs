use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Not connected — log in first")]
    NotConnected,

    #[error("Connection lost")]
    ConnectionLost,

    #[error("Message too long (max {0} characters)")]
    MessageTooLong(usize),

    #[error("Invalid format: {0}")]
    InvalidFormat(String),

    #[error("Invalid place (0-9)")]
    InvalidPlace,

    #[error("Network error: {0}")]
    Network(String),

    #[error("Invalid credentials: {0}")]
    BadCredentials(String),

    #[error("Account not found: {0}")]
    AccountNotFound(String),

    #[error("Keyring error: {0}")]
    Keyring(String),

    // Friendly-only Display: the inner detail is kept for logs and must
    // never be sent raw to UI paths (see commands/auth.rs).
    #[error("Keyring unavailable on this system")]
    KeyringUnavailable(String),

    #[error("IO: {0}")]
    Io(String),

    #[error("{0}")]
    Other(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

#[allow(dead_code)]
pub type AppResult<T> = Result<T, AppError>;
