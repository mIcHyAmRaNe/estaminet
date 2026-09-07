import { t } from "../../lib/i18n";
import type { AccountPickerProps } from "../../lib/types";

// Saved accounts: radio list, preselect-then-Connect.
// The Connect button lives in AuthStep; here: selection + ✕ + toggle.
export default function AccountPicker(props: AccountPickerProps) {
  if (props.accounts.length === 0) return null;

  return (
    <div class="account-picker">
      <p class="account-picker-label">{t("auth.selectAccount")}</p>
      <div class="account-list" role="radiogroup" aria-label={t("auth.accounts")}>
        {props.accounts.map((login) => {
          const checked = props.pickedAccount === login;
          const initial = login.charAt(0).toUpperCase() || "?";
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
              <input
                type="radio"
                class="account-radio"
                name="saved-account"
                checked={checked}
                onChange={() => props.onPick(login)}
                tabIndex={-1}
                aria-hidden="true"
              />
              <span class="remembered-avatar" aria-hidden="true">
                {initial}
              </span>
              <span class="account-name">{login}</span>
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
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        class="btn-secondary"
        onClick={props.onUseAnother}
        disabled={props.loading}
      >
        {t("auth.useAnotherAccount")}
      </button>
    </div>
  );
}
