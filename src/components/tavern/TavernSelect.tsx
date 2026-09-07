import LanguageSwitcher from "../ui/LanguageSwitcher";
import TavernCarousel from "./TavernCarousel";
import RecentTaverns from "./RecentTaverns";
import { ArrowEnterLeft, ArrowLeft } from "../../lib/utils/icons";
import { t } from "../../lib/i18n";
import type { TavernSelectProps } from "../../lib/types";

// Step 2: where to? Session is already open (auth step done).
// Recents chip row above the reused carousel; Enter opens the socket,
// Back cuts the session and returns to accounts.
export default function TavernSelect(props: TavernSelectProps) {
  return (
    <div class="auth-container">
      <div class="auth-form">
        <div class="auth-head">
          <div class="auth-head-row">
            <h1>{t("auth.pickTavern")}</h1>
            <LanguageSwitcher />
          </div>
          {props.username && (
            <p class="tavern-session-user">{t("status.sessionOpen", { username: props.username })}</p>
          )}
        </div>

        {props.error && <div class="auth-error">{props.error}</div>}
        {props.status && !props.error && <div class="auth-status">{props.status}</div>}

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
