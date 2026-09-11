import { useEffect, useState } from "preact/hooks";
import { Dismiss } from "../../lib/utils/icons";
import { t } from "../../lib/i18n";
import type { UpdaterStatus } from "../../lib/hooks/useUpdater";

interface Props {
  status: UpdaterStatus;
  version: string | null;
  error: string | null;
  onInstall: () => void;
}

// Quiet fixed-corner banner, shown only while an update is available
// (or installing). Dismiss hides it for the session; installing
// disables the buttons with a progress label. An install failure
// returns to "available" with the reason shown.
export default function UpdatePrompt({ status, version, error, onInstall }: Props) {
  const [dismissed, setDismissed] = useState(false);

  // A newly found version re-arms the banner.
  useEffect(() => {
    setDismissed(false);
  }, [version]);

  if (status !== "available" && status !== "installing") return null;
  if (dismissed && status === "available") return null;

  const installing = status === "installing";

  return (
    <div class="update-banner" role="status" aria-live="polite">
      <span class="update-banner-text">
        {t("update.available", { version: version ?? "?" })}
      </span>
      {error && (
        <span class="update-banner-error" role="alert">
          {t("update.failed", { error })}
        </span>
      )}
      <button
        type="button"
        class="update-install"
        onClick={onInstall}
        disabled={installing}
      >
        {installing ? t("update.installing") : t("update.install")}
      </button>
      <button
        type="button"
        class="btn-icon update-dismiss"
        onClick={() => setDismissed(true)}
        disabled={installing}
        title={t("update.dismiss")}
        aria-label={t("update.dismiss")}
      >
        <Dismiss size={14} />
      </button>
    </div>
  );
}
