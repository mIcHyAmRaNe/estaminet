import { useState, useEffect, useRef } from "preact/hooks";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../api/tauri";
import { t } from "../i18n";
import { playMessageSound } from "../utils/sound";
import type { ChatMessage, TavernMenus, TavernMenuItem, TourneeInfo, EcusPulse } from "../types";
import {
  PLACE_RESERVED_DEFAULT,
  AUTO_QUIET_MS,
  AUTO_MAX_MS,
  AUTO_MAX_ATTEMPTS,
  ERROR_TTL_MS,
  FLOOD_MUTE_MS,
  MSG_HISTORY_LIMIT,
  WS_RECONNECT_DELAY_MS,
  WS_CLOSE_VOLUNTARY,
  TAVERN_CONNECTED_MSG,
  WS_CLOSE_ROOM_REJECTED,
  DEFAULT_PLACES,
  MAX_PLACES,
  WHISPER_DEDUP_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_MAX_DELAY_MS,
  ECUS_PULSE_MS,
  PORTRAIT_WARN_TTL_MS,
} from "../config";
import { loginKey, displayLogin } from "../utils/login-utils";

function isValidLogin(login: string): boolean {
  const clean = login.trim();
  if (!clean || clean.length > 40 || /[\s\/"]/.test(clean)) return false;
  return true;
}

// Bare login in place events: unicode letters accepted
// (accents, cedillas…) — the old [A-Za-z] class rejected accented names
// and the seat was treated as empty.
const PLACE_LOGIN_RE = /^[\p{L}0-9_\-]+$/u;

type Placement = { disp: string; key: string; idx: number };

// Shared seat merge: move=false fills only empty slots without moving
// already-placed logins (connectMe / taverneInit); move=true frees the old
// slot and overrides the target (incremental connect = authoritative).
function mergePlacements(prev: (string | null)[], placements: Placement[], opts: { move: boolean }): (string | null)[] {
  const next = [...prev];
  let maxIdx = next.length - 1;
  for (const p of placements) if (p.idx > maxIdx) maxIdx = p.idx;
  while (next.length <= maxIdx) next.push(null);
  for (const p of placements) {
    if (p.idx < 0 || p.idx >= next.length) continue;
    const already = next.findIndex((x) => x !== null && x.toLowerCase() === p.key);
    if (opts.move) {
      if (already !== -1 && already !== p.idx) next[already] = null;
      next[p.idx] = p.disp;
    } else {
      if (already !== -1) {
        if (already === p.idx && next[already] !== p.disp) next[already] = p.disp;
        continue;
      }
      if (next[p.idx] !== null) continue;
      next[p.idx] = p.disp;
    }
  }
  return next;
}

function extractPlaceIndex(o: Record<string, unknown>): number | null {  const candidates = [o.place, o.idPlace, o.position];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isInteger(c) && c >= 0 && c < 10) return c;
    if (typeof c === "string" && c.trim() !== "") {
      const n = Number(c.trim());
      if (Number.isInteger(n) && n >= 0 && n < 10) return n;
    }
  }
  return null;
}


// Lane F1 — numeric payload field (server sometimes sends numbers as strings).
function numField(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Lane F3 — boolean-ish payload field (accepteAlcool arrives as boolean,
// sometimes as 0/1 or "0"/"1"). Null when unrecognised (leave state alone).
function boolField(v: unknown): boolean | null {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (v === false || v === 0 || v === "0" || v === "false") return false;
  return null;
}

// Lane F1 — taverneMajMenus item: { nom, prix (centimes), ingredients: item ids }.
// Ingredient ids are numeric (resolved server-side via getNomItem, which we
// don't have) — rendered as-is when numeric, verbatim when already strings.
function parseTavernMenuItem(raw: unknown, id: number): TavernMenuItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.nom !== "string" || !o.nom) return null;
  const prix = numField(o.prix);
  if (prix === null) return null;
  const ingredients: string[] = [];
  if (Array.isArray(o.ingredients)) {
    for (const ing of o.ingredients) {
      if (typeof ing === "number" && ing > 0) ingredients.push(String(ing));
      else if (typeof ing === "string" && ing) ingredients.push(ing);
    }
  }
  return { id, nom: o.nom, prix, ingredients };
}

// Lane F1 — taverneMajMenus(infos) with
//   infos = { menuBoisson?: { prix }, menu0?: {...}, menu1?: {...} }.
function parseTavernMenus(infos: Record<string, unknown>): TavernMenus {
  const plats: TavernMenuItem[] = [];
  const m0 = parseTavernMenuItem(infos.menu0, 0);
  if (m0) plats.push(m0);
  const m1 = parseTavernMenuItem(infos.menu1, 1);
  if (m1) plats.push(m1);
  let boissonPrix: number | null = null;
  const b = infos.menuBoisson;
  if (b && typeof b === "object" && !Array.isArray(b)) {
    boissonPrix = numField((b as Record<string, unknown>).prix);
  }
  return { plats, boissonPrix };
}

// Lane F1 — complete taverneErreur mapping (official chatTaverne.js switch).
// PlaceReserve / PlaceDejaPrise are handled by the caller (seat retry logic).
function mapTaverneError(err: unknown, parametre: unknown, selfDisp: string): string {
  switch (err) {
    case "MenuVide":
      return t("tavernErr.emptyPlate");
    case "PasAssezArgent":
      return t("tavernErr.notEnoughMoney");
    case "TropRapideConsoAlcool":
      return t("tavernErr.tooFastAlcohol");
    case "MenuEpuise":
      return t("tavernErr.ingredientMissing", { ingredient: String(parametre ?? "?") });
    case "PersonnageIntrouvable":
      return t("tavernErr.personNotFound");
    case "PersonnageNonbanni":
      return t("tavernErr.personNotBanned");
    case "PasAutoKick":
      return t("tavernErr.noSelfKick");
    case "PasAutoBan":
      return t("tavernErr.noSelfBan");
    case "RefuseAlcool": {
      const who = typeof parametre === "string" && parametre.trim() ? displayLogin(parametre) : null;
      return who
        ? t("tavernErr.refusesAlcohol", { user: who })
        : t("tavernErr.refusesAlcoholGeneric");
    }
    case "PersonneNeBoitIci":
      return t("tavernErr.nobodyDrinks");
    case "PlusDePlace":
      return t("tavernErr.noRoom");
    case "BadCommand":
      return t("tavernErr.badCommand");
    case "CommandeMenuDejaMange":
      return t("tavernErr.menuAlreadyEaten", { user: selfDisp });
    default:
      return t("error.generic", { err: String(err) });
  }
}

// Distinct tavern connection error kind (headless — designer-owned retry
// buttons consume `errorKind` + `retryTavern()`):
// - "room-rejected": pre-init close (handshake 41, room-rejected payload,
//   any close before taverneInit) — terminal, manual retry only.
// - "dropped": post-init drop — the backoff auto-reconnect keeps running
//   AND a manual retry is offered (same surfacing error text).
// - null: no tavern connection error.
// Village roster failures never touch this: they are village errors
// (`villageError`/`villageErrorKind` in useVillagePresence, `village.*`
// copy) — a village failure is never labeled as a tavern error.
export type TavernErrorKind = "room-rejected" | "dropped";
function isRoomRejectedPayload(payload: string): boolean {
  if (payload === WS_CLOSE_ROOM_REJECTED) return true;
  const low = payload.toLowerCase();
  return (
    low.includes("room-rejected") ||
    low.includes("room rejected") ||
    low.includes("taverne ferm") ||
    low.includes("tavern closed") ||
    low.includes("accès refus") ||
    low.includes("acces refus")
  );
}

// Friendly terminal room error (taverne fermée / accès refusé) — i18n
// `tavern.roomRejected`. Village roster failures never use this key (they
// use `village.*`, see useVillagePresence).
function roomRejectedMessage(): string {
  return t("tavern.roomRejected");
}

// Post-init drop notice (the backoff auto-reconnect continues underneath;
// retryTavern() offers the manual path) — i18n `tavern.dropped`.
function tavernDroppedMessage(): string {
  return t("tavern.dropped");
}

