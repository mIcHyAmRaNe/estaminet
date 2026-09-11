import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus = "idle" | "checking" | "available" | "installing" | "ready";

export interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  error: string | null;
}

export interface UseUpdaterOptions {
  // Silent mount-time check (default true — the shell startup check).
  // Pass false for manual-only instances (About dialog): no check
  // runs until checkForUpdates() is called.
  autoCheck?: boolean;
}

// Silent update check on mount: check only, never auto-download.
// Mount-time failures are silent (the banner simply never appears);
// manual checks and install failures surface via `error`.
export function useUpdater(
  options?: UseUpdaterOptions,
): UpdaterState & { installAndRestart: () => Promise<void>; checkForUpdates: () => Promise<boolean> } {
  const autoCheck = options?.autoCheck ?? true;
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The pending Update object (holds downloadAndInstall). Kept in a ref:
  // it is not render state, only needed on user consent.
  const updateRef = useRef<Exclude<Awaited<ReturnType<typeof check>>, null> | null>(null);
  // Single-flight guard: concurrent check() calls (startup race,
  // manual double-click) collapse into one; re-entrants resolve with
  // the currently known outcome.
  const checkingRef = useRef(false);

  // Manual trigger — also run once by the mount effect when autoCheck
  // is on. Resolves true when an update is pending, false otherwise
  // (failures included: mount-time checks stay silent, manual checks
  // surface via `error`).
  const checkForUpdates = useCallback(async (): Promise<boolean> => {
    if (checkingRef.current) return updateRef.current !== null;
    checkingRef.current = true;
    setStatus("checking");
    setError(null);
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setVersion(update.version);
        setStatus("available");
        return true;
      }
      setStatus("idle");
      return false;
    } catch (e) {
      setStatus("idle");
      // Startup checks stay silent (offline / server hiccup are normal);
      // manual checks (autoCheck: false) surface the failure.
      if (!autoCheck) setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      checkingRef.current = false;
    }
  }, [autoCheck]);

  useEffect(() => {
    if (!autoCheck) return;
    void checkForUpdates();
  }, [autoCheck, checkForUpdates]);

  const installAndRestart = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setStatus("installing");
    setError(null);
    try {
      await update.downloadAndInstall();
      setStatus("ready");
      await relaunch();
    } catch (e) {
      // Install failed (signature mismatch, offline mid-download…):
      // surface the reason and go back to available so the user can retry.
      setError(e instanceof Error ? e.message : String(e));
      setStatus("available");
    }
  }, []);

  return { status, version, error, installAndRestart, checkForUpdates };
}
