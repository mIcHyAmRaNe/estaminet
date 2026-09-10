use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    config,
    error::AppError,
    network::session::AppState,
    utils::{cookies::extract_cookies, logs},
};

// ---------- tavern list: single source of truth ----------
// Compile-time embedded JSON (works in dev + bundled build, no runtime path).
const TAVERNS_JSON: &str = include_str!("../../resources/taverns.json");

#[derive(Deserialize)]
struct TavernsFile {
    cities: Vec<CityEntry>,
}

#[derive(Deserialize)]
struct CityEntry {
    name: String,
    taverns: Vec<TavernEntry>,
}

#[derive(Deserialize)]
struct TavernEntry {
    tavern_id: u64,
    // Nullable in source JSON (e.g. "Inconnue" placeholders) → fallback below.
    tavern_name: Option<String>,
    description: Option<String>,
}

#[derive(Serialize)]
pub struct TavernInfo {
    pub id: u64,
    pub name: String,
    pub ville: String,
    pub description: String,
}

#[tauri::command]
pub async fn get_taverns() -> Vec<TavernInfo> {
    let parsed: TavernsFile = match serde_json::from_str(TAVERNS_JSON) {
        Ok(p) => p,
        Err(e) => {
            logs::log_error(&format!("taverns.json unreadable: {e}"));
            return Vec::new();
        }
    };
    parsed
        .cities
        .into_iter()
        .flat_map(|city| {
            city.taverns.into_iter().map(move |t| TavernInfo {
                id: t.tavern_id,
                name: t
                    .tavern_name
                    .unwrap_or_else(|| format!("Tavern {}", t.tavern_id)),
                ville: city.name.clone(),
                description: t.description.unwrap_or_default(),
            })
        })
        .collect()
}

// ---------- helpers: robust parsing ----------

fn extract_nombre_places(html: &str) -> Result<u64, AppError> {
    // Try multiple robust strategies before failing.

    // Strategy 1: look for the key "NombrePlaces" and parse the nearby number.
    // We allow JSON `"NombrePlaces": 9`, `"NombrePlaces":"9"`, or HTML `NombrePlaces=9`.
    let mut search_start = 0;
    while let Some(idx) = html[search_start..].find("NombrePlaces") {
        let abs_idx = search_start + idx;
        // Take a window around the key to avoid scanning whole doc.
        let window_end = (abs_idx + 400).min(html.len());
        let snippet = &html[abs_idx..window_end];

        // Find separator ':' or '=' after the key.
        if let Some(sep_rel) = snippet["NombrePlaces".len()..].find(|c| c == ':' || c == '=') {
            let after_sep = &snippet["NombrePlaces".len() + sep_rel + 1..];
            // Skip non-digits (quotes, spaces)
            let digits: String = after_sep
                .chars()
                .skip_while(|c| !c.is_ascii_digit())
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(n) = digits.parse::<u64>() {
                if config::VALID_NOMBRE_PLACES.contains(&n) || (1..=20).contains(&n) {
                    return Ok(n);
                }
            }
        }

        // Fallback within snippet: grab first digit sequence after the key.
        let after_key = &snippet["NombrePlaces".len()..];
        let digits: String = after_key
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(n) = digits.parse::<u64>() {
            if config::VALID_NOMBRE_PLACES.contains(&n) || (1..=20).contains(&n) {
                return Ok(n);
            }
        }

        search_start = abs_idx + "NombrePlaces".len();
        if search_start >= html.len() {
            break;
        }
    }

    // Strategy 2: broad regex-like fallback — search for `"NombrePlaces"\s*:\s*"?\d+"?`
    // We do a manual scan to avoid adding regex dependency.
    // If still not found, return granular error.
    Err(AppError::InvalidFormat(
        "NombrePlaces not found in the response".into(),
    ))
}

