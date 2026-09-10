use std::path::PathBuf;

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

#[allow(dead_code)]
#[inline]
pub fn log_debug(msg: &str) {
    if cfg!(debug_assertions) {
        println!("[estaminet][debug] {msg}");
    }
}

#[cfg(windows)]
fn hide_dir_windows(dir: &std::path::Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Storage::FileSystem::{GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};
    let wide: Vec<u16> = dir.as_os_str().encode_wide().collect();
    let h = HSTRING::from_wide(&wide);
    let pwstr = PCWSTR::from_raw(h.as_ptr());
    unsafe {
        let attrs = GetFileAttributesW(pwstr);
        const INVALID: u32 = 0xFFFFFFFF;
        if attrs != INVALID {
            let _ = SetFileAttributesW(pwstr, attrs | FILE_ATTRIBUTE_HIDDEN);
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
    let dir = hidden_log_dir()?;
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    Ok(dir.join(format!("taverne_{}_{}.log", tavern_id, date)))
}

/// Append a raw socket line to the per-taverne daily log file.
/// Used by the WebSocket task — failures are silently ignored (best-effort).
pub fn append_ws_line(tavern_id: u64, line: &str) {
    // Spawn-independent helper: keep logic out of socket.rs
    if let Some(home) = dirs::home_dir() {
    let dir = home.join(".estaminet").join("logs");
        #[cfg(windows)]
        let is_new = !dir.exists();
        let _ = std::fs::create_dir_all(&dir);
        #[cfg(windows)]
        {
            if is_new {
                hide_dir_windows(&dir);
            }
        }
        let date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let path = dir.join(format!("taverne_{}_{}.log", tavern_id, date));
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let entry = format!("[{ts}] {line}\n");
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut f| {
                use std::io::Write;
                f.write_all(entry.as_bytes())
            });
    }
}
