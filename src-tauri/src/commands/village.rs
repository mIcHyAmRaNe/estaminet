use tauri::State;

use crate::{
    config,
    error::AppError,
    network::{session::AppState, socket::Lieu},
    utils::{cookies::extract_cookies, logs},
};

/// Village presence over the existing single WS connection
/// (time-multiplexed with the tavern: entering a tavern via `ws_connect`
/// tears this down and vice versa).
///
/// Home-village presence only: the server returns the home roster for chat
/// purposes regardless of IDLieu, so cross-village spectating is not
/// supported — callers pass the player's home village id. Teardown,
/// portrait fetch and dial are shared with `chat::ws_connect_inner` via
/// the `Lieu` enum (no fork); single-flight + latest-wins queue via
/// `chat::dial_with_discipline`. No new Tauri event: the
/// `villeInfosPersonnages` roster arrives on the existing `ws-message` bus
/// for the frontend to parse. `ws_disconnect` / `is_connected` work
/// unchanged.
///
/// Rejects `id_village == 0`: 0,0 is out-of-bounds server-side (falls back
/// to the home village), so a 0 id is never dialed — only the home village
/// id reaches the wire.
/// Village `changeSalon` carries the per-user `vetements` outfit object
/// (`None` maps to `{}` — backward compat for callers without an outfit
/// source; live sends the full object per user, `Some` is used as-is).
/// Presence-only: no village chat send (changeSalon + roster only).
#[tauri::command]
pub async fn village_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id_village: u64,
    vetements: Option<serde_json::Value>,
) -> Result<(), String> {
    if id_village == 0 {
        return Err(AppError::InvalidFormat("Invalid village id: 0".into()).to_string());
    }
    // B1 dial discipline shared with `chat::ws_connect` via
    // `chat::dial_with_discipline` (mirrors the official JS
    // `_initialisationEnCours`, latest-wins): same `Lieu` in flight is a
    // swallowed duplicate, a different `Lieu` is queued and dialed next.
    crate::commands::chat::dial_with_discipline(&app, &state, Lieu::Village(id_village, vetements)).await
}

/// Player's current village name (P0a backend).
///
/// Fetches `EcranPrincipal.php` with the session client + cookie jar (same
/// Cookie/Referer pattern as the portrait fetch) on every call — no
/// disk/keyring cache — and extracts `NomVillage` from the `RAR.joueur`
/// JSON embedded in the page.
///
/// Contract: `Ok(Some(name))` when found, `Ok(None)` on parse-miss (page
/// layout changed, JSON absent), `Err` only on `NotConnected` / network
/// failures. Error strings are prefixed with `village:` so the frontend can
/// surface the cause (no-session vs no-cookie vs HTTP vs read) instead of a
/// silent `None`. Session snapshot retries once after 600ms: the tavern
/// phase calls this right after login, before any socket exists, and must
/// not fail on a login-commit race.
#[tauri::command]
pub async fn get_player_village(state: State<'_, AppState>) -> Result<Option<String>, String> {
    inner_get_player_village(&state).await.map_err(String::from)
}

/// Snapshot (client, jar, login) with one short retry on `NotConnected`.
///
/// The tavern select calls `get_player_village` immediately after login
/// (before any socket dial): if the login commit has not landed yet, a
/// single 600ms retry absorbs the race. Still `None` afterwards → real
/// `NotConnected` (logged as error so `~/.estaminet/logs/` shows the cause
/// even though no `village_*` file exists yet).
async fn snapshot_session(
    state: &State<'_, AppState>,
) -> Result<
    (
        wreq::Client,
        std::sync::Arc<wreq::cookie::Jar>,
        String,
    ),
    AppError,
> {
    {
        let guard = state.session.lock().await;
        if let Some(sess) = guard.as_ref() {
            return Ok((sess.client.clone(), sess.jar.clone(), sess.login.clone()));
        }
    }
    logs::log_warn("village: no session on first try, retrying once after 600ms");
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    let guard = state.session.lock().await;
    match guard.as_ref() {
        Some(sess) => {
            logs::log_info("village: session ready on retry");
            Ok((sess.client.clone(), sess.jar.clone(), sess.login.clone()))
        }
        None => {
            logs::log_error("village: NotConnected after retry (no session — login first)");
            Err(AppError::NotConnected)
        }
    }
}

