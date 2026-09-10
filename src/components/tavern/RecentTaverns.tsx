import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { t } from "../../lib/i18n";
import type { RecentTavernsProps } from "../../lib/types";

// Recent taverns: chip row. Click selects only (Enter stays in TavernSelect).
// Single row: chips that don't fit entirely are hidden (no partial chips ever).
export default function RecentTaverns(props: RecentTavernsProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [maxVisible, setMaxVisible] = useState(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const rowRect = row.getBoundingClientRect();
      let count = 0;
      for (const child of Array.from(row.children)) {
        const rect = (child as HTMLElement).getBoundingClientRect();
        if (rect.right <= rowRect.right + 0.5) {
          count++;
        } else {
          break;
        }
      }
      setMaxVisible(count);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [props.tavernIds, props.taverns]);

  if (props.tavernIds.length === 0) return null;

  const byId = new Map(props.taverns.map((tav) => [tav.id, tav]));
  const visible = props.tavernIds.filter((id) => byId.has(id));
  if (visible.length === 0) return null;

  return (
    <div class="recents">
      <p class="recents-title">{t("recents.title")}</p>
      <div class="recents-row" role="group" aria-label={t("recents.title")} ref={rowRef}>
        {visible.map((id, index) => {
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
              style={index >= maxVisible ? { visibility: "hidden" } : undefined}
            >
              {tav.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
