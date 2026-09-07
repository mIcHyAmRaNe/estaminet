import { useState, useEffect, useRef } from "preact/hooks";
import { api } from "./api/tauri";
import { t } from "./lib/i18n";
import { DEFAULT_TAVERN_ID } from "./lib/config";
import { useTaverne } from "./lib/hooks/useTaverne";
import { useBredouille } from "./lib/hooks/useBredouille";
import LoginForm from "./components/auth/LoginForm";
import ChatRoom from "./components/chat/ChatRoom";
import type { Tavern } from "./lib/types";

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [rememberedLogin, setRememberedLogin] = useState<string | null>(null);
  const [taverns, setTaverns] = useState<Tavern[]>([]);
  const [idLieu, setIdLieu] = useState(DEFAULT_TAVERN_ID);
  const [inputMessage, setInputMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  // Single-flight guard against double-connection (mirrors the official JS
  // `_initialisationEnCours`: ONE connection, ONE changeSalon). `connecting`
  // drives the UI, `connectingRef` is the synchronous anti-burst guard
  // (double-click).
  const connectingRef = useRef(false);

  const taverne = useTaverne(username, idLieu);
  const bredouille = useBredouille(taverne.isConnected);

  // Credentials cleared backend-side (BadCredentials) → leave the
  // "remembered account" state. Returns true if the state was reset.
  // An unreadable keyring (unavailable) keeps the state as-is.
  const dropStaleRemembered = async (): Promise<boolean> => {
    let still: string | null;
    try {
      still = await api.getSavedLogin();
    } catch {
      return false;
    }
    if (still) return false;
    setRememberedLogin(null);
    setUsername("");
    return true;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.getTaverns();
        if (cancelled) return;
        setTaverns(list);
        const targetId = list.length ? list[0].id : DEFAULT_TAVERN_ID;
        if (list.length) setIdLieu(targetId);
        try {
          const saved = await api.getSavedLogin();
          if (cancelled) return;
          if (saved) {
            setUsername(saved);
            setRememberedLogin(saved);
          }
        } catch {
          // Ignore prefill failures — stay on silent form.
        }
        try {
          const auto = await api.tryAutoLogin();
          if (cancelled || auto == null) return;
          // Remembered session found: stay on the login screen in the
          // "remembered account" state — the user picks a tavern then enters.
          setUsername(auto);
          setRememberedLogin(auto);
          taverne.setStatus(t("status.loginSuccess"));
        } catch (err) {
          // Real failure (credentials rejected → backend cleared, or network).
          // An unavailable keyring never rejects here: the backend maps it to
          // Ok(None) (silent return above).
          await dropStaleRemembered();
          if (!cancelled) taverne.setError(String(err));
        }
      } catch {
        // getTaverns failed — leave the form visible.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only restore (setters are stable).
  }, []);

  // Enter the chosen tavern (session already open).
  // Places are loaded by the useTaverne hook (effect on isConnected).
  // Single-flight: ignore concurrent calls (double-click, auto-reconnect)
  // to never open two sockets (double presence / kick 41).
  const enterTavern = async (id: number) => {
    if (connectingRef.current || connecting) return;
    connectingRef.current = true;
    try {
      await api.wsConnect(id);
    } finally {
      connectingRef.current = false;
    }
  };

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    // Ignore concurrent submissions (double-click): the synchronous lock
    // covers the delay before `connecting` (state) propagates.
    if (connectingRef.current || connecting) return;
    taverne.setError("");
    taverne.setStatus("");
    setConnecting(true);
    taverne.setMessages([]);
    try {
      const warning = await api.login(username, password, remember);
      setPassword("");
      // Remembered state only if persistence is confirmed: if the backend
      // reports a warning, nothing was stored and "Enter" would immediately
      // fall back to the full form.
      setRememberedLogin(remember && warning == null ? username : null);
      taverne.setStatus(warning ?? t("status.loginSuccess"));
      await enterTavern(idLieu);
    } catch (err) {
      taverne.setError(String(err));
    } finally {
      setConnecting(false);
    }
  };

  // "Remembered account" state: passwordless login via the keyring,
  // then entry into the chosen tavern.
  const handleEnter = async (e: Event) => {
    e.preventDefault();
    if (connectingRef.current || connecting) return;
    taverne.setError("");
    taverne.setStatus("");
    setConnecting(true);
    // Explicit clear like handleLogin: no tavern ID in the frames,
    // start from an empty conversation before entering.
    taverne.setMessages([]);
    taverne.setPresentUsers([]);
    try {
      const login = await api.tryAutoLogin();
      if (login == null) {
        // No remembered credentials left: back to the full form.
        setRememberedLogin(null);
        setUsername("");
        taverne.setError(t("auth.sessionExpired"));
        return;
      }
      setRememberedLogin(login);
      setUsername(login);
      taverne.setStatus(t("status.loginSuccess"));
      await enterTavern(idLieu);
    } catch (err) {
      // Credentials rejected → the backend cleared them: fall back to the
      // full form with an expiry hint.
      if (await dropStaleRemembered()) {
        taverne.setError(t("auth.sessionExpired"));
      } else {
        taverne.setError(String(err));
      }
    } finally {
      setConnecting(false);
    }
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
    const tavernName = taverns.find((t: Tavern) => t.id === idLieu)?.name ?? String(idLieu);
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

  // "Leave the tavern": cut the session but keep the remembered credentials
  // — back to the "remembered account" state.
  const handleDisconnect = async () => {
    try {
      await api.disconnect();
    } catch {
      // Session already down — leave to the login screen anyway.
    }
    // Explicit clear: the next tavern must never see the previous one's
    // history/presence/places. (Portraits are keyed by login and validated
    // by JSON: the cache is kept.)
    taverne.setMessages([]);
    taverne.setPresentUsers([]);
    taverne.setPlaces(Array(taverne.totalPlaces).fill(null));
    taverne.setSelectedPlace(null);
    taverne.setIsConnected(false);
    taverne.setStatus(t("status.disconnected"));
  };

  // "Sign out" from the remembered state: cut the session AND clear the
  // credentials — back to the full form to retype them.
  const handleLogout = async () => {
    await api.logout();
    setRememberedLogin(null);
    setUsername("");
    setPassword("");
    setRemember(false);
    taverne.setStatus(t("status.disconnected"));
    taverne.setError("");
  };

  if (!taverne.isConnected) {
    return (
      <div class="auth-page auth-page--compact">
        <LoginForm
            username={username}
            setUsername={setUsername}
            password={password}
            setPassword={setPassword}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            remember={remember}
            setRemember={setRemember}
            taverns={taverns}
            idLieu={idLieu}
            setIdLieu={setIdLieu}
            error={taverne.error}
            status={taverne.status}
            loading={connecting}
            onSubmit={rememberedLogin ? handleEnter : handleLogin}
            onDisconnect={handleLogout}
            rememberedLogin={rememberedLogin}
          />
        </div>
    );
  }

  return (
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
        onDisconnect={handleDisconnect}
        onCopy={handleCopy}
        isConnected={taverne.isConnected}
        tavernName={taverns.find((t: Tavern) => t.id === idLieu)?.name ?? t("tavern.fallback", { id: idLieu })}
        currentUser={username}
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
  );
}
