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
    places: Option<u64>,
}

#[derive(Serialize)]
pub struct TavernInfo {
    pub id: u64,
    pub name: String,
    pub ville: String,
    pub description: String,
    pub places: Option<u64>,
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
                places: t.places,
            })
        })
        .collect()
}

// ---------- helpers: robust parsing ----------

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

pub(crate) fn canonicalize_portrait_json(json_str: &str, expected_login: &str) -> String {
    let trimmed = json_str.trim();
    let mut value: serde_json::Value = match serde_json::from_str::<serde_json::Value>(trimmed) {
        Ok(v) => v,
        Err(_) => return trimmed.to_string(),
    };
    let obj = value.as_object_mut();
    if obj.is_none() {
        return trimmed.to_string();
    }
    let obj = obj.unwrap();
    // Normalize login to session login (display case diverges from page)
    obj.insert("login".to_string(), serde_json::Value::String(expected_login.trim().to_string()));
    // Filter equipement to worn-only (miniature == "o")
    if let Some(arr) = obj.get_mut("equipement").and_then(|v| v.as_array_mut()) {
        arr.retain(|item| {
            item.get("miniature")
                .and_then(|v| v.as_str())
                .map_or(false, |m| m == "o")
        });
    }
    value.to_string()
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
                                return Ok(canonicalize_portrait_json(trimmed, expected_login));
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
                                    return Ok(canonicalize_portrait_json(candidate, expected_login));
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

/// codeVisage field of a portrait JSON (diagnostics: fresh/cached/default).
pub(crate) fn code_visage_of(json_str: &str) -> String {
    serde_json::from_str::<serde_json::Value>(json_str)
        .ok()
        .and_then(|v| v.get("codeVisage")?.as_str().map(str::to_owned))
        .unwrap_or_else(|| "<none>".into())
}

async fn fetch_portrait_page(
    client: &wreq::Client,
    jar: &std::sync::Arc<wreq::cookie::Jar>,
    base_url: &str,
    login: &str,
    label: &str,
) -> Result<String, AppError> {
    let cookie_header = extract_cookies(jar);
    if cookie_header.is_empty() {
        return Err(AppError::Network("No cookie".into()));
    }

    // URL-encoded login (percent-encoding: accented chars → %XX UTF-8).
    let encoded = percent_encode_login(login);
    let url = format!("{base_url}?login={encoded}");

    let resp = client
        .get(&url)
        .header("Cookie", cookie_header.clone())
        .header("Referer", config::REFERER)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Portrait request failed ({label}): {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "HTTP {} for portrait ({label})",
            resp.status()
        )));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Network(format!("Error reading portrait ({label}): {e}")))?;

    extract_portrait_json(&text, login)
}

async fn inner_get_portrait_json(
    client: &wreq::Client,
    jar: &std::sync::Arc<wreq::cookie::Jar>,
    login: &str,
) -> Result<String, AppError> {
    // Lightweight Zoom endpoint first (same page the changeSalon fetch
    // uses); the heavy Fiche page stays as a dead fallback only.
    match fetch_portrait_page(client, jar, config::URL_ZOOM_PERSONNAGE, login, "zoom").await {
        Ok(json) => {
            logs::log_info(&format!(
                "portrait '{login}': zoom ok (codeVisage={})",
                code_visage_of(&json)
            ));
            Ok(json)
        }
        Err(zoom_err) => {
            logs::log_info(&format!(
                "portrait '{login}': zoom failed ({zoom_err}), trying fiche"
            ));
            fetch_portrait_page(client, jar, config::URL_FICHE_PERSONNAGE, login, "fiche").await
        }
    }
}

pub(crate) async fn fetch_own_portrait_json(
    client: &wreq::Client,
    jar: &std::sync::Arc<wreq::cookie::Jar>,
    login: &str,
) -> Result<String, AppError> {
    fetch_portrait_page(client, jar, config::URL_ZOOM_PERSONNAGE, login, "zoom-own").await
}

// ---------- Tauri commands (map AppError -> String consistently) ----------

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

