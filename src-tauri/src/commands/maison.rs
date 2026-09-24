use tauri::State;

use crate::{
    config,
    error::AppError,
    network::{session::AppState, socket::Lieu},
    utils::{cookies::extract_cookies, logs},
};

/// House (maison) presence over the existing single WS connection
/// (time-multiplexed with tavern/village: entering a tavern or village via
/// `ws_connect` / `village_connect` tears this down and vice versa).
///
/// Live protocol (capture): dial
/// `wss://chat.lesroyaumes.com/socket.io/?login=<login>&token=<token>&prioritaire=false&EIO=3&transport=websocket`
/// (same as village, `prioritaire=false`), send
/// `42["changeSalon",{"typeLieu":"maison","IDLieu":…,"posX":11,"posY":0,
/// "etage":0,"instance":0,"vetements":{…},"portrait":"{…}"}]` (see
/// `socket::build_change_salon_maison`), then chat via
/// `42["maisonMessage",type,message]` (`chat::maison_send`, empty type
/// defaults to `"parler"`). Room frames (`maisonInit`,
/// `maisonInfosPersonnages`, `maisonMessage`, `maisonDeplacement`) arrive
/// on the existing `ws-message` bus for the frontend to parse. Detach by
/// emitting `changeSalon` null. `ws_disconnect` / `is_connected` work
/// unchanged.
///
/// Teardown, portrait fetch and dial are shared with
/// `chat::ws_connect_inner` via the `Lieu` enum (no fork); single-flight +
/// latest-wins queue via `chat::dial_with_discipline`.
///
/// Rejects `id_maison == 0` like `village_connect` rejects id 0 — a 0 id is
/// never dialed.
/// House `changeSalon` carries the per-user `vetements` outfit object
/// (`None` maps to `{}` — backward compat for callers without an outfit
/// source; live sends the full object per user, `Some` is used as-is).
/// Chat-capable: `maison_send` covers `maisonMessage`; maison displacement
/// (`maisonDeplacement` / `maisonRefreshPosition`) is out of scope.
#[tauri::command]
pub async fn maison_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id_maison: u64,
    vetements: Option<serde_json::Value>,
) -> Result<(), String> {
    if id_maison == 0 {
        return Err(AppError::InvalidFormat("Invalid maison id: 0".into()).to_string());
    }
    // B1 dial discipline shared with `chat::ws_connect` /
    // `village_connect` via `chat::dial_with_discipline` (mirrors the
    // official JS `_initialisationEnCours`, latest-wins): same `Lieu` in
    // flight is a swallowed duplicate, a different `Lieu` is queued and
    // dialed next.
    crate::commands::chat::dial_with_discipline(&app, &state, Lieu::Maison(id_maison, vetements))
        .await
}

/// House IDLieu resolver for a player login (house-visit entry point).
///
/// The frontend lets the user type a house owner's login; this resolves it
/// to the numeric maison `IDLieu` via the official
/// `EcranPrincipal.php?l=23&t=m&p=<login>` page (same village
/// `EcranPrincipal.php` session pattern: session client + jar,
/// Cookie/Referer headers, one 600ms retry on `NotConnected`, `AppError`
/// mapping). The page embeds the maison id (live capture: IDLieu 101704
/// with `changeSalon` typeLieu "maison").
///
/// When the full page carries no `infosPlayer` payload (generic
/// main-screen page: `idlieu=0`, `datachargement=1`, `rar_joueur` shell),
/// the same `?l=23&t=m&p=<login>` query is retried against
/// `EcranPrincipalAjax.php` (AJAX navigation variant referenced by the
/// game bundle) with the identical Cookie/Referer pattern, scanned
/// identically.
///
/// Login is trimmed and validated (non-empty, ≤40 chars, no
/// whitespace/quotes/slashes — same spirit as the village login guard);
/// bad input is `InvalidFormat`. The `p=` value is percent-encoded with
/// the same helper shape as `taverne.rs` (no new `config.rs` constant —
/// the base `URL_ECRAN_PRINCIPAL` / `URL_ECRAN_PRINCIPAL_AJAX` are reused).
///
/// Contract: `Ok(id)` with the first sane (`> 0`) id found, `Err`
/// `InvalidFormat("Maison introuvable pour ce login")` when no maison id
/// is embedded, `Network`/`NotConnected` on session/HTTP failures.
/// Callers chain into `maison_connect` (signature unchanged).
#[tauri::command]
pub async fn get_maison_id(state: State<'_, AppState>, login: String) -> Result<u64, String> {
    inner_get_maison_id(&state, &login).await.map_err(String::from)
}

