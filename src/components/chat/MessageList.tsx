import type { ChatMessage } from "../../lib/types";
import { ArrowRight, ArrowExit, Alert, WhisperIcon, ServiceBell } from "../../lib/utils/icons";
import { computeMessageUnits } from "../../lib/utils/message-utils";
import { isChopine } from "../../lib/utils/chat-guards";
import { t } from "../../lib/i18n";

interface Props {
  messages: ChatMessage[];
  listRef: { current: HTMLDivElement | null };
  onScroll: () => void;
}

export default function MessageList({ messages, listRef, onScroll }: Props) {
  if (messages.length === 0) {
    return (
      <div class="room-messages" role="log" aria-live="polite" ref={listRef} onScroll={onScroll}>
        <div class="room-message system">{t("chat.welcome")}</div>
      </div>
    );
  }

  const isSpecial = (m: ChatMessage) => m.type !== "normal";
  const { units } = computeMessageUnits(messages, isSpecial);

  // Entry/exit detection by localized phrase: system messages are generated
  // by useTaverne through the same i18n keys, so the markers follow the
  // active locale. Historical messages written in the other locale simply
  // fall back to plain system styling.
  const enterMarker = t("chat.enter", { user: "" }).trim();
  const leaveMarker = t("chat.leave", { user: "" }).trim();

  return (
    <div class="room-messages" role="log" aria-live="polite" ref={listRef} onScroll={onScroll}>
      {units.map((unit) => {
        if (unit.kind === "single") {
          const msg = unit.msg;
          const chopine = isChopine(msg.content);
          const isEntry = msg.type === "system" && msg.content.includes(enterMarker);
          const isExit = msg.type === "system" && msg.content.includes(leaveMarker);
          const isEmote = msg.type === "emote";

          if (isEntry || isExit || isEmote || (msg.type === "system" && chopine)) {
            const cls =
              "room-message emote" +
              (chopine ? " chopine" : "") +
              (isEntry ? " entry" : "") +
              (isExit ? " exit" : "");
            const text = isEmote ? `${msg.login ?? ""} ${msg.content ?? ""}`.trim() : (msg.content ?? "");
            return (
              <div key={msg.id} class={cls}>
                <div class="room-msg-content">
                  {isEntry && <ArrowRight size={14} />}
                  {isExit && <ArrowExit size={14} />}
                  {chopine && !isEntry && !isExit && <ServiceBell size={14} />}
                  {isEntry || isExit || chopine ? " " : null}
                  {text}
                </div>
              </div>
            );
          }

          if (msg.type === "system") {
            return (
              <div key={msg.id} class="room-message system">
                <div class="room-msg-content">{msg.content}</div>
              </div>
            );
          }

          if (msg.type === "error") {
            return (
              <div key={msg.id} class="room-message error">
                <div class="room-msg-content" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Alert size={14} /> {msg.content}
                </div>
              </div>
            );
          }

          if (msg.type === "whisper") {
            // Anti-"undefined" guard: content only renders when truthy.
            // The short form (no message) is a system notice, never a bubble.
            const whisperLogin = msg.login && msg.login !== "undefined" ? msg.login : "";
            const whisperTarget = msg.whisperTarget && msg.whisperTarget !== "undefined" ? msg.whisperTarget : null;
            const whisperContent = msg.content && msg.content !== "undefined" ? msg.content : null;
            if (!whisperContent) return null;
            return (
              <div key={msg.id} class="room-message whisper">
                <div class="room-msg-header">
                  <span class="room-msg-username" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <WhisperIcon size={12} /> {whisperLogin}{whisperTarget ? ` -> ${whisperTarget}` : null}
                  </span>
                  <span class="room-msg-timestamp">{new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div class="room-msg-content">{whisperContent}</div>
              </div>
            );
          }

          return null;
        }

        const msgs = unit.messages;
        const lead = msgs[0];
        const time = new Date(lead.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return (
          <div key={`grp-${lead.id}`} class="room-message">
            <div class="room-msg-header">
              <span class="room-msg-username">{lead.login}</span>
              <span class="room-msg-timestamp">{time}</span>
            </div>
            {msgs.map((m) => (
              <div key={m.id} class="room-msg-content" style={{ marginTop: 3 }}>
                {m.content}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
