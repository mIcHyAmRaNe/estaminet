import { useState, useCallback } from "preact/hooks";
import { RECENTS_STORAGE_KEY, RECENTS_MAX } from "../config";

function readRecents(): number[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(
      (v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0
    );
    return [...new Set(valid)].slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

export function useRecents() {
  const [recents, setRecents] = useState<number[]>(readRecents);

  const push = useCallback((id: number) => {
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return;
    setRecents((prev) => {
      const next = [id, ...prev.filter((v) => v !== id)].slice(0, RECENTS_MAX);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(next));
        }
      } catch {
        // Private mode / storage unavailable — keep in-memory only.
      }
      return next;
    });
  }, []);

  return { recents, push };
}