/// Snapshot (client, jar, login) with one short retry on `NotConnected`.
///
/// Same tavern-phase race as the village fetch: the house entry calls this
/// right after login, before any socket exists, and must not fail on a
/// login-commit race. Mirrors `village.rs::snapshot_session` exactly
/// (600ms single retry, `maison:` log prefix).
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
    logs::log_warn("maison: no session on first try, retrying once after 600ms");
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    let guard = state.session.lock().await;
    match guard.as_ref() {
        Some(sess) => {
            logs::log_info("maison: session ready on retry");
            Ok((sess.client.clone(), sess.jar.clone(), sess.login.clone()))
        }
        None => {
            logs::log_error("maison: NotConnected after retry (no session — login first)");
            Err(AppError::NotConnected)
        }
    }
}

fn is_valid_maison_login(login: &str) -> bool {
    if login.is_empty() || login.chars().count() > 40 {
        return false;
    }
    !login
        .chars()
        .any(|c| c.is_whitespace() || matches!(c, '"' | '\'' | '/' | '\\'))
}

/// Percent-encode a login for the `p=` query value (same shape as the
/// `taverne.rs` helper: keep unreserved chars, encode everything else
/// byte by byte so accented logins become multi-byte %XX sequences).
fn percent_encode_login(login: &str) -> String {
    let mut out = String::with_capacity(login.len());
    for b in login.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

async fn inner_get_maison_id(state: &State<'_, AppState>, login: &str) -> Result<u64, AppError> {
    let login = login.trim();
    if !is_valid_maison_login(login) {
        return Err(AppError::InvalidFormat(format!(
            "Invalid login for maison lookup: '{login}'"
        )));
    }
    let (client, jar, _own_login) = snapshot_session(state).await?;

    let cookie_header = extract_cookies(&jar);
    if cookie_header.is_empty() {
        logs::log_error("maison: no session cookie (login expired?)");
        return Err(AppError::Network(
            "maison: no session cookie (login expired?)".into(),
        ));
    }

    logs::log_info(&format!("maison: resolving maison IDLieu for '{login}'"));
    // Full-page fetch first, AJAX variant as fallback (same query, same
    // Cookie/Referer pattern). The final request URL is logged at info
    // level (login is not a credential; cookies/token are never logged).
    let full_url = build_maison_url(config::URL_ECRAN_PRINCIPAL, login);
    logs::log_info(&format!("maison: GET {full_url}"));
    let full_text = fetch_maison_page(&client, &cookie_header, &full_url, "EcranPrincipal.php").await?;
    if let Some(id) = extract_maison_id(&full_text) {
        logs::log_info(&format!("maison: IDLieu for '{login}' = {id}"));
        return Ok(id);
    }

    let ajax_url = build_maison_url(config::URL_ECRAN_PRINCIPAL_AJAX, login);
    logs::log_info(&format!("maison: GET {ajax_url}"));
    let ajax_text =
        fetch_maison_page(&client, &cookie_header, &ajax_url, "EcranPrincipalAjax.php").await?;
    if let Some(id) = extract_maison_id(&ajax_text) {
        logs::log_info(&format!("maison: IDLieu for '{login}' = {id} (via EcranPrincipalAjax.php)"));
        return Ok(id);
    }

    // Total parse-miss on both endpoints: flattened `infosplayer` context
    // at info (200 chars, one line — the anchor for the real house
    // payload `dataChargement.reponse.infosPlayer.IDLieu`), full
    // per-stage diagnostics at warn.
    logs::log_info(&format!(
        "maison: infosplayer ctx for '{login}' (full) = {}",
        maison_context_snippet(&full_text, "infosplayer")
    ));
    logs::log_info(&format!(
        "maison: infosplayer ctx for '{login}' (ajax) = {}",
        maison_context_snippet(&ajax_text, "infosplayer")
    ));
    logs::log_warn(&format!(
        "maison: parse-miss for '{login}' (full page {} bytes, counts: idlieu={} maison={} typelieu={} getidlieu={} datachargement={} rar_joueur={} infosplayer={} ctx_maison={} ctx_idlieu={} ctx_infosplayer={} flags={} hex_maison={} hex_idlieu={}; ajax page {} bytes, counts: idlieu={} infosplayer={} ctx_infosplayer={} flags={})",
        full_text.len(),
        count_occurrences_ci(&full_text, "idlieu"),
        count_occurrences_ci(&full_text, "maison"),
        count_occurrences_ci(&full_text, "typelieu"),
        count_occurrences_ci(&full_text, "getidlieu"),
        count_occurrences_ci(&full_text, "datachargement"),
        count_occurrences_ci(&full_text, "rar.joueur"),
        count_occurrences_ci(&full_text, "infosplayer"),
        maison_context_snippet(&full_text, "maison"),
        maison_context_snippet(&full_text, "idlieu"),
        maison_context_snippet(&full_text, "infosplayer"),
        maison_stage_flags(&full_text),
        maison_debug_hex(&full_text, "maison"),
        maison_debug_hex(&full_text, "idlieu"),
        ajax_text.len(),
        count_occurrences_ci(&ajax_text, "idlieu"),
        count_occurrences_ci(&ajax_text, "infosplayer"),
        maison_context_snippet(&ajax_text, "infosplayer"),
        maison_stage_flags(&ajax_text),
    ));
    Err(AppError::InvalidFormat(
        "Maison introuvable pour ce login".into(),
    ))
}

/// Build the house-visit URL for `base` (`EcranPrincipal.php` or its AJAX
/// variant): `"<base>?l=23&t=m&p=<percent-encoded login>"`.
///
/// Single source of the query string so the full-page and AJAX fetches can
/// never diverge (suspect #1: params dropped/malformed by ad-hoc string
/// building). The `p=` value uses `percent_encode_login`; an empty encoding
/// (cannot happen after `is_valid_maison_login`, defensive) falls back to
/// the raw trimmed login so the `p=` param is never emitted empty.
fn build_maison_url(base: &str, login: &str) -> String {
    let mut encoded = percent_encode_login(login);
    if encoded.is_empty() {
        encoded = login.to_owned();
    }
    debug_assert!(encoded.len() <= 3 * 40, "maison: over-long encoded login");
    let url = format!("{base}?l=23&t=m&p={encoded}");
    debug_assert!(
        url.contains("?l=23&t=m&p="),
        "maison: malformed house-visit query string"
    );
    url
}

/// One authenticated page fetch with the shared Cookie/Referer pattern.
/// `label` names the endpoint in error logs only (never the URL query).
async fn fetch_maison_page(
    client: &wreq::Client,
    cookie_header: &str,
    url: &str,
    label: &str,
) -> Result<String, AppError> {
    let resp = client
        .get(url)
        .header("Cookie", cookie_header.to_owned())
        .header("Referer", config::REFERER)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("maison: request failed for {label}: {e}");
            logs::log_error(&msg);
            AppError::Network(msg)
        })?;

    if !resp.status().is_success() {
        let msg = format!("maison: HTTP {} for {label}", resp.status());
        logs::log_error(&msg);
        return Err(AppError::Network(msg));
    }

    resp.text().await.map_err(|e| {
        let msg = format!("maison: error reading {label}: {e}");
        logs::log_error(&msg);
        AppError::Network(msg)
    })
}

