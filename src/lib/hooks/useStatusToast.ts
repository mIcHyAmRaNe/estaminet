import { useState, useEffect } from "preact/hooks";
import type { TavernErrorKind } from "./useTaverne";

// Status toast timing: visible ~3.2s, then a 0.4s fade/slide exit.
// Presentation only — the status string itself is untouched,
// and errors keep their persistent behavior — except `room-rejected`,
// which is toast content (floating, auto-dismiss) rather than a blocking
// error (see below).
// Extracted from AuthStep.tsx + TavernSelect.tsx (identical blocks).
const STATUS_VISIBLE_MS = 3200;
const STATUS_EXIT_MS = 400;

function isRoomRejected(error: string, errorKind?: TavernErrorKind | null): boolean {
  return errorKind === "room-rejected" && error !== "";
}

export function useStatusToast(
  status: string,
  error: string,
  errorKind?: TavernErrorKind | null,
): {
  showStatus: boolean;
  toastLeaving: boolean;
  showRoomRejected: boolean;
  roomRejectedLeaving: boolean;
} {
  // `room-rejected` never blocks the status toast: it renders as its own
  // floating toast (showRoomRejected below), and the hook-level TTL clears
  // the message ~3.5s after display so later statuses are never stuck
  // behind it either. All other errors keep the persistent blocking
  // behavior.
  const blockingError = errorKind === "room-rejected" ? "" : error;

  const [toastShow, setToastShow] = useState(false);
  const [toastLeaving, setToastLeaving] = useState(false);

  useEffect(() => {
    if (!status || blockingError) return;
    setToastShow(true);
    setToastLeaving(false);
    const hide = setTimeout(() => setToastLeaving(true), STATUS_VISIBLE_MS);
    const gone = setTimeout(() => setToastShow(false), STATUS_VISIBLE_MS + STATUS_EXIT_MS);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, [status, blockingError]);

  // `room-rejected` error toast: same timing/presentation as the status
  // toast (the view renders it with .auth-status). Visibility is gated on
  // the live error text — the hook-level TTL clears the message after
  // display, which unmounts the toast (tail of the exit fade).
  const [rejectedShow, setRejectedShow] = useState(false);
  const [rejectedLeaving, setRejectedLeaving] = useState(false);

  useEffect(() => {
    if (!isRoomRejected(error, errorKind)) return;
    setRejectedShow(true);
    setRejectedLeaving(false);
    const hide = setTimeout(() => setRejectedLeaving(true), STATUS_VISIBLE_MS);
    const gone = setTimeout(() => setRejectedShow(false), STATUS_VISIBLE_MS + STATUS_EXIT_MS);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, [error, errorKind]);

  const showStatus = status !== "" && !blockingError && toastShow;
  const showRoomRejected = isRoomRejected(error, errorKind) && rejectedShow;
  return { showStatus, toastLeaving, showRoomRejected, roomRejectedLeaving: rejectedLeaving };
}
