import { useState, useEffect, useRef } from "preact/hooks";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../api/tauri";
import {
  MAISON_CONNECTED_MSG,
  MAISON_CONNECTME_TIMEOUT_MS,
  MSG_HISTORY_LIMIT,
  WS_CLOSE_VOLUNTARY,
} from "../config";
import { t } from "../i18n";
import { loginKey, displayLogin } from "../utils/login-utils";
import { playMessageSound } from "../utils/sound";
import type { ChatMessage } from "../types";

// House (maison) presence + chat: mirrors useVillagePresence roster
// discipline with simplified useTaverne-style messaging. Listens to
// `maison*` frames on the shared socket:
//   42["maisonInit",date]                                            room init
//   42["maisonInfosPersonnages","connectMe",{id:{login,...},...}]    full replace
//   42["maisonInfosPersonnages","connect",{login,...key}]            incremental
//   42["maisonInfosPersonnages","disconnect",id]                     removal by id
//   42["maisonMessage",date,idMessage,idPersonnage,login,type,msg]   chat line
// where type is e.g. "parler" / "crier". No seats, no portraits — logins +
// messages only, capped at 50 users / MSG_HISTORY_LIMIT lines.
//
// Typing: the official client delegates typing to the ville chat
// (debuteMessage/annuleMessage → getChatVille()), so typing frames on the
// shared ws-message bus are taverneDebuteMessage/taverneAnnuleMessage even
// in a maison room — handled here (self excluded). Sends already emit them
// via api.typingStart/Stop (ChatRoom input), so no backend change.
//
// Ville/taverne frames are ignored entirely (no cross-room pollution):
// bare relayed `connect` / `disconnect` events are ambiguous on the shared
// socket, so only `maison*` frames plus the lieu-matched `ws-connected` /
// `ws-closed` are honored.
//
// Dial discipline: the hook dials (maisonConnect) only while `enabled` is
// true. Not wired into any view yet (backend + hook lane only) — a later
// lane owns the mount.

export interface MaisonChatOptions {
  enabled: boolean;
  maisonId: number | null;
  // Room-leaving / teardown gate: while true the hook never dials. Behaves
  // like a disarm: bumps the generation (cancels in-flight outfit fetch +
  // dial) and drops late frames, so room dials never overlap on the shared
  // socket.
  suspended?: boolean;
  // Own login for the message-sound gate (echoes of self stay silent).
  // Empty/omitted = no sound gating (silent until known, like useTaverne).
  currentUser?: string;
}

export interface MaisonChatState {
  maisonId: number | null;
  messages: ChatMessage[];
  onlineUsers: string[];
  onlineCount: number;
  isConnected: boolean;
  // Lowercase logins currently composing (self excluded) — drives the
  // ChatRoom writing animation (zoneQuiEcrit + seat ellipsis).
  typingUsers: string[];
  // Legacy alias of maisonError (kept for symmetry with the other hooks).
  error: string | null;
  // Distinct maison error plumbing (headless): roster failures are maison
  // errors with `maison.*` copy — never labeled as tavern errors.
  maisonError: string | null;
  maisonErrorKind: MaisonErrorKind | null;
  // Manual maison re-dial (headless entry point for the later UI lane).
  retryMaison: () => void;
  // Thin send passthrough (type e.g. "parler" / "crier"); callers handle
  // rejection display.
  sendMaison: (msgType: string, message: string) => Promise<void>;
}

// Distinct maison error kind:
// - "roster-failed": connectMe watchdog — no roster in time.
// - "dropped": socket closed after a verified room (roster or init seen).
// - null: room healthy (or not yet attempted).
export type MaisonErrorKind = "roster-failed" | "dropped";

const MAX_MAISON_USERS = 50;

