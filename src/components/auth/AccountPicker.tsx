import { Dismiss } from "../../lib/utils/icons";
import { displayLogin } from "../../lib/utils/login-utils";
import { t } from "../../lib/i18n";
import type { AccountPickerProps } from "../../lib/types";

// Saved accounts: chalk-row list, preselect-then-Connect. The picked row is
// signalled by the gold underline alone (no radio dot, no card border).
// The Connect button lives in AuthStep; here: selection + remove + toggle.
export default function AccountPicker(props: AccountPickerProps) {
  if (props.accounts.length === 0) return null;

  return (
    <div class="account-picker">
      <p class="account-picker-label" id="saved-accounts-label">{t("auth.selectAccount")}</p>
      <div class="account-list" role="radiogroup" aria-labelledby="saved-accounts-label">
        {props.accounts.map((login) => {
          const checked = props.pickedAccount === login;
          const initial = displayLogin(login).charAt(0) || "?";
          return (
            <div
              key={login}
              class={`account-row${checked ? " is-picked" : ""}`}
              onClick={() => props.onPick(login)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  props.onPick(login);
                }
              }}
              role="radio"
              aria-checked={checked}
              tabIndex={0}
            >
              <span class="remembered-avatar" aria-hidden="true">
                {initial}
              </span>
              <span class="account-name">{displayLogin(login)}</span>
              <button
                type="button"
                class="btn-icon account-remove"
                onClick={(e: Event) => {
                  e.stopPropagation();
                  props.onRemove(login);
                }}
                disabled={props.loading}
                title={t("auth.removeAccount", { username: login })}
                aria-label={t("auth.removeAccount", { username: login })}
              >
                <Dismiss size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        class="tavern-quiet account-use-another"
        onClick={props.onUseAnother}
        disabled={props.loading}
      >
        {t("auth.useAnotherAccount")}
      </button>
    </div>
  );
}
