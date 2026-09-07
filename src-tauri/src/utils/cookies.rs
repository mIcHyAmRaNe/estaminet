use std::sync::Arc;
use wreq::cookie::{CookieStore, Jar};

use crate::config;

/// Single source of truth for cookie extraction — imported by `network::*`.
pub fn extract_cookies(jar: &Arc<Jar>) -> String {
    let site = config::COOKIE_SITE.parse().expect("Invalid COOKIE_SITE");

    match CookieStore::cookies(&**jar, &site, wreq::Version::HTTP_11) {
        wreq::cookie::Cookies::Uncompressed(values) => values
            .iter()
            .filter_map(|v| v.to_str().ok())
            .collect::<Vec<_>>()
            .join("; "),
        wreq::cookie::Cookies::Compressed(v) => v.to_str().unwrap_or_default().to_string(),
        _ => String::new(),
    }
}
