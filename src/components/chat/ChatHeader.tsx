import { Copy, Check, ArrowClockwise, SpeakerOn, SpeakerOff } from "../../lib/utils/icons";
import { t } from "../../lib/i18n";
import { isSoundEnabled, setSoundEnabled } from "../../lib/utils/sound";
import LanguageSwitcher from "../ui/LanguageSwitcher";
import { useState } from "preact/hooks";

interface Props {
  tavernName: string;
  isConnected: boolean;
  messageCount: number;
  presentUsers?: string[];
  onDisconnect: () => void;
  onCopy?: () => Promise<void>;
  onRefreshPortraits: () => void;
}

export default function ChatHeader({ tavernName, isConnected, messageCount, presentUsers, onDisconnect, onCopy, onRefreshPortraits }: Props) {
  const [copied, setCopied] = useState(false);
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
  const handleCopy = async () => {
    if (!onCopy) return;
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
  };
  const count = presentUsers ? presentUsers.length : messageCount;
  const names = presentUsers && presentUsers.length ? presentUsers.join(", ") : t("presence.none");
  const tooltip =
    presentUsers && presentUsers.length
      ? t("presence.tooltip", { count, s: count > 1 ? "s" : "", names })
      : isConnected
        ? t("status.online")
        : t("status.offline");
  return (
    <div class="room-chat-header">
      <div class="room-chat-header-left">
        <span class="room-name" title={tavernName}>{tavernName || t("tavern.defaultName")}</span>
        <span
          class="room-presence"
          title={tooltip}
          style={{ fontSize: "var(--text-xs)", color: isConnected ? "#a6e3a1" : "#f38ba8", marginLeft: 6, position: "relative", cursor: "default" }}
        >
          ● {isConnected ? t("presence.online") : t("presence.offline")} · {count}
          {presentUsers && presentUsers.length > 0 && (
            <span class="room-presence-tooltip" role="tooltip">
              {presentUsers.map((n) => (
                <span key={n} class="room-presence-name">{n}</span>
              ))}
            </span>
          )}
        </span>
      </div>
      <div class="room-chat-header-actions" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {onCopy && (
          <button
            onClick={handleCopy}
            title={t("chat.copyTitle")}
            aria-label={t("chat.copyLabel")}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: copied ? "rgba(166,227,161,0.18)" : "rgba(255,255,255,0.06)",
              color: copied ? "#a6e3a1" : "#bcc4d7",
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        )}
        <button
          onClick={onRefreshPortraits}
          title={t("chat.refreshTitle")}
          aria-label={t("chat.refreshTitle")}
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.06)",
            color: "#bcc4d7",
          }}
        >
          <ArrowClockwise size={16} />
        </button>
        <button
          onClick={toggleSound}
          title={t(soundOn ? "chat.soundOff" : "chat.soundOn")}
          aria-label={t(soundOn ? "chat.soundOff" : "chat.soundOn")}
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.06)",
            color: "#bcc4d7",
          }}
        >
          {soundOn ? <SpeakerOn size={16} /> : <SpeakerOff size={16} />}
        </button>
        <LanguageSwitcher />
        <button
          onClick={onDisconnect}
          disabled={!isConnected}
          title={t("chat.quitTitle")}
          style={{
            padding: "6px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(243,139,168,0.35)",
            background: "rgba(243,139,168,0.12)",
            color: "#f38ba8",
            fontSize: "var(--text-xs)",
            fontWeight: 600,
          }}
        >
          {t("chat.quit")}
        </button>
      </div>
    </div>
  );
}