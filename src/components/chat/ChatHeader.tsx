import type { TavernMenus, EcusPulse } from "../../lib/types";
import MenuPopup from "./MenuPopup";
import HeaderMenu from "./HeaderMenu";
import { t } from "../../lib/i18n";
import orIcon from "../../assets/images/interieurTaverne/ui_icone_or_@2X.png";
import menuIcon from "../../assets/images/interieurTaverne/ui_iconeMenu_@2X.png";
import choppeIcon from "../../assets/images/interieurTaverne/iconeMini_choppe.png";
import { useState } from "preact/hooks";

// Lane F3 — official drunkenness scale is ~0..20 (blurWithAlcool: effect
// from 10, capped at 20). The gauge maps it to 0..100 %.
const ALCOOL_MAX = 20;

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
  const isChurch = (lieu ?? "").trim().toLowerCase() === "eglise";
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
  return (
    <div class="room-chat-header">
      <div class="room-chat-header-left">
        <span class="room-name" title={tavernName}>{tavernName || t("tavern.defaultName")}</span>
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
        {/* Lane F3 — drunkenness gauge (taverneChangeTauxAlcool, ~0..20 →
            percent). Unobtrusive: choppe icon + percent near the écus. */}
        {alcoolPct !== null && alcoolLevel && (
          <span
            class={`room-alcool alcool-${alcoolLevel}`}
            title={t("tavern.alcoolTitle", { pct: alcoolPct })}
          >
            <img class="room-ecus-icon" src={choppeIcon} alt="" />
            {alcoolPct} %
          </span>
        )}
        {/* Lane F3 — proactive alcohol consent (official
            #chatMenuInputAccepteAlcool checkbox → taverneAccepteAlcool).
            Hidden until the state is known and in church mode. */}
        {onToggleAlcool && accepteAlcool !== null && accepteAlcool !== undefined && !isChurch && (
          <button
            type="button"
            onClick={onToggleAlcool}
            title={t(accepteAlcool ? "tavern.alcoolRefuse" : "tavern.alcoolAccept")}
            aria-label={t(accepteAlcool ? "tavern.alcoolRefuse" : "tavern.alcoolAccept")}
            aria-pressed={accepteAlcool}
            class={`alcool-toggle${accepteAlcool ? " is-on" : " is-off"}`}
          >
            <img class="room-ecus-icon" src={choppeIcon} alt="" />
          </button>
        )}
      </div>
      <div class="room-chat-header-actions" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {/* Lane F1 — tavern menu popup (plats + drink + general round). */}
        {menus && onOrderMenu && onOrderDrink && onBuyTournee && (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title={t("tavern.menuTitle")}
              aria-label={t("tavern.menuTitle")}
              aria-expanded={menuOpen}
              style={{
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.06)",
                padding: 4,
              }}
            >
              <img src={menuIcon} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />
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