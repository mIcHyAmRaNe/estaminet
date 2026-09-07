import { useState, useRef, useEffect, useId } from "preact/hooks";
import { t, locale, setLocale, SUPPORTED_LOCALES, type Locale } from "../../lib/i18n";
import { LocalLanguage, Check } from "../../lib/utils/icons";

interface Props {
  align?: "left" | "right";
}

const LOCALE_NAME_KEYS: Record<Locale, string> = {
  fr: "settings.french",
  en: "settings.english",
};

export default function LanguageSwitcher({ align = "right" }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  // Close and hand focus back to the trigger (Escape path).
  const closeMenu = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  const choose = (code: Locale) => {
    setLocale(code);
    closeMenu();
  };

  // Outside click (capture) + Escape, mirroring the tavern filter popover:
  // a click elsewhere just closes; Escape also restores trigger focus.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  // Move focus into the menu on open, landing on the active option.
  useEffect(() => {
    if (!open) return;
    const target =
      wrapRef.current?.querySelector<HTMLButtonElement>(".lang-option.is-active") ??
      wrapRef.current?.querySelector<HTMLButtonElement>(".lang-option");
    target?.focus();
  }, [open]);

  return (
    <div class="lang-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        class="btn-icon lang-btn"
        onClick={() => setOpen((o) => !o)}
        title={t("settings.language")}
        aria-label={t("settings.language")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
      >
        <LocalLanguage size={18} />
      </button>
      {open && (
        <div
          id={menuId}
          class={`lang-menu${align === "left" ? " lang-menu--left" : ""}`}
          role="menu"
          aria-label={t("settings.language")}
        >
          {SUPPORTED_LOCALES.map((code) => {
            const active = locale.value === code;
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                class={`lang-option${active ? " is-active" : ""}`}
                onClick={() => choose(code)}
              >
                <span class="lang-option-name">{t(LOCALE_NAME_KEYS[code])}</span>
                <span class="lang-option-code">{code.toUpperCase()}</span>
                {active && <Check size={14} class="lang-option-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
