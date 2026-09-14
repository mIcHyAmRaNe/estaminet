import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";

// Shared popover dismissal: outside pointerdown (capture) closes without
// focus restore; Escape closes and restores focus to the trigger.
// Extracted from LanguageSwitcher + HeaderMenu + TavernCarousel (identical).
// Focus-into-menu on open stays in each component (different selectors).
export function usePopover(
  open: boolean,
  wrapRef: RefObject<HTMLDivElement | null>,
  btnRef: RefObject<HTMLButtonElement | null>,
  setOpen: (v: boolean) => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, wrapRef, btnRef, setOpen]);
}
