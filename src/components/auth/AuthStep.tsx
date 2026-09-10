import { useState, useEffect } from "preact/hooks";
import LanguageSwitcher from "../ui/LanguageSwitcher";
import AboutDialog from "../ui/AboutDialog";
import LoginForm from "./LoginForm";
import AccountPicker from "./AccountPicker";
import { ArrowLeft, Info, Person } from "../../lib/utils/icons";
import { t } from "../../lib/i18n";
import type { AuthStepProps } from "../../lib/types";

// Status toast timing: visible ~3.2s, then a 0.4s fade/slide exit.
// Presentation only — the useTaverne status string itself is untouched,
// and errors keep their persistent behavior.
const STATUS_VISIBLE_MS = 3200;
const STATUS_EXIT_MS = 400;

// Step 1: who are you? Saved accounts (preselect-then-Connect) or the
// credential form. No tavern here — that is step 2 (TavernSelect).
// No wsConnect here either: Connect only opens the HTTP session.
export default function AuthStep(props: AuthStepProps) {
  const showForm = props.useAnother || props.accounts.length === 0;
  const canConnectSaved = !showForm && props.pickedAccount !== null;
  const [aboutOpen, setAboutOpen] = useState(false);
  const [toastShow, setToastShow] = useState(false);
  const [toastLeaving, setToastLeaving] = useState(false);

  useEffect(() => {
    if (!props.status || props.error) return;
    setToastShow(true);
    setToastLeaving(false);
    const hide = setTimeout(() => setToastLeaving(true), STATUS_VISIBLE_MS);
    const gone = setTimeout(() => setToastShow(false), STATUS_VISIBLE_MS + STATUS_EXIT_MS);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, [props.status, props.error]);

  const showStatus = props.status !== "" && !props.error && toastShow;

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
            <div class="auth-head-actions">
              <button
                type="button"
                class="about-btn"
                onClick={() => setAboutOpen(true)}
                title={t("about.title")}
                aria-label={t("about.title")}
              >
                <Info size={18} />
              </button>
              <LanguageSwitcher />
            </div>
          </div>
        </div>

        {props.error && <div class="auth-error">{props.error}</div>}
        {showStatus && (
          <div class={`auth-status${toastLeaving ? " is-leaving" : ""}`}>{props.status}</div>
        )}

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
                <ArrowLeft size={16} />
                {t("auth.backToAccounts")}
              </button>
            )}
            <button type="submit" class="btn-primary" disabled={props.loading}>
              {!props.loading && <Person size={16} />}
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
              {!props.loading && <Person size={16} />}
              {props.loading ? t("auth.submit") : t("auth.connect")}
            </button>
          </>
        )}
      </form>
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
