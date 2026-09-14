import { useState, useEffect } from "preact/hooks";

// Status toast timing: visible ~3.2s, then a 0.4s fade/slide exit.
// Presentation only — the status string itself is untouched,
// and errors keep their persistent behavior.
// Extracted from AuthStep.tsx + TavernSelect.tsx (identical blocks).
const STATUS_VISIBLE_MS = 3200;
const STATUS_EXIT_MS = 400;

export function useStatusToast(status: string, error: string): {
  showStatus: boolean;
  toastLeaving: boolean;
} {
  const [toastShow, setToastShow] = useState(false);
  const [toastLeaving, setToastLeaving] = useState(false);

  useEffect(() => {
    if (!status || error) return;
    setToastShow(true);
    setToastLeaving(false);
    const hide = setTimeout(() => setToastLeaving(true), STATUS_VISIBLE_MS);
    const gone = setTimeout(() => setToastShow(false), STATUS_VISIBLE_MS + STATUS_EXIT_MS);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, [status, error]);

  const showStatus = status !== "" && !error && toastShow;
  return { showStatus, toastLeaving };
}
