/**
 * Écus formatting (Lane F1 — social/economy).
 * Server prices / purse are in centimes; 100 centimes = 1 écu.
 */
export function formatEcus(centimes: number): string {
  const e = centimes / 100;
  return Number.isInteger(e) ? String(e) : e.toFixed(2);
}
