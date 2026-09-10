import { useRef, useEffect, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { ChatRoomProps } from "../../lib/types";
import { t } from "../../lib/i18n";
import { api } from "../../api/tauri";
import { MSG_DISPLAY_MAX, TYPING_STOP_DELAY_MS } from "../../lib/config";
import { useAutoScroll } from "../../lib/hooks/useAutoScroll";
import { isChopineText } from "../../lib/utils/chat-guards";
import ChatHeader from "./ChatHeader";
import MessageList from "./MessageList";
import TourneeOverlay from "./TourneeOverlay";
import FatalOverlay, { type FatalKind } from "./FatalOverlay";
import PlayerMenu from "./PlayerMenu";
import AvatarPortrait, { clearPortraitCache } from "./AvatarPortrait";
import tavernierIcon from "../../assets/images/interieurTaverne/ui_icone_tavernier_@2X.png";
import noblesseIcon from "../../assets/images/interieurTaverne/ui_icone_noblesse_@2X.png";
import mariesIcon from "../../assets/images/interieurTaverne/ui_icone_maries_@2X.png";
import pretreIcon from "../../assets/images/interieurTaverne/ui_icone_pretre_@2X.png";

// Lane F1 — tournée générale overlay auto-dismiss (~5s, official: 2.5s actif
// class + 5s freshness window; the spec asks for ~5s visible).
const TOURNEE_DISMISS_MS = 5000;

// Lane F2 — reserved-seat status (official Place.js configPlaces): the
// tavernier / noblesse / mariés / prêtre icons mark the SEAT, not the
// player — derived from the ground type, never from player payloads
// (taverneInit / taverneInfosPersonnage carry no status flags).
// eglise → ['marie', 'cure', 'marie'] (3 seats); taverns/ports/camps →
// ['tavernier', 'noble'] on seats 0-1, 'normal' elsewhere. Unknown ground
// (Lieu frame not yet received) → 'normal' (no icon, defensive).
type SeatReserve = "tavernier" | "noble" | "marie" | "cure" | "normal";

function reserveOf(lieu: string | null | undefined, place: number): SeatReserve {
  if (!lieu) return "normal";
  if (lieu.toLowerCase() === "eglise") {
    if (place === 0 || place === 2) return "marie";
    if (place === 1) return "cure";
    return "normal";
  }
  if (place === 0) return "tavernier";
  if (place === 1) return "noble";
  return "normal";
}

const RESERVE_BADGE: Record<Exclude<SeatReserve, "normal">, { icon: string; labelKey: string }> = {
  tavernier: { icon: tavernierIcon, labelKey: "seat.reserveTavernier" },
  noble: { icon: noblesseIcon, labelKey: "seat.reserveNoble" },
  marie: { icon: mariesIcon, labelKey: "seat.reserveMarie" },
  cure: { icon: pretreIcon, labelKey: "seat.reserveCure" },
};

export default function ChatRoom(props: ChatRoomProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const { showScrollBtn, pendingCount, scrollToBottom, handleScroll } = useAutoScroll(props.messages, listRef, 100);

  const msgCount = props.messages.length;
  const typingUsers = props.typingUsers ?? [];

  // Footer status bar: presence counter (moved from ChatHeader) + char count.
  const presenceCount = props.presentUsers.length;
  const presenceTooltip =
    props.presentUsers.length > 0
      ? t("presence.tooltip", { count: presenceCount, s: presenceCount > 1 ? "s" : "", names: props.presentUsers.join(", ") })
      : props.isConnected
        ? t("status.online")
        : t("status.offline");
  // Footer presence list as a floating layer: the names render in a
  // position:fixed node portaled to document.body, so the list escapes
  // .room-chat overflow:hidden (an absolute child would be clipped).
  // Positioned from the trigger's getBoundingClientRect(), flipped
  // above/below on available space, viewport-clamped, repositioned on
  // scroll/resize while open.
  const triggerRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [presencePos, setPresencePos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);
  const presenceTipId = "room-presence-tooltip";
  const hasPresenceList = props.presentUsers.length > 0;
  const cancelPresenceClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const positionPresenceTip = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const GAP = 10;
    const MARGIN = 8;
    const WIDTH = 240;
    const MAX_H = 320;
    const spaceAbove = rect.top - GAP - MARGIN;
    const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN;
    const above = spaceAbove >= spaceBelow;
    const maxHeight = Math.max(80, Math.min(MAX_H, above ? spaceAbove : spaceBelow));
    const w = Math.min(WIDTH, Math.max(120, window.innerWidth - MARGIN * 2));
    const left = Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - w / 2), Math.max(MARGIN, window.innerWidth - w - MARGIN));
    setPresencePos(
      above
        ? { bottom: Math.max(MARGIN, window.innerHeight - rect.top + GAP), left, maxHeight }
        : { top: rect.bottom + GAP, left, maxHeight },
    );
  };
  const openPresenceTip = () => {
    cancelPresenceClose();
    if (props.presentUsers.length === 0) return;
    positionPresenceTip();
    setPresenceOpen(true);
  };
  const schedulePresenceClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setPresenceOpen(false);
    }, 120);
  };
  useEffect(() => {
    if (!presenceOpen) return;
    positionPresenceTip();
    const onReposition = () => positionPresenceTip();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresenceOpen(false);
    };
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("keydown", onKey);
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
    // Live-DOM positioning: re-run on open + list-size change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceOpen, presenceCount]);

  const [avatarRefresh, setAvatarRefresh] = useState(0);
  const handleRefreshPortraits = () => {
    clearPortraitCache();
    setAvatarRefresh((v) => v + 1);
  };

  // Lane F1 — whisper prefill (official: clicking a name fills "/w login ").
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleWhisperTo = (login: string) => {
    props.setInputMessage(`/w ${login} `);
    textareaRef.current?.focus();
  };

  // Lane F1 — tournée overlay auto-dismiss (keyed per event).
  const tourneeKey = props.tournee ? props.tournee.key : null;
  useEffect(() => {
    if (!tourneeKey) return;
    const timer = setTimeout(() => props.clearTournee?.(), TOURNEE_DISMISS_MS);
    return () => clearTimeout(timer);
    // Re-armed per tournée event; clearTournee is a stable hook setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourneeKey]);

  const showPlayerMenu = !!props.onOfferDrink;

  // Lane F3 — church mode (lieu === 'eglise'): the official client hides
  // ALL drink features (MenuPopup drink row, PlayerMenu offer entry,
  // header consent toggle). Menus + tournée keep working.
  const isChurch = (props.lieu ?? "").trim().toLowerCase() === "eglise";

  // Lane F3 — fatal overlay priority: kick > ban > refresh request.
  const fatalKind: FatalKind | null = props.kicked
    ? "kicked"
    : props.banned
      ? "banned"
      : props.needsRefresh
        ? "refresh"
        : null;
  // Lane F3 — refresh path: window.location.reload(), mirroring official
  // onMAJTaverne. (ChatHeader's refresh button only clears the portrait
  // cache — not a real reconnect — so it cannot serve here.)
  const handleRefreshPage = () => window.location.reload();

  // Typing emit: start on first non-empty input, stop 4s after the last
  // keystroke, immediately on clear/send/unmount. Every backend call is
  // guarded so a missing command can never crash the UI.
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const stopTyping = () => {
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    if (isTypingRef.current) {
      isTypingRef.current = false;
      try {
        api.typingStop().catch(() => {});
      } catch {
        // Backend command missing — ignore.
      }
    }
  };
  const handleInput = (e: Event) => {
    const v = (e.target as HTMLTextAreaElement).value;
    props.setInputMessage(v);
    if (v) {
      if (!isTypingRef.current) {
        isTypingRef.current = true;
        try {
          api.typingStart().catch(() => {});
        } catch {
          // Backend command missing — ignore.
        }
      }
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => {
        typingTimer.current = null;
        isTypingRef.current = false;
        try {
          api.typingStop().catch(() => {});
        } catch {
          // Backend command missing — ignore.
        }
      }, TYPING_STOP_DELAY_MS);
    } else {
      stopTyping();
    }
  };
  const handleSendWrapper = (e: Event) => {
    stopTyping();
    props.onSend(e);
  };

  useEffect(() => {
    return () => {
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
        typingTimer.current = null;
      }
      if (isTypingRef.current) {
        isTypingRef.current = false;
        try {
          api.typingStop().catch(() => {});
        } catch {
          // Backend command missing — ignore.
        }
      }
    };
    // Mount-only teardown (helpers use refs + stable setters).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendWrapper(e as unknown as Event);
    }
  };

  const TOTAL_SEATS = props.totalPlaces ?? 10;
  const fallbackAuthors = Array.from(new Set(props.messages.filter((m) => m.login).map((m) => m.login as string)));
  const baseList = props.presentUsers.length > 0 ? props.presentUsers : fallbackAuthors;
  // Case-insensitive comparisons: the hook stores ucfirst display (lower
  // key), while currentUser stays raw (usually lowercase). The strict `===`
  // broke `own-player` hence the `cadrePlein`.
  const currentLower = (props.currentUser ?? "").toLowerCase();
  const sorted = [...baseList].sort((a, b) => {
    if (a.toLowerCase() === currentLower) return -1;
    if (b.toLowerCase() === currentLower) return 1;
    return a.localeCompare(b);
  });
  // Pre-places fallback: include everyone in order (self first) while
  // waiting for real places. The old filter excluded currentUser, making
  // yourself invisible when hasPlaced=false.
  const fallbackOccupied = sorted.slice(0, TOTAL_SEATS);
  const hasPlaced = !!(props.places && props.places.some((p) => p !== null));
  const occupied = hasPlaced ? null : fallbackOccupied;
  // Standing / unplaced: never hidden even when hasPlaced=true. A login is
  // either seated or standing (case-insensitive match, no duplicates).
  // Unplaced currentUser included too. Each standing entry mounts an
  // <AvatarPortrait> → get_portrait_json fetch via its own cache (no fetch
  // here). When hasPlaced=false the fallback grid already shows everyone:
  // no standing section (avoids duplicates).
  const placedKeys = new Set<string>(
    (props.places ?? []).filter((p): p is string => p !== null).map((p) => p.toLowerCase()),
  );
  const standingBase = [...sorted];
  const curRaw = (props.currentUser ?? "").trim();
  if (curRaw && !placedKeys.has(curRaw.toLowerCase()) && !standingBase.some((u) => u.toLowerCase() === curRaw.toLowerCase())) {
    standingBase.unshift(curRaw.charAt(0).toUpperCase() + curRaw.slice(1));
  }
  const standing = hasPlaced ? standingBase.filter((u) => !placedKeys.has(u.toLowerCase())) : [];
  // Lane F2 — zoneQuiEcrit (official .taverne_zoneQuiEcrit): text near the
  // textarea while OTHER players compose (self already excluded by the
  // hook). Typing keys are lowercase → map back to display names.
  const typingDisplay = (() => {
    const out: string[] = [];
    for (const k of typingUsers) {
      const disp = baseList.find((u) => u.toLowerCase() === k) ?? (k.charAt(0).toUpperCase() + k.slice(1));
      if (!out.some((d) => d.toLowerCase() === disp.toLowerCase())) out.push(disp);
    }
    return out;
  })();
  const typingText =
    typingDisplay.length === 1
      ? t("chat.typingOne", { user: typingDisplay[0] ?? "" })
      : typingDisplay.length === 2
        ? t("chat.typingTwo", { a: typingDisplay[0] ?? "", b: typingDisplay[1] ?? "" })
        : typingDisplay.length > 2
          ? t("chat.typingMany", { n: typingDisplay.length })
          : null;
  const getOccupant = (place: number): string | null => {
    if (hasPlaced && props.places) return props.places[place] ?? null;
    return occupied ? (occupied[place] ?? null) : null;
  };
  const handlePlaceClick = (place: number) => {
    if (!props.onChangePlace) {
      return;
    }
    const realOccupant = props.places ? props.places[place] : null;
    if (realOccupant && realOccupant.toLowerCase() !== currentLower) {
      return;
    }
    if (realOccupant && realOccupant.toLowerCase() === currentLower) {
      return;
    }
    props.onChangePlace(place);
  };

  return (
    <div class={`room room--fullscreen room--places-${TOTAL_SEATS}`}>
      <div class="room-background" />

      <div class="room-content">
        <div class="room-characters">
          <div class="room-characters-grid">
            {Array.from({ length: TOTAL_SEATS }).map((_, place) => {
              // Reconciliation by PLAYER (not by place): occupied card keyed
              // by normalized login, empty slot keyed by place. On a place
              // change (A→B), Preact MOVES the existing node (Midas canvas
              // intact) instead of unmounting/remounting. Uniqueness
              // guaranteed: case-insensitive deduplicated presence on the
              // useTaverne side (one login-lower at a time) + disjoint
              // `player-` / `empty-` namespaces (a login "empty-3" cannot
              // collide).
              const name = getOccupant(place);
              const isSelected = props.selectedPlace === place;
              const isOwn = !!name && !!currentLower && name.toLowerCase() === currentLower;
              const isEmpty = !name;
              const clickable = isEmpty && !!props.onChangePlace;
              // Lane F2 — reserved-seat badge (official iconeTavernier /
              // iconeNoblesse / iconeMarie / iconePretre on the place).
              const reserve = reserveOf(props.lieu, place);
              const badge = reserve !== "normal" ? RESERVE_BADGE[reserve] : null;
              if (name) {
                const nameLower = name.toLowerCase();
                const last = [...props.messages].reverse().find((m) => (m.login ?? "").toLowerCase() === nameLower);
                const isEmote = last?.type === "emote";
                const chopine = last ? isChopineText(last.content) : false;
                const isTyping = typingUsers.includes(nameLower);
                return (
                  <div
                    key={`player-${name.toLowerCase()}-${avatarRefresh}`}
                    class={`character-card${isOwn ? " own-player" : ""}${isSelected ? " selected" : ""}`}
                    data-place={String(place)}
                    title={isOwn ? t("seat.own") : name}
                  >
                    {badge && (
                      <img class="place-status-icon" src={badge.icon} alt="" title={t(badge.labelKey)} />
                    )}
                    <div class="character-portrait">
                      <AvatarPortrait login={name} />
                    </div>
                    <span class="character-name" title={name}>{name}</span>                    <span class={`character-last-msg${isEmote ? " emote" : ""}${chopine ? " chopine" : ""}`}>
                      {isTyping ? (
                        <div class="lds-ellipsis" aria-label={t("chat.typingLabel", { user: name })}><div></div><div></div><div></div><div></div></div>
                      ) : last ? last.content.slice(0, 56) : "—"}
                    </span>
                    {showPlayerMenu && !isOwn && props.onOfferDrink && (
                      <PlayerMenu login={name} onOfferDrink={props.onOfferDrink} onWhisper={handleWhisperTo} hideDrink={isChurch} targetAcceptsAlcool={props.alcoolByLogin?.[name.toLowerCase()] ?? null} onKick={props.onKickPlayer} onBan={props.onBanPlayer} onUnban={props.onUnbanPlayer} />
                    )}
                  </div>
                );
              }
              return (
                <div
                  key={`empty-${place}`}
                  class={`character-card empty${clickable ? " clickable" : ""}${isSelected ? " selected" : ""}`}
                  data-place={String(place)}
                  onClick={clickable ? () => handlePlaceClick(place) : undefined}
                  title={clickable ? t("seat.goTo", { place }) : t("seat.free")}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") handlePlaceClick(place); } : undefined}
                >
                  {badge && (
                    <img class="place-status-icon" src={badge.icon} alt="" title={t(badge.labelKey)} />
                  )}
                  <div class="character-portrait"><span class="portrait-fallback">+</span></div>
                  <span class="character-name">{t("seat.free")}</span>
                  <span class="character-last-msg">—</span>
                </div>
              );
            })}
          </div>
          {standing.length > 0 && (
            <div class="room-standing" style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 5, background: "rgba(20,12,8,0.82)", borderTop: "1px solid rgba(221,191,170,0.25)", padding: "6px 8px", maxHeight: "38%", overflowY: "auto" }}>
              <div class="room-standing-title" style={{ fontSize: "11px", fontWeight: 700, color: "#ddbfaa", marginBottom: 6 }}>
                {t("seat.standing", { n: standing.length })}
              </div>
              <div class="room-standing-list" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {standing.map((name) => {
                  const nameLower = name.toLowerCase();
                  const last = [...props.messages].reverse().find((m) => (m.login ?? "").toLowerCase() === nameLower);
                  const isEmote = last?.type === "emote";
                  const chopine = last ? isChopineText(last.content) : false;
                  const isOwn = !!currentLower && nameLower === currentLower;
                  const isTyping = typingUsers.includes(nameLower);
                  return (
                    <div
                      key={`standing-${nameLower}-${avatarRefresh}`}
                      class={`character-card standing${isOwn ? " own-player" : ""}`}
                      title={isOwn ? t("seat.ownStanding") : name}
                      style={{ position: "relative", left: "auto", top: "auto", transform: "none", width: 84, opacity: 1, animation: "none" }}
                    >
                      <div class="character-portrait" style={{ width: 64, height: 64 }}>
                        <AvatarPortrait login={name} />
                      </div>
                      <span class="character-name" title={name} style={{ maxWidth: 80 }}>{name}</span>
                      <span class={`character-last-msg${isEmote ? " emote" : ""}${chopine ? " chopine" : ""}`}>
                        {isTyping ? (
                          <div class="lds-ellipsis" aria-label={t("chat.typingLabel", { user: name })}><div></div><div></div><div></div><div></div></div>
                        ) : last ? last.content.slice(0, 56) : "—"}
                      </span>
                      {showPlayerMenu && !isOwn && props.onOfferDrink && (
                        <PlayerMenu login={name} onOfferDrink={props.onOfferDrink} onWhisper={handleWhisperTo} hideDrink={isChurch} targetAcceptsAlcool={props.alcoolByLogin?.[name.toLowerCase()] ?? null} onKick={props.onKickPlayer} onBan={props.onBanPlayer} onUnban={props.onUnbanPlayer} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div class="room-chat">
          <ChatHeader
            tavernName={props.tavernName}
            isConnected={props.isConnected}
            onDisconnect={props.onDisconnect}
            onCopy={props.onCopy}
            onRefreshPortraits={handleRefreshPortraits}
            ecus={props.ecus}
            ecusPulse={props.ecusPulse}
            menus={props.menus}
            onOrderMenu={props.onOrderMenu}
            onOrderDrink={props.onOrderDrink}
            onBuyTournee={props.onBuyTournee}
            lieu={props.lieu}
            alcoolRate={props.alcoolRate}
            accepteAlcool={props.accepteAlcool}
            onToggleAlcool={props.onToggleAlcool}
          />

          <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <MessageList messages={props.messages} listRef={listRef} onScroll={handleScroll} players={baseList} />
            {showScrollBtn && (
              <button class="room-scroll-btn" onClick={scrollToBottom}>
                {pendingCount > 0
                  ? t(pendingCount > 1 ? "chat.scrollNewMany" : "chat.scrollNewOne", { n: pendingCount })
                  : t("chat.scrollNew")}
              </button>
            )}
          </div>

          <div class="room-input-area">
            {/* Lane F2 — zoneQuiEcrit (official .taverne_zoneQuiEcrit). */}
            {typingText && (
              <div class="zone-qui-ecrit" role="status" aria-live="polite">{typingText}</div>
            )}
            {/* Lane F3 — flood mute (official onBanFlood): input locked ~30s. */}
            {props.floodMuted && (
              <div class="tavern-mute" role="status" aria-live="polite">{t("tavern.floodMute")}</div>
            )}
            <div class="room-input-wrap" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                class="room-textarea"
                ref={textareaRef}
                value={props.inputMessage}
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={t("chat.placeholder")}
                maxlength={MSG_DISPLAY_MAX}
                disabled={!props.isConnected || props.floodMuted ? true : undefined}
                rows={2}
                style={{ flex: 1 }}
              ></textarea>
              <button
                class="room-send-btn"
                onClick={handleSendWrapper}
                disabled={!props.inputMessage.trim() || !props.isConnected || props.floodMuted}
                aria-label={t("chat.send")}
              />
            </div>
          </div>
          <div class="room-status-bar">
            <span
              ref={triggerRef}
              class={`room-presence${props.isConnected ? " is-online" : " is-offline"}`}
              title={presenceTooltip}
              tabIndex={0}
              aria-describedby={presenceOpen && hasPresenceList ? presenceTipId : undefined}
              onMouseEnter={openPresenceTip}
              onMouseLeave={schedulePresenceClose}
              onFocus={openPresenceTip}
              onBlur={schedulePresenceClose}
            >
              ● {props.isConnected ? t("presence.online") : t("presence.offline")} · {presenceCount}
            </span>
            {presenceOpen && hasPresenceList && presencePos && createPortal(
              <span
                id={presenceTipId}
                class="room-presence-tooltip room-presence-tooltip--floating"
                role="tooltip"
                style={
                  presencePos.bottom !== undefined
                    ? { left: `${presencePos.left}px`, bottom: `${presencePos.bottom}px`, maxHeight: `${presencePos.maxHeight}px` }
                    : { left: `${presencePos.left}px`, top: `${presencePos.top ?? 0}px`, maxHeight: `${presencePos.maxHeight}px` }
                }
                onMouseEnter={cancelPresenceClose}
                onMouseLeave={schedulePresenceClose}
              >
                {props.presentUsers.map((n) => (
                  <span key={n} class="room-presence-name">{n}</span>
                ))}
              </span>,
              document.body,
            )}
            <span class="room-status-count">
              {props.inputMessage.length}/{MSG_DISPLAY_MAX} · {t("chat.messageCount", { n: msgCount, s: msgCount !== 1 ? "s" : "" })}
            </span>
          </div>
        </div>
      </div>
      {/* Lane F1 — tournée générale overlay (auto-dismissed after ~5s). */}
      {props.tournee && (
        <TourneeOverlay login={props.tournee.login} onClose={() => props.clearTournee?.()} />
      )}
      {/* Lane F3 — fatal blocking overlay (kick / ban / refresh request). */}
      {fatalKind && (
        <FatalOverlay kind={fatalKind} onDisconnect={props.onDisconnect} onRefresh={handleRefreshPage} />
      )}
    </div>
  );
}
