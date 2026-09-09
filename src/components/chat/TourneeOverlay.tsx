import { t } from "../../lib/i18n";
import illustration from "../../assets/images/interieurTaverne/tourneeGenerale_illustration.png";

interface Props {
  login: string; // display (ucfirst) — donor of the general round
  onClose: () => void;
}

// Lane F1 — tournée générale animated overlay (official
// notificationTourneeGenerale .actif). The parent auto-dismisses after ~5s;
// clicking dismisses immediately.
export default function TourneeOverlay({ login, onClose }: Props) {
  return (
    <div class="tournee-overlay" onClick={onClose} role="status">
      <div class="tournee-card">
        <img class="tournee-illustration" src={illustration} alt="" />
        <div class="tournee-text">{t("tavern.tourneeOverlay", { user: login })}</div>
      </div>
    </div>
  );
}