/// Exact portrait JSON last sent in `changeSalon` for the session login
/// (fresh-first fetch result, or last-good cache, or empty when never
/// fetched). The self-view renders this so it mirrors what other players
/// see — never a divergent Fiche fetch.
#[tauri::command]
pub async fn get_own_portrait_json(state: State<'_, AppState>) -> Result<String, String> {
    let login = {
        let s = state.session.lock().await;
        let s = s.as_ref().ok_or_else(|| AppError::NotConnected.to_string())?;
        s.login.clone()
    };
    let cache = state.portrait_cache.lock().await;
    Ok(cache
        .get(&login.trim().to_lowercase())
        .cloned()
        .unwrap_or_default())
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
    // (User-Agent comes from the client defaults.)
    let resp = client
        .get(url)
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

// ---------- village tavern presences (tavern-select right panel) ----------
//
// Authenticated fetch of the village view
// (`EcranPrincipalAjax.php?l=5`) with the logged-in session (same
// Cookie/Referer pattern as the maison fetch) and structured parse of the
// `presentsTaverne` blocks:
//
// `<div class="illustrationImage presentsTaverne">...
//  Pr&eacute;sents dans "TAVERN NAME":<br />
//  <a class="lien_default lienPerso"
//  onclick="...popupPerso('FichePersonnage.php?login=xxx')">Display</a> ...`
//
// One entry per quoted `Présents dans "…"` block (the village view carries
// one block per tavern), each with 0..N person-link display names (only
// `login=` anchors count, so decor links never leak in). No new
// dependencies: careful string parsing with HTML-entity decoding for
// `&eacute;` etc. An empty village view (or a layout change) resolves to
// `Ok(vec![])` — never throws on parse-miss; `Err` only on `NotConnected` /
// network failures.

#[derive(Serialize)]
pub struct TavernPresence {
    pub tavern_name: String,
    pub occupants: Vec<String>,
}

#[tauri::command]
pub async fn get_tavern_presences(
    state: State<'_, AppState>,
) -> Result<Vec<TavernPresence>, String> {
    inner_get_tavern_presences(&state).await.map_err(String::from)
}

/// Session snapshot (client + jar) with one short retry on `NotConnected`.
///
/// Same tavern-phase race as the maison/village fetches: the tavern select
/// calls this right after login and must not fail on a login-commit race.
/// Mirrors `maison.rs::snapshot_session` (600ms single retry,
/// `taverne-presence:` log prefix).
async fn snapshot_session_for_presence(
    state: &State<'_, AppState>,
) -> Result<
    (
        wreq::Client,
        std::sync::Arc<wreq::cookie::Jar>,
    ),
    AppError,
> {
    {
        let guard = state.session.lock().await;
        if let Some(sess) = guard.as_ref() {
            return Ok((sess.client.clone(), sess.jar.clone()));
        }
    }
    logs::log_warn("taverne-presence: no session on first try, retrying once after 600ms");
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    let guard = state.session.lock().await;
    match guard.as_ref() {
        Some(sess) => {
            logs::log_info("taverne-presence: session ready on retry");
            Ok((sess.client.clone(), sess.jar.clone()))
        }
        None => {
            logs::log_error("taverne-presence: NotConnected after retry (no session — login first)");
            Err(AppError::NotConnected)
        }
    }
}

async fn inner_get_tavern_presences(
    state: &State<'_, AppState>,
) -> Result<Vec<TavernPresence>, AppError> {
    let (client, jar) = snapshot_session_for_presence(state).await?;

    let cookie_header = extract_cookies(&jar);
    if cookie_header.is_empty() {
        logs::log_error("taverne-presence: no session cookie (login expired?)");
        return Err(AppError::Network(
            "taverne-presence: no session cookie (login expired?)".into(),
        ));
    }

    // Village view: fixed `?l=5` query (the server resolves the village from
    // the session — same as the village WS dial, which always returns the
    // home roster regardless of IDLieu).
    let url = format!("{}?l=5", config::URL_ECRAN_PRINCIPAL_AJAX);
    logs::log_info(&format!("taverne-presence: GET {url}"));
    let resp = client
        .get(&url)
        .header("Cookie", cookie_header)
        .header("Referer", config::REFERER)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("taverne-presence: request failed: {e}");
            logs::log_error(&msg);
            AppError::Network(msg)
        })?;

    if !resp.status().is_success() {
        let msg = format!(
            "taverne-presence: HTTP {} for EcranPrincipalAjax.php",
            resp.status()
        );
        logs::log_error(&msg);
        return Err(AppError::Network(msg));
    }

    let text = resp.text().await.map_err(|e| {
        let msg = format!("taverne-presence: error reading EcranPrincipalAjax.php: {e}");
        logs::log_error(&msg);
        AppError::Network(msg)
    })?;

    let presences = extract_tavern_presences(&text);
    if presences.is_empty() {
        logs::log_warn(&format!(
            "taverne-presence: parse-miss (page {} bytes, presentsTaverne={} sentsdans={})",
            text.len(),
            text.matches("presentsTaverne").count(),
            text.to_ascii_lowercase().matches("sents dans").count(),
        ));
    } else {
        let total: usize = presences.iter().map(|p| p.occupants.len()).sum();
        logs::log_info(&format!(
            "taverne-presence: {} tavern(s), {total} occupant(s)",
            presences.len()
        ));
    }
    Ok(presences)
}