fn extract_balanced_json(s: &str, start_brace: usize) -> Option<&str> {
    let bytes = s.as_bytes();
    if start_brace >= bytes.len() || bytes[start_brace] != b'{' {
        return None;
    }
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escaped = false;
    for (i, &b) in bytes[start_brace..].iter().enumerate() {
        if in_str {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_str = false;
            }
        } else {
            match b {
                b'"' => in_str = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(&s[start_brace..start_brace + i + 1]);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

fn percent_encode_login(login: &str) -> String {
    // Manual percent-encoding (no new dependency): keep unreserved chars,
    // encode everything else byte by byte (UTF-8 included, so accented
    // chars become multi-byte %XX sequences). The login is trimmed first.
    let mut out = String::with_capacity(login.len());
    for b in login.trim().as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn portrait_json_matches_login(json_str: &str, expected_login: &str) -> bool {
    let expected = expected_login.trim().to_lowercase();
    if expected.is_empty() {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json_str) else {
        return false;
    };
    // Nominal case: "login" field (case-insensitive key) at the top level.
    // If it exists and differs → proven mismatch (never return the logged-in
    // user's portrait for another login).
    if let serde_json::Value::Object(map) = &value {
        for (k, v) in map {
            if k.to_lowercase() == "login" {
                if let serde_json::Value::String(s) = v {
                    return s.trim().to_lowercase() == expected;
                }
                return false;
            }
        }
    }
    // Nested structure: deep search for a string equal to the login.
    fn deep_contains(v: &serde_json::Value, expected: &str) -> bool {
        match v {
            serde_json::Value::String(s) => s.trim().to_lowercase() == expected,
            serde_json::Value::Object(map) => map.values().any(|vv| deep_contains(vv, expected)),
            serde_json::Value::Array(arr) => arr.iter().any(|vv| deep_contains(vv, expected)),
            _ => false,
        }
    }
    deep_contains(&value, &expected)
}

/// Top-level login of a portrait JSON ("login" key, case-insensitive).
/// Used for diagnostics (requested login vs logins seen on the page).
fn found_login_of(json_str: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json_str).ok()?;
    if let serde_json::Value::Object(map) = &v {
        for (k, val) in map {
            if k.to_lowercase() == "login" {
                if let serde_json::Value::String(s) = val {
                    return Some(s.clone());
                }
                return None;
            }
        }
    }
    None
}

fn extract_portrait_json(html: &str, expected_login: &str) -> Result<String, AppError> {
    // Primary marker used by RK taverne page.
    let markers = ["apercu_personnage_rar", "genereApercuDepuisJSON", "portrait"];
    let mut saw_mismatched = false;
    // Bounded diagnostics: logins seen without matching the request.
    let mut seen_logins: Vec<String> = Vec::new();
    let note_seen = |json_str: &str, seen_logins: &mut Vec<String>| {
        if seen_logins.len() >= 10 {
            return;
        }
        if let Some(found) = found_login_of(json_str) {
            if !seen_logins.iter().any(|s| s == &found) {
                seen_logins.push(found);
            }
        }
    };

    // The FichePersonnage page can contain SEVERAL portraits (e.g. one's
    // own in the chrome + the requested one further down). The old scan only
    // looked at the FIRST occurrence of each marker: if that was the
    // logged-in user's portrait, every mismatch became fatal and other
    // players stayed as letters. So we sweep ALL occurrences and return the
    // FIRST JSON whose login matches (trim + case-insensitive). Only the
    // total absence of a match remains an error — we never return a wrong
    // portrait.
    for marker in markers {
        let mut cursor = 0usize;
        while cursor < html.len() {
            let Some(rel) = html[cursor..].find(marker) else {
                break;
            };
            let pos = cursor + rel;
            let from = &html[pos..];
            let mut consumed = false;
            // Find first '{' after marker
            if let Some(brace_rel) = from.find('{') {
                let abs_brace = pos + brace_rel;
                if let Some(json_slice) = extract_balanced_json(html, abs_brace) {
                    let trimmed = json_slice.trim();
                    // Quick validation: must contain login and be valid JSON
                    if trimmed.contains("login") {
                        if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
                            // Never return the logged-in user's portrait
                            // for another login: check (trim +
                            // case-insensitive) before returning.
                            if portrait_json_matches_login(trimmed, expected_login) {
                                return Ok(trimmed.to_string());
                            }
                            saw_mismatched = true;
                            note_seen(trimmed, &mut seen_logins);
                        }
                    }
                    cursor = abs_brace + json_slice.len();
                    consumed = true;
                } else {
                    // Lone '{' without balanced JSON: skip it.
                    cursor = abs_brace + 1;
                    consumed = true;
                }
            }

            // Fallback: old fragile path `> {json} </div>` — keep for compat
            if !consumed {
                if let Some(close_tag) = from.find('>') {
                    let start = pos + close_tag + 1;
                    if let Some(end_tag) = html[start..].find("</div>") {
                        let candidate = html[start..start + end_tag].trim();
                        if candidate.starts_with('{') && candidate.contains("login") {
                            if serde_json::from_str::<serde_json::Value>(candidate).is_ok() {
                                if portrait_json_matches_login(candidate, expected_login) {
                                    return Ok(candidate.to_string());
                                }
                                saw_mismatched = true;
                                note_seen(candidate, &mut seen_logins);
                            }
                        }
                        cursor = start + end_tag + "</div>".len();
                        consumed = true;
                    }
                }
            }
            if !consumed {
                cursor = pos + marker.len();
            }
        }
    }

    if saw_mismatched {
        logs::log_info(&format!(
            "portrait '{}': no JSON matched (seen logins: {:?})",
            expected_login.trim(),
            seen_logins
        ));
        return Err(AppError::InvalidFormat(
            "Portrait does not match the requested login".into(),
        ));
    }

    Err(AppError::InvalidFormat(
        "Portrait not found for this login".into(),
    ))
}

// ---------- inner impls returning AppError ----------

async fn inner_get_taverne_places(
    client: &wreq::Client,
    jar: &std::sync::Arc<wreq::cookie::Jar>,
    id_lieu: u64,
) -> Result<u64, AppError> {
    let cookie_header = extract_cookies(jar);
    if cookie_header.is_empty() {
        return Err(AppError::Network("No cookie".into()));
    }

    let candidates = [
        format!("{}?l={id_lieu}", config::URL_ECRAN_PRINCIPAL),
        format!("{}?l={id_lieu}", config::URL_ECRAN_PRINCIPAL_AJAX),
        format!("{}?l={id_lieu}", config::URL_VILLAGE),
    ];

    let mut last_err: Option<AppError> = None;

    for url in candidates {
        let resp = client
            .get(&url)
            .header("Cookie", cookie_header.clone())
            .header("User-Agent", config::USER_AGENT)
            .header("Referer", config::REFERER)
            .send()
            .await
            .map_err(|e| AppError::Network(format!("Tavern request failed: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            last_err = Some(AppError::Network(format!("HTTP {status} for {url}")));
            continue;
        }

        let text = resp
            .text()
            .await
            .map_err(|e| AppError::Network(format!("Error reading response: {e}")))?;

        match extract_nombre_places(&text) {
            Ok(n) => {
                logs::log_info(&format!("taverne {id_lieu} NombrePlaces={n}"));
                return Ok(n);
            }
            Err(e) => {
                last_err = Some(e);
                continue;
            }
        }
    }

    Err(last_err.unwrap_or_else(|| AppError::InvalidFormat("NombrePlaces not found".into())))
}

async fn inner_get_portrait_json(
    client: &wreq::Client,
    jar: &std::sync::Arc<wreq::cookie::Jar>,
    login: &str,
) -> Result<String, AppError> {
    let cookie_header = extract_cookies(jar);
    if cookie_header.is_empty() {
        return Err(AppError::Network("No cookie".into()));
    }

    // URL-encoded login (percent-encoding: accented chars → %XX UTF-8).
    let encoded = percent_encode_login(login);
    let url = format!("{}?login={}", config::URL_FICHE_PERSONNAGE, encoded);

    let resp = client
        .get(&url)
        .header("Cookie", cookie_header.clone())
        .header("User-Agent", config::USER_AGENT)
        .header("Referer", config::REFERER)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Portrait request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Network(format!("HTTP {} for portrait", resp.status())));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Network(format!("Error reading portrait: {e}")))?;

    extract_portrait_json(&text, login)
}

// ---------- Tauri commands (map AppError -> String consistently) ----------

#[tauri::command]
pub async fn get_taverne_places(state: State<'_, AppState>, id_lieu: u64) -> Result<u64, String> {
    let (client, jar) = {
        let s = state.session.lock().await;
        let s = s.as_ref().ok_or_else(|| AppError::NotConnected.to_string())?;
        (s.client.clone(), s.jar.clone())
    };
    inner_get_taverne_places(&client, &jar, id_lieu)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_portrait_json(state: State<'_, AppState>, login: String) -> Result<String, String> {
    let (client, jar) = {
        let s = state.session.lock().await;
        let s = s.as_ref().ok_or_else(|| AppError::NotConnected.to_string())?;
        (s.client.clone(), s.jar.clone())
    };
    inner_get_portrait_json(&client, &jar, &login)
        .await
        .map_err(|e| e.to_string())
}

// ---------- portrait assets: oxv CDN proxy (CORS-free calque loading) ----------

/// Sniff the image mime from magic bytes (the CDN serves webp or png).
fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() >= 4 && bytes[0..4] == [0x89, b'P', b'N', b'G'] {
        Some("image/png")
    } else {
        None
    }
}

async fn get_asset_bytes(client: &wreq::Client, url: &str) -> Result<Vec<u8>, AppError> {
    // No cookies: the CDN is public and the session must not leak to it.
    let resp = client
        .get(url)
        .header("User-Agent", config::USER_AGENT)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("CDN request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "HTTP {} for CDN asset",
            resp.status()
        )));
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| AppError::Network(format!("Error reading CDN asset: {e}")))
}