async fn inner_get_player_village(state: &State<'_, AppState>) -> Result<Option<String>, AppError> {
    let (client, jar, login) = snapshot_session(state).await?;

    let cookie_header = extract_cookies(&jar);
    if cookie_header.is_empty() {
        logs::log_error("village: no session cookie (login expired?)");
        return Err(AppError::Network(
            "village: no session cookie (login expired?)".into(),
        ));
    }

    logs::log_info(&format!(
        "village: fetching EcranPrincipal.php for '{login}'"
    ));
    let resp = client
        .get(config::URL_ECRAN_PRINCIPAL)
        .header("Cookie", cookie_header)
        .header("Referer", config::REFERER)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("village: request failed: {e}");
            logs::log_error(&msg);
            AppError::Network(msg)
        })?;

    if !resp.status().is_success() {
        let msg = format!("village: HTTP {} for EcranPrincipal.php", resp.status());
        logs::log_error(&msg);
        return Err(AppError::Network(msg));
    }

    let text = resp.text().await.map_err(|e| {
        let msg = format!("village: error reading EcranPrincipal.php: {e}");
        logs::log_error(&msg);
        AppError::Network(msg)
    })?;

    match extract_nom_village(&text) {
        Some(name) => {
            logs::log_info(&format!("village: home village for '{login}' = '{name}'"));
            Ok(Some(name))
        }
        None => {
            logs::log_warn(&format!(
                "village: parse-miss for '{login}' (page {} bytes, rar_joueur={} dataChargement={} nomvillage_key={} ctx={} flags={} hex={})",
                text.len(),
                text.contains("RAR.joueur"),
                text.contains("dataChargement"),
                text.to_ascii_lowercase().contains("nomvillage"),
                nom_village_context_snippet(&text),
                nom_village_stage_flags(&text),
                nom_village_debug_hex(&text),
            ));
            Ok(None)
        }
    }
}

/// Player's per-user `vetements` outfit object (P0b backend).
///
/// Fetches `EcranPrincipal.php` with the session client + cookie jar (same
/// Cookie/Referer pattern as `get_player_village`) on every call — no
/// disk/keyring cache — and extracts the live `changeSalon` `vetements`
/// object (Bordeaux `{cheveux:3,coiffure:6,sexe:M,...}`, Montpellier
/// `{cheveux:0,coiffure:6,...}`).
///
/// Anchor order: `infoVisuel` balanced JSON, `vetements` balanced JSON,
/// `dataChargement.joueur` portrait-adjacent object, then the `RAR.joueur`
/// full-object scan (nested outfit first, flat top-level outfit-key
/// projection as fallback).
///
/// Contract: `Ok(Some(outfit))` when found, `Ok(None)` on parse-miss (page
/// layout changed, JSON absent — never throws), `Err` only on
/// `NotConnected` / network failures.
#[tauri::command]
pub async fn get_player_vetements(
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    inner_get_player_vetements(&state).await.map_err(String::from)
}

async fn inner_get_player_vetements(
    state: &State<'_, AppState>,
) -> Result<Option<serde_json::Value>, AppError> {
    // Same tavern-phase race as the village fetch: share the retry helper.
    let (client, jar, _login) = snapshot_session(state).await?;

    let cookie_header = extract_cookies(&jar);
    if cookie_header.is_empty() {
        logs::log_error("village: no session cookie for vetements (login expired?)");
        return Err(AppError::Network(
            "village: no session cookie for vetements (login expired?)".into(),
        ));
    }

    let resp = client
        .get(config::URL_ECRAN_PRINCIPAL)
        .header("Cookie", cookie_header)
        .header("Referer", config::REFERER)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("village: vetements request failed: {e}");
            logs::log_error(&msg);
            AppError::Network(msg)
        })?;

    if !resp.status().is_success() {
        let msg = format!(
            "village: HTTP {} for vetements EcranPrincipal.php",
            resp.status()
        );
        logs::log_error(&msg);
        return Err(AppError::Network(msg));
    }

    let text = resp.text().await.map_err(|e| {
        let msg = format!("village: error reading vetements page: {e}");
        logs::log_error(&msg);
        AppError::Network(msg)
    })?;

    let found = extract_player_vetements(&text);
    if found.is_none() {
        logs::log_warn("village: vetements parse-miss (page layout changed or JSON absent)");
    }
    Ok(found)
}

