import { invoke } from "@tauri-apps/api/core";
import type { Tavern } from "../lib/types";

// Typed Tauri bridge — keep signatures in sync with src-tauri/src/lib.rs
// All commands surface Rust AppError as string; callers handle display.

export const api = {
  getTaverns: () => invoke<Tavern[]>("get_taverns"),

  login: (username: string, password: string, remember: boolean) =>
    invoke<string | null>("login", { username, password, remember }),

  tryAutoLogin: () => invoke<string | null>("try_auto_login"),

  getSavedLogin: () => invoke<string | null>("get_saved_login"),

  // ── ora-1 multi-account contract (backend in progress) ──
  listAccounts: () => invoke<string[]>("list_accounts"),

  saveAccount: (username: string, password: string) =>
    invoke<void>("save_account", { username, password }),

  removeAccount: (username: string) =>
    invoke<void>("remove_account", { username }),

  tryAutoLoginFor: (username: string) =>
    invoke<string | null>("try_auto_login_for", { username }),

  wsDisconnect: () => invoke<void>("ws_disconnect"),

  logout: () => invoke<void>("logout"),

  disconnect: () => invoke<void>("disconnect"),

  wsConnect: (idLieu: number) => invoke<void>("ws_connect", { idLieu }),

  wsSend: (message: string) => invoke<void>("ws_send", { message }),

  typingStart: () => invoke<void>("ws_typing_start"),

  typingStop: () => invoke<void>("ws_typing_stop"),

  changePlace: (idPlace: number) => invoke<void>("change_place", { idPlace }),

  saveChatLog: (tavernId: number, content: string) =>
    invoke<string>("save_chat_log", { tavernId, content }),

  getTavernePlaces: (idLieu: number) => invoke<number>("get_taverne_places", { idLieu }),

  getPortraitJson: (login: string) => invoke<string>("get_portrait_json", { login }),

  isConnected: () => invoke<boolean>("is_connected"),

  getSessionLogin: () => invoke<string | null>("get_session_login"),

  getLogDir: () => invoke<string>("get_log_dir"),

  getFullLog: (tavernId: number) => invoke<string>("get_full_log", { tavernId }),
} as const;

export type Api = typeof api;
