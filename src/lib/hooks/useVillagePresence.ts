import { useState, useEffect, useRef } from "preact/hooks";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../api/tauri";
import { VILLAGE_CONNECTME_TIMEOUT_MS, WS_CLOSE_VOLUNTARY } from "../config";
import { t } from "../i18n";
import { loginKey, displayLogin } from "../utils/login-utils";

// Village presence for the tavern picker (phase tavern only, home-only).
// Listens to `villeInfosPersonnages` frames on the shared socket:
//   42["villeInfosPersonnages","connectMe",{id:{login,...},...}]  full replace
//   42["villeInfosPersonnages","connect",{login,...}]             incremental
// plus bare relayed `connect` (+1) / `disconnect` (-1).
// No seats, no messages, no portraits — logins only, capped at 50.
//
// Dial discipline: the hook dials (villageConnect) only while `enabled` is
// true. App sets enabled = phase tavern + known home village id — the
// band itself never dials, the single auto-dial happens on tavern-phase
// entry for the player's own NomVillage.
// A connectMe watchdog (~10s) turns a silent empty roster into an explicit
// unverified error: presence is cleared and `error` is set, never a quiet
// "nobody here".

export interface VillagePresenceOptions {
  enabled: boolean;
  villageId: number | null;
  villageName: string | null;
  // Picker-leaving / teardown gate: while true the hook never dials (Enter
  // pending, quit-to-picker teardown in flight). Behaves like a disarm:
  // bumps the generation (cancels in-flight outfit fetch + dial) and drops
  // late frames, so picker and room never dial at once on the shared socket.
  suspended?: boolean;
}

export interface VillagePresenceState {
  villageId: number | null;
  villageName: string | null;
  onlineUsers: string[];
  onlineCount: number;
  isConnected: boolean;
  // Legacy alias of villageError (kept for existing callers).
  error: string | null;
  // Distinct village error plumbing (headless): roster failures are village
  // errors with `village.*` copy — never labeled as tavern errors.
  villageError: string | null;
  villageErrorKind: VillageErrorKind | null;
  // Manual village re-dial (headless entry point for the designer).
  retryVillage: () => void;
}

// Distinct village error kind:
// - "roster-failed": connectMe watchdog — no roster in time.
// - "dropped": socket closed after a verified roster.
// - null: roster healthy (or not yet attempted).
export type VillageErrorKind = "roster-failed" | "dropped";

const MAX_VILLAGE_USERS = 50;

// Payload emitted on `ws-connected` for a village dial (see
// `register_handlers` in src-tauri/src/network/socket.rs — tavern dials
// emit "Connected to the tavern"). Matched exactly so a tavern connect on
// the shared socket never disarms the village roster guard.
const VILLAGE_CONNECTED_MSG = "Connected to the village";

