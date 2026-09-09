// Sound controller (official modes: tout / son / musique / aucun).
// Only message_tchat.mp3 is bundled (ecu_down / tchat2 don't exist on the
// official CDN): it is an SFX ("action" sound), so it plays on "tout" and
// "son". "musique" and "aucun" stay silent; the mode distinction is kept in
// state (persisted) so background music can hook onto tout/musique later.
// Message sound: short "tchat" chime played on incoming messages.
// Module-level lazy Audio (volume 1, no loop), shared across renders.
import { SOUND_MODE_KEY, SOUND_ENABLED_KEY } from "../config";
import messageSoundUrl from "../../assets/sounds/message_tchat.mp3";

export type SoundMode = "tout" | "son" | "musique" | "aucun";

export const SOUND_MODES: readonly SoundMode[] = ["tout", "son", "musique", "aucun"];

function isMode(v: unknown): v is SoundMode {
  return v === "tout" || v === "son" || v === "musique" || v === "aucun";
}

export function getSoundMode(): SoundMode {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(SOUND_MODE_KEY);
      if (isMode(v)) return v;
      // Legacy boolean toggle migration ("1" → tout, "0"/"false" → aucun).
      const legacy = localStorage.getItem(SOUND_ENABLED_KEY);
      if (legacy !== null) {
        return legacy !== "0" && legacy.toLowerCase() !== "false" && legacy !== "" ? "tout" : "aucun";
      }
    }
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return "tout";
}

export function setSoundMode(mode: SoundMode): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SOUND_MODE_KEY, mode);
      // Keep the legacy boolean key coherent for older builds.
      localStorage.setItem(SOUND_ENABLED_KEY, mode === "tout" || mode === "son" ? "1" : "0");
    }
  } catch {
    // Private mode / storage unavailable — applies in memory only.
  }
}

// Compat: "enabled" means SFX audible (tout or son).
export function isSoundEnabled(): boolean {
  const m = getSoundMode();
  return m === "tout" || m === "son";
}

export function setSoundEnabled(v: boolean): void {
  setSoundMode(v ? "tout" : "aucun");
}

// Official jouerSonAction gate: action/SFX sounds play on tout or son.
export function isSfxAudible(mode?: SoundMode): boolean {
  const m = mode ?? getSoundMode();
  return m === "tout" || m === "son";
}

// Official music gate (no music bundled yet — always silent, kept for
// future use alongside the persisted mode).
export function isMusicAudible(mode?: SoundMode): boolean {
  const m = mode ?? getSoundMode();
  return m === "tout" || m === "musique";
}

let audio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement | null {
  try {
    if (!audio) {
      audio = new Audio(messageSoundUrl);
      audio.volume = 1;
      audio.loop = false;
    }
    return audio;
  } catch {
    return null;
  }
}

export function playMessageSound(): void {
  if (!isSfxAudible()) return;
  try {
    const a = getAudio();
    if (!a) return;
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    // Autoplay policy / missing codec — never crash the chat.
  }
}