/// Balanced-brace JSON slice starting at `start_brace` (string-aware).
/// Local copy of the `taverne.rs` helper — same semantics, plus
/// single-quote awareness: the page is JS (`'...'` strings with `\'`
/// escapes) and a brace inside a single-quoted string must not affect
/// depth, otherwise the slice truncates and the later `serde_json` parse
/// fails even though `NomVillage` is present.
fn extract_balanced_json(s: &str, start_brace: usize) -> Option<&str> {
    let bytes = s.as_bytes();
    if start_brace >= bytes.len() || bytes[start_brace] != b'{' {
        return None;
    }
    let mut depth = 0usize;
    let mut in_str: Option<u8> = None;
    let mut escaped = false;
    for (i, &b) in bytes[start_brace..].iter().enumerate() {
        if let Some(quote) = in_str {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == quote {
                in_str = None;
            }
        } else {
            match b {
                b'"' | b'\'' => in_str = Some(b),
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

/// Direct `NomVillage` key lookup on one JSON object (case-insensitive
/// key match, trimmed non-empty string). Returns `None` for non-objects.
fn direct_nom_village(v: &serde_json::Value) -> Option<String> {
    let serde_json::Value::Object(map) = v else {
        return None;
    };
    for (k, val) in map {
        if k.eq_ignore_ascii_case("nomvillage") {
            if let Some(s) = val.as_str() {
                let name = s.trim();
                if !name.is_empty() {
                    return Some(name.to_owned());
                }
            }
        }
    }
    None
}

/// `NomVillage` lookup on a joueur-shell value: direct key first, then a
/// nested `joueur` child (covers `dataChargement = {joueur: {...}}`
/// shells where the top level mixes login/outfit keys), then a full
/// recursive walk (covers `RAR.joueur` objects with a nested `joueur`
/// child or `NomVillage` buried deeper, e.g.
/// `dataChargement.joueur.NomVillage` via deeper shells).
fn nom_from_joueur_value(v: &serde_json::Value) -> Option<String> {
    if let Some(name) = direct_nom_village(v) {
        return Some(name);
    }
    if let serde_json::Value::Object(map) = v {
        for (k, child) in map {
            if k.eq_ignore_ascii_case("joueur") {
                if let Some(name) = direct_nom_village(child) {
                    return Some(name);
                }
            }
        }
    }
    nom_village_deep(v)
}

/// Recursive `NomVillage` search (case-insensitive key, trimmed non-empty
/// string value). Walks objects + arrays so any nesting depth resolves.
fn nom_village_deep(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Object(map) => {
            for (k, val) in map {
                if k.eq_ignore_ascii_case("nomvillage") {
                    if let Some(s) = val.as_str() {
                        let name = s.trim();
                        if !name.is_empty() {
                            return Some(name.to_owned());
                        }
                    }
                }
            }
            for child in map.values() {
                if let Some(name) = nom_village_deep(child) {
                    return Some(name);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(name) = nom_village_deep(item) {
                    return Some(name);
                }
            }
            None
        }
        _ => None,
    }
}

/// Sweep every `anchor` occurrence: first `{` after the anchor starts a
/// balanced-JSON candidate, checked for `NomVillage` (direct + nested
/// `joueur` + deep walk). When the candidate is not strict JSON (bare
/// values, single quotes, trailing commas) the `serde_json` parse fails —
/// fall back to a raw scan of the slice itself so the anchor still
/// resolves. Misses advance past the anchor so later anchors inside a
/// rejected candidate are still visited.
fn extract_nom_from_anchor(html: &str, anchor: &str) -> Option<String> {
    let mut cursor = 0usize;
    while cursor < html.len() {
        let Some(rel) = html[cursor..].find(anchor) else {
            break;
        };
        let pos = cursor + rel;
        if let Some(brace_rel) = html[pos..].find('{') {
            let abs_brace = pos + brace_rel;
            if let Some(slice) = extract_balanced_json(html, abs_brace) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(slice) {
                    if let Some(name) = nom_from_joueur_value(&v) {
                        return Some(name);
                    }
                }
                // Non-strict-JSON fallback: bare / single-quoted / oddly
                // nested values inside this candidate.
                if let Some(name) = nom_village_raw_scan_any(slice) {
                    return Some(name);
                }
                cursor = abs_brace + slice.len();
                continue;
            }
            cursor = abs_brace + 1;
            continue;
        }
        cursor = pos + anchor.len();
    }
    None
}

/// Decode the HTML-entity variants the page may serve instead of raw
/// quotes (`&quot;NomVillage&quot;`, `&#34;`, `&#0034;`, `&#x22;`,
/// `&apos;`, `&ldquo;`, ...). Numeric references (`&#\d+;`,
/// `&#x[0-9a-fA-F]+;`, leading zeros tolerated) decode generically via
/// `char::from_u32`; named quote entities (`quot/apos/ldquo/rdquo/
/// lsquo/rsquo`) map to ASCII quotes. `&amp;` is decoded first so
/// double-escaped `&amp;quot;` also resolves.
fn html_unescape_entities(s: &str) -> String {
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
        if let Some(decoded) = decode_html_entity(entity) {
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
/// decode via `char::from_u32` (decimal `&#34;` / hex `&#x22;`, either
/// `x` casing, leading zeros fine); named quote entities map to ASCII
/// quotes. `None` for unknown names / invalid codepoints (caller keeps
/// the raw `&` and advances one byte).
fn decode_html_entity(entity: &str) -> Option<String> {
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
        let ch = char::from_u32(codepoint)?;
        return Some(ch.to_string());
    }
    match entity {
        "&quot;" => Some("\"".to_owned()),
        "&apos;" => Some("'".to_owned()),
        "&ldquo;" | "&rdquo;" => Some("\"".to_owned()),
        "&lsquo;" | "&rsquo;" => Some("'".to_owned()),
        "&lt;" => Some("<".to_owned()),
        "&gt;" => Some(">".to_owned()),
        "&amp;" => Some("&".to_owned()),
        _ => None,
    }
}

/// Normalize zero-width/format characters and compatibility punctuation
/// before the `NomVillage` fallback scans: zero-width space / joiners
/// (U+200B/C/D), BOM (U+FEFF) and word joiner (U+2060) are stripped
/// (they defeat the ASCII `:`/whitespace scanners while rendering
/// invisibly); NBSP maps to a plain space, fullwidth `：` (U+FF1A) to
/// `:`, curly double quotes (`“”`) to `"` and curly singles (`‘’`) to
/// `'`. Idempotent on clean pages (pure-ASCII haystacks pass through
/// byte-identical).
fn normalize_nom_village_haystack(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}' | '\u{2060}' => {}
            '\u{00A0}' => out.push(' '),
            '\u{FF1A}' => out.push(':'),
            '\u{201C}' | '\u{201D}' => out.push('"'),
            '\u{2018}' | '\u{2019}' => out.push('\''),
            _ => out.push(c),
        }
    }
    out
}

/// `NomVillage` lookup order:
/// 1. `RAR.joueur` balanced-JSON sweep (direct + nested `joueur` + deep),
/// 2. `dataChargement.joueur` balanced-JSON sweep,
/// 3. `dataChargement` balanced-JSON sweep (nested `joueur` child),
/// 4. raw `"NomVillage":"..."` scan (whitespace-tolerant, double quotes,
///    case-insensitive key),
/// 5. raw `'NomVillage':'...'` scan (single quotes, case-insensitive key),
/// 6. raw bare `NomVillage:Bordeaux` scan (unquoted, trailing `,`/`}`),
/// 7. escaped-JSON fallback: steps 1–6 on a copy with `\"`→`"` / `\'`→`'`,
/// 8. normalized fallback: steps 1–7 on the format-char-normalized page,
/// 9. steps 1–8 rerun on the HTML-entity-unescaped page.
/// `None` only when truly absent (total parse-miss, never throws).
fn extract_nom_village(html: &str) -> Option<String> {
    if let Some(name) = extract_nom_village_with_fallbacks(html) {
        return Some(name);
    }
    // HTML-escaped layouts (e.g. `&quot;NomVillage&quot;:&quot;Bordeaux&quot;`).
    if html.contains('&') {
        let unescaped = html_unescape_entities(html);
        if unescaped != html {
            if let Some(name) = extract_nom_village_with_fallbacks(&unescaped) {
                return Some(name);
            }
        }
    }
    None
}

/// Verbatim + escaped-JSON + normalized fallbacks on one haystack (the
/// entity-unescaped rerun in `extract_nom_village` reuses this whole
/// chain on the decoded page).
fn extract_nom_village_with_fallbacks(html: &str) -> Option<String> {
    if let Some(name) = extract_nom_village_verbatim(html) {
        return Some(name);
    }
    // Escaped-JSON layouts (`\"NomVillage\":\"Bordeaux\"` inside a JS
    // string or JSON-encoded blob).
    let deescaped = html.replace("\\\"", "\"").replace("\\'", "'");
    if deescaped != html {
        if let Some(name) = extract_nom_village_verbatim(&deescaped) {
            return Some(name);
        }
    }
    // Zero-width/format chars, fullwidth colon, curly quotes.
    let normalized = normalize_nom_village_haystack(html);
    if normalized != html {
        if let Some(name) = extract_nom_village_verbatim(&normalized) {
            return Some(name);
        }
        let deescaped = normalized.replace("\\\"", "\"").replace("\\'", "'");
        if deescaped != normalized {
            if let Some(name) = extract_nom_village_verbatim(&deescaped) {
                return Some(name);
            }
        }
    }
    None
}

/// Verbatim lookup: anchor sweeps (steps 1–3) then the combined raw scan
/// (steps 4–6). No haystack rewriting — fallbacks wrap this helper.
fn extract_nom_village_verbatim(html: &str) -> Option<String> {
    if let Some(name) = extract_nom_from_anchor(html, "RAR.joueur") {
        return Some(name);
    }
    if let Some(name) = extract_nom_from_anchor(html, "dataChargement.joueur") {
        return Some(name);
    }
    if let Some(name) = extract_nom_from_anchor(html, "dataChargement") {
        return Some(name);
    }
    nom_village_raw_scan_any(html)
}

/// Combined raw scan: double-quoted, single-quoted, then bare values.
/// Case-insensitive key in all three (the 594KB parse-miss page carried
/// the key but none of the strict paths resolved).
fn nom_village_raw_scan_any(html: &str) -> Option<String> {
    if let Some(name) = nom_village_raw_scan(html) {
        return Some(name);
    }
    if let Some(name) = nom_village_raw_scan_quoted(html, b'\'') {
        return Some(name);
    }
    nom_village_raw_scan_bare(html)
}

/// Raw `"NomVillage" : "..."` scan (whitespace-tolerant, double quotes).
/// Byte-level walk is UTF-8 safe: it only inspects ASCII bytes (`"`, `\`,
/// `:`, whitespace; UTF-8 continuation bytes are all ≥ 0x80).
fn nom_village_raw_scan(html: &str) -> Option<String> {
    nom_village_raw_scan_quoted(html, b'"')
}

/// Raw key scan for either quote style (`"` or `'`). The VALUE quote must
/// match `quote`; the KEY itself may be wrapped in either quote style and
/// matches case-insensitively (`NomVillage`, `nomvillage`, `NOMVILLAGE`).
/// Whitespace around `:` is tolerated. Byte-level walk is UTF-8 safe
/// (ASCII bytes only; `to_ascii_lowercase` preserves byte length so
/// indices map 1:1 to the original).
fn nom_village_raw_scan_quoted(html: &str, quote: u8) -> Option<String> {
    const KEY_LEN: usize = 10; // len("NomVillage")
    let bytes = html.as_bytes();
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while cursor < html.len() {
        let rel = match lower[cursor..].find("nomvillage") {
            Some(r) => r,
            None => break,
        };
        let mut i = cursor + rel + KEY_LEN;
        // Optional closing quote of the key (`"NomVillage"` / `'NomVillage'`
        // — the opening quote sits before KEY and needs no handling).
        if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
            i += 1;
        }
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b':' {
            cursor += rel + 1;
            continue;
        }
        i += 1;
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != quote {
            cursor += rel + 1;
            continue;
        }
        i += 1; // opening value quote
        let start = i;
        // Find closing unescaped quote.
        let mut end = None;
        let mut j = i;
        while j < bytes.len() {
            if bytes[j] == b'\\' {
                j += 2;
                continue;
            }
            if bytes[j] == quote {
                end = Some(j);
                break;
            }
            j += 1;
        }
        let Some(end) = end else {
            cursor += rel + 1;
            continue;
        };
        let raw = &html[start..end];
        // Decode value escapes: double-quoted via serde (`\uXXXX`, `\"`,
        // `\\`); single-quoted via light JS-unescape.
        let decoded = if quote == b'"' {
            serde_json::from_str::<String>(&format!("\"{raw}\""))
                .unwrap_or_else(|_| raw.to_owned())
        } else {
            raw.replace("\\'", "'").replace("\\\\", "\\")
        };
        let name = decoded.trim().to_owned();
        if !name.is_empty() {
            return Some(name);
        }
        cursor = end + 1;
    }
    None
}

