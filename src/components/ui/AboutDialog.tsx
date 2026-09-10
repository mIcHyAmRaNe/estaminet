import { useEffect, useId, useRef, useState } from "preact/hooks";
import { getVersion } from "@tauri-apps/api/app";
import { APP_VERSION } from "../../lib/config";
import { useUpdater } from "../../lib/hooks/useUpdater";
import { ArrowSync, Check, Dismiss } from "../../lib/utils/icons";
import { t } from "../../lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Lightweight accessible About dialog: closes on backdrop click,
// Escape, or the Close button. Shows the app name, the runtime
// version (config fallback if getVersion fails), a one-line
// description and the tech line — plus a manual update check.
// The shell-level silent startup check is untouched: this hook
// instance never auto-checks, it only checks on button press.
export default function AboutDialog({ open, onClose }: Props) {
  const [version, setVersion] = useState(APP_VERSION);
  const [manualDone, setManualDone] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const updater = useUpdater({ autoCheck: false });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled && v) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion(APP_VERSION);
      });
    return () => {
      cancelled = true;
    };
  }, [open ]);

  // Fresh manual-check state on every opening; a found update stays
  // visible (status/version persist in the hook for the auth phase).
  useEffect(() => {
    if (open) setManualDone(false);
  }, [open ]);

  // Escape closes; focus lands on the Close button on open.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const checking = updater.status === "checking";
  const installing = updater.status === "installing";
  const available = updater.status === "available" || installing;

  const handleCheck = async () => {
    await updater.checkForUpdates();
    setManualDone(true);
  };

  return (
    <div
      class="about-backdrop"
      onClick={onClose}
    >
      <div
        class="about-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e: Event) => e.stopPropagation()}
      >
        <p id={titleId} class="about-title" role="heading" aria-level={2}>
          Estaminet
        </p>
        <p class="about-version">{t("about.version", { version })}</p>
        <p class="about-description">{t("about.description")}</p>
        <p class="about-tech">{t("about.tech")}</p>
        <div class="about-update">
          {available ? (
            <>
              <p class="about-update-note" role="status">
                {t("update.available", { version: updater.version ?? "?" })}
              </p>
              <button
                type="button"
                class="btn-primary"
                onClick={updater.installAndRestart}
                disabled={installing}
              >
                {installing ? t("update.installing") : t("update.install")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                class={`btn-secondary about-check-btn${checking ? " is-spinning" : ""}`}
                onClick={handleCheck}
                disabled={checking}
              >
                <ArrowSync size={16} class="about-check-icon" />
                {checking ? t("about.checking") : t("about.checkForUpdates")}
              </button>
              {manualDone && !checking && (
                <p class="about-update-note about-update-ok" role="status">
                  <Check size={16} />
                  {t("about.upToDate")}
                </p>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          ref={closeRef}
          class="btn-primary"
          onClick={onClose}
        >
          <Dismiss size={16} />
          {t("about.close")}
        </button>
      </div>
    </div>
  );
}
