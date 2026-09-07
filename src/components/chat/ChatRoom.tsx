import { useRef, useEffect } from "preact/hooks";
import type { ChatRoomProps } from "../../lib/types";
import { t } from "../../lib/i18n";
import { useAutoScroll } from "../../lib/hooks/useAutoScroll";
import { isChopineText } from "../../lib/utils/chat-guards";
import ChatHeader from "./ChatHeader";
import MessageList from "./MessageList";
import AvatarPortrait from "./AvatarPortrait";

export default function ChatRoom(props: ChatRoomProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const { showScrollBtn, pendingCount, scrollToBottom, handleScroll } = useAutoScroll(props.messages, listRef, 100);

  const msgCount = props.messages.length;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onSend(e as unknown as Event);
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
              if (name) {
                const nameLower = name.toLowerCase();
                const last = [...props.messages].reverse().find((m) => (m.login ?? "").toLowerCase() === nameLower);
                const isEmote = last?.type === "emote";
                const chopine = last ? isChopineText(last.content) : false;
                return (
                  <div
                    key={`player-${name.toLowerCase()}`}
                    class={`character-card${isOwn ? " own-player" : ""}${isSelected ? " selected" : ""}`}
                    data-place={String(place)}
                    title={isOwn ? t("seat.own") : name}
                  >
                    <div class="character-portrait">
                      <AvatarPortrait login={name} />
                    </div>
                    <span class="character-name" title={name}>{name}</span>
                    <span class={`character-last-msg${isEmote ? " emote" : ""}${chopine ? " chopine" : ""}`}>
                      {last ? last.content.slice(0, 56) : "—"}
                    </span>
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
                  return (
                    <div
                      key={`standing-${nameLower}`}
                      class={`character-card standing${isOwn ? " own-player" : ""}`}
                      title={isOwn ? t("seat.ownStanding") : name}
                      style={{ position: "relative", left: "auto", top: "auto", transform: "none", width: 84, opacity: 1, animation: "none" }}
                    >
                      <div class="character-portrait" style={{ width: 64, height: 64 }}>
                        <AvatarPortrait login={name} />
                      </div>
                      <span class="character-name" title={name} style={{ maxWidth: 80 }}>{name}</span>
                      <span class={`character-last-msg${isEmote ? " emote" : ""}${chopine ? " chopine" : ""}`}>
                        {last ? last.content.slice(0, 56) : "—"}
                      </span>
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
            messageCount={msgCount}
            presentUsers={props.presentUsers}
            onDisconnect={props.onDisconnect}
            onCopy={props.onCopy}
          />

          <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <MessageList messages={props.messages} listRef={listRef} onScroll={handleScroll} />
            {showScrollBtn && (
              <button class="room-scroll-btn" onClick={scrollToBottom}>
                {pendingCount > 0
                  ? t(pendingCount > 1 ? "chat.scrollNewMany" : "chat.scrollNewOne", { n: pendingCount })
                  : t("chat.scrollNew")}
              </button>
            )}
          </div>

          <div class="room-input-area">
            <div class="room-input-wrap" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                class="room-textarea"
                value={props.inputMessage}
                onInput={(e: Event) => props.setInputMessage((e.target as HTMLTextAreaElement).value)}
                onKeyDown={handleKeyDown}
                placeholder={t("chat.placeholder")}
                maxlength={500}
                disabled={!props.isConnected ? true : undefined}
                rows={2}
                style={{ flex: 1 }}
              ></textarea>
              <button
                class="room-send-btn"
                onClick={props.onSend}
                disabled={!props.inputMessage.trim() || !props.isConnected}
                aria-label={t("chat.send")}
              />
            </div>
          </div>
          <div class="room-char-count">
            <span style={{ fontSize: "var(--text-xs)", background: "rgba(44,30,21,0.85)", padding: "4px 16px", borderRadius: "var(--radius-sm)", color: "#d5b4a1", fontWeight: 600 }}>
              {props.inputMessage.length}/500 · {t("chat.messageCount", { n: msgCount, s: msgCount !== 1 ? "s" : "" })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