function isValidLogin(login: string): boolean {
  const clean = login.trim();
  if (!clean || clean.length > 40 || /[\s\/"]/.test(clean)) return false;
  return true;
}

// Map entry login: prefer the inner `login` field
// (server sends {id:{login,...}}), fall back to the map key.
function entryLogin(key: string, val: unknown): string | null {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const o = val as Record<string, unknown>;
    if (typeof o.login === "string" && isValidLogin(o.login)) return o.login;
  }
  return isValidLogin(key) ? key : null;
}

export function useVillagePresence({ enabled, villageId, villageName, suspended = false }: VillagePresenceOptions): VillagePresenceState {
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  // Distinct village error state (never tavern copy — see `village.*` keys).
  const [villageError, setVillageError] = useState<string | null>(null);
  const [villageErrorKind, setVillageErrorKind] = useState<VillageErrorKind | null>(null);
  // Manual-retry trigger: bumping it re-runs the gated dial effect below,
  // reusing the exact dial path (generation bump + outfit fetch +
  // villageConnect + watchdog) instead of forking a second one.
  const [retrySeq, setRetrySeq] = useState(0);
  // Generation guard against cross-village races (e.g. 326 vs 461
  // showing the same roster): every [enabled, villageId] change mints a
  // fresh generation id, and only the currently armed generation's events
  // are honored — frames from a prior generation's dial are stale.
  const generationRef = useRef(0);
  // Generation currently awaiting its first roster (0 = none armed). While
  // non-zero, in-flight `villeInfosPersonnages` / `connect` / `disconnect`
  // frames are stale by definition (same role as useTaverne's
  // awaitingFreshRef, keyed by generation instead of a bare boolean), and
  // only the lieu-matched `ws-connected` for this generation disarms it.
  const pendingGenRef = useRef(0);
  // Ref mirrors for the single-subscription socket handler.
  const enabledRef = useRef(enabled);
  const suspendedRef = useRef(suspended);
  const villageIdRef = useRef<number | null>(villageId);
  const presentKeysRef = useRef<Set<string>>(new Set());
  // connectMe watchdog: set while waiting for the roster, cleared on the
  // first villeInfosPersonnages frame. Refs (not state) so the []-deps
  // socket handler can observe and clear the timer.
  const gotRosterRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  useEffect(() => {
    villageIdRef.current = villageId;
  }, [villageId]);

  // Safety net: reconcile the presence mirror from state.
  useEffect(() => {
    presentKeysRef.current = new Set(onlineUsers.map((u) => u.toLowerCase()));
  }, [onlineUsers]);

  const addUser = (login: string) => {
    if (!isValidLogin(login)) return;
    const clean = login.trim();
    const key = loginKey(clean);
    const disp = displayLogin(clean);
    if (presentKeysRef.current.has(key)) {
      setOnlineUsers((prev) => {
        const idx = prev.findIndex((u) => u.toLowerCase() === key);
        if (idx === -1 || prev[idx] === disp) return prev;
        const next = [...prev];
        next[idx] = disp;
        return next;
      });
      return;
    }
    if (presentKeysRef.current.size >= MAX_VILLAGE_USERS) return;
    presentKeysRef.current.add(key);
    setOnlineUsers((prev) => {
      if (prev.some((u) => u.toLowerCase() === key)) return prev;
      if (prev.length >= MAX_VILLAGE_USERS) return prev;
      return [...prev, disp];
    });
  };

  const removeUser = (login: string) => {
    const key = loginKey(login);
    if (!key) return;
    presentKeysRef.current.delete(key);
    setOnlineUsers((prev) => prev.filter((u) => u.toLowerCase() !== key));
  };

  // (Re)connect whenever the home village target changes; reset on disarm.
  // Disarm (phase leave, logout, Enter-pending/quit-teardown suspend) clears
  // presence + error silently and bumps the generation so an in-flight
  // outfit fetch + dial is cancelled — the band shows nothing until the
  // home dial re-arms on next tavern entry.
  useEffect(() => {
    if (!enabled || villageId == null || suspended) {
      generationRef.current += 1; // invalidate any prior generation
      pendingGenRef.current = 0;
      gotRosterRef.current = false;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      presentKeysRef.current.clear();
      setOnlineUsers([]);
      setIsConnected(false);
      setVillageError(null);
      setVillageErrorKind(null);
      return;
    }
    const gen = generationRef.current + 1;
    generationRef.current = gen;
    pendingGenRef.current = gen;
    gotRosterRef.current = false;
    presentKeysRef.current.clear();
    setOnlineUsers([]);
    setIsConnected(false);
    setVillageError(null);
    setVillageErrorKind(null);
    // Home dial carries the per-user outfit for changeSalon: fetch it
    // first (same client session), tolerating a missing command or any
    // failure as undefined (backend sends `{}`). Never block the dial on a
    // vetements failure; the generation guard still applies at dial time.
    api.getPlayerVetements().catch(() => undefined).then((vetements) => {
      // Generation-cancel: Enter/quit bumped the generation (or suspended
      // the hook) while the outfit fetch was in flight — never dial stale.
      if (generationRef.current !== gen) return;
      if (suspendedRef.current) return;
      api.villageConnect(villageId, vetements ?? undefined).catch(() => {});
    });
    // Watchdog: no roster within the window => unverified, not empty.
    // Clears any stale presence and surfaces an explicit error so the
    // band never shows a silent "nobody here".
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      // Prior-generation watchdog: a re-arm/disarm since this timer was
      // set means fresher state owns the roster — stay out.
      if (generationRef.current !== gen || pendingGenRef.current !== gen) return;
      if (gotRosterRef.current) return;
      if (!enabledRef.current) return;
      presentKeysRef.current.clear();
      setOnlineUsers([]);
      setIsConnected(false);
      // Village roster failure with village copy + kind — never labeled as
      // a tavern error.
      setVillageError(t("village.rosterFailed"));
      setVillageErrorKind("roster-failed");
    }, VILLAGE_CONNECTME_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // retrySeq re-runs this exact gated dial path for manual retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, villageId, suspended, retrySeq]);

  // Unmount: never leave a dangling watchdog.
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsubs: Array<() => void> = [];
    const track = (u: () => void) => {
      if (disposed) u();
      else unsubs.push(u);
    };

    const markRoster = () => {
      gotRosterRef.current = true;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setVillageError(null);
      setVillageErrorKind(null);
      setIsConnected(true);
    };

    const handleMessage = (e: { payload: string }) => {
      if (disposed) return;
      if (!enabledRef.current || suspendedRef.current || villageIdRef.current == null) return;
      const raw = e.payload;
      if (!raw.startsWith("42[")) return;
      try {
        const data = JSON.parse(raw.substring(2)) as unknown[];
        const eventName = data[0] as string;

        if (eventName === "villeInfosPersonnages") {
          if (pendingGenRef.current !== 0) return;
          markRoster();
          const sub = data[1];
          if (sub === "connectMe" && data.length >= 3 && typeof data[2] === "object" && data[2] !== null) {
            const mapObj = data[2] as Record<string, unknown>;
            const seen = new Map<string, string>();
            for (const k of Object.keys(mapObj)) {
              const login = entryLogin(k, mapObj[k]);
              if (!login) continue;
              const lk = loginKey(login);
              if (!seen.has(lk)) seen.set(lk, displayLogin(login));
            }
            for (let i = 3; i < data.length; i++) {
              const v = data[i];
              if (v && typeof v === "object" && !Array.isArray(v)) {
                const o = v as Record<string, unknown>;
                if (typeof o.login === "string" && isValidLogin(o.login)) {
                  const lk = loginKey(o.login);
                  if (!seen.has(lk)) seen.set(lk, displayLogin(o.login));
                }
              }
            }
            const keys = [...seen.keys()].slice(0, MAX_VILLAGE_USERS);
            presentKeysRef.current = new Set(keys);
            setOnlineUsers(keys.map((k) => seen.get(k) as string));
          } else if (sub === "connect" && data.length >= 3) {
            const consider = (o: Record<string, unknown>) => {
              if (typeof o.login === "string") addUser(o.login);
            };
            const second = data[2];
            if (second && typeof second === "object" && !Array.isArray(second)) {
              const o2 = second as Record<string, unknown>;
              if (typeof o2.login === "string") {
                consider(o2);
              } else {
                for (const k of Object.keys(o2)) {
                  const login = entryLogin(k, o2[k]);
                  if (login) addUser(login);
                }
              }
            }
            for (let i = 3; i < data.length; i++) {
              const v = data[i];
              if (v && typeof v === "object" && !Array.isArray(v)) {
                consider(v as Record<string, unknown>);
              }
            }
          }
          return;
        }

        if (eventName === "connect" || eventName === "disconnect") {
          if (pendingGenRef.current !== 0) return;
          const apply = (rawLogin: string) => {
            if (!rawLogin.trim()) return;
            if (eventName === "connect") addUser(rawLogin);
            else removeUser(rawLogin);
          };
          for (let i = 1; i < data.length; i++) {
            const v = data[i];
            if (typeof v === "string") apply(v);
            else if (v && typeof v === "object" && !Array.isArray(v)) {
              const o = v as Record<string, unknown>;
              if (typeof o.login === "string") apply(o.login);
            }
          }
          return;
        }
        // Everything else (tavern frames, chat, places): not ours.
        return;
      } catch {}
    };

    listen<string>("ws-message", handleMessage).then((un) => track(un));
    listen<string>("ws-connected", (e) => {
      if (disposed) return;
      if (!enabledRef.current || suspendedRef.current || villageIdRef.current == null) return;
      // Lieu-specific ack: only the village dial's message disarms the
      // guard — a tavern `ws-connected` on the shared socket must not bless
      // a pending village roster. (A prior generation's village connect is
      // wire-indistinguishable — no village id in the payload — so the
      // newest arming wins: any matched connect acks the pending one.)
      if (e.payload !== VILLAGE_CONNECTED_MSG) return;
      pendingGenRef.current = 0;
      // Socket is up but the roster may still be on its way — keep the
      // watchdog running until the first villeInfosPersonnages frame.
      // Show the connecting state, not a premature empty list.
      if (!gotRosterRef.current) setIsConnected(false);
      else setIsConnected(true);
    }).then((u) => track(u));
    listen<string>("ws-closed", (e) => {
      if (disposed) return;
      if (!enabledRef.current || suspendedRef.current) return;
      // Voluntary teardown (logout / Leave / disconnect): silent clear,
      // never a retry affordance — the next dial (or disarm) owns the state.
      const payload = e.payload ?? "";
      const hadRoster = gotRosterRef.current;
      setIsConnected(false);
      presentKeysRef.current.clear();
      setOnlineUsers([]);
      if (payload === WS_CLOSE_VOLUNTARY) {
        setVillageError(null);
        setVillageErrorKind(null);
        return;
      }
      // Abnormal drop after a verified roster: explicit village error with
      // village copy (never tavern copy). Before any roster the watchdog
      // owns the message — stay silent here so the two never fight.
      if (hadRoster) {
        setVillageError(t("village.dropped"));
        setVillageErrorKind("dropped");
      }
    }).then((u) => track(u));

    return () => {
      disposed = true;
      for (const u of unsubs) u();
    };
    // Mount-pattern: single subscription, refs mirror latest props.
    // clearRosterTimer/addUser/removeUser are stable-by-ref usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual village re-dial (headless entry point for the designer). Clears
  // the error/kind and bumps retrySeq so the gated dial effect above runs
  // its exact path again (generation bump + outfit fetch + villageConnect +
  // watchdog); the backend single-flight (teardown-before-dial, gen-guarded
  // latest-wins, duplicate swallow) keeps a double-click to one socket.
  // Phase-owned: no-ops while the room owns the socket (enabled false) or
  // a transition is in flight (suspended) — a village retry must never
  // steal the shared socket from the room dial, and vice versa for the
  // tavern retry. App additionally guards by phase (see App.tsx).
  const retryVillage = (): void => {
    if (!enabledRef.current || suspendedRef.current || villageIdRef.current == null) return;
    setVillageError(null);
    setVillageErrorKind(null);
    setRetrySeq((s) => s + 1);
  };

  return {
    villageId,
    villageName,
    onlineUsers,
    onlineCount: onlineUsers.length,
    isConnected,
    error: villageError,
    villageError,
    villageErrorKind,
    retryVillage,
  };
}
