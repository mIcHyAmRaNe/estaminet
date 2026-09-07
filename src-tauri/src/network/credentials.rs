use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::AppError;

const SERVICE: &str = "estaminet";
const USER: &str = "session";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedCreds {
    pub username: String,
    pub password: String,
}

/// Dual-format store: new multi-account array plus the legacy single object.
/// `untagged` tries `Multi` first (any JSON array, including `[]`), then
/// falls back to `Legacy` (any JSON object). Unknown shapes stay an error —
/// never silently dropped.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum StoreFormat {
    Multi(Vec<SavedCreds>),
    Legacy(Box<SavedCreds>),
}

fn normalize(format: StoreFormat) -> Vec<SavedCreds> {
    match format {
        StoreFormat::Multi(v) => v,
        StoreFormat::Legacy(b) => vec![*b],
    }
}

fn parse_store(s: &str, ctx: &str) -> Result<Vec<SavedCreds>, AppError> {
    let fmt: StoreFormat = serde_json::from_str(s)
        .map_err(|e| AppError::Keyring(format!("{ctx} parse: {e}")))?;
    Ok(normalize(fmt))
}

/// True when secure storage itself is missing (e.g. Linux without Secret
/// Service). Such failures must degrade silently — never surface DBus
/// internals to the UI and never block login. Persistence then falls back to
/// a 0600 file (`~/.estaminet/credentials.json`): loads prefer the keyring and a
/// successful keyring save purges the stale file.
pub fn is_unavailable(e: &keyring::Error) -> bool {
    // NOTE: keyring 3.6 has no `NoBackend` variant; `NoStorageAccess` is the
    // closest equivalent and is treated the same here.
    let missing_backend = matches!(
        e,
        keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_)
    );
    if !missing_backend {
        return false;
    }
    let msg = e.to_string().to_lowercase();
    msg.contains("org.freedesktop.secrets")
        || msg.contains("dbus")
        || msg.contains("secret service")
}

fn cred_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".estaminet").join("credentials.json"))
}

fn entry() -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, USER).map_err(|e| {
        if is_unavailable(&e) {
            AppError::KeyringUnavailable(format!("keyring entry: {e}"))
        } else {
            AppError::Keyring(format!("keyring entry: {e}"))
        }
    })
}

/// Persist the whole multi-account store as a JSON array.
/// Keyring success purges any stale file fallback.
pub fn save_all(accounts: &[SavedCreds]) -> Result<(), AppError> {
    let json = serde_json::to_string(accounts)
        .map_err(|e| AppError::Keyring(format!("keyring serialize: {e}")))?;
    let e = match entry() {
        Ok(e) => e,
        // Keyring unavailable: try file fallback.
        Err(AppError::KeyringUnavailable(_)) => return write_file_fallback(&json),
        Err(e) => return Err(e),
    };
    match e.set_password(&json) {
        Ok(()) => {
            // Keyring success: purge any stale file fallback.
            if let Some(p) = cred_path() {
                let _ = std::fs::remove_file(&p);
            }
            Ok(())
        }
        // Keyring save failed with unavailable backend: try file fallback.
        Err(e) if is_unavailable(&e) => write_file_fallback(&json),
        Err(e) => Err(AppError::Keyring(format!("keyring save: {e}"))),
    }
}

/// Best-effort file fallback for `save_all` when the keyring backend is missing.
/// Creates `~/.estaminet/` as needed and restricts the file to 0600 on unix.
/// Returns `KeyringUnavailable` when the file cannot be written either.
fn write_file_fallback(json: &str) -> Result<(), AppError> {
    let Some(p) = cred_path() else {
        return Err(AppError::KeyringUnavailable(
            "keyring unavailable and no file path".to_string(),
        ));
    };
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&p, json.as_bytes()) {
        Ok(()) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let perms = std::fs::Permissions::from_mode(0o600);
                let _ = std::fs::set_permissions(&p, perms);
            }
            Ok(())
        }
        Err(e) => Err(AppError::KeyringUnavailable(format!(
            "file fallback save: {e}"
        ))),
    }
}

