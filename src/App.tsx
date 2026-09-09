import { useState, useEffect, useRef } from "preact/hooks";
import { api } from "./api/tauri";
import { t } from "./lib/i18n";
import { DEFAULT_TAVERN_ID } from "./lib/config";
import { useTaverne } from "./lib/hooks/useTaverne";
import { useBredouille } from "./lib/hooks/useBredouille";
import { useRecents } from "./lib/hooks/useRecents";
import { useUpdater } from "./lib/hooks/useUpdater";
import AuthStep from "./components/auth/AuthStep";
import TavernSelect from "./components/tavern/TavernSelect";
import ChatRoom from "./components/chat/ChatRoom";
import UpdatePrompt from "./components/ui/UpdatePrompt";
import type { Tavern } from "./lib/types";

type Phase = "auth" | "tavern" | "room";

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
  // Single-flight guard against double-connection (mirrors the official JS
  // `_initialisationEnCours`). `connecting` drives the UI,
  // `connectingRef` is the synchronous anti-burst guard (double-click).
  const connectingRef = useRef(false);

  const taverne = useTaverne(username, idLieu);
  const bredouille = useBredouille(taverne.isConnected);
  const { recents, push: pushRecent } = useRecents();
  // Shell-level silent update check (banner renders phase-independently).
  const updater = useUpdater();

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
  };

  // Step 1 (form): login opens the HTTP session only — no wsConnect.
  // The tavern is chosen in step 2.
  const handleConnectForm = async (e: Event) => {
    e.preventDefault();
    if (connectingRef.current || connecting) return;
    connectingRef.current = true;
    taverne.setError("");
    taverne.setStatus("");
    setConnecting(true);
    taverne.setMessages([]);
    try {
      const loginName = username.trim();
      const warning = await api.login(loginName, password, remember);
      setPassword("");
      setUsername(loginName);
      setPickedAccount(loginName);
      await refreshAccounts();
      setUseAnother(false);
      taverne.setStatus(warning ?? t("status.sessionOpen", { username: loginName }));
      setPhase("tavern");
    } catch (err) {
      taverne.setError(String(err));
    } finally {
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
    taverne.setError("");
    taverne.setStatus("");
    setConnecting(true);
    taverne.setMessages([]);
    taverne.setPresentUsers([]);
    try {
      const login = await api.tryAutoLoginFor(target);
      if (login == null) {
        await refreshAccounts();
        taverne.setError(t("auth.sessionExpired"));
        return;
      }
      setUsername(login);
      setPickedAccount(login);
      taverne.setStatus(t("status.sessionOpen", { username: login }));
      setPhase("tavern");
    } catch (err) {
      taverne.setError(String(err));
    } finally {
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
    taverne.setError("");
    setConnecting(true);
    try {
      await api.wsConnect(idLieu);
      pushRecent(idLieu);
      setPhase("room");
    } catch (err) {
      taverne.setError(String(err));
    } finally {
      setConnecting(false);
      connectingRef.current = false;
    }
  };

  // Step 2 — Back: cut the session, return to accounts (step 1).
  const handleBackToAuth = async () => {
    try {
      await api.disconnect();
    } catch {
      // Session already down — return to auth anyway.
    }
    clearRoomState();
    setPassword("");
    setUseAnother(accounts.length === 0);
    taverne.setStatus(t("status.disconnected"));
    taverne.setError("");
    setPhase("auth");
  };

  // Step 2 — Forget: logout removes the current account only, then auth.
  const handleForgetCurrent = async () => {
    try {
      await api.logout();
    } catch {
      // Best effort — still refresh and leave.
    }
    clearRoomState();
    setUsername("");
    setPassword("");
    setRemember(false);
    await refreshAccounts();
    setUseAnother(false);
    taverne.setStatus(t("status.disconnected"));
    taverne.setError("");
    setPhase("auth");
  };

  // Room — Leave: cut the socket only (session stays open), back to taverns.
  const handleLeaveRoom = async () => {
    try {
      await api.wsDisconnect();
    } catch {
      // Socket already down — return to taverns anyway.
    }
    clearRoomState();
    taverne.setStatus(t("status.sessionOpen", { username }));
    setPhase("tavern");
  };

  const handleSend = async (e: Event) => {
    e.preventDefault();
    const raw = inputMessage.trim();
    if (!raw || !taverne.isConnected) return;
    if (raw.startsWith("/")) {
      const allowed = ["/me ", "/faire ", "/emote ", "/w ", "/manger ", "/boire", "/boire "];
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
    if (idPlace < 0 || idPlace > 9) return;
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
          />
        )}
      </div>
      <UpdatePrompt
        status={updater.status}
        version={updater.version}
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
        onInstall={updater.installAndRestart}
      />
    </>
  );
}
