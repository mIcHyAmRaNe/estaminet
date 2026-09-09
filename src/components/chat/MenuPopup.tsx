import type { TavernMenus } from "../../lib/types";
import { t } from "../../lib/i18n";
import { formatEcus } from "../../lib/utils/ecus";
import orIcon from "../../assets/images/interieurTaverne/ui_icone_or_@2X.png";
import choppeIcon from "../../assets/images/interieurTaverne/ui_iconeChoppe_@2X.png";
import tourneeIcon from "../../assets/images/interieurTaverne/ui_iconeTournee_@2X.png";

interface Props {
  menus: TavernMenus;
  onOrderMenu: (id: number) => void;
  onOrderDrink: () => void;
  onBuyTournee: () => void;
  onClose: () => void;
  // Lane F3 — church mode (lieu === 'eglise'): the official client hides
  // ALL drink features. Menus + tournée keep working; a subtle note
  // replaces the drink row.
  hideDrinks?: boolean;
  // Tisane rules: self's alcohol consent (null/unknown → assume accepts).
  // When false the drink row becomes a (free) tisane.
  selfAcceptsAlcool?: boolean | null;
}

// Lane F1 — tavern menu popup (official popupMenu): plats with ingredients +
// price, drink row, general-round row. Ordering reuses the existing emits
// (/manger <id> → taverneCommandeRepas, /boire → taverneCommandeVerre).
export default function MenuPopup({ menus, onOrderMenu, onOrderDrink, onBuyTournee, onClose, hideDrinks, selfAcceptsAlcool }: Props) {
  const clickOrder = (id: number) => {
    onOrderMenu(id);
    onClose();
  };
  const clickDrink = () => {
    onOrderDrink();
    onClose();
  };
  const clickTournee = () => {
    onBuyTournee();
    onClose();
  };
  return (
    <div class="menu-popup" role="dialog" aria-label={t("tavern.menuTitle")}>
      <div class="menu-popup-header">
        <span class="menu-popup-title">{t("tavern.menuTitle")}</span>
        <button class="menu-popup-close" onClick={onClose} aria-label={t("tavern.close")}>✕</button>
      </div>
      <div class="menu-popup-list">
        {menus.plats.length === 0 && menus.boissonPrix === null && (
          <div class="menu-popup-empty">{t("tavern.menuEmpty")}</div>
        )}
        {menus.plats.map((plat) => (
          <div key={plat.id} class="menu-popup-row">
            <div class="menu-popup-dish">
              <span class="menu-popup-nom">
                {plat.nom}
                <span class="menu-popup-prix">
                  {formatEcus(plat.prix)}<img class="menu-popup-or" src={orIcon} alt="" />
                </span>
              </span>
              <span class="menu-popup-ingredients">
                {plat.ingredients.length > 0
                  ? t("tavern.menuIngredients", { list: plat.ingredients.join(", ") })
                  : t("tavern.menuNoIngredients")}
              </span>
            </div>
            <button class="menu-popup-order" onClick={() => clickOrder(plat.id)}>
              {t("tavern.order")}
            </button>
          </div>
        ))}
        {menus.boissonPrix !== null && !hideDrinks && (
          <div key="boisson" class="menu-popup-row">
            <div class="menu-popup-dish">
              <span class="menu-popup-nom">
                <img class="menu-popup-mini" src={choppeIcon} alt="" />
                <span class="menu-popup-prix">
                  {formatEcus(menus.boissonPrix)}<img class="menu-popup-or" src={orIcon} alt="" />
                </span>
              </span>
            </div>
            <button class="menu-popup-order" onClick={clickDrink}>
              {selfAcceptsAlcool === false ? t("tavern.orderTisane") : t("tavern.orderDrink")}
            </button>
          </div>
        )}
        {/* Lane F3 — church mode: subtle note where the drink row was. */}
        {hideDrinks && (
          <div class="menu-popup-note">{t("tavern.noAlcoholHere")}</div>
        )}
        <div key="tournee" class="menu-popup-row menu-popup-tournee">
          <div class="menu-popup-dish">
            <span class="menu-popup-nom">
              <img class="menu-popup-mini" src={tourneeIcon} alt="" />
              {t("tavern.buyTournee")}
            </span>
          </div>
          <button class="menu-popup-order" onClick={clickTournee}>
            {t("tavern.order")}
          </button>
        </div>
      </div>
    </div>
  );
}