/// Load every saved account. Reads both the new JSON-array format and the
/// legacy single-object format (keyring first, then the file fallback).
/// Parse failures are returned as errors — the store is never deleted
/// on a parse failure.
pub fn load_all() -> Result<Vec<SavedCreds>, AppError> {
    // Try keyring first.
    let entry_result = entry();
    match entry_result {
        Ok(e) => {
            match e.get_password() {
                Ok(pw) => {
                    // Stored entry exists: parse it (array or legacy
                    // object). A corrupt entry is an error, never a delete.
                    let accounts = parse_store(&pw, "keyring")?;
                    return Ok(accounts);
                }
                Err(keyring::Error::NoEntry) => {
                    // No keyring entry: the fallback file may still hold
                    // credentials (keyring was unavailable at save time) —
                    // continue to the file.
                }
                Err(e) if is_unavailable(&e) => {
                    // Keyring unavailable: fall through to file.
                }
                Err(e) => return Err(AppError::Keyring(format!("keyring load: {e}"))),
            }
        }
        Err(AppError::KeyringUnavailable(_)) => {
            // Keyring unavailable: fall through to file.
        }
        Err(e) => return Err(e),
    }
    // File fallback (only reached when keyring unavailable or missing entry not applicable).
    if let Some(p) = cred_path() {
        match std::fs::read_to_string(&p) {
            Ok(content) => {
                let accounts = parse_store(&content, "file")?;
                return Ok(accounts);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(AppError::KeyringUnavailable(format!("file fallback load: {e}"))),
        }
    }
    Ok(vec![])
}

/// Insert or replace the entry for `creds.username`, then persist.
/// Callers must hold `AppState::cred_lock` across this read-modify-write.
pub fn upsert(creds: &SavedCreds) -> Result<(), AppError> {
    let mut all = load_all()?;
    if let Some(existing) = all.iter_mut().find(|c| c.username == creds.username) {
        *existing = creds.clone();
    } else {
        all.push(creds.clone());
    }
    save_all(&all)
}

/// Remove the entry for `username`. Returns `true` when an entry was
/// removed, `false` when none matched (store untouched).
/// Callers must hold `AppState::cred_lock` across this read-modify-write.
pub fn remove(username: &str) -> Result<bool, AppError> {
    let mut all = load_all()?;
    let before = all.len();
    all.retain(|c| c.username != username);
    if all.len() == before {
        return Ok(false);
    }
    save_all(&all)?;
    Ok(true)
}

/// Find one account by username.
pub fn find(username: &str) -> Result<Option<SavedCreds>, AppError> {
    Ok(load_all()?.into_iter().find(|c| c.username == username))
}

/// Idempotent delete — missing entry is Ok; always clears the file fallback too.
pub fn delete_all() -> Result<(), AppError> {
    // The fallback file must never outlive deletion (ghost credentials).
    if let Some(p) = cred_path() {
        let _ = std::fs::remove_file(&p);
    }
    let e = match entry() {
        Ok(e) => e,
        Err(AppError::KeyringUnavailable(_)) => {
            // Try file fallback delete.
            if let Some(p) = cred_path() {
                let _ = std::fs::remove_file(&p);
            }
            return Ok(());
        }
        Err(e) => return Err(e),
    };
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) if is_unavailable(&e) => {
            if let Some(p) = cred_path() {
                let _ = std::fs::remove_file(&p);
            }
            Ok(())
        }
        Err(e) => Err(AppError::Keyring(format!("keyring delete: {e}"))),
    }
}

/// Deprecated single-account shims (kept for compatibility):
/// `save` upserts one entry, `load` returns the first entry,
/// `delete` clears the whole store.

#[deprecated(note = "use upsert() for the multi-account store")]
#[allow(dead_code)]
pub fn save(creds: &SavedCreds) -> Result<(), AppError> {
    upsert(creds)
}

#[deprecated(note = "use load_all() or find() for the multi-account store")]
#[allow(dead_code)]
pub fn load() -> Result<Option<SavedCreds>, AppError> {
    Ok(load_all()?.into_iter().next())
}

#[deprecated(note = "use remove() or delete_all() for the multi-account store")]
#[allow(dead_code)]
pub fn delete() -> Result<(), AppError> {
    delete_all()
}
