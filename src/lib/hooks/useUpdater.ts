import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus = "idle" | "checking" | "available" | "installing" | "ready";

export interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  error: null;
}

// Silent update check on mount: check only, never auto-download.
// Every failure (no update server, offline, 404…) is swallowed —
// the banner simply never appears.
export function useUpdater(): UpdaterState & { installAndRestart: () => Promise<void> } {
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  // The pending Update object (holds downloadAndInstall). Kept in a ref:
  // it is not render state, only needed on user consent.
  const updateRef = useRef<Exclude<Awaited<ReturnType<typeof check>>, null> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("checking");
      try {
        const update = await check();
        if (cancelled) return;
        if (update) {
          updateRef.current = update;
          setVersion(update.version);
          setStatus("available");
        } else {
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const installAndRestart = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setStatus("installing");
    try {
      await update.downloadAndInstall();
      setStatus("ready");
      await relaunch();
    } catch {
      // Install failed (offline mid-download…): back to available so the
      // user can retry. Never surfaced — the banner just comes back.
      setStatus("available");
    }
  }, []);

  return { status, version, error: null, installAndRestart };
}
