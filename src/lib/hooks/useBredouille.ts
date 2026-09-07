import { useState, useRef, useEffect } from "preact/hooks";
import { BREDOUILLE_MS } from "../config";
import { t } from "../i18n";

export function useBredouille(isConnected: boolean) {
  const [bredouille, setBredouille] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!isConnected && timer.current) {
      window.clearTimeout(timer.current);
      setBredouille(null);
    }
  }, [isConnected]);

  const trigger = (user: string): void => {
    setBredouille(t("bredouille.text", { user }));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setBredouille(null), BREDOUILLE_MS);
  };

  const clear = (): void => {
    if (timer.current) window.clearTimeout(timer.current);
    setBredouille(null);
  };

  return { bredouille, trigger, clear, setBredouille };
}