/// Balanced-brace JSON slice starting at `start_brace` (string-aware,
/// single-quote aware — same semantics as the `village.rs` helper: the
/// page is JS with `'...'` strings, and a brace inside a quoted string
/// must not affect depth).
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

/// Sane id gate shared by every stage: `> 0` and `< 10` decimal digits.
/// JSON numbers are judged by their decimal rendering; digit strings by
/// their trimmed length (leading zeros count toward the run).
fn sane_json_id_value(v: &serde_json::Value) -> Option<u64> {
    match v {
        serde_json::Value::Number(n) => {
            let id = n.as_u64()?;
            if id > 0 && id.to_string().len() < 10 {
                Some(id)
            } else {
                None
            }
        }
        serde_json::Value::String(s) => {
            let t = s.trim();
            if t.is_empty() || t.len() >= 10 {
                return None;
            }
            let id = t.parse::<u64>().ok()?;
            if id > 0 { Some(id) } else { None }
        }
        _ => None,
    }
}

/// Direct `IDLieu` key lookup on one JSON object (case-insensitive key).
/// Returns the first sane (`> 0`, `< 10` digits) id, `None` otherwise.
fn direct_id_lieu(v: &serde_json::Value) -> Option<u64> {
    let serde_json::Value::Object(map) = v else {
        return None;
    };
    for (k, val) in map {
        if k.eq_ignore_ascii_case("idlieu") {
            if let Some(id) = sane_json_id_value(val) {
                return Some(id);
            }
        }
    }
    None
}

