import { t } from "../../lib/i18n";
import type { RecentTavernsProps } from "../../lib/types";

// Recent taverns: chip row. Click selects only (Enter stays in TavernSelect).
export default function RecentTaverns(props: RecentTavernsProps) {
  if (props.tavernIds.length === 0) return null;

  const byId = new Map(props.taverns.map((tav) => [tav.id, tav]));
  const visible = props.tavernIds.filter((id) => byId.has(id));
  if (visible.length === 0) return null;

  return (
    <div class="recents">
      <p class="recents-title">{t("recents.title")}</p>
      <div class="recents-row" role="group" aria-label={t("recents.title")}>
        {visible.map((id) => {
          const tav = byId.get(id);
          if (!tav) return null;
          const active = id === props.selectedId;
          return (
            <button
              key={id}
              type="button"
              class={`recent-chip${active ? " is-active" : ""}`}
              onClick={() => props.onPick(id)}
              title={tav.ville}
              aria-pressed={active}
            >
              {tav.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
