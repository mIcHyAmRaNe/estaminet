// Centralized Rust constants — keep in sync with src/lib/config.ts
pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
pub const BASE_URL: &str = "https://www.renaissancekingdoms.com";
pub const ORIGIN: &str = BASE_URL;
pub const REFERER: &str = "https://www.renaissancekingdoms.com/";
pub const COOKIE_SITE: &str = "https://www.renaissancekingdoms.com/";

pub const CHAT_WSS_HOST: &str = "chat.lesroyaumes.com";
pub const CHAT_WSS_URL_TMPL: &str =
    "wss://chat.lesroyaumes.com/socket.io/?login={}&token={}&prioritaire=true&EIO=3&transport=websocket";

// Endpoint URLs — centralize all renaissancekingdoms.com URLs here
pub const URL_LOGIN: &str = "https://www.renaissancekingdoms.com/ConnexionKC.php";
pub const URL_CHAT_TOKEN: &str = "https://www.renaissancekingdoms.com/AjaxInfosChat.php";
pub const URL_ECRAN_PRINCIPAL: &str =
    "https://www.renaissancekingdoms.com/EcranPrincipal.php";
pub const URL_ECRAN_PRINCIPAL_AJAX: &str =
    "https://www.renaissancekingdoms.com/EcranPrincipalAjax.php";
pub const URL_VILLAGE: &str = "https://www.renaissancekingdoms.com/village.php";
pub const URL_FICHE_PERSONNAGE: &str =
    "https://www.renaissancekingdoms.com/FichePersonnage.php";

pub const MSG_MAX_LEN: usize = 290;
pub const WS_PING_SECS: u64 = 25;
pub const HTTP_TIMEOUT_SECS: u64 = 30;
pub const WS_CHANNEL_CAP: usize = 32;

/// Payload of the Tauri `ws-closed` event emitted on VOLUNTARY close
/// (logout / Quit button). The frontend uses it to skip auto-reconnect.
/// Any other payload = abnormal close → reconnect.
pub const WS_CLOSE_VOLUNTARY: &str = "voluntary-close";

pub const PLACE_MAX: u64 = 9;
pub const PLACE_RESERVED_DEFAULT: &[u64] = &[0];

/// Valid `NombrePlaces` values returned by the taverne page.
pub const VALID_NOMBRE_PLACES: &[u64] = &[3, 8, 9, 10];
