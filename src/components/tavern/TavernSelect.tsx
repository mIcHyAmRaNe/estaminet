import { useState } from "preact/hooks";
import { useStatusToast } from "../../lib/hooks/useStatusToast";
import LanguageSwitcher from "../ui/LanguageSwitcher";
import TavernCarousel from "./TavernCarousel";
import RecentTaverns from "./RecentTaverns";
import { ArrowEnterLeft, ArrowClockwise } from "../../lib/utils/icons";
import { t } from "../../lib/i18n";
import type { TavernSelectProps } from "../../lib/types";

// Step 2: where to? Session is already open (auth step done).
// Recents chip row above the reused carousel; Enter opens the socket,
// Back cuts the session and returns to accounts.
//
// Home-village presence is a display-only band between recents and the
// carousel, in the same visual language: quiet .village-presence band,
// text chips with initials only — never AvatarPortrait here, the band
// must stay light. No village select, no preview button, no village chat
// entry: App auto-dials the player's own NomVillage once per tavern-phase
// entry (get_player_village -> VILLAGE_IDS) and the band just shows who
// is there.
function VillagePresence(props: {
  villageId: number | null | undefined;
  villageName: string | null | undefined;
  users: string[];
  count: number;
  connected: boolean;
  fetchState?: "idle" | "loading" | "ok" | "error";
}) {
  // Always visible in the tavern phase: never return null here. The parent
  // always renders this band so loading vs failed vs unmapped stays
  // diagnosable — an empty name + null id is the loading state, not a
  // reason to hide.
  const name = props.villageName?.trim() ? props.villageName.trim() : null;
  const title = name
    ? t("village.title", { name })
    : t("village.titleGeneric");
  // Not live yet (fetching the name, unmapped id, or dialling the roster)
  // reads as connecting — never as an empty room. Only a live roster may
  // claim empty.
  const isLive = props.connected;
  const countLabel = !isLive
    ? t("village.connecting")
    : props.count <= 0
      ? null
      : props.count === 1
        ? t("village.one")
        : t("village.many", { n: props.count });
  const visible = isLive ? props.users.slice(0, 12) : [];
  const extra = isLive ? Math.max(0, props.count - visible.length) : 0;

  return (
    <section class={`village-presence${isLive ? "" : " is-loading"}`} aria-live="polite" aria-label={title}>
      <div class="village-presence-head">
        <span class={`village-dot${isLive ? " is-on" : ""}`} aria-hidden="true" />
        <span class="village-title">{title}</span>
        {countLabel && <span class="village-count">{countLabel}</span>}
      </div>
      {isLive && props.count <= 0 && (
        <p class="village-hint">{t("village.empty")}</p>
      )}
      {visible.length > 0 && (
        <div class="village-chips">
          {visible.map((login) => (
            <span class="village-chip" key={login.toLowerCase()} title={login}>
              <span class="village-chip-initial" aria-hidden="true">
                {login.charAt(0).toUpperCase()}
              </span>
              {login}
            </span>
          ))}
          {extra > 0 && (
            <span class="village-more" title={t("village.many", { n: props.count })}>
              {t("village.more", { n: extra })}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

export default function TavernSelect(props: TavernSelectProps) {
  const { showStatus, toastLeaving } = useStatusToast(props.status, props.error);
  const [customValue, setCustomValue] = useState("");
  const [customError, setCustomError] = useState("");

  const trimmed = customValue.trim();
  const parsedCustom = /^\d{1,10}$/.test(trimmed) ? Number(trimmed) : null;
  const parsedValid = parsedCustom !== null && Number.isSafeInteger(parsedCustom) && parsedCustom > 0;
  const knownTavern = parsedValid ? props.taverns.find((tav) => tav.id === parsedCustom) : undefined;
  const isCustomSelected =
    parsedValid && props.selectedId === parsedCustom && !props.taverns.some((tav) => tav.id === props.selectedId);
  const selectedTavern = props.taverns.find((tav) => tav.id === props.selectedId);
  const canEnter = !props.loading && (props.taverns.length > 0 || isCustomSelected);
  // Distinct village error row: message + icon retry button. A null kind
  // (e.g. the unverified fetch notice, which no re-dial can fix) shows the
  // message without the button; an unknown kind keeps the button.
  const villageRetryLabel = t("retry.village");
  const showVillageRetry = !!props.onRetryVillage && props.villageErrorKind !== null;

  const applyCustom = () => {
    if (!parsedValid || parsedCustom === null) {
      setCustomError(t("auth.customTavernInvalid"));
      return;
    }
    setCustomError("");
    if (parsedCustom !== props.selectedId) props.onSelect(parsedCustom);
  };

  return (
    <div class="auth-form auth-form--wide tavern-select">
        <div class="auth-head">
          <div class="auth-head-row">
            {props.username && (
              <span
                class="session-dot"
                role="img"
                title={t("auth.connectedAs", { username: props.username })}
                aria-label={t("auth.connectedAs", { username: props.username })}
              />
            )}
            <h1>{t("auth.pickTavern")}</h1>
            <LanguageSwitcher />
          </div>
        </div>

        {props.error && <div class="auth-error" role="alert">{props.error}</div>}
        {showStatus && (
          <div class={`auth-status${toastLeaving ? " is-leaving" : ""}`}>{props.status}</div>
        )}

        <RecentTaverns
          tavernIds={props.recents}
          taverns={props.taverns}
          selectedId={props.selectedId}
          onPick={props.onSelect}
        />

        {/* Home-village presence: always visible in the tavern phase.
            Loading (no name yet) shows the generic title + connecting,
            a name with no mapped id shows the name + connecting, a live
            roster shows counts/chips, and fetch/roster failures surface
            via villageError below — never a silent gap. */}
        <VillagePresence
          villageId={props.villageId ?? null}
          villageName={props.villageName ?? null}
          users={props.villageUsers ?? []}
          count={props.villageCount ?? 0}
          connected={props.villageConnected ?? false}
          fetchState={props.villageFetchState ?? "ok"}
        />
        {props.villageError && (
          <div class="village-error" role="alert">
            <span class="village-error-text">{props.villageError}</span>
            {showVillageRetry && (
              <button
                type="button"
                class="village-retry"
                onClick={() => props.onRetryVillage?.()}
                title={villageRetryLabel}
                aria-label={villageRetryLabel}
              >
                <ArrowClockwise size={15} />
              </button>
            )}
          </div>
        )}

        {props.taverns.length > 0 && (
          <TavernCarousel
            taverns={props.taverns}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
          />
        )}

        <details class="custom-tavern">
          <summary class="custom-tavern-toggle">{t("auth.customTavernToggle")}</summary>
          <p class="custom-tavern-hint">{t("auth.customTavernHint")}</p>
          <div class="custom-tavern-row">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              class="custom-tavern-input"
              value={customValue}
              onInput={(e: Event) => {
                setCustomValue((e.currentTarget as HTMLInputElement).value);
                if (customError) setCustomError("");
              }}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyCustom();
                }
              }}
              placeholder={t("auth.customTavernPlaceholder")}
              aria-label={t("auth.customTavernPlaceholder")}
              disabled={props.loading}
              autoComplete="off"
            />
            <button
              type="button"
              class="btn-secondary custom-tavern-apply"
              onClick={applyCustom}
              disabled={props.loading || !parsedValid}
            >
              {t("auth.customTavernUse")}
            </button>
          </div>
          {customError && (
            <p class="custom-tavern-error" role="alert">{customError}</p>
          )}
          {!customError && knownTavern && (
            <p class="custom-tavern-note" aria-live="polite">
              {t("auth.customTavernKnown", { name: knownTavern.name })}
            </p>
          )}
        </details>

        {props.selectedId > 0 && (
          <p class="tavern-selected tavern-selected--unified" aria-live="polite">
            {selectedTavern
              ? t("auth.tavernSelected", { name: selectedTavern.name })
              : t("auth.customTavernSelected", { id: String(props.selectedId) })}
          </p>
        )}

        <button
          type="button"
          class="btn-primary"
          onClick={props.onEnter}
          disabled={!canEnter}
        >
          {!props.loading && <ArrowEnterLeft size={16} />}
          {props.loading ? t("auth.entering") : t("auth.enterTavern")}
        </button>

        <div class="tavern-select-foot">
          <button
            type="button"
            class="tavern-quiet"
            onClick={props.onBack}
            disabled={props.loading}
          >
            {t("auth.backToAccounts")}
          </button>
          {props.loading && props.onCancel ? (
            <button
              type="button"
              class="tavern-quiet"
              onClick={props.onCancel}
            >
              {t("auth.cancel")}
            </button>
          ) : props.onForgetCurrent ? (
            <button
              type="button"
              class="tavern-forget"
              onClick={props.onForgetCurrent}
              disabled={props.loading}
            >
              {t("auth.forgetCurrent")}
            </button>
          ) : null}
        </div>
    </div>
  );
}