export function useTaverne(username: string, idLieu: number, tavernPlaces?: number, isTavernPhase = true) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [presentUsers, setPresentUsers] = useState<string[]>([]);
  const [totalPlaces, setTotalPlaces] = useState(tavernPlaces ?? DEFAULT_PLACES);
  const [places, setPlaces] = useState<(string | null)[]>(() => Array(tavernPlaces ?? DEFAULT_PLACES).fill(null));
  const [selectedPlace, setSelectedPlace] = useState<number | null>(null);
  const [lastPlaceAttempt, setLastPlaceAttempt] = useState<number | null>(null);
  const lastPlaceRef = useRef<number | null>(null);
  const [error, setError] = useState("");
  // Distinct tavern connection error kind — set alongside `error` by the
  // ws-closed / ws-connected paths below (`room-rejected` = pre-init/41
  // terminal, `dropped` = post-init). Cleared with the message.
  const [errorKind, setErrorKind] = useState<TavernErrorKind | null>(null);
  const [status, setStatus] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const reservedRef = useRef<Set<number>>(new Set(PLACE_RESERVED_DEFAULT));
  const autoSeat = useRef<{ pending: boolean; attempts: number; quietTimer: ReturnType<typeof setTimeout> | null; maxTimer: ReturnType<typeof setTimeout> | null }>({ pending: false, attempts: 0, quietTimer: null, maxTimer: null });

  // Mirror of the official JS `_estEntre`: the "enters the tavern" message
  // for yourself is only shown once per connection.
  const enteredSelfRef = useRef(false);
  // Whisper deduplication: full and short forms can both arrive for the
  // same message — display only one bubble/notice.
  const whisperBubbleSeenRef = useRef<Map<string, number>>(new Map());
  const whisperNoticeRef = useRef<Map<string, string>>(new Map());
  // Auto-reconnect with backoff, stopped on first success.
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Manual-retry single-flight: double-clicking the retry button must not
  // open two sockets (backend latest-wins would swallow the duplicate, but
  // the local reset must run once).
  const retryInFlightRef = useRef(false);
  // Room-ready gate: set on the first fresh `taverneInit`, reset per
  // connection ([idLieu], tavern ws-connected, any ws-closed). The backoff
  // reconnect runs ONLY for drops after init; pre-init closes (handshake
  // 41, early server close, room-rejected) are terminal with no retry.
  const taverneInitSeenRef = useRef(false);
  // Cross-tavern race guard: armed on idLieu change, disarmed on the next
  // ws-connected. While armed, in-flight ws-message events from the old
  // tavern are ignored (the backend sends no tavern ID in 42[...] frames,
  // payload filtering is impossible).
  // Not armed on unexpected ws-closed: micro-drop + same-tavern auto
  // reconnect preserves history; only pre-reconnect stragglers are filtered
  // via the idLieu/ws-connected cycle and explicit clears.
  const awaitingFreshRef = useRef(false);
  // Ref mirrors (avoid re-subscriptions on re-renders / totalPlaces).
  const isConnectedRef = useRef(false);
  const totalPlacesRef = useRef(totalPlaces);
  const usernameRef = useRef(username);
  const idLieuRef = useRef(idLieu);
  // Tavern-phase gate: the hook mounts unconditionally (App always renders
  // it, even in the village picker/preview), but the shared socket fires
  // ws-connected for villageConnect too. Auto-seat must only arm/fire while
  // the tavern room owns the session — otherwise a village preview leaks
  // 42["taverneChangePlace",…]. Mirrored in a ref (single-flight listener).
  const isTavernPhaseRef = useRef(isTavernPhase);
  // Presence mirror for synchronous "already present" tests inside the
  // single-flight socket handler (state setters batch across events in
  // the same tick, refs don't). Kept in sync inside addPresent /
  // removePresent, the silent connectMe rebuild and every clear.
  const presentKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    lastPlaceRef.current = lastPlaceAttempt;
  }, [lastPlaceAttempt]);

  useEffect(() => {
    totalPlacesRef.current = totalPlaces;
  }, [totalPlaces]);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    idLieuRef.current = idLieu;
  }, [idLieu]);

  useEffect(() => {
    isTavernPhaseRef.current = isTavernPhase;
    // Leaving the room phase must never leave a stale seat attempt armed:
    // a quiet/max timer scheduled while in-room would otherwise fire during
    // the village preview and emit taverneChangePlace.
    if (!isTavernPhase) {
      autoSeat.current.pending = false;
      autoSeat.current.attempts = 0;
      if (autoSeat.current.quietTimer) { clearTimeout(autoSeat.current.quietTimer); autoSeat.current.quietTimer = null; }
      if (autoSeat.current.maxTimer) { clearTimeout(autoSeat.current.maxTimer); autoSeat.current.maxTimer = null; }
    }
  }, [isTavernPhase]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  // Safety net: reconcile the presence mirror from state (covers external
  // resets via the exported setPresentUsers, e.g. Leave-room cleanup).
  // No-op when already in agreement with the eager updates above.
  useEffect(() => {
    presentKeysRef.current = new Set(presentUsers.map((u) => u.toLowerCase()));
  }, [presentUsers]);

  const placesRef = useRef<(string | null)[]>(places);
  useEffect(() => {
    placesRef.current = places;
  }, [places]);

  // Sticky auto-expand: whenever a placement at idx 8 or 9 is seen, the
  // tavern really has MAX_PLACES seats — bump totalPlaces (drives ChatRoom
  // TOTAL_SEATS) and pad places[] so seats 8/9 render instead of staying
  // invisible. Sticky: never shrinks back (see the [tavernPlaces] guard).
  // Ref-based + stable setters only, safe to call from the socket handler.
  const expandForPlace = (idx: number) => {
    if ((idx === 8 || idx === 9) && totalPlacesRef.current < MAX_PLACES) {
      totalPlacesRef.current = MAX_PLACES;
      setTotalPlaces(MAX_PLACES);
      setPlaces((prev) => {
        if (prev.length >= MAX_PLACES) return prev;
        const n = [...prev];
        while (n.length < MAX_PLACES) n.push(null);
        return n;
      });
    }
  };

  useEffect(() => {
    // Tavern change: explicit clear (42[...] frames carry no tavern ID)
    // + arming the race guard until the next ws-connected of the new tavern.
    awaitingFreshRef.current = true;
    taverneInitSeenRef.current = false;
    // Fresh room, fresh error state: a stale terminal/dropped error + kind
    // from the previous tavern must not linger (the next ws-connected or a
    // terminal close sets its own).
    setError("");
    setErrorKind(null);
    // Fixed size: DEFAULT_PLACES overridable via taverns.json `places`.
    const n = tavernPlaces ?? DEFAULT_PLACES;
    setPlaces(Array(n).fill(null));
    setTotalPlaces(n);
    setSelectedPlace(null);
    setMessages([]);
    setPresentUsers([]);
    presentKeysRef.current.clear();
    setTypingUsers([]);
    enteredSelfRef.current = false;
    setLieu(null);
    whisperBubbleSeenRef.current.clear();
    whisperNoticeRef.current.clear();
    // Reset place without breaking auto-seat: the pending flag is re-armed
    // on each ws-connected (armAutoSeat), never inherited from the old tavern.
    setLastPlaceAttempt(null);
    lastPlaceRef.current = null;
  }, [idLieu]);

  useEffect(() => {
    const n = tavernPlaces ?? DEFAULT_PLACES;
    // Sticky 10: a late tavern-list sync must not shrink 10→8 while seats
    // 8/9 are occupied (or already expanded) — that would hide occupants.
    // The [idLieu] reset above stays authoritative on tavern switch.
    const keepTen =
      placesRef.current[8] != null ||
      placesRef.current[9] != null ||
      totalPlacesRef.current === MAX_PLACES;
    const next = keepTen ? Math.max(n, MAX_PLACES) : n;
    setTotalPlaces(next);
    setPlaces(Array(next).fill(null));
  }, [tavernPlaces]);

  const addPresent = (login: string) => {
    if (!isValidLogin(login)) return;
    const clean = login.trim();
    const key = loginKey(clean);
    const disp = displayLogin(clean);
    presentKeysRef.current.add(key);
    setPresentUsers((prev) => {
      const idx = prev.findIndex((u) => u.toLowerCase() === key);
      if (idx !== -1) {
        if (prev[idx] === disp) return prev;
        const next = [...prev];
        next[idx] = disp;
        return next;
      }
      return [...prev, disp];
    });
  };

  const removePresent = (login: string) => {
    const key = loginKey(login);
    if (!key) return;
    presentKeysRef.current.delete(key);
    setPresentUsers((prev) => prev.filter((u) => u.toLowerCase() !== key));
    setPlaces((prev) => prev.map((p) => (p !== null && p.toLowerCase() === key ? null : p)));
  };

  // Typing reception: lowercase logins currently composing (self excluded).
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  // Tavern ground type (e.g. "eglise"): drives the reserved-seat status icons in ChatRoom. Null = unset.
  const [lieu, setLieu] = useState<string | null>(null);

  // Lane F1 — social/economy state.
  const [menus, setMenus] = useState<TavernMenus>({ plats: [], boissonPrix: null });
  // Écus balance (argent centimes / 100). Authoritative source is
  // taverneMajPerso infos.argent (taverneInit carries no purse in the
  // official bundle — read defensively there too). Null = unknown yet.
  const [ecus, setEcus] = useState<number | null>(null);
  const [ecusPulse, setEcusPulse] = useState<EcusPulse | null>(null);
  // Drunkenness level (taverneChangeTauxAlcool + taverneMajPerso infos.alcool).
  // Official bundle scale is ~0..20 (blurWithAlcool: effect >= 10, cap 20),
  // NOT 0..1 — the header maps it to a percent (rate / 20).
  const [alcoolRate, setAlcoolRate] = useState<number | null>(null);
  // Lane F3 — alcohol consent (official checkbox #chatMenuInputAccepteAlcool):
  // self state from taverneInit / taverneMajPerso infos.accepteAlcool +
  // taverneAccepteAlcool broadcast when it concerns us. Null = unknown yet.
  const [accepteAlcool, setAccepteAlcool] = useState<boolean | null>(null);
  // Tisane rules: per-player alcohol consent (keys = lowercased login).
  // Filled from taverneAccepteAlcool broadcasts (self + others); a missing
  // key means unknown → assume accepts (tisane labels + écus guards).
  const [alcoolByLogin, setAlcoolByLogin] = useState<Record<string, boolean>>({});
  // Ref mirrors for the single-flight socket handler (state is stale in its
  // closure — same pattern as ecusRef). Updated synchronously with the state.
  const alcoolByLoginRef = useRef<Record<string, boolean>>({});
  const accepteAlcoolRef = useRef<boolean | null>(null);

  useEffect(() => {
    accepteAlcoolRef.current = accepteAlcool;
  }, [accepteAlcool]);
  // Tournée générale overlay payload — auto-dismissed by the view (~5s).
  const [tournee, setTournee] = useState<TourneeInfo | null>(null);
  // Fatal moderation flags (taverneKick / taverneBan) — rendered as blocking
  // overlays by the view (Lane F3). taverneBanFlood is NOT fatal (official
  // onBanFlood: 30s input mute) → floodMuted instead.
  const [kicked, setKicked] = useState(false);
  const [banned, setBanned] = useState(false);
  // Lane F3 — page-refresh request (taverneRafraichirPage; official
  // onMAJTaverne = location.reload): blocking overlay with a user-gesture
  // "Rafraîchir" button instead of reloading blindly.
  const [needsRefresh, setNeedsRefresh] = useState(false);
  // Lane F3 — flood mute (taverneBanFlood): chat input disabled ~30s.
  const [floodMuted, setFloodMuted] = useState(false);
  const floodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Portrait fallback notice (Rust `portrait-warning` event on ws_connect
  // when the Zoom fetch fails): yellow floating toast (latest-wins, ~6s)
  // + one yellow chat line per fallback source per tavern. Never set on
  // fresh success — the backend emits nothing then.
  const [portraitWarning, setPortraitWarning] = useState<string | null>(null);
  const portraitToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portraitWarnedRef = useRef<Set<string>>(new Set());
  const ecusRef = useRef<number | null>(null);
  const ecusPulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashEcus = (dir: "down" | "up") => {
    if (ecusPulseTimer.current) clearTimeout(ecusPulseTimer.current);
    setEcusPulse({ dir, key: Date.now() });
    ecusPulseTimer.current = setTimeout(() => setEcusPulse(null), ECUS_PULSE_MS);
  };

  const setEcusFromCentimes = (centimes: number) => {
    const next = centimes / 100;
    const prev = ecusRef.current;
    ecusRef.current = next;
    setEcus(next);
    if (prev !== null && next !== prev) flashEcus(next < prev ? "down" : "up");
  };

  // Optimistic purse decrement on self-paid spends (corrected afterwards
  // by the authoritative taverneMajPerso). No-op while ecus is unknown.
  const spendEcus = (prixCentimes: number | null) => {
    if (prixCentimes === null || !(prixCentimes > 0)) return;
    const prev = ecusRef.current;
    if (prev === null) return;
    const next = prev - prixCentimes / 100;
    ecusRef.current = next;
    setEcus(next);
    flashEcus("down");
  };

  const clearTournee = () => setTournee(null);

  const clearSocialState = () => {
    setPortraitWarning(null);
    if (portraitToastTimer.current) {
      clearTimeout(portraitToastTimer.current);
      portraitToastTimer.current = null;
    }
    portraitWarnedRef.current.clear();
    setMenus({ plats: [], boissonPrix: null });
    setEcus(null);
    ecusRef.current = null;
    setEcusPulse(null);
    if (ecusPulseTimer.current) {
      clearTimeout(ecusPulseTimer.current);
      ecusPulseTimer.current = null;
    }
    setAlcoolRate(null);
    setAccepteAlcool(null);
    accepteAlcoolRef.current = null;
    setAlcoolByLogin({});
    alcoolByLoginRef.current = {};
    setTournee(null);
    setKicked(false);
    setBanned(false);
    setNeedsRefresh(false);
    setFloodMuted(false);
    if (floodTimer.current) {
      clearTimeout(floodTimer.current);
      floodTimer.current = null;
    }
  };

  useEffect(() => {
    // Lane F1 — per-tavern social/economy reset (menus/ecus/tournee/flags).
    // Separate from the main idLieu clear above (declared after the helpers).
    clearSocialState();
    // Runs on tavern change only; the helper uses refs + stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idLieu]);

  const addTyping = (login: string) => {
    const key = loginKey(login);
    if (!key) return;
    const selfLower = loginKey(usernameRef.current);
    if (selfLower && key === selfLower) return;
    setTypingUsers((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };

  const removeTyping = (login: string) => {
    const key = loginKey(login);
    if (!key) return;
    setTypingUsers((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : prev));
  };

  useEffect(() => {
    let disposed = false;
    const unsubs: Array<() => void> = [];
    const trackUnlisten = (u: () => void) => {
      if (disposed) u();
      else unsubs.push(u);
    };

    const handleMessage = (e: { payload: string }) => {
      if (disposed) return;
      // Race guard: ignore everything (including place events) until the
      // new tavern has confirmed via ws-connected.
      if (awaitingFreshRef.current) return;
      const raw = e.payload;
      if (!raw.startsWith("42[")) return;
      try {
        const data = JSON.parse(raw.substring(2)) as unknown[];
        const eventName = data[0] as string;

        // Village-phase defense: ville frames belong to useVillagePresence,
        // and bare connect/disconnect while room-less would pollute presence.
        if (eventName === "villeInfosPersonnages") return;
        if ((eventName === "connect" || eventName === "disconnect") && !isConnectedRef.current) return;

        const lower = eventName.toLowerCase();
        if (lower.includes("place")) {
          if (lower.includes("vide")) {
            setPlaces(Array(totalPlacesRef.current).fill(null));
            setSelectedPlace(null);
            armAutoSeat(300);
            return;
          }
          let id: number | null = null;
          let plogin: string | null = null;
          for (let i = 1; i < data.length; i++) {
            const v = data[i] as unknown;
            if (typeof v === "number" && v >= 0 && v < 10) id = v;
            else if (v === null) plogin = null;
            else if (typeof v === "string" && PLACE_LOGIN_RE.test(v)) plogin = v;
            else if (typeof v === "object" && v !== null) {
              const o = v as Record<string, unknown>;
              if (typeof o.idPlace === "number") id = o.idPlace as number;
              if (typeof o.login === "string") plogin = o.login as string;
            }
          }
          // Server echo 2-args: 42["taverneChangePlace",login,place]
          // (login THEN place). Verified conforming — kept as-is.
          if (data.length === 3 && typeof data[1] === "string" && typeof data[2] === "number") {
            plogin = data[1] as string;
            id = data[2] as number;
          }
          if (id !== null) {
            expandForPlace(id);
            if (plogin === null) {
              setPlaces((prev) => {
                const n = [...prev];
                n[id!] = null;
                return n;
              });
            } else {
              const disp = displayLogin(plogin);
              const wantedKey = loginKey(plogin);
              const selfLower = loginKey(usernameRef.current);
              setPlaces((prev) => {
                const n = [...prev];
                while (n.length <= id!) n.push(null);
                const old = n.findIndex((p) => p !== null && p.toLowerCase() === wantedKey);
                if (old !== -1 && old !== id) n[old] = null;
                n[id!] = disp;
                return n;
              });
              addPresent(plogin);
              if (autoSeat.current.pending) {
                if (autoSeat.current.quietTimer) clearTimeout(autoSeat.current.quietTimer);
                autoSeat.current.quietTimer = setTimeout(() => tryAutoSeat(), AUTO_QUIET_MS);
              }
              if (wantedKey === selfLower && selfLower) {
                setSelectedPlace(null);
                setLastPlaceAttempt(null);
                lastPlaceRef.current = null;
                stopAutoSeat();
              }
            }
            return;
          }
        }

        const nowIso = new Date().toISOString();
        const nowTime = new Date().toLocaleTimeString();
        let newMsg: ChatMessage | null = null;

        if (eventName === "taverneDebuteMessage") {
          const rawLogin = data[1];
          if (typeof rawLogin === "string") addTyping(rawLogin);
          return;
        } else if (eventName === "taverneAnnuleMessage") {
          const rawLogin = data[1];
          if (typeof rawLogin === "string") removeTyping(rawLogin);
          return;
        } else if (eventName === "taverneMessage") {
          const login = data[3] as string;
          if (typeof login !== "string") return;
          addPresent(login);
          removeTyping(login);
          const selfLowerMsg = loginKey(usernameRef.current);
          if (selfLowerMsg && loginKey(login) !== selfLowerMsg) playMessageSound();
          newMsg = { id: crypto.randomUUID(), type: "normal", login: displayLogin(login), content: data[4] as string, timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneEmote") {
          const login = data[3] as string;
          if (typeof login !== "string") return;
          addPresent(login);
          removeTyping(login);
          newMsg = { id: crypto.randomUUID(), type: "emote", login: displayLogin(login), content: data[4] as string, timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneEntreTaverne") {
          const login = data[3] as string;
          if (typeof login !== "string") return;
          addPresent(login);
          // Optimistic seat: makes the avatar visible immediately (the
          // AvatarPortrait mount triggers the get_portrait_json fetch) while
          // waiting for the authoritative place (taverneInfosPersonnage
          // "connect" / ChangePlace). Merge without override: already
          // placed → does not move; reserved slot (PLACE_RESERVED_DEFAULT)
          // ignored; bounded by totalPlacesRef; no crash if places[] is
          // empty (extension).
          const dispEntre = displayLogin(login);
          const keyEntre = loginKey(login);
          if (keyEntre) {
            setPlaces((prev) => {
              if (prev.some((p) => p !== null && p.toLowerCase() === keyEntre)) return prev;
              const total = totalPlacesRef.current || prev.length;
              if (total <= 0) return prev;
              const next = [...prev];
              while (next.length < total) next.push(null);
              const reserved = PLACE_RESERVED_DEFAULT as readonly number[];
              let idx = -1;
              for (let i = 0; i < total && i < next.length; i++) {
                if (next[i] === null && !reserved.includes(i)) {
                  idx = i;
                  break;
                }
              }
              if (idx === -1) return prev.length === next.length ? prev : next;
              next[idx] = dispEntre;
              return next;
            });
          }
          // `_estEntre` guard: the entry message for yourself is displayed
          // only once per connection (the double-socket bug received it 2×).
          const selfLower = loginKey(usernameRef.current);
          const loginLower = loginKey(login);
          if (selfLower && loginLower === selfLower) {
            if (enteredSelfRef.current) return;
            enteredSelfRef.current = true;
          }
          newMsg = { id: crypto.randomUUID(), type: "system", content: t("chat.enter", { user: displayLogin(login) }), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneQuitteTaverne") {
          const login = data[3] as string;
          if (typeof login !== "string") return;
          removePresent(login);
          removeTyping(login);
          newMsg = { id: crypto.randomUUID(), type: "system", content: t("chat.leave", { user: displayLogin(login) }), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneQuitteTaverneColere") {
          // Angry leave: same display as a normal leave (payload
          // [date, id, login], login at data[3]).
          const login = data[3] as string;
          if (typeof login !== "string") return;
          removePresent(login);
          removeTyping(login);
          newMsg = { id: crypto.randomUUID(), type: "system", content: t("chat.leave", { user: displayLogin(login) }), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneInfosPersonnage") {
          // Full list: 42["taverneInfosPersonnage","connectMe",{login:{...}}]
          // Keys = logins in original case → rebuilt without case duplicates.
          // Values may carry the place ({place,idPlace,position}) → merged
          // into places[] without overriding places already known via
          // ChangePlace (only empty slots are filled, an already-placed
          // login is never moved).
          const sub = data[1];
          if (sub === "connectMe" && data.length >= 3 && typeof data[2] === "object" && data[2] !== null) {
            const mapObj = data[2] as Record<string, unknown>;
            const seen = new Map<string, string>();
            const placements: Array<{ disp: string; key: string; idx: number }> = [];
            for (const k of Object.keys(mapObj)) {
              if (!isValidLogin(k)) continue;
              const lk = loginKey(k);
              if (!seen.has(lk)) seen.set(lk, displayLogin(k));
              const val = mapObj[k];
              if (val && typeof val === "object" && !Array.isArray(val)) {
                const idx = extractPlaceIndex(val as Record<string, unknown>);
                if (idx !== null) placements.push({ disp: displayLogin(k), key: lk, idx });
              }
            }
            // Variants: possible {login,place,...} objects in following args.
            for (let i = 3; i < data.length; i++) {
              const v = data[i];
              if (v && typeof v === "object" && !Array.isArray(v)) {
                const o = v as Record<string, unknown>;
                if (typeof o.login === "string" && isValidLogin(o.login as string)) {
                  const rawLogin = o.login as string;
                  const lk = loginKey(rawLogin);
                  if (!seen.has(lk)) seen.set(lk, displayLogin(rawLogin));
                  const idx = extractPlaceIndex(o);
                  if (idx !== null) placements.push({ disp: displayLogin(rawLogin), key: lk, idx });
                }
              }
            }
            const selfClean = usernameRef.current.trim();
            if (selfClean && isValidLogin(selfClean)) {
              const sk = loginKey(selfClean);
              if (!seen.has(sk)) seen.set(sk, displayLogin(selfClean));
            }
            setPresentUsers([...seen.values()]);
            presentKeysRef.current = new Set(seen.keys());
            setTypingUsers([]);
            if (placements.length > 0) {
              if (placements.some((p) => p.idx === 8 || p.idx === 9)) expandForPlace(8);
              setPlaces((prev) => mergePlacements(prev, placements, { move: false }));
            }
          } else if (sub === "connect" && data.length >= 3) {
            // Incremental: 42["taverneInfosPersonnage","connect",{login,portrait,place,...}]
            // (place verified in logs: e.g. "place":3). Same merge as
            // connectMe via extractPlaceIndex + addPresent, but WITHOUT
            // rebuilding all presentUsers (single arrival → addPresent).
            // The inline portrait is deliberately ignored: no shared cache
            // here, the AvatarPortrait mount will fetch get_portrait_json
            // via its own cache (no extra fetch here, no blocking). The
            // server placement is authoritative: it fixes the optimistic
            // seat set on taverneEntreTaverne (frees the old slot, overrides
            // the target — the moved player stays visible as "standing").
            const placements: Array<{ disp: string; key: string; idx: number }> = [];
            const consider = (o: Record<string, unknown>) => {
              if (typeof o.login === "string" && isValidLogin(o.login as string)) {
                const rawLogin = o.login as string;
                addPresent(rawLogin);
                const idx = extractPlaceIndex(o);
                if (idx !== null) placements.push({ disp: displayLogin(rawLogin), key: loginKey(rawLogin), idx });
              }
            };
            const second = data[2];
            if (second && typeof second === "object" && !Array.isArray(second)) {
              const o2 = second as Record<string, unknown>;
              if (typeof o2.login === "string") {
                consider(o2);
              } else {
                // Tolerance: {login: {...}} map like connectMe, incremental.
                for (const k of Object.keys(o2)) {
                  if (!isValidLogin(k)) continue;
                  addPresent(k);
                  const v = o2[k];
                  if (v && typeof v === "object" && !Array.isArray(v)) {
                    const idx = extractPlaceIndex(v as Record<string, unknown>);
                    if (idx !== null) placements.push({ disp: displayLogin(k), key: loginKey(k), idx });
                  }
                }
              }
            }
            for (let i = 3; i < data.length; i++) {
              const v = data[i];
              if (v && typeof v === "object" && !Array.isArray(v)) {
                consider(v as Record<string, unknown>);
              }
            }
            if (placements.length > 0) {
              if (placements.some((p) => p.idx === 8 || p.idx === 9)) expandForPlace(8);
              setPlaces((prev) => mergePlacements(prev, placements, { move: true }));
            }
          }
          return;
        } else if (eventName === "connect") {
          // Relayed socket arrival: visible enter only for a valid,
          // non-self login not already present (join-burst duplicates and
          // self stay silent). Same chat.enter text as taverneEntreTaverne.
          const cand = data[1];
          if (typeof cand === "string" && isValidLogin(cand)) {
            const key = loginKey(cand);
            const selfLower = loginKey(usernameRef.current);
            const isSelf = !!selfLower && key === selfLower;
            const already = presentKeysRef.current.has(key);
            addPresent(cand);
            if (!isSelf && !already) {
              newMsg = { id: crypto.randomUUID(), type: "system", content: t("chat.enter", { user: displayLogin(cand) }), timestamp: nowTime, created_at: nowIso };
            } else {
              return;
            }
          } else {
            if (typeof cand === "string" && cand.trim()) addPresent(cand);
            return;
          }
        } else if (eventName === "disconnect") {
          // Relayed socket departure: visible leave only for a valid,
          // non-self login currently present. Same chat.leave text as
          // taverneQuitteTaverne; otherwise silent removal.
          const cand = data[1];
          if (typeof cand !== "string" || !cand.trim()) return;
          const key = loginKey(cand);
          const selfLower = loginKey(usernameRef.current);
          const isSelf = !!selfLower && key === selfLower;
          const wasPresent = presentKeysRef.current.has(key);
          removePresent(cand);
          removeTyping(cand);
          if (!isSelf && wasPresent) {
            newMsg = { id: crypto.randomUUID(), type: "system", content: t("chat.leave", { user: displayLogin(cand) }), timestamp: nowTime, created_at: nowIso };
          } else {
            return;
          }
        } else if (eventName === "taverneInit") {
          // 42["taverneInit",date,{login,portrait,key,place,...}]
          // The payload also carries the place (o.place / o.idPlace /
          // o.position) → fill places[] + presentUsers without overriding
          // places already known via ChangePlace (merge: only empty slots
          // are filled, an already-placed login is never moved).
          // Lane F1 — defensive purse read (official taverneInit carries no
          // argent; the authoritative source is taverneMajPerso).
          const placements: Array<{ disp: string; key: string; idx: number }> = [];
          for (let i = 1; i < data.length; i++) {
            const v = data[i];
            if (v && typeof v === "object" && !Array.isArray(v)) {
              const o = v as Record<string, unknown>;
              const argentInit = numField(o.argent);
              if (argentInit !== null) setEcusFromCentimes(argentInit);
              // Lane F3 — self consent + drunkenness (official onInitTaverne:
              // setAccepteAlcool from infosJoueur; alcool mirrors MajPerso).
              const alcoolInit = numField(o.alcool);
              if (alcoolInit !== null) setAlcoolRate(alcoolInit);
              const aaInit = boolField(o.accepteAlcool);
              if (aaInit !== null) setAccepteAlcool(aaInit);
              if (typeof o.login === "string" && isValidLogin(o.login as string)) {
                const rawLogin = o.login as string;
                addPresent(rawLogin);
                const idx = extractPlaceIndex(o);
                if (idx !== null) {
                  placements.push({ disp: displayLogin(rawLogin), key: loginKey(rawLogin), idx });
                }
              }
            }
          }
          if (placements.length > 0) {
            if (placements.some((p) => p.idx === 8 || p.idx === 9)) expandForPlace(8);
            setPlaces((prev) => mergePlacements(prev, placements, { move: false }));
          }
          // Room proven: drops from here on use the backoff reconnect.
          taverneInitSeenRef.current = true;
          return;
        } else if (eventName === "taverneMessagePrive") {
          // Two forms:
          //  full   42["taverneMessagePrive",date,id,login,target,message,alcool]
          //  short  42["taverneMessagePrive",date,id,login,target] (no message)
          // Both can arrive for the same message → do not duplicate.
          const rawId = data[2];
          const rawFrom = data[3];
          const rawTo = data[4];
          const rawMsg: unknown = data.length >= 6 ? data[5] : undefined;
          if (typeof rawFrom !== "string" || typeof rawTo !== "string") return;
          if (!isValidLogin(rawFrom) || !isValidLogin(rawTo)) return;
          const from = rawFrom.trim();
          const to = rawTo.trim();
          const fromDisp = displayLogin(from);
          const toDisp = displayLogin(to);
          addPresent(from);
          addPresent(to);
          // `message ?? null` guard: only a truthy message yields a bubble.
          // A frame without a message yields just a system notice, never
          // "undefined".
          const msgText: string | null =
            typeof rawMsg === "string" && rawMsg ? rawMsg : null;
          const baseKey = `${String(rawId ?? "")}|${loginKey(from)}|${loginKey(to)}`;
          const nowMs = Date.now();
          // Purge old entries (anti memory-leak).
          if (whisperBubbleSeenRef.current.size > 200) {
            for (const [k, ts] of whisperBubbleSeenRef.current) {
              if (nowMs - ts > WHISPER_DEDUP_MS) whisperBubbleSeenRef.current.delete(k);
            }
          }
          if (msgText) {
            const fullKey = `${baseKey}|${msgText}`;
            const last = whisperBubbleSeenRef.current.get(fullKey);
            if (last !== undefined && nowMs - last < WHISPER_DEDUP_MS) return;
            whisperBubbleSeenRef.current.set(fullKey, nowMs);
            // Upgrade: if the short form already created a notice for this
            // same message, remove it to keep only the bubble.
            const noticeId = whisperNoticeRef.current.get(baseKey);
            if (noticeId) {
              whisperNoticeRef.current.delete(baseKey);
              setMessages((prev) => prev.filter((m) => m.id !== noticeId));
            }
            newMsg = {
              id: crypto.randomUUID(),
              type: "whisper",
              login: fromDisp,
              whisperTarget: toDisp,
              content: msgText,
              timestamp: nowTime,
              created_at: nowIso,
            };
            // Full-form whisper targeting self from someone else: chime.
            const selfLowerWhisper = loginKey(usernameRef.current);
            if (selfLowerWhisper && loginKey(to) === selfLowerWhisper && loginKey(from) !== selfLowerWhisper) {
              playMessageSound();
            }
          } else {
            // Short form: system notice "X whispers to Y", no content.
            let hasBubble = false;
            for (const [k, ts] of whisperBubbleSeenRef.current) {
              if (k.startsWith(`${baseKey}|`) && nowMs - ts < WHISPER_DEDUP_MS) {
                hasBubble = true;
                break;
              }
            }
            if (hasBubble) return;
            if (whisperNoticeRef.current.has(baseKey)) return;
            const nid = crypto.randomUUID();
            whisperNoticeRef.current.set(baseKey, nid);
            const bk = baseKey;
            setTimeout(() => {
              whisperNoticeRef.current.delete(bk);
            }, WHISPER_DEDUP_MS);
            newMsg = {
              id: nid,
              type: "system",
              content: t("chat.whisperNotice", { from: fromDisp, to: toDisp }),
              timestamp: nowTime,
              created_at: nowIso,
            };
          }
        } else if (eventName === "taverneMajMenus") {
          // Lane F1 — 42["taverneMajMenus", infos] with
          //   infos = { menuBoisson?: { prix }, menu0?: {...}, menu1?: {...} }.
          const infos = data[1];
          if (infos && typeof infos === "object" && !Array.isArray(infos)) {
            setMenus(parseTavernMenus(infos as Record<string, unknown>));
          }
          return;
        } else if (eventName === "taverneMajPerso") {
          // Lane F1 — authoritative purse update (argent in centimes).
          // This is the écus source (taverneInit carries no purse).
          // Lane F3 — also the alcool + accepteAlcool source (official
          // onMaJPersonnage: setArgent/setAccepteAlcool/setAlcool/blur).
          const infos = data[1];
          if (infos && typeof infos === "object" && !Array.isArray(infos)) {
            const o = infos as Record<string, unknown>;
            const argent = numField(o.argent);
            if (argent !== null) setEcusFromCentimes(argent);
            const alcool = numField(o.alcool);
            if (alcool !== null) setAlcoolRate(alcool);
            const aa = boolField(o.accepteAlcool);
            if (aa !== null) setAccepteAlcool(aa);
          }
          return;
        } else if (eventName === "taverneChangeTauxAlcool") {
          // Lane F1 — 42["taverneChangeTauxAlcool", alcool]: state only.
          const rate = numField(data[1]);
          if (rate !== null) setAlcoolRate(rate);
          return;
        } else if (eventName === "taverneMangeMenu") {
          // Lane F1 — 42["taverneMangeMenu", date, id, login, nomMenu, prix].
          // nomMenu == "alcool" → self-poured drink, else ordered menu item.
          const login = data[3];
          if (typeof login !== "string" || !isValidLogin(login)) return;
          addPresent(login);
          const nomMenu = typeof data[4] === "string" ? data[4] : "";
          const prix = numField(data[5]);
          const selfLowerMeal = loginKey(usernameRef.current);
          // Tisane rules: a self-poured drink is free when self refuses
          // alcohol (tisane); plats always charge. The authoritative
          // taverneMajPerso corrects the balance afterwards.
          if (!!selfLowerMeal && loginKey(login) === selfLowerMeal) {
            const selfRefuses = accepteAlcoolRef.current === false;
            if (!(nomMenu === "alcool" && selfRefuses)) spendEcus(prix);
          }
          if (nomMenu === "alcool") {
            newMsg = { id: crypto.randomUUID(), type: "drink", login: displayLogin(login), content: t("tavern.selfDrink", { user: displayLogin(login) }), timestamp: nowTime, created_at: nowIso };
          } else {
            newMsg = { id: crypto.randomUUID(), type: "meal", login: displayLogin(login), content: t("tavern.orderMenu", { user: displayLogin(login), menu: nomMenu || "?" }), timestamp: nowTime, created_at: nowIso };
          }
        } else if (eventName === "taverneOffreVerre" || eventName === "taverneOffreTisane") {
          // Lane F1 — 42["taverneOffreVerre", date, id, login, loginCible, nomMenu, prix]
          // (taverneOffreTisane: same shape, alcohol declined).
          const login = data[3];
          const cible = data[4];
          if (typeof login !== "string" || typeof cible !== "string") return;
          if (!isValidLogin(login) || !isValidLogin(cible)) return;
          addPresent(login);
          addPresent(cible);
          const prix = numField(data[6]);
          const selfLowerOffer = loginKey(usernameRef.current);
          // Tisane rules: a tisane offer is free — never decrement. A verre
          // offer decrements (price known from the event, corrected later by
          // the authoritative taverneMajPerso), unless the target is known to
          // refuse (defensive: the server answers taverneOffreTisane then).
          const tisane = eventName === "taverneOffreTisane";
          if (!!selfLowerOffer && loginKey(login) === selfLowerOffer && !tisane) {
            const targetRefuses = alcoolByLoginRef.current[loginKey(cible)] === false;
            if (!targetRefuses) spendEcus(prix);
          }
          newMsg = { id: crypto.randomUUID(), type: "drink", login: displayLogin(login), content: t(tisane ? "tavern.offerTisane" : "tavern.offerDrink", { from: displayLogin(login), to: displayLogin(cible) }), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneTourneeGenerale") {
          // Lane F1 — 42["taverneTourneeGenerale", date, id, login, prix]:
          // animated overlay (view auto-dismisses) + chat line.
          const login = data[3];
          if (typeof login !== "string" || !isValidLogin(login)) return;
          addPresent(login);
          const prix = numField(data[4]);
          const selfLowerTournee = loginKey(usernameRef.current);
          if (!!selfLowerTournee && loginKey(login) === selfLowerTournee) spendEcus(prix);
          setTournee({ login: displayLogin(login), key: crypto.randomUUID() });
          newMsg = { id: crypto.randomUUID(), type: "tournee", login: displayLogin(login), content: t("tavern.tournee", { user: displayLogin(login) }), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneAccepteAlcool") {
          // Lane F1 — 42["taverneAccepteAlcool", login, accepter]: info line.
          // Lane F3 — no consent-REQUEST event exists in the official bundle:
          // this frame is a plain acceptance-state broadcast (official
          // onAccepteAlcool updates the self tooltip + presents). Sync our
          // toggle state when the broadcast concerns us; others stay lines.
          const login = data[1];
          if (typeof login !== "string" || !isValidLogin(login)) return;
          const accepter = boolField(data[2]) ?? false;
          // Tisane rules: ALWAYS record the broadcast login in the per-player
          // map (self + others); unknown keys keep meaning "assume accepts".
          const aa = boolField(data[2]);
          if (aa !== null) {
            const key = loginKey(login);
            if (key) {
              alcoolByLoginRef.current = { ...alcoolByLoginRef.current, [key]: aa };
              setAlcoolByLogin(alcoolByLoginRef.current);
            }
          }
          const selfLowerAA = loginKey(usernameRef.current);
          if (selfLowerAA && loginKey(login) === selfLowerAA) {
            if (aa !== null) setAccepteAlcool(aa);
          }
          newMsg = { id: crypto.randomUUID(), type: "system", content: t(accepter ? "tavern.acceptsAlcohol" : "tavern.refusesAlcoholLine", { user: displayLogin(login) }), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneEmoteKick") {
          // Lane F1 — 42["taverneEmoteKick", date, id, login, loginCible].
          // Lane F3 — official renders this via onEmote (login=false, the
          // "Videur" fragment with both actors), so the line is an emote,
          // not a plain system line.
          const login = data[3];
          const cible = data[4];
          if (typeof login !== "string" || typeof cible !== "string") return;
          if (!isValidLogin(login) || !isValidLogin(cible)) return;
          newMsg = { id: crypto.randomUUID(), type: "emote", content: t("tavern.videurKick", { user: displayLogin(login), target: displayLogin(cible) }), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "tavernePersonnageKick" || eventName === "tavernePersonnageBan" || eventName === "tavernePersonnageUnban") {
          // Lane F1 — confirmation that our kick/ban/unban went through
          // (official: afficheMessageErreur). Single login arg (data[1]).
          const login = typeof data[1] === "string" ? data[1] : null;
          const who = login && isValidLogin(login) ? displayLogin(login) : "?";
          const key = eventName === "tavernePersonnageKick" ? "tavern.youKicked" : eventName === "tavernePersonnageBan" ? "tavern.youBanned" : "tavern.youUnbanned";
          newMsg = { id: crypto.randomUUID(), type: "error", content: t(key, { user: who }), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneKick") {
          // Lane F1 — we were kicked: fatal flag (blocking overlay, Lane F3).
          setKicked(true);
          newMsg = { id: crypto.randomUUID(), type: "error", content: t("tavern.kickedSelf"), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneBan") {
          // Lane F1 — we were banned: fatal flag (blocking overlay, Lane F3).
          setBanned(true);
          newMsg = { id: crypto.randomUUID(), type: "error", content: t("tavern.bannedSelf"), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneBanFlood") {
          // Lane F3 — flood is NOT fatal (official onBanFlood: error line +
          // input disabled ~30s with countdown). Mute the input; the view
          // disables the textarea/send while floodMuted.
          if (floodTimer.current) clearTimeout(floodTimer.current);
          setFloodMuted(true);
          floodTimer.current = setTimeout(() => {
            setFloodMuted(false);
            floodTimer.current = null;
          }, FLOOD_MUTE_MS);
          newMsg = { id: crypto.randomUUID(), type: "error", content: t("tavern.banFlood"), timestamp: nowTime, created_at: nowIso };
        } else if (eventName === "taverneRafraichirPage") {
          // Lane F3 — server asks for a page refresh (official onMAJTaverne:
          // location.reload()). No payload; raise the flag and let the view
          // show a blocking overlay with a user-gesture refresh button.
          setNeedsRefresh(true);
          return;
        } else if (eventName === "taverneErreur") {
          const err = data[1] as string;
          if (err === "PlaceReserve" || err === "PlaceDejaPrise") {
            const attempted = lastPlaceRef.current;
            setError(err === "PlaceReserve" ? t("place.reservedError") : t("place.taken"));
            setSelectedPlace(null);
            setLastPlaceAttempt(null);
            lastPlaceRef.current = null;
            if (err === "PlaceReserve" && attempted !== null) reservedRef.current.add(attempted);
            setTimeout(() => setError(""), ERROR_TTL_MS);
            newMsg = { id: crypto.randomUUID(), type: "error", content: err === "PlaceReserve" ? t("place.reservedDenied") : t("place.taken"), timestamp: nowTime, created_at: nowIso };
            if (autoSeat.current.pending) {
              if (autoSeat.current.quietTimer) clearTimeout(autoSeat.current.quietTimer);
              autoSeat.current.quietTimer = setTimeout(() => tryAutoSeat(), 150);
            }
          } else {
            // Lane F1 — complete mapping (official chatTaverne.js switch);
            // parametre is interpolated where the official message uses it.
            const parametre = data[2];
            const selfDisp = usernameRef.current.trim() ? displayLogin(usernameRef.current) : t("chat.you");
            newMsg = { id: crypto.randomUUID(), type: "error", content: mapTaverneError(err, parametre, selfDisp), timestamp: nowTime, created_at: nowIso };
          }
        }

        if (newMsg) {
          setMessages((prev) => {
            const next = [...prev.slice(-MSG_HISTORY_LIMIT), newMsg!];
            const line =
              newMsg!.type === "normal" || newMsg!.type === "whisper"
                ? `${newMsg!.login ?? ""}: ${newMsg!.content ?? ""}`
                : (newMsg!.content ?? "");
            api.saveChatLog(idLieuRef.current, line).catch(() => {});
            return next;
          });
        }
      } catch {}
    };

    function clearAutoTimers() {
      if (autoSeat.current.quietTimer) { clearTimeout(autoSeat.current.quietTimer); autoSeat.current.quietTimer = null; }
      if (autoSeat.current.maxTimer) { clearTimeout(autoSeat.current.maxTimer); autoSeat.current.maxTimer = null; }
    }

    function stopAutoSeat() {
      autoSeat.current.pending = false;
      autoSeat.current.attempts = 0;
      clearAutoTimers();
    }

    function clearReconnectTimer() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function scheduleReconnect() {
      if (disposed) return;
      // No double socket: only reconnect when there is NO live session.
      if (isConnectedRef.current) return;
      if (reconnectAttemptsRef.current >= RECONNECT_MAX_ATTEMPTS) return;
      const attempt = reconnectAttemptsRef.current;
      const delay = Math.min(
        WS_RECONNECT_DELAY_MS * Math.pow(2, attempt),
        RECONNECT_MAX_DELAY_MS,
      );
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        if (disposed || isConnectedRef.current) return;
        api.isConnected().then((live) => {
          if (disposed || live || isConnectedRef.current) return;
          api.wsConnect(idLieuRef.current).catch(() => {
            if (disposed) return;
            reconnectAttemptsRef.current += 1;
            scheduleReconnect();
          });
        }).catch(() => {
          if (disposed) return;
          reconnectAttemptsRef.current += 1;
          scheduleReconnect();
        });
      }, delay);
    }

    function tryAutoSeat() {
      if (disposed || !autoSeat.current.pending || !usernameRef.current) return;
      // Tavern-phase only: never seat from a village-preview socket.
      if (!isTavernPhaseRef.current || idLieuRef.current == null) { stopAutoSeat(); return; }
      const selfLower = loginKey(usernameRef.current);
      const cur = placesRef.current;
      if (cur.some((p) => p !== null && p.toLowerCase() === selfLower)) { stopAutoSeat(); return; }
      const total = totalPlacesRef.current;
      let idx = cur.findIndex((p, i) => i < total && p === null && !reservedRef.current.has(i));
      if (idx === -1) { stopAutoSeat(); setStatus(t("place.full")); return; }
      if (++autoSeat.current.attempts > AUTO_MAX_ATTEMPTS) { stopAutoSeat(); return; }
      setSelectedPlace(idx);
      setLastPlaceAttempt(idx);
      lastPlaceRef.current = idx;
      api.changePlace(idx).catch(() => {
        setSelectedPlace(null);
        setLastPlaceAttempt(null);
        lastPlaceRef.current = null;
      });
    }

    function armAutoSeat(quietDelay = AUTO_QUIET_MS) {
      if (!usernameRef.current) return;
      // Tavern-phase only (see isTavernPhaseRef): arming during a village
      // preview would leak taverneChangePlace on the shared socket. Return
      // before setting pending so a later room entry can arm fresh.
      if (!isTavernPhaseRef.current || idLieuRef.current == null) return;
      // Idempotent: only once per connection. The flag is re-armed on each
      // new ws-connected, never on re-renders.
      if (autoSeat.current.pending) return;
      autoSeat.current.pending = true;
      autoSeat.current.attempts = 0;
      clearAutoTimers();
      autoSeat.current.quietTimer = setTimeout(() => tryAutoSeat(), quietDelay);
      autoSeat.current.maxTimer = setTimeout(() => tryAutoSeat(), AUTO_MAX_MS);
    }

    function resetPresence() {
      setPresentUsers([]);
      presentKeysRef.current.clear();
      setTypingUsers([]);
      setPlaces(Array(totalPlacesRef.current).fill(null));
    }

    listen<string>("ws-message", handleMessage).then((un) => {
      trackUnlisten(un);
    });
    listen<string>("ws-closed", (e) => {
      if (disposed) return;
      // Voluntary close (teardown_session: Leave button / logout): same
      // cleanup as a drop, but NEVER auto-reconnect — the backend session
      // is destroyed, otherwise 5 NotConnected attempts.
      // Room-rejected (distinct backend payload: taverne fermée / accès
      // refusé) or any other close BEFORE taverneInit (handshake 41, early
      // server close): terminal friendly error, NO retry.
      // Only drops AFTER taverneInit use the backoff reconnect. Old generic
      // payloads keep working (compat): pre-init they are terminal,
      // post-init they keep the backoff.
      const payload = e.payload ?? "";
      const voluntary = payload === WS_CLOSE_VOLUNTARY;
      const wasConnected = isConnectedRef.current;
      const hadInit = taverneInitSeenRef.current;
      stopAutoSeat();
      enteredSelfRef.current = false;
      // Never let a stale reconnect timer fire across a close (quit racing
      // a village re-dial with a tavern re-dial = two sockets).
      clearReconnectTimer();
      if (voluntary) {
        setIsConnected(false);
        isConnectedRef.current = false;
        taverneInitSeenRef.current = false;
        reconnectAttemptsRef.current = 0;
        // Next dial must prove fresh: drop stragglers from the torn-down
        // socket (quit-to-picker) until the next tavern ws-connected.
        awaitingFreshRef.current = true;
        resetPresence();
        // Voluntary teardown carries no error and no retry affordance.
        setErrorKind(null);
        return;
      }
      if (isRoomRejectedPayload(payload) || !hadInit) {
        // Terminal: no auto-retry, presence reset like a drop (history kept).
        // Surfaced as a floating auto-dismiss toast in the picker (same
        // transient TTL as other errors): the message self-clears after
        // display so the toast never sticks and never blocks later status
        // toasts. errorKind stays set for retry logic; the next ws-connected
        // / Enter / retryTavern() clears both.
        setIsConnected(false);
        isConnectedRef.current = false;
        taverneInitSeenRef.current = false;
        reconnectAttemptsRef.current = 0;
        resetPresence();
        setError(roomRejectedMessage());
        setErrorKind("room-rejected");
        setTimeout(() => setError(""), ERROR_TTL_MS);
        return;
      }
      const attempted = lastPlaceRef.current;
      const total = totalPlacesRef.current;
      if (attempted !== null && attempted >= total) {
        setError(t("place.invalid", { place: attempted, total }));
        setSelectedPlace(null);
        setLastPlaceAttempt(null);
        lastPlaceRef.current = null;
        setTimeout(() => setError(""), ERROR_TTL_MS);
        // Reconnect with live-session guard + backoff (no double socket).
        if (usernameRef.current && wasConnected) scheduleReconnect();
        return;
      }
      setIsConnected(false);
      isConnectedRef.current = false;
      // Voluntary: no message clear and no guard arming here.
      // Micro-drop + same-tavern auto reconnect = history preserved.
      // The clear + guard live on idLieu change only.
      // The drop surfaces as a tavern error (kind `dropped`) with its retry
      // affordance; the backoff auto-reconnect below keeps running and the
      // next ws-connected clears both.
      setError(tavernDroppedMessage());
      setErrorKind("dropped");
      resetPresence();
      // Auto-reconnect: only on unexpected loss (we were connected), never
      // when no live session is required, with backoff and stop on success
      // (reset on ws-connected).
      if (usernameRef.current && wasConnected) scheduleReconnect();
    }).then((u) => trackUnlisten(u));

    listen<string>("ws-connected", (e) => {
      if (disposed) return;
      // Lieu gate (mirrors useVillagePresence's village gate): the shared
      // socket fires `ws-connected` for village dials too ("Connected to
      // the village") — only the tavern ack may mark the tavern connected,
      // disarm the race guard, or reset reconnect accounting. A village
      // connect previously did all three, corrupting isConnected + backoff.
      if (e.payload !== TAVERN_CONNECTED_MSG) return;
      // New connection: reset guards (never on re-renders) and disarm the
      // race guard — following messages are fresh.
      awaitingFreshRef.current = false;
      enteredSelfRef.current = false;
      taverneInitSeenRef.current = false;
      reconnectAttemptsRef.current = 0;
      clearReconnectTimer();
      stopAutoSeat();
      setIsConnected(true);
      isConnectedRef.current = true;
      setError("");
      setErrorKind(null);
      setStatus(t("status.connected"));
      if (usernameRef.current) {
        addPresent(usernameRef.current);
        // No longer simulating place 0: ask the server for a free, simple seat.
        // Idempotent: armAutoSeat ignores if already pending for this connection.
        // Tavern-phase only: a village-preview ws-connected must not auto-seat.
        if (isTavernPhaseRef.current && idLieuRef.current != null) armAutoSeat();
      }
    }).then((u) => trackUnlisten(u));

    // Portrait fallback (backend `portrait-warning` on ws_connect, payload
    // "cached" | "default"): toast is latest-wins (~6s TTL), the chat line
    // fires once per source per tavern (reconnect bursts refresh the toast
    // without duplicating the line). Local-only notice, not saved to the log.
    listen<string>("portrait-warning", (e) => {
      if (disposed) return;
      const source = e.payload === "default" ? "default" : "cached";
      const text = t(source === "default" ? "portrait.warnDefault" : "portrait.warnCached");
      if (portraitToastTimer.current) clearTimeout(portraitToastTimer.current);
      setPortraitWarning(text);
      portraitToastTimer.current = setTimeout(() => {
        setPortraitWarning(null);
        portraitToastTimer.current = null;
      }, PORTRAIT_WARN_TTL_MS);
      if (portraitWarnedRef.current.has(source)) return;
      portraitWarnedRef.current.add(source);
      const warn: ChatMessage = {
        id: crypto.randomUUID(),
        type: "warning",
        content: text,
        timestamp: new Date().toLocaleTimeString(),
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev.slice(-MSG_HISTORY_LIMIT), warn]);
    }).then((u) => trackUnlisten(u));

    return () => {
      disposed = true;
      stopAutoSeat();
      clearReconnectTimer();
      if (portraitToastTimer.current) {
        clearTimeout(portraitToastTimer.current);
        portraitToastTimer.current = null;
      }
      for (const u of unsubs) {
        try { u(); } catch {}
      }
    };
  // Single listen flight: never re-subscribe on totalPlaces (re-renders) —
  // current values go through refs.
  }, [username, idLieu]);

  // Lane F1 — social/economy emits. Failures surface via the room error
  // banner (same TTL as other transient errors), never as a crash.
  const withTransientError = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      setError(String(e));
      setTimeout(() => setError(""), ERROR_TTL_MS);
    }
  };

  const offerDrink = (login: string): Promise<void> =>
    withTransientError(() => api.taverneOffreVerre(login));

  // Reuses the existing /manger emit (taverneCommandeRepas) — no new command.
  const orderMenu = (id: number): Promise<void> =>
    withTransientError(() => api.wsSend(`/manger ${id}`));

  const buyTournee = (): Promise<void> =>
    withTransientError(() => api.taverneTourneeGenerale());

  // Reuses the existing /boire emit (taverneCommandeVerre) — no new command.
  const orderDrink = (): Promise<void> =>
    withTransientError(() => api.wsSend("/boire"));

  // Lane F3 — proactive alcohol consent toggle (official checkbox
  // #chatMenuInputAccepteAlcool → chat.accepteAlcool). The server answers
  // with a taverneAccepteAlcool broadcast that re-syncs the state above.
  const toggleAccepteAlcool = (): Promise<void> => {
    const next = !accepteAlcool;
    return withTransientError(() => api.taverneAccepteAlcool(next));
  };

  // Lane F3 — moderation (PlayerMenu; server enforces rights and answers
  // with tavernePersonnageKick/Ban/Unban confirmations or taverneErreur
  // PasAutoKick/PasAutoBan). Failures surface via the transient error.
  const kickPlayer = (login: string): Promise<void> =>
    withTransientError(() => api.taverneKick(login));

  const banPlayer = (login: string): Promise<void> =>
    withTransientError(() => api.taverneBan(login));

  const unbanPlayer = (login: string): Promise<void> =>
    withTransientError(() => api.taverneUnban(login));

  // Manual tavern re-dial (headless entry point for the designer).
  // Resets the init gate + backoff accounting, clears the error/kind, arms
  // the fresh-guard, then reuses the wsConnect path (backend owns
  // teardown-before-dial, gen-guarded latest-wins single-flight — no double
  // socket). Phase-owned: no-ops outside the tavern room phase (the village
  // retry owns the picker phase, and vice versa) and over a live session.
  const retryTavern = async (): Promise<void> => {
    if (retryInFlightRef.current) return;
    if (!isTavernPhaseRef.current) return;
    if (isConnectedRef.current) return;
    retryInFlightRef.current = true;
    try {
      taverneInitSeenRef.current = false;
      reconnectAttemptsRef.current = 0;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setError("");
      setErrorKind(null);
      awaitingFreshRef.current = true;
      await api.wsConnect(idLieuRef.current);
    } catch (e) {
      setError(String(e));
      setErrorKind("dropped");
    } finally {
      retryInFlightRef.current = false;
    }
  };

  // External error clears (App login/enter/leave/cancel flows) also drop a
  // stale kind — a cleared banner must never keep a retry affordance. The
  // connection paths above set message + kind explicitly via the raw
  // setters; transient errors leave the kind alone.
  const setErrorAndKind = (msg: string): void => {
    setError(msg);
    if (!msg) setErrorKind(null);
  };

  return {
    messages, setMessages,
    presentUsers, places, totalPlaces, selectedPlace, setSelectedPlace,
    error, setError: setErrorAndKind, errorKind, setErrorKind, status, setStatus,
    isConnected, setIsConnected,
    typingUsers,
    // Lane F2 — tavern ground type for the reserved-seat status icons.
    lieu,
    setPresentUsers, setPlaces, setTotalPlaces,
    // Lane F1 — social/economy (later lanes build on these names).
    menus, ecus, ecusPulse, alcoolRate, alcoolByLogin, tournee, kicked, banned,
    offerDrink, orderMenu, orderDrink, buyTournee, clearTournee, clearSocialState,
    // Distinct tavern error plumbing + manual retry (headless, designer UI).
    retryTavern,
    // Lane F3 — consent, fatal flags, flood mute, moderation.
    accepteAlcool, needsRefresh, floodMuted,
    toggleAccepteAlcool, kickPlayer, banPlayer, unbanPlayer,
    // Portrait fallback notice (toast text; null when none).
    portraitWarning,
  };
}
