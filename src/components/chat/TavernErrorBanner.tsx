import { useState } from "preact/hooks";
import { t } from "../../lib/i18n";
import { ArrowClockwise } from "../../lib/utils/icons";

export type TavernErrorKindOption = "room-rejected" | "dropped" | null;

interface TavernErrorBannerProps {
  message: string;
  // Distinct tavern connection kind (hook-owned): "room-rejected" is
  // terminal, "dropped" keeps the auto-reconnect backoff running underneath.
  // Both stay persistent with a manual retry — never auto-dismissed. Null
  // (transient errors, e.g. a failed order) shows the message only.
  kind?: TavernErrorKindOption;
  onRetry?: () => void | Promise<void>;
}

// Room connection-error banner: persistent message + icon-only retry button.
// No timers, no dismiss — a terminal room-rejected error stays until the
// user retries or leaves; a dropped error stays while the backoff continues.
export default function TavernErrorBanner({ message, kind, onRetry }: TavernErrorBannerProps) {
  const [busy, setBusy] = useState(false);
  const retryLabel = t("retry.tavern");
  const showRetry = !!onRetry && kind !== null;

  const handleRetry = async () => {
    if (busy || !onRetry) return;
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="tavern-error-banner" role="alert">
      <span class="tavern-error-text">{message}</span>
      {showRetry && (
        <button
          type="button"
          class="tavern-error-retry"
          onClick={handleRetry}
          disabled={busy}
          title={retryLabel}
          aria-label={retryLabel}
        >
          <ArrowClockwise size={16} />
        </button>
      )}
    </div>
  );
}
