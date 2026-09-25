import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { api } from "../../api/tauri";
import { t } from "../i18n";

// Tavern presence roster for the picker side panel (phase tavern only).
// Mirrors the useVillagePresence state shape (presences / loading / error /
// retry) but over a plain polling fetch instead of the shared socket: one
// call on mount, then a refresh roughly every minute while mounted.
//
// Backend: api.getTavernPresences() -> Tauri `get_tavern_presences`
// (EcranPrincipalAjax.php?l=5, parsed per tavern).
export interface TavernPresence {
  tavernName: string;
  occupants: string[];
}

export interface TavernPresencesState {
  presences: TavernPresence[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Refresh cadence for the side panel — quiet background poll, not live.
const TAVERN_PRESENCES_POLL_MS = 60000;

const MAX_OCCUPANTS = 100;

function sanitize(raw: unknown): TavernPresence[] {
  if (!Array.isArray(raw)) return [];
  const out: TavernPresence[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const name = typeof rec.tavernName === "string" ? rec.tavernName.trim() : "";
    if (!name) continue;
    const occupants = Array.isArray(rec.occupants)
      ? rec.occupants
          .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
          .map((u) => u.trim())
          .slice(0, MAX_OCCUPANTS)
      : [];
    out.push({ tavernName: name, occupants });
  }
  return out;
}

async function loadPresences(): Promise<TavernPresence[]> {
  const raw = await api.getTavernPresences();
  return sanitize(raw);
}

export function useTavernPresences(): TavernPresencesState {
  const [presences, setPresences] = useState<TavernPresence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Manual-retry trigger: bumping it re-runs the fetch effect below.
  const [retrySeq, setRetrySeq] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadPresences()
      .then((list) => {
        if (cancelled || !mountedRef.current) return;
        setPresences(list);
        setError(null);
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        setError(t("tavernPresence.rosterFailed"));
      })
      .finally(() => {
        if (cancelled || !mountedRef.current) return;
        setLoading(false);
      });
    const timer = window.setInterval(() => {
      loadPresences()
        .then((list) => {
          if (cancelled || !mountedRef.current) return;
          setPresences(list);
          setError(null);
        })
        .catch(() => {
          // Background refresh failure: keep the last good roster on
          // screen, flag it softly so the next tick or manual retry
          // recovers without wiping the panel.
          if (cancelled || !mountedRef.current) return;
          setError(t("tavernPresence.refreshFailed"));
        });
    }, TAVERN_PRESENCES_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // retrySeq re-runs the immediate fetch (the interval keeps its cadence).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrySeq]);

  const retry = useCallback(() => {
    setRetrySeq((s) => s + 1);
  }, []);

  return { presences, loading, error, retry };
}