/// Raw bare-value scan: `NomVillage : Bordeaux,` / `NomVillage:Bordeaux}`
/// (no quotes, trailing comma/brace/bracket). Case-insensitive key,
/// whitespace-tolerant around `:`. Stops at `,`, `}`, `]`, `<`, `;` or
/// line breaks; strips stray surrounding quotes. Returns the trimmed
/// non-empty token, or `None`.
fn nom_village_raw_scan_bare(html: &str) -> Option<String> {
    const KEY_LEN: usize = 10; // len("NomVillage")
    let bytes = html.as_bytes();
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while cursor < html.len() {
        let rel = match lower[cursor..].find("nomvillage") {
            Some(r) => r,
            None => break,
        };
        let mut i = cursor + rel + KEY_LEN;
        if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
            i += 1;
        }
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b':' {
            cursor += rel + 1;
            continue;
        }
        i += 1;
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        // Quoted values belong to the quoted scanners — skip here so a
        // bare pass never shadows them (the `any` order tries quoted
        // first anyway).
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            cursor += rel + 1;
            continue;
        }
        let start = i;
        let mut j = i;
        while j < bytes.len()
            && !matches!(
                bytes[j],
                b',' | b'}' | b']' | b'<' | b';' | b'\r' | b'\n'
            )
        {
            j += 1;
        }
        let mut token = html[start..j].trim().to_owned();
        // Strip one layer of stray surrounding quotes, then re-trim.
        if token.len() >= 2 {
            let b = token.as_bytes();
            if (b[0] == b'"' && b[b.len() - 1] == b'"')
                || (b[0] == b'\'' && b[b.len() - 1] == b'\'')
            {
                token = token[1..token.len() - 1].trim().to_owned();
            }
        }
        token = token
            .trim_end_matches(['"', '\'', ' ', '\t'])
            .trim()
            .to_owned();
        if !token.is_empty() && token != ":" {
            return Some(token);
        }
        cursor = j.saturating_add(1).max(cursor + rel + 1);
    }
    None
}

