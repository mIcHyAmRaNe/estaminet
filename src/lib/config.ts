// Centralized frontend constants — single source for taverns, limits, timeouts, URLs
// Rust counterpart: src-tauri/src/config.rs — keep in sync

// Tavern list: single source of truth is the backend (src-tauri/resources/taverns.json,
// served via get_taverns). Frontend must keep using api.getTaverns() — no local copy.
export const DEFAULT_TAVERN_ID = 85905;

// Chat limits
export const MSG_MAX_LEN = 290; // server-enforced in chat.rs; also used as textarea maxlength
export const MSG_HISTORY_LIMIT = 200; // keep last N in memory

// Places
export const PLACE_RESERVED_DEFAULT = [0] as const;
export const DEFAULT_PLACES = 8 as const;
// 8 by default, 10 when taverns.json sets places:10 or occupancy is detected at 8/9.
export const MAX_PLACES = 10 as const;

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
export const APP_VERSION = "0.6.0";

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
export const FLOOD_MUTE_MS = 30000;
export const WS_RECONNECT_DELAY_MS = 900;

// Payload `ws-closed` for a VOLUNTARY close (logout / Leave button).
// Rust counterpart: config.rs WS_CLOSE_VOLUNTARY — keep in sync.
// Any other payload = abnormal drop → auto-reconnect kicks in.
export const WS_CLOSE_VOLUNTARY = "voluntary-close";

// Lieu-tagged `ws-connected` payload for a tavern dial (Rust counterpart:
// network/socket.rs `register_handlers` — keep in sync). The village twin
// ("Connected to the village") lives next to its hook (useVillagePresence);
// this one gates useTaverne: the shared socket fires `ws-connected` for
// village dials too, and only the tavern ack may mark the tavern connected
// (otherwise a village connect corrupts isConnected + reconnect accounting).
export const TAVERN_CONNECTED_MSG = "Connected to the tavern";

// Distinct `ws-closed` payload for a room-rejected dial (taverne fermée /
// accès refusé): terminal, no retry. Any other non-voluntary payload =
// abnormal drop → backoff reconnect, but ONLY after taverneInit. Older
// backends predate the distinct payload and send generic strings
// ("Authentication error (41)", …) — still handled (compat): pre-init
// closes are terminal, post-init drops keep the backoff.
export const WS_CLOSE_ROOM_REJECTED = "room-rejected";

// Connect UX: abort/timeout for login + tavern-enter (Esc cancels, timer
// restores the prior phase with a friendly error). Generous: Tauri window
// on slow networks still completes inside this window.
export const CONNECT_TIMEOUT_MS = 30000;

// URLs (display only — keep canonical in Rust config.rs)
export const RK_BASE = "https://www.renaissancekingdoms.com";
// Midas calques: this root is only used to BUILD calque URLs — the bytes are
// fetched through the `fetch_portrait_asset` Rust proxy (commands/taverne.rs)
// and returned as data: URLs, so the webview runs no CORS checks. Direct
// oxv CDN loads were dropped: the CDN 404s on missing calques with no ACAO
// header, which WebKit reports as CORS errors (console noise). Tavern decor
// images are bundled locally instead — see the --tavern-* vars in
// src/styles/_base.scss (single source for CSS).
export const MIDAS_CDN = "https://lesroyaumes.cdn.oxv.fr/images/";

// Tavern ground type for church mode (official "eglise"): drives reserved-seat
// icons + drink-feature gating. Single source (was hardcoded in ChatRoom/ChatHeader).
export const LIEU_EGLISE = "eglise";

// Village IDLieu map for picker-phase presence (village_connect).
// Key = tavern `ville` string from taverns.json, value = village IDLieu for
// the 42["changeSalon",{"typeLieu":"village","IDLieu":..}] spike.
// Only confirmed ids are listed — unknown villes omit keys so the lookup
// returns undefined => null (never guess). Confirmed: 326 = Montpellier
// (live getInfosSalon {typeLieu:village, IDLieu:326}), 461 = Bordeaux
// (Eren_j home village; spawn coords in socket.rs still placeholder pending
// a live Bordeaux getInfosSalon capture).
export const VILLAGE_IDS: Record<string, number> = {
  Montpellier: 326,
  "Montpellier (Comté de Languedoc)": 326,
  Bordeaux: 461,
  "Bordeaux (Comté Guyenne)": 461,
};

// Village picker preselect + presence roster wait: how long the picker waits
// for the villeInfosPersonnages connectMe roster before showing the
// unverified error instead of a silent empty list.
export const VILLAGE_CONNECTME_TIMEOUT_MS = 10000;

// Chat slash-command allowlist (official commands only; others trigger bredouille).
export const CHAT_SLASH_ALLOWLIST: readonly string[] = ["/me ", "/faire ", "/emote ", "/w ", "/manger ", "/boire", "/boire "];

// Whisper dedup window (full + short forms of the same message).
export const WHISPER_DEDUP_MS = 10000;
// Auto-reconnect backoff (single-flight socket handler).
export const RECONNECT_MAX_ATTEMPTS = 5;
export const RECONNECT_MAX_DELAY_MS = 10000;
// Ecus balance pulse (matches official ecus_moins flash duration).
export const ECUS_PULSE_MS = 2500;
// Portrait fallback toast TTL (latest-wins).
export const PORTRAIT_WARN_TTL_MS = 6000;
