import { invoke } from "@tauri-apps/api/core";
import type { Tavern } from "../lib/types";

// Typed Tauri bridge — keep signatures in sync with src-tauri/src/lib.rs
// All commands surface Rust AppError as string; callers handle display.

export const api = {
  getTaverns: () => invoke<Tavern[]>("get_taverns"),

  login: (username: string, password: string, remember: boolean) =>
    invoke<string | null>("login", { username, password, remember }),

  // ── ora-1 multi-account contract (backend in progress) ──
  listAccounts: () => invoke<string[]>("list_accounts"),

  removeAccount: (username: string) =>
    invoke<void>("remove_account", { username }),

  tryAutoLoginFor: (username: string) =>
    invoke<string | null>("try_auto_login_for", { username }),

  wsDisconnect: () => invoke<void>("ws_disconnect"),

  logout: () => invoke<void>("logout"),

  disconnect: () => invoke<void>("disconnect"),

  wsConnect: (idLieu: number) => invoke<void>("ws_connect", { idLieu }),

  // Village presence (tavern-picker phase only): reuses the single socket.
  // Backend counterpart: village_connect in src-tauri/src/lib.rs.
  // `vetements` is the per-user outfit object for changeSalon (omitted →
  // backend sends `{}`); live sends the full object per user.
  villageConnect: (idVillage: number, vetements?: unknown) =>
    invoke<void>("village_connect", { idVillage, vetements }),

  // Player home village (NomVillage, e.g. Montpellier) for home-only
  // presence dial. Backend in progress — callers treat rejection as
  // unknown (band hidden until the name maps to a known IDLieu).
  getPlayerVillage: () => invoke<string | null>("get_player_village"),

  // Per-user outfit object for village preview dials (same client session).
  // Backend in progress — callers tolerate rejection (missing command) and
  // fall back to undefined (backend sends `{}`).
  getPlayerVetements: () => invoke<unknown | null>("get_player_vetements"),

  // House IDLieu for an owner login (numeric IDLieu for maisonConnect).
  // Backend counterpart: get_maison_id (parallel lane) — { login } -> u64.
  getMaisonId: (login: string) => invoke<number>("get_maison_id", { login }),

  // House chat (maison phase only): reuses the single socket.
  // Backend counterpart: maison_connect in src-tauri/src/lib.rs (lane in progress).
  // `vetements` is the per-user outfit object for changeSalon (omitted →
  // backend sends `{}`); live sends the full object per user. Tauri maps the
  // camelCase `idMaison` key onto the backend `id_maison` param.
  maisonConnect: (idMaison: number, vetements?: unknown) =>
    invoke<void>("maison_connect", { idMaison, vetements }),

  // House message send (type e.g. "parler" / "crier").
  // Backend counterpart: maison_send (lane in progress).
  maisonSend: (msgType: string, message: string) =>
    invoke<void>("maison_send", { msgType, message }),

  wsSend: (message: string) => invoke<void>("ws_send", { message }),

  typingStart: () => invoke<void>("ws_typing_start"),

  typingStop: () => invoke<void>("ws_typing_stop"),

  changePlace: (idPlace: number) => invoke<void>("change_place", { idPlace }),

  saveChatLog: (tavernId: number, content: string) =>
    invoke<string>("save_chat_log", { tavernId, content }),

  // Portrait calque bytes from the oxv CDN via the Rust proxy: returns a
  // data: URL (webp→png fallback server-side). Same-origin load → untainted
  // canvas, no CORS checks. Rust counterpart: commands/taverne.rs.
  fetchPortraitAsset: (url: string) => invoke<string>("fetch_portrait_asset", { url }),

  // ── Lane F1 — social/economy commands (backend in src-tauri/src/commands/chat.rs) ──
  // Offer a drink to another player (emits taverneOffreVerre).
  taverneOffreVerre: (login: string) => invoke<void>("taverne_offre_verre", { login }),

  // Buy a general round for the whole tavern (emits taverneTourneeGenerale).
  taverneTourneeGenerale: () => invoke<void>("taverne_tournee_generale"),

  // Opt in/out of receiving alcohol (emits taverneAccepteAlcool).
  taverneAccepteAlcool: (accepter: boolean) =>
    invoke<void>("taverne_accepte_alcool", { accepter }),

  // Moderation (UI lands in a later lane — wrappers ready).
  taverneKick: (login: string) => invoke<void>("taverne_kick", { login }),

  taverneBan: (login: string) => invoke<void>("taverne_ban", { login }),

  taverneUnban: (login: string) => invoke<void>("taverne_unban", { login }),

  getPortraitJson: (login: string) => invoke<string>("get_portrait_json", { login }),

  // Exact portrait JSON last sent in changeSalon for self (fresh-first
  // fetch or last-good cache, "" when never fetched). Self-view mirrors
  // what other players see — never a divergent fetch.
  getOwnPortraitJson: () => invoke<string>("get_own_portrait_json"),

  // Village tavern presences for the tavern-select right panel (authenticated
  // EcranPrincipalAjax.php?l=5 village-view fetch, parsed per tavern).
  // Rust counterpart: get_tavern_presences in src-tauri/src/commands/taverne.rs.
  // Rust returns snake_case; mapped here to camelCase for UI callers.
  getTavernPresences: () =>
    invoke<Array<{ tavern_name: string; occupants: string[] }>>("get_tavern_presences").then((rows) =>
      rows.map((r) => ({ tavernName: r.tavern_name, occupants: r.occupants })),
    ),

  isConnected: () => invoke<boolean>("is_connected"),

} as const;
