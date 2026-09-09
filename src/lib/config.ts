// Centralized frontend constants — single source for taverns, limits, timeouts, URLs
// Rust counterpart: src-tauri/src/config.rs — keep in sync

// Tavern list: single source of truth is the backend (src-tauri/resources/taverns.json,
// served via get_taverns). Frontend must keep using api.getTaverns() — no local copy.
export const DEFAULT_TAVERN_ID = 85905;

// Chat limits
export const MSG_MAX_LEN = 290; // server-enforced in chat.rs
export const MSG_DISPLAY_MAX = 500; // textarea maxlength
export const MSG_HISTORY_LIMIT = 200; // keep last N in memory

// Places
export const PLACE_RESERVED_DEFAULT = [0] as const;
export const PLACE_MAX = 10;
export const PLACE_SIMPLE_CANDIDATES = [1, 2, 3, 4, 5, 6, 7] as const;
export const PLACES_ALLOWED = [3, 8, 9, 10] as const;

// Auto-seat
export const AUTO_QUIET_MS = 600;
export const AUTO_MAX_MS = 2500;
export const AUTO_MAX_ATTEMPTS = 10;

// Bredouille
export const BREDOUILLE_MS = 2400;

// Locale (i18n): localStorage key for the persisted UI language.
// Supported values: 'fr' | 'en'. Kept here so hooks, components and the
// i18n module share a single constant instead of a hardcoded string.
export const LOCALE_STORAGE_KEY = "estaminet.locale";

// App version fallback for the About dialog (runtime source of truth is
// getVersion() from @tauri-apps/api/app; keep in sync with package.json).
export const APP_VERSION = "0.2.0";

// Recent taverns (ora-1 step 2): most-recent-first ids in localStorage.
export const RECENTS_STORAGE_KEY = "estaminet.recentTaverns";
export const RECENTS_MAX = 5;

// Typing indicator: emit a stop after this delay without input.
export const TYPING_STOP_DELAY_MS = 4000;

// Sound: localStorage key for the 4-mode sound controller (official:
// tout / son / musique / aucun). Default "tout".
export const SOUND_MODE_KEY = "estaminet.soundMode";
// Legacy boolean toggle (pre-modes): migrated on read, kept in sync on
// write so older builds still see a coherent value.
export const SOUND_ENABLED_KEY = "estaminet.soundEnabled";

// Network / UX
export const SCROLL_THRESHOLD = 100;
export const ERROR_TTL_MS = 3500;
// Lane F3 — flood mute: official onBanFlood disables the chat input for 30s
// (error line + countdown, NOT a fatal popup).
export const FLOOD_MUTE_MS = 30000;export const PORTRAIT_RETRY_MS = 1200;
export const COPIED_TTL_MS = 1800;
export const WS_RECONNECT_DELAY_MS = 900;

// Payload `ws-closed` for a VOLUNTARY close (logout / Leave button).
// Rust counterpart: config.rs WS_CLOSE_VOLUNTARY — keep in sync.
// Any other payload = abnormal drop → auto-reconnect kicks in.
export const WS_CLOSE_VOLUNTARY = "voluntary-close";

// URLs (display only — keep canonical in Rust config.rs)
export const RK_BASE = "https://www.renaissancekingdoms.com";
export const CHAT_WSS_HOST = "chat.lesroyaumes.com";
// Midas calques: use the oxv CDN directly — renaissancekingdoms.com 302s to
// it but WITHOUT Access-Control-Allow-Origin on the redirect hop, which fails
// CORS-mode image loads (crossOrigin="anonymous" required for toDataURL).
// Final CDN serves ACAO:* (verified 2026-09). Tavern decor images are bundled
// locally instead — see CDN_TAVERN / TAVERN_BG below.
export const MIDAS_CDN = "https://lesroyaumes.cdn.oxv.fr/images/";
// Local tavern assets, bundled in src/assets/images/interieurTaverne/.
// (Downloaded from the official site/CDN in 2026-09; see git history for sources.)
export const CDN_IMAGES = "../assets/images/interieurTaverne/";
export const TAVERN_BG = "../assets/images/interieurTaverne/fondNormal_nuit.jpg";
export const TAVERN_BG_NIGHT = TAVERN_BG;
export const CDN_TAVERN = "../assets/images/interieurTaverne/";
