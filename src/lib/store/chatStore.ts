import { batch, computed, signal } from "@preact/signals";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChatMessage, Places } from "../types";
import { MSG_HISTORY_LIMIT } from "../config";
import { t } from "../i18n";

// Module-level signals — never create signal() inside render.
export const messages = signal<ChatMessage[]>([]);
export const presentUsers = signal<string[]>([]);
export const places = signal<Places>([]);
export const selectedPlace = signal<number | null>(null);
export const isConnected = signal<boolean>(false);
export const totalPlaces = signal<number>(8);

// Computed views.
export const sortedMessages = computed(() =>
  [...messages.value].sort((a, b) => a.created_at.localeCompare(b.created_at)),
);
export const occupiedSeats = computed(() => places.value.filter((p) => p !== null).length);

// Filtered helpers.
export function messagesForUser(login: string): ChatMessage[] {
  return messages.value.filter((m) => m.login === login);
}

export function messagesOfType(
  type: ChatMessage["type"],
): ChatMessage[] {
  return messages.value.filter((m) => m.type === type);
}

export function systemMessages(): ChatMessage[] {
  return messages.value.filter((m) => m.type === "system" || m.type === "error");
}

export function isSeatOccupied(id: number): boolean {
  return places.value[id] != null;
}

export function freeSeats(): number[] {
  return places.value
    .map((p, i) => (p === null ? i : -1))
    .filter((i) => i >= 0);
}

// Atomic mutators.
export function clearMessages(): void {
  messages.value = [];
}

export function resetChat(): void {
  batch(() => {
    messages.value = [];
    presentUsers.value = [];
    places.value = [];
    selectedPlace.value = null;
    isConnected.value = false;
  });
}

function pushMessage(msg: ChatMessage): void {
  messages.value = [...messages.value.slice(-MSG_HISTORY_LIMIT), msg];
}

function addPresent(login: string): void {
  const clean = login.trim();
  if (!clean || clean.length > 40 || /[\s/"]/.test(clean)) return;
  if (!presentUsers.value.includes(clean)) {
    presentUsers.value = [...presentUsers.value, clean];
  }
}

function removePresent(login: string): void {
  presentUsers.value = presentUsers.value.filter((u) => u !== login);
  places.value = places.value.map((p) => (p === login ? null : p));
}

function now(): { iso: string; time: string } {
  const d = new Date();
  return { iso: d.toISOString(), time: d.toLocaleTimeString() };
}

// Subscribe to Tauri ws-* events with the same listen/disposed-guard
// pattern as useTaverne. Multi-signal updates go through batch().
export function subscribeChatStore(): () => void {
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];
  const track = (u: UnlistenFn) => {
    if (disposed) u();
    else unlisteners.push(u);
  };

  void listen<string>("ws-message", (e) => {
    if (disposed) return;
    const raw = e.payload;
    if (!raw.startsWith("42[")) return;
    try {
      const data = JSON.parse(raw.substring(2)) as unknown[];
      const eventName = data[0] as string;
      const stamp = now();

      if (eventName === "taverneMessage" && data.length >= 5) {
        const login = String(data[3]);
        const content = String(data[4]);
        batch(() => {
          addPresent(login);
          pushMessage({
            id: crypto.randomUUID(),
            type: "normal",
            login,
            content,
            timestamp: stamp.time,
            created_at: stamp.iso,
          });
        });
        return;
      }

      if (eventName === "taverneEmote" && data.length >= 5) {
        const login = String(data[3]);
        const content = String(data[4]);
        batch(() => {
          addPresent(login);
          pushMessage({
            id: crypto.randomUUID(),
            type: "emote",
            login,
            content,
            timestamp: stamp.time,
            created_at: stamp.iso,
          });
        });
        return;
      }

      if (eventName === "taverneEntreTaverne" && data.length >= 4) {
        const login = String(data[3]);
        batch(() => {
          addPresent(login);
          pushMessage({
            id: crypto.randomUUID(),
            type: "system",
            content: t("chat.enter", { user: login }),
            timestamp: stamp.time,
            created_at: stamp.iso,
          });
        });
        return;
      }

      if (eventName === "taverneQuitteTaverne" && data.length >= 4) {
        const login = String(data[3]);
        batch(() => {
          removePresent(login);
          pushMessage({
            id: crypto.randomUUID(),
            type: "system",
            content: t("chat.leave", { user: login }),
            timestamp: stamp.time,
            created_at: stamp.iso,
          });
        });
        return;
      }
    } catch {
      // Ignore malformed payloads.
    }
  }).then(track);

  void listen<string>("ws-connected", () => {
    if (disposed) return;
    batch(() => {
      isConnected.value = true;
    });
  }).then(track);

  void listen<string>("ws-closed", () => {
    if (disposed) return;
    batch(() => {
      isConnected.value = false;
      presentUsers.value = [];
      selectedPlace.value = null;
    });
  }).then(track);

  return () => {
    disposed = true;
    for (const u of unlisteners) u();
  };
}
