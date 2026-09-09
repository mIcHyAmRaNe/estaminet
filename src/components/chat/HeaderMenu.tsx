import { useState, useRef, useEffect, useId } from "preact/hooks";
import { t, locale, setLocale, SUPPORTED_LOCALES, type Locale } from "../../lib/i18n";
import { MoreVertical, Copy, Check, ArrowClockwise } from "../../lib/utils/icons";
import { getSoundMode, setSoundMode, SOUND_MODES, type SoundMode } from "../../lib/utils/sound";

interface Props {
  onCopy?: () => Promise<void>;
  onRefreshPortraits: () => void;
}

const LOCALE_NAME_KEYS: Record<Locale, string> = {
  fr: "settings.french",
  en: "settings.english",
};

// Header utility menu (MoreVertical trigger): copy conversation, portrait
// refresh, 4-mode sound radio list, language radio list. Interaction mirrors
// LanguageSwitcher (outside pointerdown close + Escape with focus restore);
// styling follows the .sound-popup conventions (see room.css .header-menu*).
export default function HeaderMenu({ onCopy, onRefreshPortraits }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // 4-mode sound controller (official: tout / son / musique / aucun).
  const [soundMode, setSoundModeState] = useState<SoundMode>(() => getSoundMode());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  // Close and hand focus back to the trigger (Escape path).
  const closeMenu = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  const handleCopy = async () => {
    if (!onCopy) return;
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const pickSoundMode = (m: SoundMode) => {
    setSoundMode(m);
    setSoundModeState(m);
    setOpen(false);
  };

  const chooseLocale = (code: Locale) => {
    setLocale(code);
    setOpen(false);
  };

  // Outside click (capture) + Escape, mirroring LanguageSwitcher: a click
  // elsewhere just closes; Escape also restores trigger focus.
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
  }, [open ]);

  // Move focus into the menu on open, landing on the first item.
  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLButtonElement>(".header-menu-item")?.focus();
  }, [open ]);

  return (
    <div class="header-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        class="header-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        title={t("chat.moreOptions")}
        aria-label={t("chat.moreOptions")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div id={menuId} class="header-menu" role="menu" aria-label={t("chat.moreOptions")}>
          {onCopy && (
            <button
              type="button"
              class="header-menu-item"
              role="menuitem"
              onClick={handleCopy}
              title={t("chat.copyTitle")}
            >
              <span class="header-menu-icon" aria-hidden="true">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </span>
              <span class="header-menu-label">{t("chat.copyLabel")}</span>
            </button>
          )}
          <button
            type="button"
            class="header-menu-item"
            role="menuitem"
            onClick={() => {
              onRefreshPortraits();
              setOpen(false);
            }}
            title={t("chat.refreshTitle")}
          >
            <span class="header-menu-icon" aria-hidden="true">
              <ArrowClockwise size={16} />
            </span>
            <span class="header-menu-label">{t("chat.refreshTitle")}</span>
          </button>
          <div class="header-menu-sep" aria-hidden="true" />
          <div
            class="header-menu-group"
            role="group"
            aria-label={t("sound.toggleTitle", { mode: t(`sound.mode.${soundMode}`) })}
          >
            <div class="header-menu-group-label" aria-hidden="true">
              {t("sound.toggleTitle", { mode: t(`sound.mode.${soundMode}`) })}
            </div>
            {SOUND_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={soundMode === m}
                class={`header-menu-item${soundMode === m ? " is-active" : ""}`}
                onClick={() => pickSoundMode(m)}
              >
                <span class="header-menu-check" aria-hidden="true">
                  {soundMode === m ? <Check size={14} /> : null}
                </span>
                <span class="header-menu-label">
                  {t(`sound.mode.${m}`)}
                  <span class="header-menu-hint">{t(`sound.hint.${m}`)}</span>
                </span>
              </button>
            ))}
          </div>
          <div class="header-menu-sep" aria-hidden="true" />
          <div class="header-menu-group" role="group" aria-label={t("settings.language")}>
            <div class="header-menu-group-label" aria-hidden="true">
              {t("settings.language")}
            </div>
            {SUPPORTED_LOCALES.map((code) => {
              const active = locale.value === code;
              return (
                <button
                  key={code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  class={`header-menu-item${active ? " is-active" : ""}`}
                  onClick={() => chooseLocale(code)}
                >
                  <span class="header-menu-check" aria-hidden="true">
                    {active ? <Check size={14} /> : null}
                  </span>
                  <span class="header-menu-label">
                    {t(LOCALE_NAME_KEYS[code])}
                    <span class="header-menu-hint">{code.toUpperCase()}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
