import { t } from "../../lib/i18n";
import { Moon } from "../../lib/utils/icons";

export default function ThemeSwitcher(_props: { align?: "left" | "right" }) {
  // Stub — single theme (light) for Estaminet.
  return (
    <button type="button" class="btn-icon" disabled title={t("settings.theme")}>
      <Moon size={18} />
    </button>
  );
}