/// Decode the HTML entities the village view serves (`&eacute;` for
/// `Présents`, `&quot;` for the tavern-name quotes, `&amp;`-escaped
/// doubles, numeric `&#...;` / `&#x...;` references). `&amp;` is decoded
/// first so double-escaped `&amp;eacute;` also resolves. Unknown entities
/// pass through untouched.
fn decode_tavern_entities(s: &str) -> String {
    let pre = s.replace("&amp;", "&");
    if !pre.contains('&') {
        return pre;
    }
    let mut out = String::with_capacity(pre.len());
    let mut i = 0usize;
    while i < pre.len() {
        if pre.as_bytes()[i] != b'&' {
            let ch = pre[i..].chars().next().unwrap_or('\0');
            out.push(ch);
            i += ch.len_utf8().max(1);
            continue;
        }
        let rest = &pre[i..];
        let Some(semi) = rest.find(';') else {
            out.push('&');
            i += 1;
            continue;
        };
        // Bound the entity body so a stray `&` far from any `;` scans cheap.
        if semi > 10 {
            out.push('&');
            i += 1;
            continue;
        }
        let entity = &rest[..semi + 1];
        if let Some(decoded) = decode_tavern_entity(entity) {
            out.push_str(&decoded);
            i += entity.len();
        } else {
            out.push('&');
            i += 1;
        }
    }
    out
}

/// Single HTML entity (`&...;`) to its decoded text. Numeric references
/// decode via `char::from_u32` (decimal `&#233;` / hex `&#xE9;`, either `x`
/// casing); named entities cover the French/Latin-1 range the game serves.
/// `None` for unknown names / invalid codepoints (caller keeps the raw `&`).
fn decode_tavern_entity(entity: &str) -> Option<String> {
    if let Some(body) = entity
        .strip_prefix("&#")
        .and_then(|b| b.strip_suffix(';'))
    {
        let codepoint = if let Some(hex) = body
            .strip_prefix('x')
            .or_else(|| body.strip_prefix('X'))
        {
            u32::from_str_radix(hex, 16).ok()?
        } else {
            body.parse::<u32>().ok()?
        };
        return char::from_u32(codepoint).map(|c| c.to_string());
    }
    let decoded = match entity {
        "&lt;" => "<",
        "&gt;" => ">",
        "&quot;" => "\"",
        "&apos;" => "'",
        "&nbsp;" => " ",
        "&laquo;" => "«",
        "&raquo;" => "»",
        "&ldquo;" => "\u{201C}",
        "&rdquo;" => "\u{201D}",
        "&lsquo;" => "\u{2018}",
        "&rsquo;" => "\u{2019}",
        "&hellip;" => "…",
        "&mdash;" => "—",
        "&ndash;" => "–",
        "&agrave;" => "à",
        "&aacute;" => "á",
        "&acirc;" => "â",
        "&auml;" => "ä",
        "&egrave;" => "è",
        "&eacute;" => "é",
        "&ecirc;" => "ê",
        "&euml;" => "ë",
        "&icirc;" => "î",
        "&iuml;" => "ï",
        "&ocirc;" => "ô",
        "&ouml;" => "ö",
        "&ugrave;" => "ù",
        "&ucirc;" => "û",
        "&uuml;" => "ü",
        "&ccedil;" => "ç",
        "&ntilde;" => "ñ",
        "&oelig;" => "œ",
        "&aelig;" => "æ",
        "&szlig;" => "ß",
        "&Agrave;" => "À",
        "&Acirc;" => "Â",
        "&Egrave;" => "È",
        "&Eacute;" => "É",
        "&Ecirc;" => "Ê",
        "&Icirc;" => "Î",
        "&Ocirc;" => "Ô",
        "&Ugrave;" => "Ù",
        "&Ucirc;" => "Û",
        "&Ccedil;" => "Ç",
        "&OElig;" => "Œ",
        "&AElig;" => "Æ",
        _ => return None,
    };
    Some(decoded.to_owned())
}

