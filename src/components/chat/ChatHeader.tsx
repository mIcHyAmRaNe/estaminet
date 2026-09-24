import type { TavernMenus, EcusPulse } from "../../lib/types";
import { LIEU_EGLISE } from "../../lib/config";
import MenuPopup from "./MenuPopup";
import HeaderMenu from "./HeaderMenu";
import { t } from "../../lib/i18n";
import orIcon from "../../assets/images/interieurTaverne/ui_icone_or_@2X.png";
import menuIcon from "../../assets/images/interieurTaverne/ui_iconeMenu_@2X.png";
import { useState } from "preact/hooks";

// Lane F3 — official drunkenness scale is ~0..20 (blurWithAlcool: effect
// from 10, capped at 20). The gauge maps it to 0..100 %.
const ALCOOL_MAX = 20;
// Ring geometry for the circular gauge (r=7 → C≈43.98).
const GAUGE_R = 7;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

function ChoppeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none">
      <circle cx="10" cy="7.4" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="13.2" cy="6.6" r="2" fill="currentColor" stroke="none" />
      <circle cx="15.9" cy="7.7" r="1.3" fill="currentColor" stroke="none" />
      <path
        d="M7 9.5h10V15a3.5 3.5 0 0 1-3.5 3.5h-3A3.5 3.5 0 0 1 7 15V9.5Z"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path
        d="M17 10.8h.7a2.6 2.6 0 0 1 0 5.2H17"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

interface Props {
  tavernName: string;
  isConnected: boolean;
  onDisconnect: () => void;
  onCopy?: () => Promise<void>;
  onRefreshPortraits: () => void;
  // Lane F1 — social/economy (optional; hidden until the data arrives).
  ecus?: number | null;
  ecusPulse?: EcusPulse | null;
  menus?: TavernMenus;
  onOrderMenu?: (id: number) => void;
  onOrderDrink?: () => void;
  onBuyTournee?: () => void;
  // Lane F2 — ground type (church mode hides ALL drink features).
  lieu?: string | null;
  // Lane F3 — drunkenness + alcohol consent (both hidden until known).
  alcoolRate?: number | null;
  accepteAlcool?: boolean | null;
  onToggleAlcool?: () => void;
}

export default function ChatHeader({ tavernName, isConnected, onDisconnect, onCopy, onRefreshPortraits, ecus, ecusPulse, menus, onOrderMenu, onOrderDrink, onBuyTournee, lieu, alcoolRate, accepteAlcool, onToggleAlcool }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Lane F3 — church mode: the official client hides ALL drink features.
  const isChurch = (lieu ?? "").trim().toLowerCase() === LIEU_EGLISE;
  // Lane F3 — drunkenness gauge (official ~0..20 scale → percent).
  const alcoolPct =
    alcoolRate === null || alcoolRate === undefined
      ? null
      : Math.max(0, Math.min(100, Math.round((alcoolRate / ALCOOL_MAX) * 100)));
  const alcoolLevel =
    alcoolRate === null || alcoolRate === undefined
      ? null
      : alcoolRate >= ALCOOL_MAX
        ? "high"
        : alcoolRate >= 10
          ? "mid"
          : "low";
  const hasEcus = ecus !== null && ecus !== undefined;
  const canToggle = !!onToggleAlcool && accepteAlcool !== null && accepteAlcool !== undefined && !isChurch;
  const hasGauge = alcoolPct !== null && alcoolLevel !== null;
  const showAlcool = hasGauge || canToggle;
  const gaugeOffset = alcoolPct === null ? GAUGE_C : GAUGE_C * (1 - alcoolPct / 100);
  return (
    <div class="room-chat-header">
      <div class="room-chat-header-left">
        <span class="room-name" title={tavernName}>{tavernName || t("tavern.defaultName")}</span>
      <div class="room-status-meta">
        {/* Lane F1 — écus balance (taverneMajPerso infos.argent / 100).
            Hidden until the first purse event; +/- pulse on spends. */}
        {ecus !== null && ecus !== undefined && (
          <span
            key={ecusPulse ? `ecus-${ecusPulse.key}` : "ecus-idle"}
            class={`room-ecus${ecusPulse ? ` ecus-${ecusPulse.dir}` : ""}`}
            title={t("tavern.ecusTitle")}
          >
            <img class="room-ecus-icon" src={orIcon} alt="" />
            {Number.isInteger(ecus) ? String(ecus) : ecus.toFixed(2)}
          </span>
        )}
        {/* Lane F3 — single alcool cluster: consent toggle (chromeless SVG
            tint) + circular drunkenness gauge. One choppe, one meaning each. */}
        {showAlcool && (
          <>
            {hasEcus && <span class="room-status-sep" aria-hidden="true" />}
            <span class="alcool-cluster">
              {canToggle && (
                <button
                  type="button"
                  onClick={onToggleAlcool}
                  title={t(accepteAlcool ? "tavern.alcoolRefuse" : "tavern.alcoolAccept")}
                  aria-label={t(accepteAlcool ? "tavern.alcoolRefuse" : "tavern.alcoolAccept")}
                  aria-pressed={accepteAlcool}
                  class={`alcool-toggle${accepteAlcool ? " is-on" : " is-off"}`}
                >
                  <ChoppeGlyph />
                </button>
              )}
              {hasGauge && (
                <span
                  class={`alcool-gauge alcool-${alcoolLevel}`}
                  title={t("tavern.alcoolTitle", { pct: alcoolPct })}
                  role="img"
                  aria-label={t("tavern.alcoolTitle", { pct: alcoolPct })}
                >
                  <svg class="alcool-ring" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                    <circle cx="10" cy="10" r={GAUGE_R} fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2.5" />
                    <circle
                      cx="10"
                      cy="10"
                      r={GAUGE_R}
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-dasharray={GAUGE_C}
                      stroke-dashoffset={gaugeOffset}
                      transform="rotate(-90 10 10)"
                    />
                  </svg>
                  <span class="alcool-pct" aria-hidden="true">{alcoolPct} %</span>
                </span>
              )}
            </span>
          </>
        )}
      </div>
      </div>
      <div class="room-chat-header-actions">
        {/* Lane F1 — tavern menu popup (plats + drink + general round). */}
        {menus && onOrderMenu && onOrderDrink && onBuyTournee && (
          <div class="menu-popup-anchor">
            <button
              type="button"
              class="header-menu-trigger room-menu-btn"
              onClick={() => setMenuOpen((v) => !v)}
              title={t("tavern.menuTitle")}
              aria-label={t("tavern.menuTitle")}
              aria-expanded={menuOpen}
            >
              <img src={menuIcon} alt="" class="room-menu-btn-icon" />
            </button>
            {menuOpen && (
              <MenuPopup
                menus={menus}
                onOrderMenu={onOrderMenu}
                onOrderDrink={onOrderDrink}
                onBuyTournee={onBuyTournee}
                onClose={() => setMenuOpen(false)}
                hideDrinks={isChurch}
                selfAcceptsAlcool={accepteAlcool}
              />
            )}
          </div>
        )}
        <HeaderMenu onCopy={onCopy} onRefreshPortraits={onRefreshPortraits} />
        <button
          type="button"
          class="room-quit-btn"
          onClick={onDisconnect}
          disabled={!isConnected}
          title={t("chat.quitTitle")}
        >
          {t("chat.quit")}
        </button>
      </div>
    </div>
  );
}