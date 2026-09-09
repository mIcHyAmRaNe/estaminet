import { t } from "../../lib/i18n";
import { RK_BASE } from "../../lib/config";
import choppeIcon from "../../assets/images/interieurTaverne/iconeMini_choppe.png";
import whisperIcon from "../../assets/images/interieurTaverne/iconeMini_chuchoter.png";

interface Props {
  login: string; // display (ucfirst) — server logins are matched case-insensitively
  onOfferDrink: (login: string) => void;
  onWhisper: (login: string) => void;
  // Lane F3 — church mode (lieu === 'eglise'): hide the drink entry.
  hideDrink?: boolean;
  // Tisane rules: the target's alcohol consent (null/unknown → assume
  // accepts). When false the offer entry becomes a (free) tisane.
  targetAcceptsAlcool?: boolean | null;
  // Lane F3 — moderation, shown unconditionally (player payloads carry no
  // role/status data, so visibility cannot be derived client-side; the
  // server enforces rights and answers PasAutoKick/PasAutoBan otherwise).
  onKick?: (login: string) => void;
  onBan?: (login: string) => void;
  onUnban?: (login: string) => void;
}

// Lane F1 — portrait hover context menu (official optionsPerso) for OTHER
// players: offer a drink (taverneOffreVerre), whisper (prefills /w), character
// sheet (official FichePersonnage.php profile). Revealed on card hover via CSS.
export default function PlayerMenu({ login, onOfferDrink, onWhisper, hideDrink, targetAcceptsAlcool, onKick, onBan, onUnban }: Props) {
  const profileUrl = `${RK_BASE}/FichePersonnage.php?login=${encodeURIComponent(login)}`;
  return (
    <div class="player-menu" role="menu">
      {!hideDrink && (
        <button
          type="button"
          class="player-menu-item"
          role="menuitem"
          onClick={(e: Event) => {
            e.stopPropagation();
            onOfferDrink(login);
          }}
        >
          <img class="player-menu-icon" src={choppeIcon} alt="" />
          {targetAcceptsAlcool === false ? t("tavern.playerOfferTisane") : t("tavern.playerOffer")}
        </button>
      )}
      <button
        type="button"
        class="player-menu-item"
        role="menuitem"
        onClick={(e: Event) => {
          e.stopPropagation();
          onWhisper(login);
        }}
      >
        <img class="player-menu-icon" src={whisperIcon} alt="" />
        {t("tavern.playerWhisper")}
      </button>
      <a
        class="player-menu-item"
        role="menuitem"
        href={profileUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e: Event) => e.stopPropagation()}
      >
        <span class="player-menu-external" aria-hidden="true">↗</span>
        {t("tavern.playerProfile")}
      </a>
      {onKick && (
        <button
          type="button"
          class="player-menu-item danger"
          role="menuitem"
          onClick={(e: Event) => {
            e.stopPropagation();
            onKick(login);
          }}
        >
          <span class="player-menu-external" aria-hidden="true">✕</span>
          {t("tavern.playerKick")}
        </button>
      )}
      {onBan && (
        <button
          type="button"
          class="player-menu-item danger"
          role="menuitem"
          onClick={(e: Event) => {
            e.stopPropagation();
            if (!confirm(t("tavern.confirmBan", { user: login }))) return;
            onBan(login);
          }}
        >
          <span class="player-menu-external" aria-hidden="true">⊘</span>
          {t("tavern.playerBan")}
        </button>
      )}
      {onUnban && (
        <button
          type="button"
          class="player-menu-item"
          role="menuitem"
          onClick={(e: Event) => {
            e.stopPropagation();
            onUnban(login);
          }}
        >
          <span class="player-menu-external" aria-hidden="true">↩</span>
          {t("tavern.playerUnban")}
        </button>
      )}
    </div>
  );
}
