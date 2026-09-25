import { useTavernPresences } from "../../lib/hooks/useTavernPresences";
import { t } from "../../lib/i18n";
import { ArrowClockwise } from "../../lib/utils/icons";
import type { Tavern } from "../../lib/types";

// Right-side panel of the tavern picker: who is present, per tavern.
// Display-only — plain text rows (the clickable persona link comes later).
// Same quiet band language as .village-presence: dot + label head, muted
// fallbacks, never a silent gap (loading skeleton, error + retry, empty).
function PresenceSkeleton() {
  return (
    <div class="tavern-presence-skeleton" aria-hidden="true">
      <div class="tavern-presence-skel-line" style="width: 72%" />
      <div class="tavern-presence-skel-line" style="width: 54%" />
      <div class="tavern-presence-skel-line" style="width: 64%" />
      <div class="tavern-presence-skel-line" style="width: 42%" />
    </div>
  );
}

export default function TavernPresencePanel(props: { taverns?: Tavern[] }) {
  const { presences, loading, error, retry } = useTavernPresences();
  const retryLabel = t("tavernPresence.retry");
  const refreshLabel = t("tavernPresence.refresh");

  // Order blocks like the picker carousel when the tavern list is known;
  // unknown backend names trail after, in backend order. Taverns with no
  // roster entry at all read as empty (omitted below, like the band).
  const knownOrder = new Map<string, number>();
  for (const tav of props.taverns ?? []) {
    const key = tav.name.trim().toLowerCase();
    if (key && !knownOrder.has(key)) knownOrder.set(key, knownOrder.size);
  }
  const ordered = [...presences].sort((a, b) => {
    const ia = knownOrder.get(a.tavernName.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const ib = knownOrder.get(b.tavernName.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });
  const lively = ordered.filter((p) => p.occupants.length > 0);
  const totalHeads = presences.reduce((n, p) => n + p.occupants.length, 0);

  return (
    <section
      class="tavern-presence-panel"
      aria-live="polite"
      aria-label={t("tavernPresence.ariaLabel")}
      aria-busy={loading}
    >
      <div class="tavern-presence-panel-head">
        <span class={`tavern-presence-dot${loading ? "" : " is-on"}`} aria-hidden="true" />
        <span class="tavern-presence-panel-title">{t("tavernPresence.title")}</span>
        {!loading && !error && totalHeads > 0 && (
          <span class="tavern-presence-panel-count">{totalHeads}</span>
        )}
        <button
          type="button"
          class={`tavern-presence-refresh${loading ? " is-spinning" : ""}`}
          onClick={retry}
          disabled={loading}
          title={refreshLabel}
          aria-label={refreshLabel}
        >
          <ArrowClockwise size={15} />
        </button>
      </div>

      {loading && presences.length === 0 && <PresenceSkeleton />}

      {!loading && error && presences.length === 0 && (
        <div class="tavern-presence-error" role="alert">
          <span class="tavern-presence-error-text">{error}</span>
          <button type="button" class="tavern-presence-retry" onClick={retry}>
            {retryLabel}
          </button>
        </div>
      )}

      {!loading && (!error || presences.length > 0) && lively.length === 0 && (
        <p class="tavern-presence-empty">{t("tavernPresence.empty")}</p>
      )}

      {lively.length > 0 && (
        <div class="tavern-presence-blocks">
          {lively.map((block) => (
            <div class="tavern-presence-block" key={block.tavernName.trim().toLowerCase()}>
              <p class="tavern-presence-block-title" title={block.tavernName}>
                <span class="tavern-presence-block-name">{block.tavernName}</span>
              </p>
              <ul class="tavern-presence-list">
                {block.occupants.map((login) => (
                  <li class="tavern-presence-name" key={login.toLowerCase()} title={login}>
                    {login}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!loading && error && presences.length > 0 && (
        <p class="tavern-presence-stale" role="status">
          {error}{" "}
          <button type="button" class="tavern-presence-retry tavern-presence-retry--inline" onClick={retry}>
            {retryLabel}
          </button>
        </p>
      )}
    </section>
  );
}
