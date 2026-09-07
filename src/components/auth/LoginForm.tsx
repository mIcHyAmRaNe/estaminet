import { Eye, EyeOff } from "../../lib/utils/icons";
import { t } from "../../lib/i18n";
import type { LoginFieldsProps } from "../../lib/types";

// Pure credential fields — no tavern picker, no remembered block.
// The surrounding <form> and submit button live in AuthStep.
export default function LoginForm(props: LoginFieldsProps) {
  return (
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
          autoComplete="username"
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
            autoComplete="current-password"
          />
          <button
            type="button"
            class="btn-icon field-input-toggle"
            tabIndex={-1}
            onClick={() => props.setShowPassword(!props.showPassword)}
            aria-label={props.showPassword ? "Masquer" : "Afficher"}
          >
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
  );
}