/// Maison-typed object check: `typeLieu == "maison"` (case-insensitive
/// key and value — covers the live `changeSalon` shape).
fn is_maison_lieu(v: &serde_json::Value) -> bool {
    let serde_json::Value::Object(map) = v else {
        return false;
    };
    map.iter().any(|(k, val)| {
        k.eq_ignore_ascii_case("typelieu")
            && val
                .as_str()
                .map(|s| s.eq_ignore_ascii_case("maison"))
                .unwrap_or(false)
    })
}

/// Deep search for a maison object carrying `IDLieu`: a `typeLieu ==
/// "maison"` object contributes its own `IDLieu` first, then children are
/// walked (objects + arrays) so any nesting depth resolves.
fn find_maison_id_deep(v: &serde_json::Value) -> Option<u64> {
    if is_maison_lieu(v) {
        if let Some(id) = direct_id_lieu(v) {
            return Some(id);
        }
    }
    match v {
        serde_json::Value::Object(map) => {
            for child in map.values() {
                if let Some(id) = find_maison_id_deep(child) {
                    return Some(id);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(id) = find_maison_id_deep(item) {
                    return Some(id);
                }
            }
            None
        }
        _ => None,
    }
}

/// Deep search for ANY `IDLieu`-like key (case-insensitive,
/// numeric or digit-string, sane `> 0` / `< 10` digits) at any nesting
/// depth. No `typeLieu` gate — covers `dataChargement`, `RAR.joueur`,
/// `interfaceVisite`, `uiMaison` shells where the id sits without a
/// maison-typed sibling.
fn find_any_idlieu_deep(v: &serde_json::Value) -> Option<u64> {
    if let Some(id) = direct_id_lieu(v) {
        return Some(id);
    }
    match v {
        serde_json::Value::Object(map) => {
            for child in map.values() {
                if let Some(id) = find_any_idlieu_deep(child) {
                    return Some(id);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(id) = find_any_idlieu_deep(item) {
                    return Some(id);
                }
            }
            None
        }
        _ => None,
    }
}

/// Sweep every `anchor` occurrence (case-insensitive): first `{` after
/// the anchor starts a balanced-JSON candidate, searched for a
/// maison-typed `IDLieu` first then any `IDLieu`-like key inside.
/// Misses advance past the anchor so later anchors inside a rejected
/// candidate are still visited.
fn extract_maison_id_by_anchor(html: &str, anchor: &str) -> Option<u64> {
    let lower = html.to_ascii_lowercase();
    let anchor_lower = anchor.to_ascii_lowercase();
    let mut cursor = 0usize;
    while cursor < html.len() {
        let Some(rel) = lower[cursor..].find(anchor_lower.as_str()) else {
            break;
        };
        let pos = cursor + rel;
        if let Some(brace_rel) = html[pos..].find('{') {
            let abs_brace = pos + brace_rel;
            if let Some(slice) = extract_balanced_json(html, abs_brace) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(slice) {
                    if let Some(id) = find_maison_id_deep(&v) {
                        return Some(id);
                    }
                    if let Some(id) = find_any_idlieu_deep(&v) {
                        return Some(id);
                    }
                }
            }
        }
        cursor = pos + anchor.len();
    }
    None
}

/// `getIdLieu`-adjacent numbers: for each `getIdLieu` occurrence
/// (case-insensitive) scan a ±4KB window and take the nearest digit run
/// to the anchor (covers `getIdLieu(101704)`, `getIdLieu: 101704`,
/// `getIdLieu = "101704"` and query-string layouts). Only sane
/// (`> 0`, `< 10` digits) runs count; the nearest sane run to each
/// anchor wins, anchors visited in document order.
fn extract_maison_id_getidlieu(html: &str) -> Option<u64> {
    const WINDOW: usize = 4096;
    const MARKER_LEN: usize = 9; // len("getIdLieu")
    let bytes = html.as_bytes();
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while cursor < html.len() {
        let Some(rel) = lower[cursor..].find("getidlieu") else {
            break;
        };
        let pos = cursor + rel;
        let mut win_start = pos.saturating_sub(WINDOW);
        while win_start < pos && !html.is_char_boundary(win_start) {
            win_start += 1;
        }
        let mut win_end = (pos + MARKER_LEN + WINDOW).min(html.len());
        while win_end > win_start && !html.is_char_boundary(win_end) {
            win_end -= 1;
        }
        let anchor_rel = pos - win_start;
        let anchor_end_rel = anchor_rel + MARKER_LEN;
        let win_bytes = &bytes[win_start..win_end];
        let mut best: Option<(usize, u64)> = None; // (distance, id)
        let mut i = 0usize;
        while i < win_bytes.len() {
            if !win_bytes[i].is_ascii_digit() {
                i += 1;
                continue;
            }
            let start = i;
            while i < win_bytes.len() && win_bytes[i].is_ascii_digit() {
                i += 1;
            }
            let run_len = i - start;
            if run_len == 0 || run_len >= 10 {
                continue;
            }
            // SAFETY: digit runs are ASCII, slicing the digit range is
            // always a char boundary.
            let Ok(id) = html[win_start + start..win_start + i].parse::<u64>() else {
                continue;
            };
            if id == 0 {
                continue;
            }
            let dist = if start >= anchor_end_rel {
                start - anchor_end_rel
            } else if i <= anchor_rel {
                anchor_rel - i
            } else {
                0
            };
            match best {
                Some((d, _)) if d <= dist => {}
                _ => best = Some((dist, id)),
            }
        }
        if let Some((_, id)) = best {
            return Some(id);
        }
        cursor = pos + MARKER_LEN;
    }
    None
}

/// Raw `IDLieu` key scan (case-insensitive key, whitespace-tolerant
/// around `:`/`=`): `IDLieu:101704`, `"IDLieu" : "101704"`,
/// `idlieu='101704'`, ... Numeric or digit-string values, first sane
/// (`> 0`, `< 10` digits) wins. Over-long (≥10 digit) runs are skipped,
/// not returned. Byte-level walk is UTF-8 safe (ASCII bytes only;
/// `to_ascii_lowercase` preserves byte length so indices map 1:1 to the
/// original).
fn extract_maison_id_raw(html: &str) -> Option<u64> {
    const KEY_LEN: usize = 6; // len("IDLieu")
    let bytes = html.as_bytes();
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while cursor < html.len() {
        let Some(rel) = lower[cursor..].find("idlieu") else {
            break;
        };
        let mut i = cursor + rel + KEY_LEN;
        if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
            i += 1;
        }
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
            i += 1;
        }
        if i < bytes.len() && (bytes[i] == b':' || bytes[i] == b'=') {
            i += 1;
        } else {
            cursor += rel + 1;
            continue;
        }
        while i < bytes.len()
            && matches!(
                bytes[i],
                b' ' | b'\t' | b'\n' | b'\r' | b'"' | b'\''
            )
        {
            i += 1;
        }
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if start < i {
            let run_len = i - start;
            if run_len < 10 {
                if let Ok(id) = html[start..i].parse::<u64>() {
                    if id > 0 {
                        return Some(id);
                    }
                }
            }
            cursor = i;
        } else {
            cursor += rel + 1;
        }
    }
    None
}

