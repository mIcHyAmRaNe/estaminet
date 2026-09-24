import { useState, useEffect, useRef } from "preact/hooks";
import { api } from "./api/tauri";
import { t } from "./lib/i18n";
import { DEFAULT_TAVERN_ID, DEFAULT_PLACES, MAX_PLACES, CHAT_SLASH_ALLOWLIST, CONNECT_TIMEOUT_MS, VILLAGE_IDS } from "./lib/config";
import { useTaverne } from "./lib/hooks/useTaverne";
import { useVillagePresence } from "./lib/hooks/useVillagePresence";
import { useBredouille } from "./lib/hooks/useBredouille";
import { useRecents } from "./lib/hooks/useRecents";
import { useUpdater } from "./lib/hooks/useUpdater";
import { normalizeText } from "./lib/utils/text-utils";
import AuthStep from "./components/auth/AuthStep";
import TavernSelect from "./components/tavern/TavernSelect";
import ChatRoom from "./components/chat/ChatRoom";
import { clearPortraitCache } from "./components/chat/AvatarPortrait";
import UpdatePrompt from "./components/ui/UpdatePrompt";
import type { Tavern } from "./lib/types";

type Phase = "auth" | "tavern" | "room";

// NomVillage (EcranPrincipale) -> VILLAGE_IDS: exact full string first,
// then the parenthesis-stripped base ("Montpellier (Comté…)" ->
// "Montpellier"), then a case/accent-insensitive pass over both forms so
// server casing variants still preselect instead of dropping to manual.
function resolveVillageId(raw: string): number | null {
  const clean = raw.trim();
  if (!clean) return null;
  const direct = VILLAGE_IDS[clean];
  if (direct != null) return direct;
  const base = clean.replace(/\s*\(.*\)\s*$/, "").trim();
  if (base && base !== clean) {
    const b = VILLAGE_IDS[base];
    if (b != null) return b;
  }
  const norm = normalizeText(clean);
  const normBase = normalizeText(base || clean);
  for (const [key, id] of Object.entries(VILLAGE_IDS)) {
    const nk = normalizeText(key);
    if (nk === norm || nk === normBase) return id;
  }
  return null;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("auth");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [useAnother, setUseAnother] = useState(false);
  const [taverns, setTaverns] = useState<Tavern[]>([]);
  const [idLieu, setIdLieu] = useState(DEFAULT_TAVERN_ID);
  const [inputMessage, setInputMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  // Picker↔room switch guards (shared single socket):
  // - enterPending: Enter dial in flight — the village presence stays
  //   suspended so picker and room never dial at once (generation-cancel).
  // - leavingRoom: quit teardown in flight — the village re-dial waits
  //   until wsDisconnect resolved (teardown before re-dial, never both).
  const [enterPending, setEnterPending] = useState(false);
  const [leavingRoom, setLeavingRoom] = useState(false);
  // Single-flight guard against double-connection (mirrors the official JS
  // `_initialisationEnCours`). `connecting` drives the UI,
  // `connectingRef` is the synchronous anti-burst guard (double-click).
  const connectingRef = useRef(false);

  const tavernPlaces = taverns.find((t) => t.id === idLieu)?.places ?? DEFAULT_PLACES;
  // Tavern-phase gate: useTaverne mounts unconditionally, but auto-seat must
  // only arm/fire while the tavern room owns the socket (phase "room"). The
  // home-village presence ("tavern") shares the socket's ws-connected —
  // without this gate a village roster leaks 42["taverneChangePlace",…].
  // No change to onSelect/onEnter.
  const taverne = useTaverne(username, idLieu, tavernPlaces, phase === "room");
  // Home-village presence only: the band never offers a choice — any
  // IDLieu returns whoever is there, so only the player's own NomVillage
  // is honest. Fetched once per account per tavern-phase entry
  // (get_player_village -> VILLAGE_IDS), then a single villageConnect via
  // useVillagePresence (enabled = phase tavern + known home id). No
  // cross-village select, no preview arming, no village chat.
  const [homeVillageId, setHomeVillageId] = useState<number | null>(null);
  const [homeVillageName, setHomeVillageName] = useState<string | null>(null);
  // Name-fetch diagnostics for the always-visible presence band: loading
  // while get_player_village is in flight, ok once a name is kept (even
  // when the id stays unmapped — the band then shows name + connecting),
  // error when the backend is missing/offline or returns nothing.
  const [villageFetchState, setVillageFetchState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [villageFetchError, setVillageFetchError] = useState<string | null>(null);
  const villageFetchedForRef = useRef<string | null>(null);
  const village = useVillagePresence({
    enabled: phase === "tavern" && homeVillageId !== null,
    villageId: homeVillageId,
    villageName: homeVillageName,
    // Never dial while leaving the picker (Enter pending) or while the
    // quit teardown is still in flight — room phase disables via `enabled`.
    // The same gate owns manual retries: village.retryVillage() no-ops
    // while suspended (or while the room owns the socket), so a retry never
    // races an in-flight dial and never fights the roster watchdog; the
    // tavern retry (taverne.retryTavern()) is room-phase-only, vice versa.
    suspended: enterPending || leavingRoom,
  });
  // Fetch the player home village once per account per tavern-phase entry
  // for the auto-dial. Never touches idLieu. Skipped while logged out
  // (empty username, post-forget) so the fetch isn't burnt on a dead
  // session — it retries on next login.
  useEffect(() => {
    if (phase !== "tavern") return;
    const who = username.trim();
    if (!who) return;
    if (villageFetchedForRef.current === who) return;
    villageFetchedForRef.current = who;
    let cancelled = false;
    setVillageFetchState("loading");
    setVillageFetchError(null);
    (async () => {
      try {
        const name = await api.getPlayerVillage();
        if (cancelled) return;
        if (!name || !name.trim()) {
          // Parse-miss / empty: keep the band visible with an explicit
          // diagnostic instead of a silent gap.
          setVillageFetchState("error");
          setVillageFetchError(t("village.unverified"));
          return;
        }
        const clean = name.trim();
        // Keep the name even when the id stays unmapped (e.g. Bordeaux):
        // the band shows name + connecting rather than nothing.
        setHomeVillageName(clean);
        const mapped = resolveVillageId(clean);
        if (mapped != null) {
          setHomeVillageId((prev) => prev ?? mapped);
        }
        setVillageFetchState("ok");
        setVillageFetchError(null);
      } catch {
        // Backend missing / offline / NotConnected — surface it on the
        // band until the next tavern-phase entry.
        if (cancelled) return;
        setVillageFetchState("error");
        setVillageFetchError(t("village.unverified"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Tavern-phase entry per account (setters are stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, username]);
  useEffect(() => {
    // Sticky 10: do not shrink back to 8 while seats 8/9 are occupied —
    // the hook already auto-expanded on occupancy (see expandForPlace).
    if (taverne.totalPlaces === MAX_PLACES && tavernPlaces === DEFAULT_PLACES && (taverne.places[8] != null || taverne.places[9] != null)) return;
    taverne.setTotalPlaces(tavernPlaces);
    taverne.setPlaces(Array(tavernPlaces).fill(null));
    // Sync on tavern selection / list load (setters are stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tavernPlaces]);
  const bredouille = useBredouille(taverne.isConnected);
  const { recents, push: pushRecent } = useRecents();
  // Shell-level silent update check (banner renders phase-independently).
  const updater = useUpdater();

  // Attempt id: Esc / Annuler / watchdog increments it so a late Tauri
  // invoke result is ignored (invokes cannot truly abort). The phase never
  // changes until success, so cancelling restores the prior screen as-is.
  const attemptRef = useRef(0);
  const handleCancelConnect = () => {
    attemptRef.current += 1;
    connectingRef.current = false;
    setConnecting(false);
    // Release a pending Enter so the village dial can re-arm on the picker.
    setEnterPending(false);
    taverne.setError("");
  };

  // Esc cancels a pending connect; a watchdog restores the phase with a
  // friendly error when the network never answers (technical goes to console).
  useEffect(() => {
    if (!connecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancelConnect();
    };
    window.addEventListener("keydown", onKey);
    const timer = setTimeout(() => {
      handleCancelConnect();
      taverne.setError(phase === "tavern" ? t("error.enterFailed") : t("error.authFailed"));
    }, CONNECT_TIMEOUT_MS);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
    // Mount-pattern: setters are stable; re-arm only on connecting/phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting, phase]);

  const refreshAccounts = async (): Promise<string[]> => {
    try {
      const list = await api.listAccounts();
      setAccounts(list);
      setPickedAccount((prev) => {
        if (prev !== null && list.includes(prev)) return prev;
        return list.length > 0 ? (list[0] ?? null) : null;
      });
      return list;
    } catch {
      return accounts;
    }
  };

  // Boot: taverns + accounts in parallel, no auto-login (ora-1).
  // The user explicitly picks an account (step 1) then a tavern (step 2).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, saved] = await Promise.all([api.getTaverns(), api.listAccounts()]);
        if (cancelled) return;
        setTaverns(list);
        if (list.length > 0 && list[0]) setIdLieu(list[0].id);
        setAccounts(saved);
        setPickedAccount(saved.length > 0 ? (saved[0] ?? null) : null);
        if (saved.length === 0) setUseAnother(true);
      } catch {
        // getTaverns failed — leave the auth screen visible.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only boot (setters are stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearRoomState = () => {
    taverne.setMessages([]);
    taverne.setPresentUsers([]);
    taverne.setPlaces(Array(taverne.totalPlaces).fill(null));
    taverne.setSelectedPlace(null);
    taverne.setIsConnected(false);
    taverne.clearSocialState();
  };

  // Step 1 (form): login opens the HTTP session only — no wsConnect.
  // The tavern is chosen in step 2.
  const handleConnectForm = async (e: Event) => {
    e.preventDefault();
    if (connectingRef.current || connecting) return;
    connectingRef.current = true;
    const attempt = ++attemptRef.current;
    clearPortraitCache();
    taverne.setError("");
    taverne.setStatus("");
    setConnecting(true);
    taverne.setMessages([]);
    try {
      const loginName = username.trim();
      const warning = await api.login(loginName, password, remember);
      if (attempt !== attemptRef.current) return;
      setPassword("");
      setUsername(loginName);
      setPickedAccount(loginName);
      await refreshAccounts();
      if (attempt !== attemptRef.current) return;
      setUseAnother(false);
      taverne.setStatus(warning ?? t("status.sessionOpen", { username: loginName }));
      setPhase("tavern");
    } catch (err) {
      if (attempt !== attemptRef.current) return;
      console.error("[auth] login failed:", err);
      taverne.setError(t("error.authFailed"));
    } finally {
      if (attempt !== attemptRef.current) return;
      setConnecting(false);
      connectingRef.current = false;
    }
  };

  // Step 1 (saved): passwordless session for the preselected account.
  const handleConnectSaved = async () => {
    if (connectingRef.current || connecting) return;
    if (pickedAccount === null) return;
    const target = pickedAccount;
    connectingRef.current = true;
    const attempt = ++attemptRef.current;
    clearPortraitCache();
    taverne.setError("");
    taverne.setStatus("");
    setConnecting(true);
    taverne.setMessages([]);
    taverne.setPresentUsers([]);
    try {
      const login = await api.tryAutoLoginFor(target);
      if (attempt !== attemptRef.current) return;
      if (login == null) {
        await refreshAccounts();
        if (attempt !== attemptRef.current) return;
        taverne.setError(t("auth.sessionExpired"));
        return;
      }
      setUsername(login);
      setPickedAccount(login);
      taverne.setStatus(t("status.sessionOpen", { username: login }));
      setPhase("tavern");
    } catch (err) {
      if (attempt !== attemptRef.current) return;
      console.error("[auth] saved session failed:", err);
      taverne.setError(t("error.sessionFailed"));
    } finally {
      if (attempt !== attemptRef.current) return;
      setConnecting(false);
      connectingRef.current = false;
    }
  };

  const handleRemoveAccount = async (login: string) => {
    if (connecting) return;
    try {
      await api.removeAccount(login);
      const next = await refreshAccounts();
      if (pickedAccount === login) {
        setPickedAccount(next.length > 0 ? (next[0] ?? null) : null);
        if (next.length === 0) setUseAnother(true);
      }
      taverne.setStatus(t("auth.accountRemoved", { username: login }));
    } catch (err) {
      taverne.setError(String(err));
    }
  };

  // Step 2 — Enter: open the socket, remember the tavern, show the room.
  // Single-flight: ignore concurrent calls (double-click) to never open
  // two sockets (double presence / kick 41).
  const handleEnterTavern = async () => {
    if (connectingRef.current || connecting) return;
    connectingRef.current = true;
    const attempt = ++attemptRef.current;
    taverne.setError("");
    setConnecting(true);
    // Leaving the picker: suspend the village dial first (generation-cancel
    // any in-flight villageConnect) so village close + tavern dial never
    // race on the shared socket.
    setEnterPending(true);
    try {
      await api.wsConnect(idLieu);
      if (attempt !== attemptRef.current) return;
      pushRecent(idLieu);
      // Entering the room leaves the tavern phase: presence auto-disables
      // via its enabled gate (phase tavern + home id), no stale roster.
      setPhase("room");
    } catch (err) {
      if (attempt !== attemptRef.current) return;
      console.error("[tavern] enter failed:", err);
      taverne.setError(t("error.enterFailed"));
    } finally {
      if (attempt !== attemptRef.current) return;
      setEnterPending(false);
      setConnecting(false);
      connectingRef.current = false;
    }
  };

  // Step 2 — Back: cut the session, return to accounts (step 1).
  const handleBackToAuth = async () => {
    setEnterPending(false);
    try {
      await api.disconnect();
    } catch {
      // Session already down — return to auth anyway.
    }
    clearPortraitCache();
    clearRoomState();
    // Reset the home dial so the next login refetches its own NomVillage.
    setHomeVillageId(null);
    setHomeVillageName(null);
    setVillageFetchState("idle");
    setVillageFetchError(null);
    villageFetchedForRef.current = null;
    setPassword("");
    setUseAnother(accounts.length === 0);
    taverne.setStatus(t("status.disconnected"));
    taverne.setError("");
    setPhase("auth");
  };

  // Step 2 — Forget: logout removes the current account only, then auth.
  const handleForgetCurrent = async () => {
    setEnterPending(false);
    try {
      await api.logout();
    } catch {
      // Best effort — still refresh and leave.
    }
    clearPortraitCache();
    clearRoomState();
    setUsername("");
    setPassword("");
    setRemember(false);
    // The account (and its village) is gone: clear the home dial so a
    // stale band never survives, and allow the next login to refetch its
    // own NomVillage.
    setHomeVillageId(null);
    setHomeVillageName(null);
    setVillageFetchState("idle");
    setVillageFetchError(null);
    villageFetchedForRef.current = null;
    await refreshAccounts();
    setUseAnother(false);
    taverne.setStatus(t("status.disconnected"));
    taverne.setError("");
    setPhase("auth");
  };

  // Room — Leave: cut the socket only (session stays open), back to taverns.
  // The portrait cache is KEPT across re-entries: entries are keyed by
  // login and self-invalidated by JSON comparison on the next fetch, so a
  // re-enter reuses portraits (the backend fresh-first fetch still picks up
  // outfit changes server-side).
  const handleLeaveRoom = async () => {
    if (leavingRoom) return;
    // Quit-to-picker: the tavern teardown must COMPLETE before the village
    // re-dial — the presence stays suspended until wsDisconnect resolved,
    // so teardown + re-dial never fire together on the shared socket.
    setLeavingRoom(true);
    try {
      await api.wsDisconnect();
    } catch {
      // Socket already down — return to taverns anyway.
    }
    clearRoomState();
    // Back in the picker the home dial re-arms on its own (phase gate) —
    // the tavern socket close drops the shared presence first. Any stale
    // room connection error (room-rejected/dropped + retry affordance) is
    // cleared so the picker never shows the previous room's error — the
    // wrapped setter clears errorKind alongside the message.
    taverne.setError("");
    taverne.setStatus(t("status.sessionOpen", { username }));
    setPhase("tavern");
    setLeavingRoom(false);
  };

  const handleSend = async (e: Event) => {
    e.preventDefault();
    const raw = inputMessage.trim();
    if (!raw || !taverne.isConnected) return;
    if (raw.startsWith("/")) {
      const allowed = CHAT_SLASH_ALLOWLIST;
      const ok = allowed.some((p) => raw === p.trim() || raw.startsWith(p));
      if (!ok) {
        bredouille.trigger(username || t("chat.you"));
        setInputMessage("");
        return;
      }
    }
    try {
      await api.wsSend(inputMessage);
      setInputMessage("");
    } catch (err) {
      taverne.setError(t("error.sendFailed", { err: String(err) }));
    }
  };

  const handleCopy = async () => {
    const text = taverne.messages
      .map((m) => (m.type === "normal" || m.type === "whisper" ? `${m.login}: ${m.content}` : m.content))
      .join("\n");
    const tavernName = taverns.find((tav: Tavern) => tav.id === idLieu)?.name ?? String(idLieu);
    const full = `${t("chat.copyHeader", { name: tavernName, date: new Date().toLocaleString() })}\n${"=".repeat(48)}\n${text}`;
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = full;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    api.saveChatLog(idLieu, t("chat.copyMarker", { date: new Date().toISOString(), content: full })).catch(() => {});
  };

  const handleChangePlace = async (idPlace: number) => {
    const maxPlace = Math.max(0, taverne.totalPlaces - 1);
    if (idPlace < 0 || idPlace > maxPlace) return;
    const occupant = taverne.places[idPlace];
    if (occupant) return;
    taverne.setSelectedPlace(idPlace);
    try {
      await api.changePlace(idPlace);
    } catch (err) {
      taverne.setError(String(err));
      taverne.setSelectedPlace(null);
    }
  };

  if (phase !== "room") {
    return (
      <>
      <div class="auth-page auth-page--compact">
        {phase === "auth" ? (
          <AuthStep
            accounts={accounts}
            pickedAccount={pickedAccount}
            setPickedAccount={setPickedAccount}
            username={username}
            setUsername={setUsername}
            password={password}
            setPassword={setPassword}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            remember={remember}
            setRemember={setRemember}
            useAnother={useAnother}
            setUseAnother={setUseAnother}
            loading={connecting}
            error={taverne.error}
            status={taverne.status}
            onConnectSaved={handleConnectSaved}
            onConnectForm={handleConnectForm}
            onRemoveAccount={handleRemoveAccount}
            onCancel={handleCancelConnect}
            />
        ) : (
          <TavernSelect
            taverns={taverns}
            selectedId={idLieu}
            onSelect={setIdLieu}
            recents={recents}
            username={username}
            loading={connecting}
            error={taverne.error}
            status={taverne.status}
            onEnter={handleEnterTavern}
            onBack={handleBackToAuth}
            onForgetCurrent={handleForgetCurrent}
            onCancel={handleCancelConnect}
            villageId={village.villageId}
            villageName={homeVillageName ?? village.villageName}
            villageUsers={village.onlineUsers}
            villageCount={village.onlineCount}
            villageConnected={village.isConnected}
            // Distinct village plumbing: roster failures surface as village
            // errors (villageError/villageErrorKind), never tavern copy.
            villageError={village.villageError ?? villageFetchError}
            villageErrorKind={village.villageErrorKind}
            onRetryVillage={village.retryVillage}
            villageFetchState={villageFetchState}
          />
        )}
      </div>
      <UpdatePrompt
        status={updater.status}
        version={updater.version}
        error={updater.error}
        onInstall={updater.installAndRestart}
      />
    </>
  );
}

  return (
    <>
    <div class="tavern-fullscreen">
      <ChatRoom
        messages={taverne.messages}
        presentUsers={taverne.presentUsers}
        places={taverne.places}
        selectedPlace={taverne.selectedPlace}
        onChangePlace={handleChangePlace}
        totalPlaces={taverne.totalPlaces}
        inputMessage={inputMessage}
        setInputMessage={setInputMessage}
        onSend={handleSend}
        onDisconnect={handleLeaveRoom}
        onCopy={handleCopy}
        isConnected={taverne.isConnected}
        tavernName={taverns.find((tav: Tavern) => tav.id === idLieu)?.name ?? t("tavern.fallback", { id: idLieu })}
        currentUser={username}
        typingUsers={taverne.typingUsers}
        lieu={taverne.lieu}
        menus={taverne.menus}
        ecus={taverne.ecus}
        ecusPulse={taverne.ecusPulse}
        tournee={taverne.tournee}
        clearTournee={taverne.clearTournee}
        onOfferDrink={taverne.offerDrink}
        onOrderMenu={taverne.orderMenu}
        onOrderDrink={taverne.orderDrink}
        onBuyTournee={taverne.buyTournee}
        alcoolRate={taverne.alcoolRate}
        accepteAlcool={taverne.accepteAlcool}
        alcoolByLogin={taverne.alcoolByLogin}
        onToggleAlcool={taverne.toggleAccepteAlcool}
        kicked={taverne.kicked}
        banned={taverne.banned}
        needsRefresh={taverne.needsRefresh}
        floodMuted={taverne.floodMuted}
        portraitWarning={taverne.portraitWarning}
        onKickPlayer={taverne.kickPlayer}
        onBanPlayer={taverne.banPlayer}
        onUnbanPlayer={taverne.unbanPlayer}
        // Distinct tavern connection errors: persistent banner + icon retry
        // (taverne.retryTavern) under the header. Stale room errors are
        // already cleared on leave (handleLeaveRoom), so the picker never
        // inherits them.
        tavernError={taverne.error}
        tavernErrorKind={taverne.errorKind}
        onRetryTavern={taverne.retryTavern}
      />
      {bredouille.bredouille && (
        <div class="bredouille-overlay" onClick={bredouille.clear}>
          <div class="bredouille-bubble">
            <div class="bredouille-title">{t("bredouille.title")}</div>
            <div class="bredouille-text">{bredouille.bredouille}</div>
            <div class="bredouille-hint">{t("bredouille.hint")}</div>
          </div>
        </div>
      )}
    </div>
      <UpdatePrompt
        status={updater.status}
        version={updater.version}
        error={updater.error}
        onInstall={updater.installAndRestart}
      />
    </>
  );
}
