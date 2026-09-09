// Message sound: short "tchat" chime played on incoming messages.
// Module-level lazy Audio (volume 1, no loop), shared across renders.
// Toggle persisted via SOUND_ENABLED_KEY (default enabled).
import { SOUND_ENABLED_KEY } from "../config";
import messageSoundUrl from "../../assets/sounds/message_tchat.mp3";

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

export function isSoundEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    const v = localStorage.getItem(SOUND_ENABLED_KEY);
    if (v === null) return true;
    return v !== "0" && v.toLowerCase() !== "false" && v !== "";
  } catch {
    return true;
  }
}

export function setSoundEnabled(v: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SOUND_ENABLED_KEY, v ? "1" : "0");
  } catch {
    // Private mode / storage unavailable — applies in memory only.
  }
}

export function playMessageSound(): void {
  if (!isSoundEnabled()) return;
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
