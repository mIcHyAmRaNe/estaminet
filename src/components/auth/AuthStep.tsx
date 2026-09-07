import LanguageSwitcher from "../ui/LanguageSwitcher";
import LoginForm from "./LoginForm";
import AccountPicker from "./AccountPicker";
import { t } from "../../lib/i18n";
import type { AuthStepProps } from "../../lib/types";

// Step 1: who are you? Saved accounts (preselect-then-Connect) or the
// credential form. No tavern here — that is step 2 (TavernSelect).
// No wsConnect here either: Connect only opens the HTTP session.
export default function AuthStep(props: AuthStepProps) {
  const showForm = props.useAnother || props.accounts.length === 0;
  const canConnectSaved = !showForm && props.pickedAccount !== null;

  return (
    <div class="auth-container">
      <form
        class="auth-form"
        onSubmit={(e: Event) => {
          e.preventDefault();
          if (showForm) {
            props.onConnectForm(e);
          } else if (canConnectSaved) {
            props.onConnectSaved();
          }
        }}
      >
        <div class="auth-head">
          <div class="auth-head-row">
            <h1>{t("auth.login")}</h1>
            <LanguageSwitcher />
          </div>
        </div>

        {props.error && <div class="auth-error">{props.error}</div>}
        {props.status && !props.error && <div class="auth-status">{props.status}</div>}

        {showForm ? (
          <>
            <LoginForm
              username={props.username}
              setUsername={props.setUsername}
              password={props.password}
              setPassword={props.setPassword}
              showPassword={props.showPassword}
              setShowPassword={props.setShowPassword}
              remember={props.remember}
              setRemember={props.setRemember}
              loading={props.loading}
            />
            {props.accounts.length > 0 && (
              <button
                type="button"
                class="btn-secondary"
                onClick={() => props.setUseAnother(false)}
                disabled={props.loading}
              >
                {t("auth.backToAccounts")}
              </button>
            )}
            <button type="submit" class="btn-primary" disabled={props.loading}>
              {props.loading ? t("auth.submit") : t("auth.connect")}
            </button>
          </>
        ) : (
          <>
            <AccountPicker
              accounts={props.accounts}
              pickedAccount={props.pickedAccount}
              onPick={props.setPickedAccount}
              onRemove={props.onRemoveAccount}
              onUseAnother={() => props.setUseAnother(true)}
              loading={props.loading}
            />
            <button
              type="submit"
              class="btn-primary"
              disabled={props.loading || !canConnectSaved}
            >
              {props.loading ? t("auth.submit") : t("auth.connect")}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
