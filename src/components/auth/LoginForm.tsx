import TavernCarousel from "../tavern/TavernCarousel";
import LanguageSwitcher from "../ui/LanguageSwitcher";
import { Eye, EyeOff } from "../../lib/utils/icons";
import { t } from "../../lib/i18n";
import type { LoginFormProps } from "../../lib/types";

export default function LoginForm(props: LoginFormProps) {
  const remembered = props.rememberedLogin;

  return (
    <div class="auth-container">
      <form class="auth-form" onSubmit={props.onSubmit}>
        <div class="auth-head">
          <div class="auth-head-row">
            <h1>{t("auth.login")}</h1>
            <LanguageSwitcher />
          </div>
        </div>

        {props.taverns && props.taverns.length > 0 && (
          <TavernCarousel
            taverns={props.taverns}
            selectedId={props.idLieu}
            onSelect={props.setIdLieu}
          />
        )}

        {props.error && <div class="auth-error">{props.error}</div>}
        {props.status && !props.error && <div class="auth-status">{props.status}</div>}

        {remembered ? (
          <div class="remembered-account">
            <span class="remembered-avatar" aria-hidden="true">
              {remembered.charAt(0).toUpperCase()}
            </span>
            <div class="remembered-id">
              <span class="remembered-hello">
                {t("auth.connectedAs", { username: remembered })}
              </span>
              <span class="remembered-hint">{t("auth.rememberedHint")}</span>
            </div>
          </div>
        ) : (
          <>
        <div class="field">
          <label for="username">{t("auth.username")}</label>
          <input
            id="username"
            type="text"
            value={props.username}
            onInput={(e: Event) => props.setUsername((e.currentTarget as HTMLInputElement).value)}
            required
            minLength={3}
            maxLength={50}
            placeholder={t("auth.usernamePlaceholder")}
          />
        </div>

        <div class="field">
          <label for="password">{t("auth.password")}</label>
          <div class="field-input-wrap">
            <input
              id="password"
              type={props.showPassword ? "text" : "password"}
              value={props.password}
              onInput={(e: Event) => props.setPassword((e.currentTarget as HTMLInputElement).value)}
              required
              minLength={8}
              placeholder={t("auth.passwordPlaceholder")}
            />
            <button type="button" class="btn-icon field-input-toggle" tabIndex={-1} onClick={() => props.setShowPassword(!props.showPassword)}>
              {props.showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <label class="field-checkbox remember-me">
          <input
            type="checkbox"
            checked={props.remember}
            onChange={(e: Event) => props.setRemember((e.currentTarget as HTMLInputElement).checked)}
          />
          <span>{t("auth.rememberMe")}</span>
        </label>
          </>
        )}

        <button type="submit" class="btn-primary" disabled={props.loading}>
          {props.loading
            ? t("auth.submit")
            : remembered
              ? t("auth.enterTavern")
              : t("auth.login")}
        </button>

        {remembered && props.onDisconnect && (
          <button type="button" class="btn-secondary" onClick={props.onDisconnect} disabled={props.loading}>
            {t("auth.disconnect")}
          </button>
        )}
      </form>
    </div>
  );
}