async fn inner_fetch_portrait_asset(client: &wreq::Client, url: &str) -> Result<String, AppError> {
    // SSRF guard: only the oxv images CDN root is fetchable.
    if !url.starts_with(config::CDN_IMAGES_ROOT) {
        return Err(AppError::InvalidFormat(format!(
            "portrait asset URL outside CDN root: {url}"
        )));
    }

    // webp → png fallback: some calques only exist as png on the CDN.
    let bytes = match get_asset_bytes(client, url).await {
        Ok(b) => b,
        Err(webp_err) if url.ends_with(".webp") => {
            match get_asset_bytes(client, &url.replace(".webp", ".png")).await {
                Ok(b) => b,
                Err(_) => return Err(webp_err),
            }
        }
        Err(e) => return Err(e),
    };

    let mime = sniff_image_mime(&bytes)
        .ok_or_else(|| AppError::InvalidFormat("Unrecognized image format".into()))?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// Fetch a Midas calque from the oxv CDN and return it as a `data:` URL.
/// The webview loads data: URLs same-origin: the canvas stays untainted and
/// runs no CORS checks — removing the CDN 404 CORS console noise (missing
/// calques surface as a rejected promise instead).
#[tauri::command]
pub async fn fetch_portrait_asset(
    state: State<'_, AppState>,
    url: String,
) -> Result<String, String> {
    let (client, _jar) = {
        let s = state.session.lock().await;
        let s = s.as_ref().ok_or_else(|| AppError::NotConnected.to_string())?;
        (s.client.clone(), s.jar.clone())
    };
    inner_fetch_portrait_asset(&client, &url)
        .await
        .map_err(|e| e.to_string())
}
