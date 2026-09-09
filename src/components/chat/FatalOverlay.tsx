import { t } from "../../lib/i18n";
import { Alert } from "../../lib/utils/icons";

export type FatalKind = "kicked" | "banned" | "refresh";

interface Props {
  kind: FatalKind;
  onDisconnect: () => void;
  onRefresh: () => void;
}

// Lane F3 — full-screen blocking overlay for fatal tavern states, modelled
// on TourneeOverlay/bredouille patterns (click does NOT dismiss: a single
// explicit action is required). Kick/ban reuse the existing disconnect flow
// (ChatHeader's "Quitter" → App handleLeaveRoom); the refresh request uses
// window.location.reload(), mirroring official onMAJTaverne.
export default function FatalOverlay({ kind, onDisconnect, onRefresh }: Props) {
  const refresh = kind === "refresh";
  const title = refresh
    ? t("tavern.fatalRefreshTitle")
    : t(kind === "kicked" ? "tavern.fatalKickTitle" : "tavern.fatalBanTitle");
  const message = refresh
    ? t("tavern.fatalRefreshMsg")
    : t(kind === "kicked" ? "tavern.kickedSelf" : "tavern.bannedSelf");
  return (
    <div class="fatal-overlay" role="alertdialog" aria-modal="true" aria-label={title}>
      <div class="fatal-card">
        <div class="fatal-icon" aria-hidden="true">
          <Alert size={28} />
        </div>
        <div class="fatal-title">{title}</div>
        <div class="fatal-message">{message}</div>
        {refresh ? (
          <button type="button" class="fatal-action" onClick={onRefresh}>
            {t("tavern.refreshNow")}
          </button>
        ) : (
          <button type="button" class="fatal-action" onClick={onDisconnect}>
            {t("auth.disconnect")}
          </button>
        )}
      </div>
    </div>
  );
}
