import { useEffect, useId, useRef, useState } from "preact/hooks";
import { getVersion } from "@tauri-apps/api/app";
import { APP_VERSION } from "../../lib/config";
import { Dismiss } from "../../lib/utils/icons";
import { t } from "../../lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Lightweight accessible About dialog: closes on backdrop click,
// Escape, or the Close button. Shows the app name, the runtime
// version (config fallback if getVersion fails), a one-line
// description and the tech line.
export default function AboutDialog({ open, onClose }: Props) {
  const [version, setVersion] = useState(APP_VERSION);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

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