/// ASCII suffix of `Présents dans` / `présents dans` (the leading `P/p` is
/// skipped so the scan is case-proof without Unicode lowercasing, which
/// would break byte-index mapping). `to_ascii_lowercase` preserves byte
/// length, so positions map 1:1 onto the decoded page.
const PRESENCE_MARKER: &str = "sents dans";

/// Split the decoded village view into one entry per quoted
/// `Présents dans "…"` block. Title-only occurrences (`Sont présents dans
/// la taverne :`, no quoted name) are skipped — they carry no tavern name.
/// Blocks with a name but no person links yield an empty `occupants` vec
/// (tavern shown as empty, not dropped).
fn extract_tavern_presences(html: &str) -> Vec<TavernPresence> {
    let decoded = decode_tavern_entities(html);
    let lower = decoded.to_ascii_lowercase();
    let mut markers: Vec<usize> = Vec::new();
    let mut cursor = 0usize;
    while cursor < lower.len() {
        match lower[cursor..].find(PRESENCE_MARKER) {
            Some(rel) => {
                markers.push(cursor + rel);
                cursor += rel + PRESENCE_MARKER.len();
            }
            None => break,
        }
    }
    let mut out = Vec::new();
    for (idx, &pos) in markers.iter().enumerate() {
        let seg_end = markers.get(idx + 1).copied().unwrap_or(decoded.len());
        let Some((name, links_from)) =
            extract_presence_name(&decoded, pos + PRESENCE_MARKER.len(), seg_end)
        else {
            continue;
        };
        let occupants = extract_presence_occupants(&decoded, &lower, links_from, seg_end);
        out.push(TavernPresence {
            tavern_name: name,
            occupants,
        });
    }
    out
}

/// Tavern name right after a `Présents dans` marker: skip whitespace, expect
/// an opening quote, capture to its strict pair. Strict pairing matters —
/// names like `"L’etsicroxe de …"` contain a `’` that must not close a `"`
/// opener. Returns the name plus the offset where person links start.
/// `None` when no quoted name follows (title line).
fn extract_presence_name(html: &str, from: usize, end: usize) -> Option<(String, usize)> {
    let bytes = html.as_bytes();
    let end = end.min(html.len());
    let mut i = from.min(end);
    while i < end && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    let rest = html.get(i..end)?;
    let open = rest.chars().next()?;
    let close: &[char] = match open {
        '"' => &['"'],
        '\'' => &['\''],
        '\u{2018}' => &['\u{2019}'],
        '\u{201C}' => &['\u{201D}'],
        '«' => &['»'],
        _ => return None,
    };
    let mut j = i + open.len_utf8();
    let mut name_end = None;
    while j < end {
        let c = html[j..].chars().next()?;
        if close.contains(&c) {
            name_end = Some(j);
            break;
        }
        j += c.len_utf8();
    }
    let name_end = name_end?;
    let name = html[i + open.len_utf8()..name_end].trim().to_owned();
    if name.is_empty() {
        return None;
    }
    let close_len = html[name_end..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
    Some((name, name_end + close_len))
}

/// Person links between `from` and `end`: `<a …>Display</a>` anchors whose
/// tag carries a `login=` param (the `popupPerso('FichePersonnage.php?login=…')`
/// person links). Inner markup is stripped, empty names dropped, exact
/// duplicates kept once (order preserved).
fn extract_presence_occupants(
    html: &str,
    lower: &str,
    from: usize,
    end: usize,
) -> Vec<String> {
    let mut occupants = Vec::new();
    let mut cursor = from.min(end);
    while cursor < end {
        let Some(rel) = lower[cursor..end].find("<a") else {
            break;
        };
        let tag_start = cursor + rel;
        let Some(tag_rel) = html[tag_start..end].find('>') else {
            break;
        };
        let tag_end = tag_start + tag_rel;
        let is_person = lower[tag_start..tag_end].contains("login=");
        let inner_from = tag_end + 1;
        let Some(close_rel) = lower[inner_from..end].find("</a") else {
            cursor = tag_end + 1;
            continue;
        };
        let inner_end = inner_from + close_rel;
        cursor = inner_end + "</a".len();
        if !is_person {
            continue;
        }
        let text = strip_tags(&html[inner_from..inner_end]).trim().to_owned();
        if !text.is_empty() && !occupants.iter().any(|o| o == &text) {
            occupants.push(text);
        }
    }
    occupants
}

/// Strip inner `<…>` markup from an anchor's inner HTML (UTF-8 safe,
/// char-based; `&lt;`-decoded text cannot contain `<` from real names in
/// practice, and a stray `<` without `>` keeps the tail — display only).
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}


