import { signal } from "@preact/signals";
import { fr } from "./fr";
import { en } from "./en";
import { LOCALE_STORAGE_KEY } from "../config";

export type Locale = "fr" | "en";
export const SUPPORTED_LOCALES: readonly Locale[] = ["fr", "en"];

const dictionaries: Record<Locale, Record<string, string>> = { fr, en };

function readStoredLocale(): Locale | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "fr" || stored === "en") return stored;
    return null;
  } catch {
    return null;
  }
}

function detectLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  try {
    if (typeof navigator !== "undefined" && navigator.language) {
      if (navigator.language.toLowerCase().startsWith("en")) return "en";
    }
  } catch {
    // Ignore detection failures — fall through to the default.
  }
  return "fr";
}

function applyDocumentLang(next: Locale): void {
  try {
    if (typeof document !== "undefined") document.documentElement.lang = next;
  } catch {
    // Non-DOM environment — nothing to apply.
  }
}

const initial = detectLocale();
applyDocumentLang(initial);

// Reactive locale: reading `locale.value` inside a component subscribes it,
// so every view using t() re-renders on setLocale().
export const locale = signal<Locale>(initial);

export function setLocale(next: Locale): void {
  if (next !== "fr" && next !== "en") return;
  if (locale.value === next) return;
  locale.value = next;
  applyDocumentLang(next);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // Private mode / storage unavailable — locale still applies in memory.
  }
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = dictionaries[locale.value] ?? fr;
  let str = dict[key] ?? (fr as Record<string, string>)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return str;
}