function isValidLogin(login: string): boolean {
  const clean = login.trim();
  if (!clean || clean.length > 40 || /[\s\/"]/.test(clean)) return false;
  return true;
}

// Roster entry login: ONLY the inner `login` field
// (server sends {id:{login,...}} with numeric person-id keys) — never the
// map key, which is a person id, not a login.
function maisonEntryLogin(val: unknown): string | null {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const o = val as Record<string, unknown>;
    if (typeof o.login === "string" && isValidLogin(o.login)) return o.login;
  }
  return null;
}

// Server chat type → ChatMessage variant. Both parler (talk) and crier
// (shout) are plain speech: no ChatMessage variant fits shouting better
// than normal (emote would misrender as a /me action), so both stay
// "normal" with content verbatim.
function maisonMsgType(serverType: unknown): ChatMessage["type"] {
  if (typeof serverType === "string") {
    const st = serverType.trim().toLowerCase();
    if (st === "parler" || st === "crier") return "normal";
  }
  return "normal";
}

export function useMaisonChat({ enabled, maisonId, suspended = false, currentUser = "" }: MaisonChatOptions): MaisonChatState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  // Distinct maison error state (never tavern copy — see `maison.*` keys).
  const [maisonError, setMaisonError] = useState<string | null>(null);
  const [maisonErrorKind, setMaisonErrorKind] = useState<MaisonErrorKind | null>(null);
  // Manual-retry trigger: bumping it re-runs the gated dial effect below,
  // reusing the exact dial path (generation bump + outfit fetch +
  // maisonConnect + watchdog) instead of forking a second one.
  const [retrySeq, setRetrySeq] = useState(0);
  // Generation guard against cross-room races: every
  // [enabled, maisonId] change mints a fresh generation id, and only the
  // currently armed generation's events are honored — frames from a prior
  // generation's dial are stale.
  const generationRef = useRef(0);
  // Generation currently awaiting its first ack (0 = none armed). While
  // non-zero, in-flight `maison*` roster/message frames are stale by
  // definition (same role as useTaverne's awaitingFreshRef, keyed by
  // generation instead of a bare boolean), and only the lieu-matched
  // `ws-connected` for this generation disarms it. `maisonInit` is exempt:
  // it is room-scoped init evidence (only a maison dial produces it), so it
  // marks init-seen even while the ack is still in flight.
  const pendingGenRef = useRef(0);
  // Ref mirrors for the single-subscription socket handler.
  const enabledRef = useRef(enabled);
  const suspendedRef = useRef(suspended);
  const maisonIdRef = useRef<number | null>(maisonId);
  const currentUserRef = useRef(currentUser);
  const presentKeysRef = useRef<Set<string>>(new Set());
  // Person-id → login key mirror for `disconnect` payloads (which carry the
  // numeric person id, not the login).
  const idToLoginRef = useRef<Map<string, string>>(new Map());
  // connectMe watchdog: set while waiting for the roster, cleared on the
  // first maisonInfosPersonnages frame. Refs (not state) so the []-deps
  // socket handler can observe and clear the timer.
  const gotRosterRef = useRef(false);
  // Room-init seen (maisonInit): with gotRosterRef classifies an abnormal
  // close as a drop of a joined room vs a pre-join failure (watchdog-owned).
  const gotInitRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  useEffect(() => {
    maisonIdRef.current = maisonId;
  }, [maisonId]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

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
    if (presentKeysRef.current.size >= MAX_MAISON_USERS) return;
    presentKeysRef.current.add(key);
    setOnlineUsers((prev) => {
      if (prev.some((u) => u.toLowerCase() === key)) return prev;
      if (prev.length >= MAX_MAISON_USERS) return prev;
      return [...prev, disp];
    });
  };

  const removeUser = (login: string) => {
    const key = loginKey(login);
    if (!key) return;
    presentKeysRef.current.delete(key);
    setOnlineUsers((prev) => prev.filter((u) => u.toLowerCase() !== key));
  };

  // (Re)connect whenever the house target changes; reset on disarm.
  // Disarm (leave, logout, suspend) clears messages + presence + error
  // silently and bumps the generation so an in-flight outfit fetch + dial
  // is cancelled.
  useEffect(() => {
    if (!enabled || maisonId == null || suspended) {
      generationRef.current += 1; // invalidate any prior generation
      pendingGenRef.current = 0;
      gotRosterRef.current = false;
      gotInitRef.current = false;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      presentKeysRef.current.clear();
      idToLoginRef.current.clear();
      setOnlineUsers([]);
      setMessages([]);
      setIsConnected(false);
      setMaisonError(null);
      setMaisonErrorKind(null);
      return;
    }
    const gen = generationRef.current + 1;
    generationRef.current = gen;
    pendingGenRef.current = gen;
    gotRosterRef.current = false;
    gotInitRef.current = false;
    presentKeysRef.current.clear();
    idToLoginRef.current.clear();
    setOnlineUsers([]);
    setMessages([]);
    setIsConnected(false);
    setMaisonError(null);
    setMaisonErrorKind(null);
    // House dial carries the per-user outfit for changeSalon: fetch it
    // first (same client session), tolerating a missing command or any
    // failure as undefined (backend sends `{}`). Never block the dial on a
    // vetements failure; the generation guard still applies at dial time.
    api.getPlayerVetements().catch(() => undefined).then((vetements) => {
      // Generation-cancel: a disarm/suspend bumped the generation while the
      // outfit fetch was in flight — never dial stale.
      if (generationRef.current !== gen) return;
      if (suspendedRef.current) return;
      api.maisonConnect(maisonId, vetements ?? undefined).catch(() => {});
    });
    // Watchdog: no roster within the window => unverified, not empty.
    // Clears any stale presence and surfaces an explicit error so the UI
    // never shows a silent "nobody here".
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      // Prior-generation watchdog: a re-arm/disarm since this timer was
      // set means fresher state owns the roster — stay out.
      if (generationRef.current !== gen || pendingGenRef.current !== gen) return;
      if (gotRosterRef.current) return;
      if (!enabledRef.current) return;
      presentKeysRef.current.clear();
      idToLoginRef.current.clear();
      setOnlineUsers([]);
      setIsConnected(false);
      // Maison roster failure with maison copy + kind — never labeled as
      // a tavern error.
      setMaisonError(t("maison.rosterFailed"));
      setMaisonErrorKind("roster-failed");
    }, MAISON_CONNECTME_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // retrySeq re-runs this exact gated dial path for manual retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, maisonId, suspended, retrySeq]);

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
      setMaisonError(null);
      setMaisonErrorKind(null);
      setIsConnected(true);
    };

    const pushMessage = (login: string, serverType: unknown, content: unknown) => {
      if (typeof content !== "string") return;
      if (!isValidLogin(login)) return;
      addUser(login);
      const nowIso = new Date().toISOString();
      const nowTime = new Date().toLocaleTimeString();
      const selfLower = loginKey(currentUserRef.current);
      if (selfLower && loginKey(login) !== selfLower) playMessageSound();
      const newMsg: ChatMessage = {
        id: crypto.randomUUID(),
        type: maisonMsgType(serverType),
        login: displayLogin(login),
        content,
        timestamp: nowTime,
        created_at: nowIso,
      };
      setMessages((prev) => [...prev.slice(-MSG_HISTORY_LIMIT), newMsg]);
    };

    const handleMessage = (e: { payload: string }) => {
      if (disposed) return;
      if (!enabledRef.current || suspendedRef.current || maisonIdRef.current == null) return;
      const raw = e.payload;
      if (!raw.startsWith("42[")) return;
      try {
        const data = JSON.parse(raw.substring(2)) as unknown[];
        const eventName = data[0] as string;

        if (eventName === "maisonInit") {
          // Room-init evidence (exempt from the pending-ack guard — see
          // pendingGenRef docs). Clears a watchdog error that fired early
          // on a slow roster; the roster watchdog itself keeps running.
          gotInitRef.current = true;
          setMaisonError(null);
          setMaisonErrorKind(null);
          return;
        }

        if (eventName === "maisonInfosPersonnages") {
          if (pendingGenRef.current !== 0) return;
          markRoster();
          const sub = data[1];
          if (sub === "connectMe" && data.length >= 3 && typeof data[2] === "object" && data[2] !== null) {
            const mapObj = data[2] as Record<string, unknown>;
            const seen = new Map<string, string>();
            const idMap = new Map<string, string>();
            for (const k of Object.keys(mapObj)) {
              const login = maisonEntryLogin(mapObj[k]);
              if (!login) continue;
              const lk = loginKey(login);
              if (!seen.has(lk)) seen.set(lk, displayLogin(login));
              if (!idMap.has(k)) idMap.set(k, lk);
            }
            // Variants: possible {login,...} objects in following args
            // (trailing "normal"|<etat> strings are ignored).
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
            const keys = [...seen.keys()].slice(0, MAX_MAISON_USERS);
            presentKeysRef.current = new Set(keys);
            idToLoginRef.current = idMap;
            setOnlineUsers(keys.map((k) => seen.get(k) as string));
            // Self may be missing when alone (empty connectMe) — always show.
            const selfLogin = currentUserRef.current.trim();
            if (selfLogin && isValidLogin(selfLogin)) {
              const sk = loginKey(selfLogin);
              if (keys.indexOf(sk) === -1) {
                presentKeysRef.current.add(sk);
                setOnlineUsers((prev) => {
                  const next = [...prev];
                  const disp = displayLogin(selfLogin);
                  if (!next.some((u) => u.toLowerCase() === sk)) next.push(disp);
                  return next;
                });
              }
            }
          } else if (sub === "connect" && data.length >= 3) {
            const consider = (idHint: string | null, o: Record<string, unknown>) => {
              if (typeof o.login !== "string") return;
              if (!isValidLogin(o.login)) return;
              const lk = loginKey(o.login);
              // Record the person-id → login mapping for later disconnects.
              const rawKey = o.key;
              const idStr =
                idHint ??
                (typeof rawKey === "string" ? rawKey : typeof rawKey === "number" ? String(rawKey) : null);
              if (idStr !== null) idToLoginRef.current.set(idStr, lk);
              addUser(o.login);
            };
            const second = data[2];
            if (second && typeof second === "object" && !Array.isArray(second)) {
              const o2 = second as Record<string, unknown>;
              if (typeof o2.login === "string") {
                consider(null, o2);
              } else {
                // Map-shaped single (or few): keys are person ids.
                for (const k of Object.keys(o2)) {
                  const login = maisonEntryLogin(o2[k]);
                  if (login) {
                    idToLoginRef.current.set(k, loginKey(login));
                    addUser(login);
                  }
                }
              }
            }
            for (let i = 3; i < data.length; i++) {
              const v = data[i];
              if (v && typeof v === "object" && !Array.isArray(v)) {
                consider(null, v as Record<string, unknown>);
              }
            }
          } else if (sub === "disconnect" && data.length >= 3) {
            // Payload is the person id (numeric or numeric-string), not the
            // login — resolve through the roster mirror, falling back to a
            // direct login removal when the payload already looks like one.
            const resolve = (v: unknown) => {
              const idStr = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
              if (idStr === null) return;
              const mapped = idToLoginRef.current.get(idStr);
              if (mapped) {
                idToLoginRef.current.delete(idStr);
                removeUser(mapped);
              } else if (isValidLogin(idStr) && /[a-zA-Z]/.test(idStr)) {
                removeUser(idStr);
              }
            };
            resolve(data[2]);
            for (let i = 3; i < data.length; i++) resolve(data[i]);
          }
          return;
        }

        if (eventName === "maisonMessage") {
          if (pendingGenRef.current !== 0) return;
          // 42["maisonMessage",date,idMessage,idPersonnage,login,type,message]
          if (data.length < 7) return;
          const login = data[4];
          if (typeof login !== "string") return;
          // Self echoes arrive too — display all, sound only for others.
          pushMessage(login, data[5], data[6]);
          return;
        }
        // Everything else (ville/taverne frames, bare connect/disconnect):
        // not ours.
        return;
      } catch {}
    };

    listen<string>("ws-message", handleMessage).then((un) => track(un));
    listen<string>("ws-connected", (e) => {
      if (disposed) return;
      if (!enabledRef.current || suspendedRef.current || maisonIdRef.current == null) return;
      // Lieu-specific ack: only the maison dial's message disarms the
      // guard — a tavern/village `ws-connected` on the shared socket must
      // not bless a pending maison roster. (A prior generation's maison
      // connect is wire-indistinguishable — no maison id in the payload —
      // so the newest arming wins: any matched connect acks the pending one.)
      if (e.payload !== MAISON_CONNECTED_MSG) return;
      pendingGenRef.current = 0;
      // Socket is up but the roster may still be on its way — keep the
      // watchdog running until the first maisonInfosPersonnages frame.
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
      const hadRoom = gotRosterRef.current || gotInitRef.current;
      setIsConnected(false);
      presentKeysRef.current.clear();
      idToLoginRef.current.clear();
      setOnlineUsers([]);
      if (payload === WS_CLOSE_VOLUNTARY) {
        setMessages([]);
        setMaisonError(null);
        setMaisonErrorKind(null);
        return;
      }
      // Abnormal drop after joining the room (roster or init seen):
      // explicit maison error with maison copy (never tavern copy). Before
      // any room evidence the watchdog owns the message — stay silent here
      // so the two never fight. History is kept so a retry resumes context.
      if (hadRoom) {
        setMaisonError(t("maison.dropped"));
        setMaisonErrorKind("dropped");
      }
    }).then((u) => track(u));

    return () => {
      disposed = true;
      for (const u of unsubs) u();
    };
    // Mount-pattern: single subscription, refs mirror latest props.
    // addUser/removeUser are stable-by-ref usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual maison re-dial (headless entry point for the later UI lane).
  // Clears the error/kind and bumps retrySeq so the gated dial effect above
  // runs its exact path again (generation bump + outfit fetch +
  // maisonConnect + watchdog); the backend single-flight
  // (teardown-before-dial, gen-guarded latest-wins, duplicate swallow)
  // keeps a double-click to one socket. No-ops while disabled or a
  // transition is in flight (suspended) — a maison retry must never steal
  // the shared socket from another room's dial.
  const retryMaison = (): void => {
    if (!enabledRef.current || suspendedRef.current || maisonIdRef.current == null) return;
    setMaisonError(null);
    setMaisonErrorKind(null);
    setRetrySeq((s) => s + 1);
  };

  const sendMaison = (msgType: string, message: string): Promise<void> =>
    api.maisonSend(msgType, message);

  return {
    maisonId,
    messages,
    onlineUsers,
    onlineCount: onlineUsers.length,
    isConnected,
    error: maisonError,
    maisonError,
    maisonErrorKind,
    retryMaison,
    sendMaison,
  };
}