/// First 200 chars around the first `NomVillage` occurrence
/// (case-insensitive) for parse-miss diagnostics. Truncated page context
/// only — no cookies/session data lives near the key, and control chars
/// are flattened so the log stays one line.
fn nom_village_context_snippet(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let Some(rel) = lower.find("nomvillage") else {
        return "<no-key>".to_owned();
    };
    let start = rel.saturating_sub(100);
    let end = (rel + 100).min(html.len());
    // Snap to char boundaries (page is UTF-8; keys are ASCII but village
    // names/neighbours may be multi-byte).
    let mut s = start;
    while s < end && !html.is_char_boundary(s) {
        s += 1;
    }
    let mut e = end;
    while e > s && !html.is_char_boundary(e) {
        e -= 1;
    }
    let mut snippet: String = html[s..e].chars().map(|c| c.to_string()).collect::<String>();
    snippet = snippet
        .chars()
        .map(|c| {
            if c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut flat: String = snippet.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.len() > 200 {
        // Truncate on a char boundary.
        let mut cut = 200;
        while cut > 0 && !flat.is_char_boundary(cut) {
            cut -= 1;
        }
        flat.truncate(cut);
    }
    format!("'{flat}'")
}

/// Per-stage parse-miss diagnostics: balanced-slice / serde-parse counts
/// across the three anchors plus each raw scanner's hit flag. Computed
/// only on the miss path (one extra sweep of a page that already missed).
fn nom_village_stage_flags(html: &str) -> String {
    let mut anchor_slices = 0usize;
    let mut serde_ok = 0usize;
    for anchor in ["RAR.joueur", "dataChargement.joueur", "dataChargement"] {
        let mut cursor = 0usize;
        while cursor < html.len() {
            let Some(rel) = html[cursor..].find(anchor) else {
                break;
            };
            let pos = cursor + rel;
            let Some(brace_rel) = html[pos..].find('{') else {
                cursor = pos + anchor.len();
                continue;
            };
            let abs_brace = pos + brace_rel;
            match extract_balanced_json(html, abs_brace) {
                Some(slice) => {
                    anchor_slices += 1;
                    if serde_json::from_str::<serde_json::Value>(slice).is_ok() {
                        serde_ok += 1;
                    }
                    cursor = abs_brace + slice.len();
                }
                None => cursor = abs_brace + 1,
            }
        }
    }
    let raw_double = u8::from(nom_village_raw_scan(html).is_some());
    let raw_single = u8::from(nom_village_raw_scan_quoted(html, b'\'').is_some());
    let raw_bare = u8::from(nom_village_raw_scan_bare(html).is_some());
    format!(
        "anchor_slices={anchor_slices} serde_ok={serde_ok} raw_double={raw_double} raw_single={raw_single} raw_bare={raw_bare}"
    )
}

/// Hex dump of ~64B around the first `NomVillage` occurrence
/// (case-insensitive, ~32B each side): exposes zero-width/format chars
/// the flattened `ctx` snippet hides. `<no-key>` when the key is absent.
fn nom_village_debug_hex(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let Some(rel) = lower.find("nomvillage") else {
        return "<no-key>".to_owned();
    };
    let start = rel.saturating_sub(32);
    let end = (rel + 10 + 32).min(html.len());
    let mut s = start;
    while s < end && !html.is_char_boundary(s) {
        s += 1;
    }
    let mut e = end;
    while e > s && !html.is_char_boundary(e) {
        e -= 1;
    }
    html[s..e]
        .bytes()
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Wardrobe-key membership (lowercased): face params (`sexe`, `cheveux`,
/// `coiffure(s)`, `barbe(s)`) + garment slots (`Chemise(s)`, `Braies`, ...).
/// Compared case-insensitively — the page mixes `sexe`/`Chemise` casings.
fn is_outfit_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "sexe"
            | "cheveux"
            | "coiffure"
            | "coiffures"
            | "barbe"
            | "barbes"
            | "chemise"
            | "chemises"
            | "braies"
            | "bas"
            | "pantalon"
            | "pantalons"
            | "jupe"
            | "jupes"
            | "robe"
            | "robes"
            | "gilet"
            | "gilets"
            | "manteau"
            | "manteaux"
            | "chapeau"
            | "chapeaux"
            | "chaussure"
            | "chaussures"
            | "bottes"
            | "ceinture"
            | "ceintures"
            | "gants"
            | "cape"
            | "capes"
    )
}

/// Heuristic: object with ≥2 wardrobe keys including at least one non-`sexe`
/// slot. The ≥2 gate keeps the portrait JSON (`sexe` only, `equipement`
/// array) from ever matching as an outfit.
fn is_vetements_like(v: &serde_json::Value) -> bool {
    let serde_json::Value::Object(map) = v else {
        return false;
    };
    let mut outfit_hits = 0usize;
    let mut has_slot = false;
    for k in map.keys() {
        if is_outfit_key(k) {
            outfit_hits += 1;
            if !k.eq_ignore_ascii_case("sexe") {
                has_slot = true;
            }
        }
    }
    outfit_hits >= 2 && has_slot
}

/// Deep outfit search (self + children): `vetements`/`infoVisuel`-named
/// children first so a sibling portrait object never shadows the outfit.
fn find_vetements_deep(v: &serde_json::Value) -> Option<serde_json::Value> {
    if is_vetements_like(v) {
        return Some(v.clone());
    }
    match v {
        serde_json::Value::Object(map) => {
            let mut priority = Vec::new();
            let mut rest = Vec::new();
            for (k, child) in map {
                if k.eq_ignore_ascii_case("vetements") || k.eq_ignore_ascii_case("infovisuel") {
                    priority.push(child);
                } else {
                    rest.push(child);
                }
            }
            for child in priority.into_iter().chain(rest) {
                if let Some(found) = find_vetements_deep(child) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(found) = find_vetements_deep(item) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

/// Children-only outfit search for joueur shells (`RAR.joueur`,
/// `dataChargement...`): the shell itself mixes `NomVillage`/login with
/// outfit keys, so self never counts — nested outfit first, flat top-level
/// outfit-key projection as fallback (original keys/values preserved).
fn find_nested_vetements(v: &serde_json::Value) -> Option<serde_json::Value> {
    match v {
        serde_json::Value::Object(map) => {
            let mut priority = Vec::new();
            let mut rest = Vec::new();
            for (k, child) in map {
                if k.eq_ignore_ascii_case("vetements") || k.eq_ignore_ascii_case("infovisuel") {
                    priority.push(child);
                } else {
                    rest.push(child);
                }
            }
            for child in priority.into_iter().chain(rest) {
                if let Some(found) = find_vetements_deep(child) {
                    return Some(found);
                }
            }
            project_vetements(map)
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(found) = find_vetements_deep(item) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

/// Flat-shell fallback: collect top-level wardrobe keys as-is; `None` unless
/// the projection itself passes the outfit heuristic.
fn project_vetements(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Option<serde_json::Value> {
    let projected: serde_json::Map<String, serde_json::Value> = map
        .iter()
        .filter(|(k, _)| is_outfit_key(k))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let v = serde_json::Value::Object(projected);
    if is_vetements_like(&v) {
        Some(v)
    } else {
        None
    }
}

/// Sweep every `anchor` occurrence: first `{` after the anchor starts a
/// balanced-JSON candidate, deep-searched for the outfit. Misses advance past
/// the anchor (never past a whole slice) so later anchors inside a rejected
/// candidate are still visited. `None` when no occurrence yields an outfit.
fn extract_vetements_by_anchor(html: &str, anchor: &str) -> Option<serde_json::Value> {
    let mut cursor = 0usize;
    while cursor < html.len() {
        let Some(rel) = html[cursor..].find(anchor) else {
            break;
        };
        let pos = cursor + rel;
        if let Some(brace_rel) = html[pos..].find('{') {
            let abs_brace = pos + brace_rel;
            if let Some(slice) = extract_balanced_json(html, abs_brace) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(slice) {
                    if let Some(found) = find_vetements_deep(&v) {
                        return Some(found);
                    }
                }
            }
        }
        cursor = pos + anchor.len();
    }
    None
}

/// Joueur-shell sweep (`RAR.joueur`, `dataChargement...`): same sweep shape,
/// children-only match + flat projection (the shell itself never counts).
fn extract_vetements_from_joueur_scan(
    html: &str,
    anchor: &str,
) -> Option<serde_json::Value> {
    let mut cursor = 0usize;
    while cursor < html.len() {
        let Some(rel) = html[cursor..].find(anchor) else {
            break;
        };
        let pos = cursor + rel;
        if let Some(brace_rel) = html[pos..].find('{') {
            let abs_brace = pos + brace_rel;
            if let Some(slice) = extract_balanced_json(html, abs_brace) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(slice) {
                    if let Some(found) = find_nested_vetements(&v) {
                        return Some(found);
                    }
                }
            }
        }
        cursor = pos + anchor.len();
    }
    None
}

/// Anchor order: `infoVisuel`, `vetements`, `dataChargement.joueur`,
/// `dataChargement`, `RAR.joueur`. `None` on total parse-miss.
fn extract_player_vetements(html: &str) -> Option<serde_json::Value> {
    if let Some(v) = extract_vetements_by_anchor(html, "infoVisuel") {
        return Some(v);
    }
    if let Some(v) = extract_vetements_by_anchor(html, "vetements") {
        return Some(v);
    }
    if let Some(v) = extract_vetements_from_joueur_scan(html, "dataChargement.joueur") {
        return Some(v);
    }
    if let Some(v) = extract_vetements_from_joueur_scan(html, "dataChargement") {
        return Some(v);
    }
    extract_vetements_from_joueur_scan(html, "RAR.joueur")
}
