import { useStatusToast } from "../../lib/hooks/useStatusToast";
import LanguageSwitcher from "../ui/LanguageSwitcher";
import TavernCarousel from "./TavernCarousel";
import RecentTaverns from "./RecentTaverns";
import { ArrowEnterLeft, ArrowLeft, Person } from "../../lib/utils/icons";
import { t } from "../../lib/i18n";
import type { TavernSelectProps } from "../../lib/types";

// Step 2: where to? Session is already open (auth step done).
// Recents chip row above the reused carousel; Enter opens the socket,
// Back cuts the session and returns to accounts.
export default function TavernSelect(props: TavernSelectProps) {
  const { showStatus, toastLeaving } = useStatusToast(props.status, props.error);

  return (
    <div class="auth-container">
      <div class="auth-form">
        <div class="auth-head">
          <div class="auth-head-row">
            <h1>{t("auth.pickTavern")}</h1>
            {props.username && (
              <p
                class="session-chip"
                title={`${t("session.connectedAs")} ${props.username}`}
              >
                <Person size={16} />
                <span class="session-chip-label">
                  <span class="session-chip-name">{props.username}</span>
                </span>
                <span class="session-dot" aria-hidden="true" />
              </p>
            )}
            <LanguageSwitcher />
          </div>
        </div>

        {props.error && <div class="auth-error">{props.error}</div>}
        {showStatus && (
          <div class={`auth-status${toastLeaving ? " is-leaving" : ""}`}>{props.status}</div>
        )}

        <RecentTaverns
          tavernIds={props.recents}
          taverns={props.taverns}
          selectedId={props.selectedId}
          onPick={props.onSelect}
        />

        {props.taverns.length > 0 && (
          <TavernCarousel
            taverns={props.taverns}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
          />
        )}

        <button
          type="button"
          class="btn-primary"
          onClick={props.onEnter}
          disabled={props.loading || props.taverns.length === 0}
        >
          {!props.loading && <ArrowEnterLeft size={16} />}
          {props.loading ? t("auth.submit") : t("auth.enterTavern")}
        </button>

        <div class="tavern-select-actions">
          <button
            type="button"
            class="btn-secondary"
            onClick={props.onBack}
            disabled={props.loading}
          >
            <ArrowLeft size={16} />
            {t("auth.backToAccounts")}
          </button>
          {props.onForgetCurrent && (
            <button
              type="button"
              class="tavern-forget"
              onClick={props.onForgetCurrent}
              disabled={props.loading}
              title={t("auth.forgetCurrent")}
            >
              {t("auth.forgetCurrent")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