/// Normalize an id-like key for family comparison: strip `_`/`-` and
/// lowercase, so `IDLieu`/`id_lieu`/`id-lieu` compare equal and
/// `maisonId`/`maison_id` compare equal.
fn norm_id_key(key: &str) -> String {
    key.chars()
        .filter(|c| *c != '_' && *c != '-')
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Deep search for an id-like key inside an `infosPlayer` object: the
/// `IDLieu`/`maisonId` families win anywhere in the subtree before a bare
/// `id` anywhere is accepted (a bare top-level `id` must never shadow a
/// nested `IDLieu`). Walks objects + arrays.
fn find_infosplayer_id_deep(v: &serde_json::Value) -> Option<u64> {
    if let Some(id) = direct_infosplayer_id_priority(v, &["idlieu", "maisonid"]) {
        return Some(id);
    }
    if let Some(id) = find_family_deep(v, &["idlieu", "maisonid"]) {
        return Some(id);
    }
    if let Some(id) = direct_infosplayer_id_priority(v, &["id"]) {
        return Some(id);
    }
    find_family_deep(v, &["id"])
}

/// Direct lookup restricted to the given normalized families (document
/// order within the object, first sane wins).
fn direct_infosplayer_id_priority(v: &serde_json::Value, families: &[&str]) -> Option<u64> {
    let serde_json::Value::Object(map) = v else {
        return None;
    };
    for family in families {
        for (k, val) in map {
            if norm_id_key(k) == *family {
                if let Some(id) = sane_json_id_value(val) {
                    return Some(id);
                }
            }
        }
    }
    None
}

/// Recursive deep search for the given normalized key families (children
/// only — the caller checks self first so family priority holds across
/// nesting levels).
fn find_family_deep(v: &serde_json::Value, families: &[&str]) -> Option<u64> {
    match v {
        serde_json::Value::Object(map) => {
            for child in map.values() {
                if let Some(id) = direct_infosplayer_id_priority(child, families) {
                    return Some(id);
                }
            }
            for child in map.values() {
                if let Some(id) = find_family_deep(child, families) {
                    return Some(id);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(id) = direct_infosplayer_id_priority(item, families) {
                    return Some(id);
                }
            }
            for item in arr {
                if let Some(id) = find_family_deep(item, families) {
                    return Some(id);
                }
            }
            None
        }
        _ => None,
    }
}

/// `infosPlayer` balanced-JSON sweep (case-insensitive anchor): for each
/// occurrence the first `{` after the anchor starts a balanced-JSON
/// candidate (covers `dataChargement.reponse.infosPlayer = {...IDLieu...}`
/// from the live game bundle chain `dataChargement.reponse.infosPlayer.
/// IDLieu → Batiment3D._infos.infosPlayer.IDLieu →
/// InterfaceVisite.getIdLieu()`), parsed and searched for any sane
/// id-like key (`IDLieu`/`id_lieu` first, `maisonId`, bare `id` last).
/// Misses advance past the anchor so later anchors inside a rejected
/// candidate are still visited.
fn extract_infosplayer_id_verbatim(html: &str) -> Option<u64> {
    const ANCHOR_LEN: usize = 11; // len("infosplayer")
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while cursor < html.len() {
        let Some(rel) = lower[cursor..].find("infosplayer") else {
            break;
        };
        let pos = cursor + rel;
        if let Some(brace_rel) = html[pos..].find('{') {
            let abs_brace = pos + brace_rel;
            if let Some(slice) = extract_balanced_json(html, abs_brace) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(slice) {
                    if let Some(id) = find_infosplayer_id_deep(&v) {
                        return Some(id);
                    }
                }
            }
        }
        cursor = pos + ANCHOR_LEN;
    }
    None
}

/// Maison IDLieu lookup order (all case-insensitive):
/// 0. `infosPlayer` balanced-JSON sweep (any sane id-like key inside:
///    `IDLieu`/`id_lieu` first, `maisonId`, bare `id` last),
/// 1. balanced-JSON sweeps on `IDLieu` / `typeLieu` / `changeSalon` /
///    `maison` / `Maison` / `dataChargement` / `RAR.joueur` /
///    `interfaceVisite` / `uiMaison` (maison-typed `IDLieu` first, then
///    any numeric/digit-string `IDLieu`-like key inside),
/// 2. `getIdLieu`-adjacent numbers (±4KB window, nearest sane number),
/// 3. raw `IDLieu` key scan (numeric or digit-string values),
/// 4. steps 0–3 rerun on the backslash-unescape copy (`\"`→`"`).
/// First sane (`> 0`, `< 10` digits) wins. `None` only when truly
/// absent (total parse-miss, never throws).
fn extract_maison_id(html: &str) -> Option<u64> {
    if let Some(id) = extract_maison_id_verbatim_with_infosplayer(html) {
        return Some(id);
    }
    // Escaped-JSON layouts (`\"IDLieu\":101704` inside a JS string).
    let deescaped = html.replace("\\\"", "\"").replace("\\'", "'");
    if deescaped != html {
        if let Some(id) = extract_maison_id_verbatim_with_infosplayer(&deescaped) {
            return Some(id);
        }
    }
    None
}

/// Verbatim lookup with the `infosPlayer` anchor first, existing
/// extraction (`extract_maison_id_verbatim`) as fallback.
fn extract_maison_id_verbatim_with_infosplayer(html: &str) -> Option<u64> {
    if let Some(id) = extract_infosplayer_id_verbatim(html) {
        return Some(id);
    }
    extract_maison_id_verbatim(html)
}

/// Verbatim lookup: anchor sweeps then `getIdLieu` then the raw scan. No
/// haystack rewriting — the escaped fallback wraps this helper.
fn extract_maison_id_verbatim(html: &str) -> Option<u64> {
    for anchor in [
        "IDLieu",
        "typeLieu",
        "changeSalon",
        "maison",
        "Maison",
        "dataChargement",
        "RAR.joueur",
        "interfaceVisite",
        "uiMaison",
    ] {
        if let Some(id) = extract_maison_id_by_anchor(html, anchor) {
            return Some(id);
        }
    }
    if let Some(id) = extract_maison_id_getidlieu(html) {
        return Some(id);
    }
    extract_maison_id_raw(html)
}

/// Case-insensitive occurrence count of `needle` in `haystack`
/// (non-overlapping). Byte-length preserving (`to_ascii_lowercase`)
/// so multibyte pages count correctly.
fn count_occurrences_ci(haystack: &str, needle: &str) -> usize {
    let lower = haystack.to_ascii_lowercase();
    let needle_lower = needle.to_ascii_lowercase();
    let mut count = 0usize;
    let mut cursor = 0usize;
    while cursor < lower.len() {
        match lower[cursor..].find(needle_lower.as_str()) {
            Some(rel) => {
                count += 1;
                cursor += rel + needle_lower.len();
            }
            None => break,
        }
    }
    count
}

/// First 200 chars around the first `key` occurrence (case-insensitive)
/// for parse-miss diagnostics. Mirrors `village.rs`
/// `nom_village_context_snippet`: truncated page context only — no
/// cookies/session data lives near the key, and control chars are
/// flattened so the log stays one line.
fn maison_context_snippet(html: &str, key: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let key_lower = key.to_ascii_lowercase();
    let Some(rel) = lower.find(key_lower.as_str()) else {
        return "<no-key>".to_owned();
    };
    let start = rel.saturating_sub(100);
    let end = (rel + 100).min(html.len());
    let mut s = start;
    while s < end && !html.is_char_boundary(s) {
        s += 1;
    }
    let mut e = end;
    while e > s && !html.is_char_boundary(e) {
        e -= 1;
    }
    let snippet: String = html[s..e].chars().collect();
    let snippet: String = snippet
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let mut flat: String = snippet.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.len() > 200 {
        let mut cut = 200;
        while cut > 0 && !flat.is_char_boundary(cut) {
            cut -= 1;
        }
        flat.truncate(cut);
    }
    format!("'{flat}'")
}

/// Per-stage parse-miss diagnostics, mirroring `village.rs`
/// `nom_village_stage_flags`: balanced-slice / serde-parse counts
/// across the maison anchors plus raw/getIdLieu hit flags. Computed
/// only on the miss path.
fn maison_stage_flags(html: &str) -> String {
    let mut anchor_slices = 0usize;
    let mut serde_ok = 0usize;
    for anchor in [
        "maison",
        "dataChargement",
        "RAR.joueur",
        "interfaceVisite",
        "uiMaison",
        "IDLieu",
        "typeLieu",
        "changeSalon",
        "infosPlayer",
    ] {
        let lower = html.to_ascii_lowercase();
        let anchor_lower = anchor.to_ascii_lowercase();
        let mut cursor = 0usize;
        while cursor < html.len() {
            let Some(rel) = lower[cursor..].find(anchor_lower.as_str()) else {
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
    let raw = u8::from(extract_maison_id_raw(html).is_some());
    let getid = u8::from(extract_maison_id_getidlieu(html).is_some());
    format!("anchor_slices={anchor_slices} serde_ok={serde_ok} raw={raw} getidlieu={getid}")
}

/// Hex dump of ~64B around the first `key` occurrence
/// (case-insensitive, ~32B each side), mirroring `village.rs`
/// `nom_village_debug_hex`: exposes zero-width/format chars the
/// flattened `ctx` snippet hides. `<no-key>` when absent.
fn maison_debug_hex(html: &str, key: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let key_lower = key.to_ascii_lowercase();
    let Some(rel) = lower.find(key_lower.as_str()) else {
        return "<no-key>".to_owned();
    };
    let start = rel.saturating_sub(32);
    let end = (rel + key.len() + 32).min(html.len());
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
