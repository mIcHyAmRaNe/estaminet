use std::path::PathBuf;

use crate::network::socket::Lieu;

/// Centralized logging helpers — use these instead of raw `println!` / `eprintln!`.
#[inline]
pub fn log_info(msg: &str) {
    println!("[estaminet] {msg}");
}

#[inline]
pub fn log_warn(msg: &str) {
    eprintln!("[estaminet][warn] {msg}");
}

#[inline]
pub fn log_error(msg: &str) {
    eprintln!("[estaminet][error] {msg}");
}

#[cfg(windows)]
fn hide_dir_windows(dir: &std::path::Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Storage::FileSystem::{GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};
    let wide: Vec<u16> = dir.as_os_str().encode_wide().collect();
    let h = HSTRING::from_wide(&wide);
    let pwstr = PCWSTR::from_raw(h.as_ref().unwrap().as_ptr());
    unsafe {
        let attrs = GetFileAttributesW(pwstr);
        const INVALID: u32 = 0xFFFFFFFF;
        if attrs != INVALID {
            let _ = SetFileAttributesW(pwstr, windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES((attrs | FILE_ATTRIBUTE_HIDDEN.0) as u32));
        }
    }
}

pub fn hidden_log_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not find the home directory".to_string())?;
        let dir = home.join(".estaminet").join("logs");
    #[cfg(windows)]
    let is_new = !dir.exists();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create log directory: {e}"))?;
    #[cfg(windows)]
    {
        if is_new {
            hide_dir_windows(&dir);
        }
    }
    Ok(dir)
}

pub fn log_path_for(tavern_id: u64) -> Result<PathBuf, String> {
    log_path_for_lieu(Lieu::Taverne(tavern_id))
}

/// Lieu-aware daily log path: `taverne_<id>_<date>.log` for tavern presence,
/// `village_<id>_<date>.log` for village presence (B3 log split),
/// `maison_<id>_<date>.log` for maison presence.
pub(crate) fn log_path_for_lieu(lieu: Lieu) -> Result<PathBuf, String> {
    let dir = hidden_log_dir()?;
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let prefix = match lieu {
        Lieu::Taverne(_) => "taverne",
        Lieu::Village(..) => "village",
        Lieu::Maison(..) => "maison",
    };
    Ok(dir.join(format!("{prefix}_{}_{date}.log", lieu.id())))
}

/// Append one timestamped line to the per-lieu daily log file.
/// Best-effort: failures are silently ignored. An empty `prefix` writes the
/// line bare (`[ts] {payload}`), otherwise `[ts] {prefix} {payload}`.
pub(crate) fn append_line_for_lieu(lieu: Lieu, prefix: &str, payload: &str) {
    let Ok(path) = log_path_for_lieu(lieu) else {
        return;
    };
    append_to_path(&path, prefix, payload);
}

fn append_to_path(path: &std::path::Path, prefix: &str, payload: &str) {
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let entry = if prefix.is_empty() {
        format!("[{ts}] {payload}\n")
    } else {
        format!("[{ts}] {prefix} {payload}\n")
    };
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(entry.as_bytes())
        });
}

/// Append a raw socket line to the per-lieu daily log file.
/// Used by the WebSocket task — failures are silently ignored (best-effort).
pub(crate) fn append_ws_line_for_lieu(lieu: Lieu, line: &str) {
    // Spawn-independent helper: keep logic out of socket.rs
    append_line_for_lieu(lieu, "", line);
}
